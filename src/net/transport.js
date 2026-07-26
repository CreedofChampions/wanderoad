/* Wanderoad — the transport adapter.
 *
 * One method, `send(payload)`, POSTing to one endpoint. The game does not care which
 * backend answers, so this file owns the choice and hides it.
 *
 * Why one fused write+read endpoint: Base44's realtime socket is receive-only and is not
 * guaranteed to work at all for anonymous users, so the game has to be fully playable over
 * plain HTTPS request/response. Every tick therefore sends our car and gets the nearby
 * peers back in the same round trip. A socket, if we ever add one, is a latency
 * optimisation layered on top — never a requirement.
 *
 * Fallback order for `backend: 'auto'`:
 *   base44 (if an appId was given) -> php -> local
 * The chain is resolved on the first real send rather than by a separate probe, so a cold
 * start costs one request, not two. Whichever backend answers first is pinned; if the
 * pinned one then fails repeatedly the chain is re-walked, which is what happens when a
 * phone drops off wifi mid-drive.
 *
 * The identity envelope (`v`, `secret`, `name`, `t`) is stamped on here rather than by the
 * callers. One file touches the secret, so there is exactly one place to audit that it
 * never reaches a URL, a log line or the DOM.
 */

import { getName, getPlayerId, getSecret } from './identity.js';

/** Hard body cap. The servers enforce it too; failing here makes an oversized save loud. */
export const MAX_BODY = 8192;
/** A tick is worthless once it is this stale, so there is no point waiting longer. */
const TIMEOUT_MS = 6000;
/** Consecutive failures before we give up on the pinned backend and re-walk the chain. */
const DEMOTE_AFTER = 5;

/**
 * @param {object} [opts]
 * @param {'auto'|'base44'|'php'|'local'} [opts.backend]
 * @param {string|null} [opts.base44AppId] app id from the Base44 editor URL
 * @param {string} [opts.phpBase] directory holding drive.php / state.php
 * @returns {{
 *   send(payload: object): Promise<object>,
 *   ready(): Promise<string>,
 *   backend: string,
 *   info(): object,
 *   close(): void
 * }}
 */
export function createTransport({ backend = 'auto', base44AppId = null, phpBase = './api/' } = {}) {
  const base = phpBase.endsWith('/') ? phpBase : `${phpBase}/`;

  const drivers = {
    base44: base44AppId ? makeBase44Driver(base44AppId) : null,
    php: makePhpDriver(base),
    local: makeLocalDriver(),
  };

  const chain =
    backend === 'auto'
      ? ['base44', 'php', 'local'].filter((k) => drivers[k])
      : [backend, 'local'].filter((k, i, a) => drivers[k] && a.indexOf(k) === i);

  const state = {
    pinned: null,
    fails: 0,
    lastMs: 0,
    sent: 0,
    errors: 0,
    lastError: null,
  };

  // Resolves the first time a backend answers. The HUD uses it to show what we connected
  // to; nothing in the game loop waits on it, because the loop must run offline too.
  let announce = null;
  const resolved = new Promise((r) => {
    announce = r;
  });

  function pin(name) {
    state.pinned = name;
    state.fails = 0;
    announce(name);
  }

  /**
   * Stamp the envelope, serialise once, and refuse anything over the cap — callers size
   * their own payloads (see WorldSave's upload budget) so an oversized body is a bug, not
   * a runtime condition to paper over.
   */
  function encode(payload) {
    const body = JSON.stringify({
      v: 1,
      secret: getSecret(),
      name: getName(),
      t: Date.now(),
      ...payload,
    });
    if (body.length > MAX_BODY) {
      throw new Error(`[net] payload ${body.length} B exceeds the ${MAX_BODY} B cap`);
    }
    return body;
  }

  async function attempt(name, body) {
    const t0 = Date.now();
    const res = await drivers[name].send(body);
    state.lastMs = Date.now() - t0;
    if (!res || typeof res !== 'object') throw new Error(`[net] ${name} returned a non-object`);
    return res;
  }

  async function send(payload) {
    const body = encode(payload);

    if (state.pinned) {
      try {
        const res = await attempt(state.pinned, body);
        state.fails = 0;
        state.sent++;
        return res;
      } catch (err) {
        state.fails++;
        state.errors++;
        state.lastError = String(err && err.message ? err.message : err);
        if (state.fails < DEMOTE_AFTER) throw err;
        // The pinned backend has gone away. Fall through and re-walk from the top.
        console.error(`[net] ${state.pinned} failed ${state.fails}x, re-probing`, state.lastError);
        state.pinned = null;
        state.fails = 0;
      }
    }

    let lastErr = null;
    for (const name of chain) {
      try {
        const res = await attempt(name, body);
        pin(name);
        state.sent++;
        return res;
      } catch (err) {
        lastErr = err;
        state.lastError = String(err && err.message ? err.message : err);
        // Not an error: walking the chain IS the selection mechanism, and a backend that is
        // not present on this host is the normal case (there is no PHP on a dev server).
        // Logging it as an error trains everyone to ignore console errors.
        if (name !== 'local') console.info(`[net] ${name} not available here, trying the next backend`);
      }
    }
    state.errors++;
    // 'local' cannot throw, so reaching here means the chain was empty.
    throw lastErr ?? new Error('[net] no transport available');
  }

  /** Resolves to the backend name once one has actually answered. Never rejects. */
  function ready() {
    return resolved;
  }

  return {
    send,
    ready,
    get backend() {
      return state.pinned ?? (chain[0] || 'local');
    },
    info() {
      return {
        backend: state.pinned ?? 'unresolved',
        chain: chain.slice(),
        phpBase: base,
        appId: base44AppId,
        lastMs: state.lastMs,
        sent: state.sent,
        errors: state.errors,
        lastError: state.lastError,
      };
    },
    close() {
      for (const k of Object.keys(drivers)) drivers[k]?.close?.();
    },
  };
}

/* ── php ───────────────────────────────────────────────────────────────────*/

function makePhpDriver(base) {
  const url = `${base}drive.php`;
  return {
    async send(body) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: ctrl.signal,
          // The secret lives in the body; there is no cookie and nothing to send.
          credentials: 'omit',
          cache: 'no-store',
        });
        if (!res.ok) {
          // The status rides along so the tick loop can back off on a 429 instead of
          // treating a rate limit like a dead server.
          const err = new Error(`HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/* ── base44 ────────────────────────────────────────────────────────────────
 * The SDK is imported lazily so a PHP-only build never pays for it, and so a missing
 * package degrades to the next backend instead of breaking the bundle.
 */

function makeBase44Driver(appId) {
  let clientPromise = null;

  function client() {
    if (!clientPromise) {
      clientPromise = import('@base44/sdk').then((sdk) => sdk.createClient({ appId }));
    }
    return clientPromise;
  }

  return {
    async send(body) {
      const b44 = await client();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        // functions.fetch keeps us on one code path with the PHP driver: same JSON body,
        // same status handling. invoke() would wrap the payload and hide the status code.
        const res = await b44.functions.fetch('/drive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: ctrl.signal,
        });
        if (!res.ok) {
          // The status rides along so the tick loop can back off on a 429 instead of
          // treating a rate limit like a dead server.
          const err = new Error(`HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    },
    close() {
      clientPromise?.then((b44) => b44.cleanup?.()).catch(() => {});
      clientPromise = null;
    },
  };
}

/* ── local ─────────────────────────────────────────────────────────────────
 * The always-succeeds backend. Single player must work with the network unplugged, and it
 * must work identically, so this answers the same shape as the real servers: you are alone,
 * your save round-trips in memory, and the tick rate is the solo rate.
 */

function makeLocalDriver() {
  const saves = new Map();
  return {
    async send(body) {
      const req = JSON.parse(body);
      const now = Date.now();
      const id = getPlayerId();
      const res = { now, you: { playerId: id }, peers: [], rate: 0.25 };

      if (req.op === 'save' && Array.isArray(req.ops)) {
        const prev = saves.get(id) ?? { seed: null, visited: [], ops: [] };
        for (const op of req.ops) mergeLocalOp(prev, op);
        saves.set(id, prev);
      } else if (req.op === 'load') {
        res.save = saves.get(id) ?? null;
      }
      return res;
    },
  };
}

/** Mirrors the merge the servers do, so an offline save reloads the same as an online one. */
function mergeLocalOp(save, op) {
  if (!op || typeof op !== 'object') return;
  if (op.k === 'seed') {
    save.seed = op.v | 0;
  } else if (op.k === 'visited') {
    const i = save.visited.findIndex((b) => b.b === op.b);
    if (i < 0) save.visited.push({ b: op.b, d: op.d });
    else save.visited[i] = { b: op.b, d: orBase64(save.visited[i].d, op.d) };
  } else {
    save.ops.push(op);
    if (save.ops.length > 4000) save.ops.splice(0, save.ops.length - 4000);
  }
}

/** Bitsets merge by OR — visiting a region is a fact that never becomes false. */
function orBase64(a, b) {
  const da = atob(a);
  const db = atob(b);
  const n = Math.max(da.length, db.length);
  let out = '';
  for (let i = 0; i < n; i++) {
    out += String.fromCharCode((da.charCodeAt(i) || 0) | (db.charCodeAt(i) || 0));
  }
  return btoa(out);
}
