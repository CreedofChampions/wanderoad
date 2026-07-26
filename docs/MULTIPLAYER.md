<!-- created by AI -->
# Wanderoad — multiplayer

There is one world and everybody is already in it. There are no lobbies, no rooms, no
invites and no accounts. You drive, and when someone else is within a few kilometres of you
their car appears. That is the whole feature.

This file is how you *play* it with someone, and how you *prove* it works.
`docs/BACKEND.md` is the wire format and the server; this is the human end.

---

## Play with someone

### Two windows on one computer

Open the **Garage** (`Escape` or `M`) and use **Drive together**. It shows the address of a
second seat and will open it for you.

You need that panel — you cannot just open the game twice. An identity is one secret in
`localStorage`, and every tab of a browser profile shares it, so a second window is *the
same driver*. The server then correctly leaves you out of your own peer list, and the two
windows sit on top of each other seeing nothing. That is exactly what was reported as
"2 cars in same place don't see each other", and it is correct behaviour for one person in
two tabs — it is just useless for playing together.

`?seat=2` forks the identity: its own secret, so its own player id, its own name, its own
paint. Nothing else changes.

```
https://crumbtown.org/wanderoad/            ← you
https://crumbtown.org/wanderoad/?seat=2     ← the other seat, same computer
https://crumbtown.org/wanderoad/?seat=3     ← a third
```

Seats are separate saved drivers, not throwaways: seat 2 keeps its own name, paint and
streak between visits, so two people sharing a machine each stay themselves. `?seat` with no
value is read as seat 2, and `?seat=1` is the driver you already are — seat 1 is the
unseated window, not a third person.

### Someone on another computer

Send them the page's address. Their machine has its own storage and therefore its own
driver, so **no seat parameter** — a seat is only for sharing one browser profile.

The one thing that must match is the world. If you are using `?seed=` or `?terrain=`, send
the address *with those parameters on it*; the Garage panel's second link does that for you.
A different seed is a different planet: presence is shared regardless, so you would see each
other's cars driving through scenery that does not exist on your screen.

### What you will see

- Their car appears at about 6 km — the server hands out peers from a 3×3 grid of 2048 m
  interest cells, 6144 m across, so nobody pops in on top of you.
- The HUD's top-right list shows who is near and how far.
- Remote cars are **ghosts**. They never collide with you, with each other or with the
  world. This is deliberate and permanent; see the rule at the top of `src/net/remotes.js`.
- Positions arrive between 0.25 Hz (alone) and 2 Hz (within 800 m) and are interpolated a
  quarter-second in the past, so a ghost is smooth but is never quite live.
- Stop sending for 8 seconds — close the tab, lose signal — and you disappear from everyone.

The HUD's connection dot says `online` when a real backend is answering and `solo` when the
game fell back to its in-memory local backend. **Solo means nobody will ever appear.** If
you expected company, that dot is the first thing to look at.

---

## Prove it works

```bash
node tools/net-test.mjs                                 # against the live backend
node tools/net-test.mjs --base http://localhost:8080/api/
node tools/net-test.mjs --quiet                         # verdict only
```

It is a **Node** client, not a browser one. It imports `src/net/transport.js` and
`src/net/identity.js` — the same files the game runs — creates two forked identities in one
process, drives them together and asserts each is in the other's peer list. It needs no
browser, no dev server and no port, and it takes about fifteen seconds (most of which is
waiting out the 8 s presence expiry so both cars may legitimately arrive from 6 km away).

Exit code 0 = every check passed, 1 = a check failed, 2 = it could not run at all.

It writes to a real server, so it drives out to (1234000, −987000) — about 1500 km from
spawn — where it cannot clutter a real player's HUD, and both cars say `bye` on the way out.

A real run against production:

```
── wanderoad net-test ─────────────────────────────────────────────
backend  https://crumbtown.org/wanderoad/api/
meeting  1234000, -987000

0. two seats are two players
   seat (default)  id 4cce47fe6e93  name "net-test seat 1"
   seat 2          id 13d0e1446135  name "net-test seat 2"
  PASS  the two seats hold different secrets
  PASS  the two seats are different player ids  (one id here is the "2 cars cannot see each other" bug)

1. the Garage hands out the seat link
  PASS  the panel is attached to the Garage sheet
   second window  https://crumbtown.org/wanderoad/?seed=99&terrain=alpine&seat=2
   a friend       https://crumbtown.org/wanderoad/?seed=99&terrain=alpine
  PASS  the panel shows a seat=2 link
  PASS  the link carries the world you are in  (a different seed is a different planet — you would never meet)
  PASS  the link for another computer asks for no seat
  PASS  an existing seat is replaced, not appended
  PASS  a second window can invite a third
  PASS  nothing in the panel is created hidden
  PASS  copy and open are wired  4 buttons

2. 6 km apart — interest management should hide them from each other
   seat 1 at 1234000, -987000   peers 0  rate 0.25 Hz
   seat 2 at 1240000, -987000   peers 0  rate 0.25 Hz
  PASS  seat 1 cannot see seat 2 from 6 km
  PASS  seat 2 cannot see seat 1 from 6 km
  PASS  alone, seat 1 ticks at the idle rate  0.25 Hz

3. waiting out the 8 s presence expiry, then driving to the meeting point
   t-3  seat 1 at 1233955  sees 0   |   seat 2 at 1234045  sees 1
   t-2  seat 1 at 1233970  sees 1   |   seat 2 at 1234030  sees 1
   t-1  seat 1 at 1233985  sees 1   |   seat 2 at 1234015  sees 1

4. each one is in the other’s peer list
   seat 1 sees  id 13d0e1446135  "net-test seat 2"  at 1234015.0, -987000.0  v(0.0, 0.0)  30.0 m away
   seat 2 sees  id 4cce47fe6e93  "net-test seat 1"  at 1233985.0, -987000.0  v(25.0, 0.0)  30.0 m away
  PASS  seat 1 sees seat 2
  PASS  seat 2 sees seat 1
  PASS  seat 2’s position arrived intact  sent 1234015, -987000 — got 1234015, -987000
  PASS  seat 2’s name arrived intact  "net-test seat 2"
  PASS  seat 1’s position arrived intact  sent 1233985, -987000 — got 1233985, -987000
  PASS  seat 1’s name arrived intact  "net-test seat 1"
  PASS  the server raised the tick rate for a close pass  2 Hz / 2 Hz

5. leaving removes you
   after seat 2 said bye, seat 1 sees 0 peer(s)
  PASS  seat 2 is gone from seat 1’s peer list

OK — 4cce47fe6e93 and 13d0e1446135 saw each other over https://crumbtown.org/wanderoad/api/
```

### Why each check is there

| Check | What it would catch |
|---|---|
| Two seats, two ids | The original bug. One id means both windows are one car and the server rightly hides it from itself. |
| The Garage link | A URL parameter nobody can find is not a feature — and a link missing `?seed=` puts your friend on a different planet. |
| Invisible at 6 km | Interest cells are real, and cars do not appear out of nowhere. |
| Each in the other's peer list | The actual claim. Both directions, because a one-way peer list is a plausible server bug. |
| Positions and names intact | A server echoing your own car back would pass a weaker test. |
| Rate rose to 2 Hz | The server independently agrees they are close — it is not just returning rows. |
| `bye` removes you | The peer list can go down as well as up, so it is not a table that only ever grows. |

If it prints `transport fell back to 'local'`, the server never answered: the transport's
last resort is an in-memory backend that always says you are alone, which would otherwise
be a silent pass. Check the base URL and that `drive.php` is deployed.

---

## When it does not work

| Symptom | Cause |
|---|---|
| Two windows, no cars | Second window has no `?seat=`. It is you. |
| HUD says `solo` | No backend answered; the game is on its in-memory fallback. Nobody will ever appear. |
| You see each other but the land is different | Different `?seed=`. Presence is global; terrain is not. |
| Cars visible then gone for good | Presence expires 8 s after the last tick — a suspended tab or a dead connection. It comes back on the next tick. |
| `429 slow down` | 6 requests per 2 s per player, 40 per 2 s per IP. A household shares one address, so several players on one connection share that 40. |
| Nothing at all from another origin | CORS. `drive.php` allows crumbtown.org, `*.base44.app` and localhost only. |
| Your car snapped back | The server rejected the move as a teleport (`rejected: true`): over 105 m/s, or further than 1.6× your last reported speed plus 25 m of slack. |

`?offline` disables the network entirely, which is the fastest way to tell a multiplayer
problem from a driving one.

---

## Where the code is

| | |
|---|---|
| `src/net/identity.js` | who you are; `createIdentity(seat)` and the `?seat=` fork |
| `src/net/transport.js` | one `send()`, one endpoint, backend fallback chain |
| `src/net/remotes.js` | ghosts: buffering, interpolation, dead reckoning |
| `src/net/invite.js` | the Garage's "Drive together" panel |
| `src/net/save.js` | the map save, over the same endpoint |
| `server/drive.php` | the entire protocol, one file |
| `tools/net-test.mjs` | this page's proof |
