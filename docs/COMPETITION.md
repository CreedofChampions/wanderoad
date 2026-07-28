<!-- created by AI -->
# Base44 Dev Build-Off — submission pack

Everything needed to submit, plus a blunt statement of the one thing that is blocking it.

**Deadline:** 28 July 2026. The exact hour is not published anywhere (the competition page, the
form, the X and LinkedIn announcements and the third-party write-up all say "July 21–28" with no
time and no timezone). Treat it as **end of day 27 July** to be safe, not the 28th.

---

## ⛔ THE BLOCKER — two commands, and only the operator can run them

The competition requires the entry to **run on a Base44 backend**. Wanderoad's Base44 backend is
written to spec and has never been deployed. `docs/BACKEND.md` has said so since it was written:

> **written to spec, never deployed** — `base44 login` is a device-code flow that has not been
> completed on this machine

`npx base44 whoami` hangs with no output, which is that same unfinished login.

The game currently runs live on the PHP mirror at `https://crumbtown.org/wanderoad/`. That is a
complete, working backend implementing the identical `/drive` contract — but it is **not Base44**,
and "runs on a Base44 backend" is the one hard entry requirement.

**What the operator has to do, in a terminal, in the repo:**

```bash
npx base44 login
```

That opens a device-code flow — a code to approve in a browser, signed in as whichever account
should own the entry. I will not do this: it is an authentication step, and entering credentials
or approving an account grant on someone's behalf is a line I don't cross even when asked.

Then:

```bash
npx base44 deploy
```

That pushes entities, functions and the site. `docs/BACKEND.md` §"Two things to fix at deploy
time" lists the two gotchas to expect on the first deploy — read it before running, not after.

Once it is deployed, the **App ID** appears in the CLI output and the Base44 dashboard. That is
the last field the form needs.

---

## Submission form — prepared answers

| Field | Answer |
|---|---|
| **Project title** | Cozy Driver |
| **One-line pitch** | An endless, hand-painted road trip — infinite procedural world, ghost-car multiplayer, and nothing to do but drive and feel better. |
| **Surface type** | Game (web). Also ships as a Chrome extension that docks the game beside YouTube. |
| **Live URL** | `https://crumbtown.org/wanderoad/` — replace with the Base44 site URL once deployed, or list both. |
| **GitHub** | `CreedofChampions/wanderoad` |
| **Access instructions** | No login, no account, no install. Open the URL and drive. `?seat=2` in a second window joins as a second player. Esc opens the garage, which lists every control. |
| **Agentic IDE used** | Claude Code |
| **Base44 App ID** | ⛔ available only after `npx base44 deploy` |
| **Video demo** | ⛔ not recorded — see below |
| **Social link** | operator to supply |

### Backend features to tick

Check these against the deployed app before submitting — claim only what the deploy actually
stands up:

- **Database** — three entities (`WorldSave`, `Presence`, `RtcSignal`) under `base44/entities/`
- **Functions** — the fused `drive` endpoint under `base44/functions/drive/`
- **Hosting** — `base44/config.jsonc` builds and serves the Vite site
- **Real-time** — *partially*. `docs/BACKEND.md` records that Base44's realtime socket is
  receive-only and may not work for anonymous users, which is exactly why the game polls a fused
  read/write endpoint instead. Do not tick "real-time" unless the deploy proves otherwise.
- **Auth** — **not used, deliberately.** Identity is 32 random bytes in localStorage. There is no
  login wall in front of the world, and that is a design decision, not a gap.
- **AI / Storage** — not used.

---

## Project write-up (optional but scored)

> **Cozy Driver** is an endless procedural driving game. There is no score, no timer and no fail
> state — you drive, the world builds itself ahead of you, and the only thing being asked of you
> is to stay on the road.
>
> The world is generated, not authored. A hashed lattice produces the road network; two tiers of
> road, curving via a curvature profile laid over cubic Hermite splines, carve themselves into
> terrain built from a climate field that blends five biomes — meadow, steppe, highland, dunes,
> wetland. Nothing is stored: the same seed rebuilds the same world, byte for byte, on any
> machine. Everything above 2 km is a separate layer of smooth domes whose radius is tied to
> their height, so a mountain is guaranteed climbable by construction rather than by hope.
>
> The backend is deliberately small and deliberately fused. One endpoint, `POST /drive`, is both
> the read and the write: you send your car, you get back everyone near you, in one round trip
> against a 2048 m interest cell. There is no login — identity is 32 random bytes in
> localStorage — because a cozy game should not have a wall in front of it. The same contract is
> implemented twice, on Base44 and on plain PHP, and the client takes whichever answers first.
> That was not gold-plating: it is what let the game stay playable while the hosting question was
> still open.
>
> Everything is hand-built in the painted-solid style ported from a Ghibli-flavoured Three.js
> scene: the cars, the hundred roadside props, the petrol stations, the ships on the water. No
> downloaded art beyond seven CC0 car bodies, no GPL anywhere, and every sound — the radio, the
> engine, the ambience — is synthesised in the WebAudio graph rather than sampled.
>
> It is verified the way a game should be: a suite of 40 checks drives a real headless Chrome
> with real key events and measures real pixels and real geometry. It exists because the game
> once shipped completely unplayable behind a suite that passed — CSS had quietly beaten a
> `hidden` attribute. Since then nothing ships unless the browser says "THE GAME WORKS", and the
> gate is the live site, not localhost, because a startup-cost regression once passed locally and
> failed in production.

---

## What is NOT ready

Honest list, so nothing is discovered at the deadline:

1. **The Base44 deploy** — the blocker above. Everything else is downstream of it.
2. **The video demo.** Not recorded. The form asks for one and judges score polish. Screen-record
   two or three minutes: the opening cinematic, a drive through two or three biomes, the streak
   bar filling, a petrol station, and the second window joining as another player.
3. **The live URL field** should probably list the Base44 site as primary once it exists, with
   crumbtown.org as a mirror — the entry requirement is about the backend, and showing both is
   more honest than swapping one for the other silently.
