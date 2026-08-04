<!-- created by AI -->
# Wanderoad — backend

Two interchangeable backends implement one endpoint. The client picks whichever answers and
never knows the difference. Single player works with both of them down.

| | PHP | Base44 |
|---|---|---|
| Where | crumbtown.org VPS, OpenLiteSpeed + PHP 8.3 | Base44-hosted Deno function |
| Files | `server/drive.php`, `server/state.php` | `base44/` |
| Store | SQLite outside the docroot | Base44 entities |
| Status | **verified end to end** (see the bottom of this file) | **written to spec, never deployed** — `base44 login` is a device-code flow that has not been completed on this machine |

---

## Why one endpoint, and why write and read are fused

`POST /drive` takes your car and returns the nearby peers in the same response.

Base44's realtime socket is receive-only, and it is not guaranteed to work at all for
anonymous users — Wanderoad has no login. So the game had to be fully playable over plain
HTTPS request/response, and a socket had to be a pure latency optimisation that can be
absent without anything breaking. Fusing the write and the read is what makes that cheap:
one round trip per tick instead of a write plus a poll.

The second half of the design is the rule in `src/net/remotes.js`:

> **Remote cars are ghosts. They never collide, with anything, ever.**

That one rule removes server authority, contact arbitration and rollback from the project.
A ghost cannot push you off the road, so nothing about it has to be agreed on, so the
server can be a dumb spatial cache with a sanity filter. If someone ever adds a collider to
a remote car, the entire netcode has to be rewritten. Don't.

---

## The wire format

### Request — `POST /drive` (PHP: `POST <base>/drive.php`)

```jsonc
{
  "v": 1,
  "secret": "<64 hex>",          // 32 random bytes, localStorage. Body only — never a URL.
  "name": "Amber Fox",           // <=18 chars after sanitisation
  "op": "tick" | "bye" | "save" | "load" | "board",
  "cell": "c12_-3",              // advisory; the server recomputes it from x,z
  "t": 1785072024525,            // client clock, ms
  "car": {
    "x": 0, "y": 0, "z": 0, "yaw": 0,
    "vx": 0, "vy": 0, "vz": 0, "yawRate": 0,
    "steer": 0, "throttle": 0, "brake": 0,
    "gear": 1, "tier": 0, "paint": 3, "flags": 0
  },
  "ops": []                      // save deltas, or {"k":"rtc",...} signalling
}
```

`src/net/transport.js` stamps `v`, `secret`, `name` and `t` on every request, so callers
never touch the secret. One file to audit.

### Response

```jsonc
{
  "now": 1785072024525,          // server clock, ms — the interpolator's time base
  "you": { "playerId": "3138bb9bc78d" },
  "peers": [                     // <=16, nearest first, by true distance
    { "id": "4f2e8d65483c", "name": "Cobalt Wren", "tier": 2, "paint": 7,
      "x": 500, "y": 12, "z": 50, "yaw": 0,
      "vx": 30, "vz": 0, "yawRate": 0,
      "steer": 0, "throttle": 1, "brake": 0, "flags": 0, "t": 1785072026743 }
  ],
  "rate": 2,                     // Hz the client must obey
  "save": { },                   // only for op save/load
  "board": [ ],                  // only for op board — top 20, see "The leaderboard" below
  "rejected": true,              // only when the position failed a sanity check
  "signals": [ ]                 // only when a WebRTC signal was waiting
}
```

Errors are `{"error": "..."}` with a real status code: 400 bad json / bad secret,
405 non-POST, 413 body over 8 KB, 429 rate limited (with `Retry-After`), 500 server error.

### `playerId`

`playerId = SHA-256(secret)[0:12]`, derived **server-side on every request**. It is never
accepted from the client, so nobody can claim someone else's row without their secret. The
secret itself only ever appears in a POST body: never a URL, never a query string, never
rendered, never logged.

---

## Interest management

Presence cell = 2048 m: `c${Math.round(x/2048)}_${Math.round(z/2048)}`. The server queries
the 3x3 neighbourhood (6144 m across), sorts by true 3-D distance, and returns the nearest
16. The neighbourhood is deliberately wider than the 3 km at which the tick rate rises, so
a car is already being tracked before it is close enough to matter.

The PHP mirror computes the cell index as `floor(v/2048 + 0.5)` because that is exactly
what JS `Math.round` does for negative halves, and the two must agree.

## Adaptive tick rate

Server-decided, so it can shed load unilaterally. The client obeys `rate`.

| Situation | Rate |
|---|---|
| Alone | 0.25 Hz |
| A peer within 3 km | 1 Hz |
| A peer within 800 m | 2 Hz |

On top of that the client sends immediately when its own dead reckoning has diverged from
what it last sent by more than **2 m**, **8 degrees of yaw** or **2.5 m/s** — capped at
4 Hz. That burst is what makes close racing feel live without paying for 4 Hz across an
empty continent.

**Budget:** the limiter allows 6 requests per 2 s per player. A 4 Hz burst is therefore
fine for about a second and a half; sustained 4 Hz is not. The tick scheduler must not
exceed 6 requests in any 2 s window. A 429 comes back with `Retry-After: 1`, and
`transport.js` puts the status on the thrown error (`err.status`) so the loop can back off
instead of treating a rate limit like a dead server.

## Expiry and limits

| Rule | Value |
|---|---|
| Presence row TTL | 8 s after the last tick |
| Rate limit, per player | 6 requests / 2 s |
| Rate limit, per IP | 40 requests / 2 s (a household shares one address) |
| Body cap | 8192 bytes, enforced on both ends |
| Peers returned | 16 |
| Save blob | 256 KB, 4000 ops per player |
| WebRTC signal | 1400 bytes, 30 s TTL, delivered once |

Sanity checks on a reported position, both of which pin the position to the previous one
and set `rejected: true`:

* implied speed over `max(elapsed, 0.25) s` above **105 m/s**
* a jump further than `lastReportedSpeed * elapsed * 1.6 + 25` metres

The 0.25 s floor exists because a burst tick 30 ms after the last one says nothing useful
about speed — five metres in 30 ms reads as 166 m/s and would fail every legitimate
divergence burst. What actually bounds a cheat is the rate limit: 25 m per request, six
requests per 2 s, so 75 m/s.

---

## The save

The world is infinite and generated, so none of it is stored — the seed regenerates every
hill, road and tree byte for byte. A save is:

* **seed** — which world this is. A save from another seed is refused on load.
* **visited** — a bitset over 4096 m regions, 256 regions per 32-byte block, base64'd.
  Merged with OR, because having been somewhere never becomes false. Crossing a continent
  costs a few hundred bytes, not a list of coordinates.
* **ops** — an append-only delta log, deduped by the client's monotonic `n`, replayed on
  top of a freshly generated world.

`WorldSave` writes through to IndexedDB immediately (a tab can die at any moment) and to
the backend on a 20 s debounce (it is a shared server and the local copy is already safe).
Uploads are chunked to a 5800-byte budget so they fit inside the 8 KB cap; one `flush()`
drains up to six batches.

---

## The leaderboard

The streak — distance driven without leaving the road — is the only scoring mechanic in
this game, so it is the only thing worth ranking. `op: "board"` is submit-and-fetch in one
call, the same fused idiom as `tick`: the request carries a claimed best (metres), the
response carries the top 20 for the world that claim was set in. `src/net/board.js` is the
client: it polls every 60 s while the panel is open and submits immediately whenever a run
beats the player's own last-sent number, never more often than that.

* **Monotonic by construction, not by convention.** A row only ever moves up. A claim lower
  than what is already on file is silently kept rather than written over — not politeness,
  it is what stops a player losing their place on the board because they opened the game
  again and immediately hit a tree. It also means the client never has to ask the server
  what it already holds before submitting: it can submit on every streak end, and a run
  that ends short simply costs nothing.
* **A claim of exactly `0` never writes.** `src/net/board.js` sends `best: 0` on a plain
  poll that is not reporting a run at all (`refresh()` with nothing to submit), and that
  must return the board without ever creating a row for a player who has not driven yet.
* **Bounded to `(0, 4,000,000]` metres.** 4,000 km is far past any real run and still cheap
  to store; a claim outside that range is a bug or a lie and is discarded outright — not
  clamped down to the cap and accepted, thrown away entirely, claim and all.
* **Filtered by `seed`.** A streak on one procedurally generated world is not comparable to
  a streak on another — different roads, different corners, different luck — so the table
  is scoped per world and every seed gets its own ranking, from a clean table, in the same
  `leaderboard` row space (`PRIMARY KEY(player_id, seed)`, one row per player per world —
  see `wr_db()` in `server/drive.php`).
* **Thin on purpose.** No history, no per-run rows, no fields beyond what the board renders.
  A leaderboard that stores every attempt is a table that grows without limit for a number
  nobody reads twice — see the comment at the top of `base44/entities/Leaderboard.jsonc`.

The response's `board` is an array, nearest-to-first-place order, capped at 20:

```jsonc
"board": [
  { "rank": 1, "name": "Amber Fox", "best": 48213, "you": false }
]
```

`name` falls back to `"someone"` for a row whose player never set one. `you` is `true` for
the row belonging to the caller's own derived `playerId`, so the client can highlight its
own entry without comparing ids itself. Ties are broken however the backing store already
orders equal values — neither backend imposes a secondary sort — since the entity schema's
`at` field only documents an ordering intent that was never wired into either the Base44
function or this PHP port; treat it as informational, not a guarantee.

---

## Switching the client between backends

```js
import { createTransport } from './net/transport.js';

createTransport();                                     // auto: php -> local
createTransport({ base44AppId: 'abc123' });             // auto: base44 -> php -> local
createTransport({ backend: 'php', phpBase: './api/' }); // force PHP
createTransport({ backend: 'base44', base44AppId: 'abc123' });
createTransport({ backend: 'local' });                  // offline; single player still works
```

`auto` does not probe separately — it walks the chain on the first real send, so a cold
start costs one request, not two. Whichever backend answers is pinned; five consecutive
failures re-walk the chain, which is what happens when a phone drops off wifi mid-drive.
`transport.ready()` resolves to the backend name once one has answered;
`transport.info()` gives `{backend, chain, lastMs, sent, errors, lastError}` for the HUD.

The `local` backend always succeeds and answers the same shape as the real servers: you are
alone, your save round-trips in memory, `rate` is the solo rate. Single player is never a
degraded mode.

---

## Deploying the PHP backend

`python deploy/deploy.py` already does all of this:

```
dist/          -> /home/admin/domains/crumbtown.org/public_html/wanderoad/
server/*.php   -> .../wanderoad/api/
data dir       -> /home/admin/domains/crumbtown.org/wanderoad_data/   (OUTSIDE the docroot)
```

The data directory is outside the docroot so a webserver misconfiguration cannot serve the
SQLite file. `drive.php` creates the directory if it is missing and honours a
`WANDEROAD_DATA` environment variable, which is how it is tested without touching the live
tree.

`state.php` `require_once`s `drive.php` for the schema, the connection and the CORS rules —
one definition of each. `drive.php`'s handler only runs when it is the request's own entry
point, so including it is free.

Health check: `curl https://crumbtown.org/wanderoad/api/state.php`

```json
{"ok":true,"players":2,"seed":20260726,"uptime":25}
```

`seed` is pinned by the first save that names one. `uptime` is seconds since the database
was created.

### CORS

Allowed origins: `https://crumbtown.org`, `https://www.crumbtown.org`, any
`*.base44.app`, and `http://localhost:*` / `http://127.0.0.1:*` for the Vite dev server.
`OPTIONS` returns 204. Credentials are never allowed — there are no cookies, the secret is
in the body — so there is nothing for a third-party origin to gain by embedding us.

### Hardening

* Prepared statements only. No user string is ever concatenated into SQL; even the nine
  cell names in the interest query are bound parameters, and they are computed from the
  server's own floats, not from the client's `cell` string.
* JSON in, JSON out. Every number off the wire goes through a clamp that rejects NaN and
  Infinity; every integer through a range clamp.
* Names are stripped of C0/C1 controls, zero-width characters and the bidi overrides (one
  RTL override in a name reorders the whole HUD line it lands in), then truncated to 18
  codepoints. Invalid UTF-8 is dropped outright — `json_encode` would fail on it and take
  down the response for everyone in the cell.
* Expired presence rows, delivered signals and stale rate-limit rows are swept on roughly
  one request in sixteen, so the tables stay the size of the live population.

---

## Deploying the Base44 backend

```bash
npx base44 login          # device-code flow — NOT completed on this machine
npx base44 create         # or: npx base44 link, for an existing app
npx base44 deploy         # entities + functions + site
```

`base44/config.jsonc` sets `visibility: public` (there is no login to put in front of the
world) and a `site` block with `installCommand: npm ci`, `buildCommand: npm run build`,
`outputDirectory: ./dist`.

### Entities

Names must match `^[a-zA-Z0-9]+$` — the CLI rejects underscores.

| Entity | What it is |
|---|---|
| `Presence` | One row per live car. Written every tick, read by everyone in the 3x3 neighbourhood, expired after 8 s. Nothing in it is authoritative. |
| `WorldSave` | One row per player: seed, visited bitset, op log. Merged, never overwritten, so two devices converge. |
| `RtcSignal` | A one-shot mailbox for a WebRTC offer/answer/ICE. Optional latency optimisation; nothing may depend on it. |
| `Leaderboard` | One row per player per seed: longest streak ever, monotonic. See "The leaderboard" above. |

All four set `rls` to deny direct client access on every verb. The `drive` function owns
every read and write through `asServiceRole`. A player who could write `Presence` directly
could put their car anywhere and the sanity checks would never see it; and a player proves
ownership by knowing their secret, which is not something row-level security can express —
Base44 rows are keyed to accounts, and Wanderoad has none.

### Two things to fix at deploy time

1. **The function entry file.** Base44 expects `entry.ts` or `entry.js` in the function
   directory. This repo has `base44/functions/drive/index.js`. Either rename it, or add
   `base44/functions/drive/function.jsonc`:

   ```jsonc
   { "name": "drive", "entry": "index.js" }
   ```

2. **`site.outputDirectory`.** The documented paths in `config.jsonc` are relative to the
   config file, which would make `./dist` mean `base44/dist`. The value is written as
   `./dist` because that is what the full-stack template uses; if the first `site deploy`
   uploads an empty site, change it to `../dist`.

### Differences from the PHP mirror

Behaviour is identical; two implementation details are not:

* The rate limiter is an in-memory `Map` in the Deno isolate, not a table. Base44 recycles
  isolates, so it is best effort — a limiter that survived recycling would cost two entity
  round trips on every single tick, and the cost of a missed window is one extra request,
  not a security hole.
* `Presence` is read with a `$in` filter across the nine cells with a limit of 128, then
  the nearest 16 are picked in the function. The PHP path does the same thing in SQL and
  PHP respectively.

---

## Verification

Client modules, on Node 24:

```
npx acorn --ecma2022 --module <each file>            -> parse OK
node --input-type=module -e "import(...)"            -> loads, exports as documented
```

`src/net/identity.js`'s SHA-256 was fuzzed against `node:crypto` over 300 inputs
(0 mismatches) and matches the standard `abc` and empty-string vectors.

`src/net/remotes.js` was driven at 60 fps against a synthetic 1 Hz peer following a
terrain-shaped path at 30 m/s: worst horizontal error against ground truth **0.0000 m**,
worst 3-D error **0.237 m** (the residual is vertical, where there is no reported velocity
and vy is measured from the last two samples). Teleport snapped, yaw crossing +/-PI stayed
on the short arc, extrapolation stopped at 1.2 s, and the peer despawned on expiry.

`server/drive.php` and `server/state.php` were run on the real target — PHP 8.3.31 with
pdo_sqlite on the crumbtown.org VPS — and exercised end to end: preflight, CORS allow and
refusal, 405/413/429, two players seeing each other, the tick rate rising to 2 Hz, a
teleport rejected, a distant player correctly excluded, a save/load round trip with bitsets
OR'd and ops deduped, a WebRTC signal delivered exactly once, the rate limiter allowing
exactly six requests then 429ing, and `'); DROP TABLE presence;--` in both the name and the
cell doing nothing but getting truncated to 18 characters. No warnings or errors in the
PHP log.

The Base44 side is **unverified**: `base44 login` is a device-code flow that has not been
completed on this machine, so nothing could be pushed or run. It was written against the
CLI and SDK documentation and mirrors the PHP implementation statement for statement.
