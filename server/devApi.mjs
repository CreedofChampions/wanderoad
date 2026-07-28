/* Wanderoad — the multiplayer protocol, in-process, for the dev server and for tests.
 *
 * WHY THIS EXISTS, stated plainly, because a second implementation of a protocol is normally
 * a bad idea and this one is worth it.
 *
 * Multiplayer could not be tested locally AT ALL. A playtest audit put it like this: "this
 * cannot run on the dev server — GET http://localhost:5173/api/drive.php returns index.html
 * (200, HTML body), so createTransport falls through to the 'local' driver, whose store is a
 * Map inside its own closure, so every window is permanently solo." Vite serves index.html
 * for any unmatched path, the PHP driver reads that 200 as success, gets a non-JSON body,
 * throws, and the chain silently demotes to `local`. So the garage's own "Second window here
 * (seat 2)" link hands you a solo game on localhost and always has. Every multiplayer bug in
 * this project's history has therefore been diagnosed either by a script that ticks both
 * sides in lockstep (tools/net-test.mjs — which cannot see a scheduling asymmetry) or by
 * pushing a build to production and opening two tabs, which is a terrible loop to debug in
 * and is exactly how a permanent server-side wedge survived two rounds of "fixed".
 *
 * This module is the same endpoint, in JavaScript, over a Map. It is wired into the Vite dev
 * server as middleware (see vite.config.js), so `npm run dev` now answers /api/drive.php and
 * /api/state.php in-process and two localhost windows are genuinely two players.
 *
 * ── the contract with server/drive.php ────────────────────────────────────────
 * drive.php REMAINS the production server and the source of truth. This file's job is to be
 * indistinguishable from it over the wire for the ops the game actually uses, and in
 * particular to implement the SAME position filter with the SAME constants — because that
 * filter is where the "player 2 never sees player 1" bug lived, and a dev mirror that quietly
 * disagrees with production about it would hide the very class of bug it exists to expose.
 * The constants below are copied from drive.php's own const block and tools/net-devapi.mjs
 * asserts, by reading drive.php's text, that they still match. If you change one, change both.
 *
 * Deliberately NOT mirrored, because none of it can be exercised by two tabs on one machine
 * and each would be a second thing to keep in step: the rate limiter, the WebRTC signal
 * relay, the sweep, and SQLite persistence. A dev server restart forgets everybody, which is
 * the correct behaviour for a dev server.
 */

import { createHash } from 'node:crypto';

/* ── constants, copied from server/drive.php ──────────────────────────────────*/
export const WR_EXPIRE_S = 8.0;
export const WR_CELL = 2048.0;
export const WR_MAX_PEERS = 16;
export const WR_MAX_SPEED = 105.0;
export const WR_JUMP_SLACK = 25.0;
export const WR_JUMP_FACTOR = 1.6;

const num = (v, limit) => {
  const f = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(f)) return 0;
  return Math.max(-limit, Math.min(limit, f));
};
const int = (v, lo, hi) => {
  const i = Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0;
  return Math.max(lo, Math.min(hi, i));
};
/* drive.php's wr_name(): names are drawn in other players' HUDs, so controls, zero-width
 * characters and the bidi overrides come out - one RTL override in a name reorders the
 * whole line it lands in. Written with explicit \u escapes rather than pasted literals,
 * because a character class full of invisible characters is unreadable and unreviewable. */
const NAME_STRIP = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g;
const name = (v) =>
  typeof v === 'string' ? v.replace(NAME_STRIP, '').replace(/\s+/g, ' ').trim().slice(0, 18) : '';

const cellIndex = (v) => Math.round(v / WR_CELL);
const cellKey = (x, z) => `c${cellIndex(x)}_${cellIndex(z)}`;

/** drive.php's wr_rate(), identically. Alone 0.25 Hz, within 3 km 1 Hz, within 800 m 2 Hz. */
export function rateFor(nearest) {
  if (nearest <= 800) return 2.0;
  if (nearest <= 3000) return 1.0;
  return 0.25;
}

/**
 * The position filter, lifted out as a pure function so it can be tested directly and so the
 * one rule that produced the reported bug has exactly one statement of itself here.
 *
 * THE FIX IT CARRIES: on a rejection it walks the stored position TOWARD the claim by the
 * largest legal step, rather than pinning it to the previous position forever. See the long
 * note at the same branch in server/drive.php for the failure this repairs — briefly, pinning
 * is a one-way door, because the next tick finds the client even further away than the last
 * one did, so the row never moves again and every other player is handed a gravestone.
 *
 * @param {{x:number,y:number,z:number,vx:number,vy:number,vz:number,seen:number}|null} prev
 * @param {{x:number,y:number,z:number}} claim
 * @param {number} now seconds
 * @returns {{x:number,y:number,z:number,rejected:boolean}}
 */
export function filterPosition(prev, claim, now) {
  let { x, y, z } = claim;
  if (!prev) return { x, y, z, rejected: false };
  const elapsed = now - prev.seen;
  if (!(elapsed > 0) || elapsed > WR_EXPIRE_S) return { x, y, z, rejected: false };

  const dist = Math.hypot(x - prev.x, y - prev.y, z - prev.z);
  const wasGoing = Math.hypot(prev.vx, prev.vy, prev.vz);
  const allowed = wasGoing * elapsed * WR_JUMP_FACTOR + WR_JUMP_SLACK;
  if (!(dist / Math.max(elapsed, 0.25) > WR_MAX_SPEED || dist > allowed)) {
    return { x, y, z, rejected: false };
  }
  const step = Math.max(allowed, WR_MAX_SPEED * Math.max(elapsed, 0.25));
  if (dist > step && dist > 1e-6) {
    const f = step / dist;
    x = prev.x + (x - prev.x) * f;
    y = prev.y + (y - prev.y) * f;
    z = prev.z + (z - prev.z) * f;
  }
  return { x, y, z, rejected: true };
}

/**
 * One dev world. Not a singleton: tools/net-devapi.mjs makes several, and a test that has to
 * remember to reset global state is a test that will one day forget.
 */
export class DevWorld {
  constructor() {
    /** playerId -> presence row */
    this.presence = new Map();
    /** playerId -> save blob */
    this.saves = new Map();
    this.boot = Math.floor(Date.now() / 1000);
    this.seed = null;
  }

  /** @param {string} secret 64 hex chars — the id is DERIVED, never accepted off the wire. */
  static idFor(secret) {
    return createHash('sha256').update(secret).digest('hex').slice(0, 12);
  }

  /**
   * Handle one request body. Returns `{ status, body }`.
   * @param {object} req the parsed JSON body
   * @param {number} [nowMs] injectable clock — a test must be able to move time without sleeping
   */
  handle(req, nowMs = Date.now()) {
    const secret = req?.secret;
    if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) {
      return { status: 400, body: { error: 'bad secret' } };
    }
    const me = DevWorld.idFor(secret);
    const now = nowMs / 1000;
    const res = { now: Math.round(nowMs), you: { playerId: me }, peers: [], rate: 0.25 };
    const op = typeof req.op === 'string' ? req.op : 'tick';

    if (op === 'bye') {
      this.presence.delete(me);
      return { status: 200, body: res };
    }

    if (op === 'save' || op === 'load') {
      const prev = this.saves.get(me) ?? { seed: null, visited: [], ops: [] };
      if (op === 'save' && Array.isArray(req.ops)) {
        for (const o of req.ops) this._mergeOp(prev, o);
        this.saves.set(me, prev);
        if (prev.seed !== null && this.seed === null) this.seed = prev.seed;
      } else if (op === 'load') {
        res.save = this.saves.has(me) ? prev : null;
      }
      return { status: 200, body: res };
    }

    /* ── tick ─────────────────────────────────────────────────────────────── */
    const car = req.car && typeof req.car === 'object' ? req.car : {};
    const claim = {
      x: num(car.x ?? 0, 1e7),
      y: num(car.y ?? 0, 1e5),
      z: num(car.z ?? 0, 1e7),
    };
    const prev = this.presence.get(me) ?? null;
    const filtered = filterPosition(prev, claim, now);

    const row = {
      playerId: me,
      name: name(req.name) || prev?.name || '',
      cell: cellKey(filtered.x, filtered.z),
      x: filtered.x, y: filtered.y, z: filtered.z,
      yaw: num(car.yaw ?? 0, 1e4),
      vx: num(car.vx ?? 0, 200), vy: num(car.vy ?? 0, 200), vz: num(car.vz ?? 0, 200),
      yawRate: num(car.yawRate ?? 0, 50),
      steer: num(car.steer ?? 0, 1),
      throttle: num(car.throttle ?? 0, 1),
      brake: num(car.brake ?? 0, 1),
      gear: int(car.gear ?? 0, -1, 12),
      tier: int(car.tier ?? 0, 0, 63),
      paint: int(car.paint ?? 0, 0, 63),
      flags: int(car.flags ?? 0, 0, 0xffff),
      t: Math.round(nowMs),
      seen: now,
    };
    this.presence.set(me, row);

    /* Interest management: the 3x3 cell neighbourhood, ROUNDED not floored, so the block is
     * centred on you. Same as drive.php. */
    const cx = cellIndex(filtered.x);
    const cz = cellIndex(filtered.z);
    const cells = new Set();
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) cells.add(`c${cx + i}_${cz + j}`);

    const found = [];
    let nearest = Infinity;
    for (const [id, p] of this.presence) {
      if (id === me) continue;
      if (now - p.seen > WR_EXPIRE_S) continue;
      if (!cells.has(p.cell)) continue;
      const d2 = (p.x - filtered.x) ** 2 + (p.y - filtered.y) ** 2 + (p.z - filtered.z) ** 2;
      if (d2 < nearest) nearest = d2;
      found.push([d2, {
        id, name: p.name, tier: p.tier, paint: p.paint,
        x: p.x, y: p.y, z: p.z, yaw: p.yaw,
        vx: p.vx, vz: p.vz, yawRate: p.yawRate,
        steer: p.steer, throttle: p.throttle, brake: p.brake,
        flags: p.flags, t: p.t,
      }]);
    }
    found.sort((a, b) => a[0] - b[0]);
    res.peers = found.slice(0, WR_MAX_PEERS).map((p) => p[1]);
    res.rate = rateFor(nearest === Infinity ? Infinity : Math.sqrt(nearest));
    if (filtered.rejected) res.rejected = true;
    return { status: 200, body: res };
  }

  /** GET /state.php — health and population, nothing identifying. */
  state(nowMs = Date.now()) {
    const now = nowMs / 1000;
    let players = 0;
    for (const p of this.presence.values()) if (now - p.seen <= WR_EXPIRE_S) players++;
    return { ok: true, players, seed: this.seed, uptime: Math.max(0, Math.floor(nowMs / 1000) - this.boot), dev: true };
  }

  _mergeOp(save, op) {
    if (!op || typeof op !== 'object') return;
    if (op.k === 'seed') save.seed = op.v | 0;
    else if (op.k === 'visited') {
      const i = save.visited.findIndex((b) => b.b === op.b);
      if (i < 0) save.visited.push({ b: op.b, d: op.d });
      else save.visited[i] = { b: op.b, d: orBase64(save.visited[i].d, op.d) };
    } else {
      save.ops.push(op);
      if (save.ops.length > 4000) save.ops.splice(0, save.ops.length - 4000);
    }
  }
}

/** Visited bitsets merge by OR — having been somewhere never becomes false. */
function orBase64(a, b) {
  const da = Buffer.from(a, 'base64');
  const db = Buffer.from(b, 'base64');
  const n = Math.max(da.length, db.length);
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) out[i] = (da[i] || 0) | (db[i] || 0);
  return out.toString('base64');
}

/**
 * The Vite plugin. Mount BEFORE Vite's own SPA fallback (configureServer's
 * `server.middlewares.use` runs in registration order and the fallback is added later), which
 * is the whole reason /api/drive.php currently returns index.html.
 */
export function wanderoadDevApi() {
  const world = new DevWorld();
  return {
    name: 'wanderoad-dev-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (url !== '/api/drive.php' && url !== '/api/state.php') return next();

        // CORS: the game may be opened on 127.0.0.1 while the server is on localhost, and
        // those are different origins. No cookies are ever used, so this costs nothing.
        const origin = req.headers.origin;
        if (origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
        }
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (url === '/api/state.php') {
          res.statusCode = 200;
          res.end(JSON.stringify(world.state()));
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'POST only' }));
          return;
        }

        let body = '';
        req.setEncoding('utf8');
        req.on('data', (c) => {
          body += c;
          // The client enforces the same 8 KB cap (net/transport.js MAX_BODY); refusing here
          // rather than buffering keeps a dev server from being a worse citizen than prod.
          if (body.length > 8192) req.destroy();
        });
        req.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(body);
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'bad json' }));
            return;
          }
          const out = world.handle(parsed);
          res.statusCode = out.status;
          res.end(JSON.stringify(out.body));
        });
      });
      server.config.logger.info('  \x1b[32m➜\x1b[0m  multiplayer: /api/drive.php served in-process (dev only)');
    },
  };
}
