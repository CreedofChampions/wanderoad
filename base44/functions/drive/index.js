/* Wanderoad — POST /drive on Base44. The byte-for-byte twin of server/drive.php.
 *
 * Write and read are fused on purpose: the request carries your car, the response carries
 * the nearest peers. The game is therefore fully playable over plain HTTPS, which matters
 * here more than anywhere — Base44's realtime socket is receive-only and is not guaranteed
 * to work for anonymous users, and Wanderoad has no login. A socket is a latency
 * optimisation on top of this, never a requirement.
 *
 * Remote cars are ghosts on the client and never collide. That is why there is no
 * authority, no contact arbitration and no rollback in here: a ghost cannot push you off
 * the road, so nothing about it has to be agreed on. This function is a spatial cache with
 * a sanity filter, and nothing more.
 *
 * Runs on Deno. Every entity call goes through asServiceRole because callers are anonymous
 * — they prove who they are by knowing their secret, which is not something row-level
 * security can express. See docs/BACKEND.md.
 */

import { createClientFromRequest } from 'npm:@base44/sdk';

const MAX_BODY = 8192; // bytes; the client enforces the same cap
const EXPIRE_S = 8; // a presence row is dead this long after its last tick
const CELL = 2048; // interest-management cell size, metres
const MAX_PEERS = 16; // nearest N returned
const MAX_SPEED = 105; // m/s — above this the position is a lie
const JUMP_SLACK = 25; // metres of free movement before the jump test bites
const JUMP_FACTOR = 1.6; // how much faster than last reported you may have gone
const RATE_WINDOW_MS = 2000;
const RATE_PLAYER = 6; // requests per window per player
const RATE_IP = 40; // per window per IP — a household shares one address
const SAVE_OPS = 4000; // ops kept per player
const SIGNAL_TTL_S = 30;
const SIGNAL_MAX = 1400; // bytes per signal body

/* ── CORS ──────────────────────────────────────────────────────────────────
 * No cookies are ever used — the secret travels in the body — so credentials are never
 * allowed and there is nothing for a third-party origin to gain by embedding us.
 */
function corsHeaders(req) {
  const origin = req.headers.get('origin') ?? '';
  const ok =
    origin === 'https://crumbtown.org' ||
    origin === 'https://www.crumbtown.org' ||
    /^https:\/\/([a-z0-9-]+\.)*base44\.app$/i.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
  };
  if (ok) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Vary'] = 'Origin';
  }
  return h;
}

const json = (req, body, status = 200) => Response.json(body, { status, headers: corsHeaders(req) });

/* ── helpers ───────────────────────────────────────────────────────────────*/

async function playerIdFrom(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const bytes = new Uint8Array(digest).subarray(0, 6);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Every number off the wire goes through here: no NaN, no Infinity, no silly magnitudes. */
function num(v, limit) {
  const f = typeof v === 'number' ? v : Number.NaN;
  if (!Number.isFinite(f)) return 0;
  return Math.max(-limit, Math.min(limit, f));
}

function int(v, lo, hi) {
  const i = Number.isFinite(v) ? Math.trunc(v) : 0;
  return Math.max(lo, Math.min(hi, i));
}

/**
 * Names are drawn in other players' HUDs: strip controls, zero-width characters and the
 * bidi overrides — one RTL override in a name reorders the whole line it lands in.
 */
function cleanName(v) {
  if (typeof v !== 'string') return '';
  let out = '';
  for (const ch of v) {
    const c = ch.codePointAt(0);
    if (c < 0x20) continue;
    if (c >= 0x7f && c <= 0x9f) continue;
    if (c >= 0x200b && c <= 0x200f) continue;
    if (c >= 0x2028 && c <= 0x202e) continue;
    if (c >= 0x2066 && c <= 0x2069) continue;
    out += ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, 18);
}

/** Matches JS Math.round on the client and floor(v/CELL + 0.5) in the PHP mirror. */
const cellIndex = (v) => Math.round(v / CELL);

/**
 * Adaptive tick rate, decided by the server so it can shed load unilaterally.
 * Alone: 0.25 Hz. A peer within 3 km: 1 Hz. Within 800 m: 2 Hz. The client may burst to
 * 4 Hz when its own dead reckoning diverges, which is what makes close racing feel live
 * without paying for 4 Hz across an empty continent.
 */
function rateFor(nearest) {
  if (nearest <= 800) return 2;
  if (nearest <= 3000) return 1;
  return 0.25;
}

/* Fixed-window limiter held in the isolate. Best effort by design: Base44 recycles
 * isolates, and a limiter that survives that would cost two entity round trips on every
 * single tick. The cost of a missed window is one extra request, not a security hole. */
const buckets = new Map();
function rateOk(key, limit, now) {
  const b = buckets.get(key);
  if (!b || now - b.win >= RATE_WINDOW_MS) {
    buckets.set(key, { n: 1, win: now });
    if (buckets.size > 4096) {
      for (const [k, v] of buckets) if (now - v.win >= RATE_WINDOW_MS) buckets.delete(k);
    }
    return true;
  }
  b.n++;
  return b.n <= limit;
}

/* ── save merge ────────────────────────────────────────────────────────────*/

/** Visited bitsets merge by OR: having been somewhere never becomes false. */
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

function mergeSave(save, ops) {
  const visited = save.visited ?? [];
  const log = save.ops ?? [];
  const byBlock = new Map(visited.map((e, i) => [e.b, i]));
  const seen = new Set(log.map((o) => o?.n).filter((n) => n));
  let seed = save.seed ?? null;

  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    if (op.k === 'seed') {
      seed = int(op.v, 0, 0xffffffff);
    } else if (op.k === 'visited') {
      if (typeof op.b !== 'string' || typeof op.d !== 'string') continue;
      if (!/^-?\d+,-?\d+$/.test(op.b) || op.d.length > 64) continue;
      const at = byBlock.get(op.b);
      if (at === undefined) {
        byBlock.set(op.b, visited.length);
        visited.push({ b: op.b, d: op.d });
      } else {
        visited[at] = { b: op.b, d: orBase64(visited[at].d, op.d) };
      }
    } else if (op.k !== 'rtc') {
      if (op.n && seen.has(op.n)) continue;
      if (op.n) seen.add(op.n);
      log.push(op);
    }
  }
  return { seed, visited, ops: log.length > SAVE_OPS ? log.slice(-SAVE_OPS) : log };
}

/* ── the handler ───────────────────────────────────────────────────────────*/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'POST only' }, 405);

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json(req, { error: 'body too large' }, 413);

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(req, { error: 'bad json' }, 400);
    }
    if (!body || typeof body !== 'object') return json(req, { error: 'bad json' }, 400);

    const secret = body.secret;
    if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) {
      return json(req, { error: 'bad secret' }, 400);
    }
    // The id is derived, never accepted: without the secret you cannot claim a row.
    const me = await playerIdFrom(secret);

    const nowMs = Date.now();
    const nowS = nowMs / 1000;
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    if (!rateOk(`p:${me}`, RATE_PLAYER, nowMs) || !rateOk(`i:${ip}`, RATE_IP, nowMs)) {
      return json(req, { error: 'slow down' }, 429);
    }

    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;
    const op = typeof body.op === 'string' ? body.op : 'tick';
    const res = { now: nowMs, you: { playerId: me }, peers: [], rate: 0.25 };

    // Sweep on roughly one request in sixteen. Cheap, and it keeps the tables the size of
    // the live population rather than of everyone who ever played.
    if (Math.random() < 0.0625) {
      await db.Presence.deleteMany({ seen: { $lt: nowS - EXPIRE_S } }).catch(() => {});
      await db.RtcSignal.deleteMany({ t: { $lt: nowS - SIGNAL_TTL_S } }).catch(() => {});
    }

    const mine = await db.Presence.filter({ playerId: me }, '-seen', 1);
    const prev = mine[0] ?? null;

    if (op === 'bye') {
      if (prev) await db.Presence.delete(prev.id);
      return json(req, res);
    }

    /* ── save / load ─────────────────────────────────────────────────────── */
    if (op === 'save' || op === 'load') {
      const rows = await db.WorldSave.filter({ playerId: me }, '-updated', 1);
      const row = rows[0] ?? null;
      let save = row ? { seed: row.seed ?? null, visited: row.visited ?? [], ops: row.ops ?? [] }
        : { seed: null, visited: [], ops: [] };

      if (op === 'save') {
        save = mergeSave(save, Array.isArray(body.ops) ? body.ops : []);
        const record = { playerId: me, seed: save.seed ?? undefined, visited: save.visited, ops: save.ops, updated: nowS };
        if (row) await db.WorldSave.update(row.id, record);
        else await db.WorldSave.create(record);
      }
      res.save = save;
      return json(req, res);
    }

    /* ── leaderboard ─────────────────────────────────────────────────────────
     * Submit-and-fetch in one call, the same fused idiom as the tick below: the request
     * carries your best, the response carries the top of the table. One round trip.
     *
     * MONOTONIC BY CONSTRUCTION. A row only ever moves up — a submission lower than what is
     * already stored is ignored rather than written. That is not politeness, it is what stops
     * a player losing their place because they opened the game and immediately hit a tree, and
     * it means the client can submit as often as it likes without needing to know the state.
     *
     * Filtered by SEED, because a streak on one world is not comparable to a streak on another:
     * different roads, different corners, different luck. Ranking them together would be
     * meaningless and would quietly reward whoever found the straightest world.
     */
    if (op === 'board') {
      const seed = Number.isFinite(body.seed) ? Math.max(0, Math.floor(body.seed)) : 0;
      const claim = Number.isFinite(body.best) ? Math.max(0, Math.floor(body.best)) : 0;

      /* The one number a stranger supplies, so it is bounded here as well as on the client.
       * 4000 km is far past any real run and still cheap to store; beyond that the submission
       * is a bug or a liar, and either way it does not belong on the board. */
      if (claim > 0 && claim <= 4000000) {
        const rows = await db.Leaderboard.filter({ playerId: me, seed }, '-best', 1);
        const row = rows[0] ?? null;
        if (!row) {
          await db.Leaderboard.create({
            playerId: me, seed, best: claim, at: nowS,
            name: cleanName(body.name) || '',
          }).catch(() => {});
        } else if (claim > (row.best ?? 0)) {
          await db.Leaderboard.update(row.id, {
            best: claim, at: nowS, name: cleanName(body.name) || row.name || '',
          }).catch(() => {});
        }
      }

      const top = await db.Leaderboard.filter({ seed }, '-best', 20).catch(() => []);
      res.board = top.map((r, i) => ({
        rank: i + 1,
        name: r.name || 'someone',
        best: r.best ?? 0,
        you: r.playerId === me,
      }));
      return json(req, res);
    }

    /* ── tick ────────────────────────────────────────────────────────────── */
    const car = body.car && typeof body.car === 'object' ? body.car : {};
    let x = num(car.x, 1e7);
    let y = num(car.y, 1e5);
    let z = num(car.z, 1e7);

    let rejected = false;
    if (prev) {
      const elapsed = nowS - (prev.seen ?? 0);
      if (elapsed > 0 && elapsed <= EXPIRE_S) {
        const dist = Math.hypot(x - prev.x, y - prev.y, z - prev.z);
        const wasGoing = Math.hypot(prev.vx ?? 0, prev.vy ?? 0, prev.vz ?? 0);
        const allowed = wasGoing * elapsed * JUMP_FACTOR + JUMP_SLACK;
        // Two tests: one catches a sustained impossible speed, the other a single teleport
        // that a low reported velocity would otherwise excuse.
        //
        // The speed test floors elapsed because a burst tick 30 ms after the last one says
        // nothing useful about speed — five metres in 30 ms reads as 166 m/s and would fail
        // every legitimate divergence burst. The 6-per-2 s rate limit is what actually
        // bounds how far a client can walk itself: JUMP_SLACK per request, 75 m/s at the cap.
        if (dist / Math.max(elapsed, 0.25) > MAX_SPEED || dist > allowed) {
          rejected = true;
          x = prev.x;
          y = prev.y;
          z = prev.z;
        }
      }
    }

    const cx = cellIndex(x);
    const cz = cellIndex(z);
    const record = {
      playerId: me,
      // A tick that omits the name keeps the stored one, so one malformed request does not
      // blank a driver out of every other HUD.
      name: cleanName(body.name) || prev?.name || '',
      cell: `c${cx}_${cz}`,
      x, y, z,
      yaw: num(car.yaw, 1e4),
      vx: num(car.vx, 200),
      vy: num(car.vy, 200),
      vz: num(car.vz, 200),
      yawRate: num(car.yawRate, 50),
      steer: num(car.steer, 1),
      throttle: Math.max(0, num(car.throttle, 1)),
      brake: Math.max(0, num(car.brake, 1)),
      gear: int(car.gear, -1, 12),
      tier: int(car.tier, 0, 63),
      paint: int(car.paint, 0, 63),
      flags: int(car.flags, 0, 0xffff),
      t: nowMs,
      seen: nowS,
    };
    if (prev) await db.Presence.update(prev.id, record);
    else await db.Presence.create(record);

    // Interest management: the 3x3 cell neighbourhood is 6144 m across, comfortably wider
    // than the 3 km at which the tick rate rises, so nobody appears out of nowhere.
    const cells = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) cells.push(`c${cx + i}_${cz + j}`);

    const rows = await db.Presence.filter(
      { cell: { $in: cells }, seen: { $gt: nowS - EXPIRE_S } },
      '-seen',
      // Read more than we return: the nearest 16 by true distance can only be picked from
      // a superset, and a busy cell cluster can hold more than 16 cars.
      128,
    );

    let nearest = Infinity;
    const scored = [];
    for (const r of rows) {
      if (r.playerId === me) continue;
      const d = Math.hypot(r.x - x, r.y - y, r.z - z);
      if (d < nearest) nearest = d;
      scored.push([d, {
        id: r.playerId,
        name: r.name ?? '',
        tier: r.tier ?? 0,
        paint: r.paint ?? 0,
        x: r.x, y: r.y, z: r.z,
        yaw: r.yaw ?? 0,
        vx: r.vx ?? 0, vz: r.vz ?? 0,
        yawRate: r.yawRate ?? 0,
        steer: r.steer ?? 0,
        throttle: r.throttle ?? 0,
        brake: r.brake ?? 0,
        flags: r.flags ?? 0,
        t: r.t ?? 0,
      }]);
    }
    // Sorted by true distance, not by cell, so the sixteen you get are the sixteen you can
    // actually see.
    scored.sort((a, b) => a[0] - b[0]);
    res.peers = scored.slice(0, MAX_PEERS).map((p) => p[1]);
    res.rate = rateFor(nearest);
    if (rejected) res.rejected = true;

    /* ── WebRTC relay ────────────────────────────────────────────────────── */
    if (Array.isArray(body.ops)) {
      for (const o of body.ops) {
        if (!o || o.k !== 'rtc') continue;
        if (!/^[0-9a-f]{12}$/.test(o.to ?? '')) continue;
        if (!['offer', 'answer', 'ice'].includes(o.kind)) continue;
        if (typeof o.body !== 'string' || o.body.length === 0 || o.body.length > SIGNAL_MAX) continue;
        // fromId is the derived id, never the claimed one — otherwise anyone could forge
        // an offer from anyone.
        await db.RtcSignal.create({ toId: o.to, fromId: me, kind: o.kind, body: o.body, t: nowS });
      }
    }
    const waiting = await db.RtcSignal.filter({ toId: me, t: { $gt: nowS - SIGNAL_TTL_S } }, 'created_date', 4);
    if (waiting.length) {
      res.signals = waiting.map((s) => ({ from: s.fromId, kind: s.kind, body: s.body }));
      // Delivered once, then forgotten — a signal is only useful to its first reader.
      for (const s of waiting) await db.RtcSignal.delete(s.id);
    }

    return json(req, res);
  } catch (err) {
    console.error('[wanderoad/drive]', err?.message ?? err);
    return json(req, { error: 'server error' }, 500);
  }
});
