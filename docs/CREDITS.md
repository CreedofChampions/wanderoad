<!-- created by AI -->
# Wanderoad — credits and licences

The operator's rule is absolute: **no GPL or AGPL anywhere in this project**, so that its
copyleft cannot reach the rest of the work. Everything below is MIT, Apache-2.0, BSD, ISC,
CC0 or public domain. Anything added later must be recorded here with its licence at the time
it is added.

Audited 2026-07-26 across the whole installed tree — 51 packages: MIT ×48, ISC ×1,
BSD-3-Clause ×1, MIT (CC-hosted URL) ×1. **No GPL or AGPL found.**
Re-run with:

```bash
node -e "const fs=require('fs');const bad=[];(function w(d){if(!fs.existsSync(d))return;for(const e of fs.readdirSync(d,{withFileTypes:true})){if(!e.isDirectory())continue;const p=d+'/'+e.name;if(e.name.startsWith('@')){w(p);continue}try{const m=JSON.parse(fs.readFileSync(p+'/package.json','utf8'));const l=(m.license||'?').toString();if(/(^|[^L])GPL/i.test(l))bad.push(m.name+' '+l)}catch{}w(p+'/node_modules')}})('node_modules');console.log(bad.length?bad:'clean')"
```

---

## Code

| What | Licence | Notes |
|---|---|---|
| [three.js](https://threejs.org) | MIT | The renderer. |
| [@base44/sdk](https://www.npmjs.com/package/@base44/sdk) | MIT | Backend client, used only when the Base44 backend is selected. |
| [Vite](https://vitejs.dev) | MIT | Build tool, dev only. |

## Art and visual language

| What | Licence | Notes |
|---|---|---|
| "Hoshi-no-Tani — The Valley of Stars" CodePen | Provided by the operator as the visual reference for this project. | The palette, lighting model (`paint()`), sky, post chain, grass, water, cloud and painted-solid pipelines derive from it. It is the reason the game looks the way it does and it should be credited wherever the game is presented. |
| [Quaternius](https://quaternius.com/packs/cars.html) car models — 7 GLBs in `public/models/cars/` | **CC0 1.0 Universal** (public domain). Attribution not required; given anyway. | Fetched anonymously over plain HTTP from [Poly Pizza](https://poly.pizza). Untextured, so the game re-materials them into its own painted shader. Full text in `public/models/cars/LICENCE.txt`. |
| The 100 roadside props, the petrol stations, and the floating fuel cans — `src/render/props.js` | **This project's own work.** No third-party asset, model, texture or snippet. | See the note below. The fuel can (added 27 July, alongside a fix to petrol-station findability — docs/BACKLOG.md) is built with the same painted primitives as everything else here, so it needs no separate entry beyond this one. |
| Boats on large open water — `src/render/ships.js` | **This project's own work.** No third-party asset, model, texture or snippet. | Added 27 July alongside sea sound and calm-water damping (docs/BACKLOG.md). Same reasoning as the row above: a hull is five painted-pipeline faces (`pquad`/`ptri`) plus an optional cabin (`pbox`) and mast (`pcyl`), coloured from `src/core/palette.js`'s existing paint chips — nothing downloaded, nothing to audit. |
| Litter bins beside the fuel cans, and the cans' glow halo — `src/render/props.js` | **This project's own work.** No third-party asset, model, texture or snippet. | Added 27 July for "fuel cans and trash cans: bigger, and glowing" (docs/BACKLOG.md). The bin is `pcyl`/`pbox` in the same painted pipeline as the other hundred props; the halo is a 64 px radial gradient **drawn at runtime into a `<canvas>`** by `haloTexture()` — generated, not a downloaded sprite sheet, so there is no image file in the repo and nothing to license. |
| The off-road dust spray — `src/game/spray.js` | **This project's own work.** No third-party asset, model, texture, particle library or snippet. | Added 27 July (docs/BACKLOG.md). One `InstancedMesh` of small solid boxes on a stock three.js `MeshBasicMaterial` — no particle engine was added as a dependency and no shader was written. Colours are blended from `src/core/palette.js`'s own sand/dry-grass/rock chips. |
| The fuel-can pick-up chime — `EngineAudio.pickup()`, `src/audio/engine.js` | **This project's own work.** No sample, no sound pack, no third-party service. | **Recorded here deliberately.** The operator offered API keys to a sound-effects service, held in his password manager, for this one sound. Those keys were **not requested, not opened and not used**, and no audio file was downloaded. The chime is a three-note major arpeggio synthesised live in the WebAudio graph the same way the engine, the horn, the radio and the ambience already are — so it adds zero bytes to the download and carries no licence. |

### The 100 points of interest — why nothing was downloaded

The 100 roadside props (`src/world/props.js` for placement, `src/render/props.js` for
geometry) and the petrol stations are **modelled in code**, in this project's own
painted-solid pipeline. **Zero third-party assets were added.** Nothing in this feature needs
a licence audit because there is nothing in it that anyone else wrote.

That was a deliberate choice over importing a hundred CC0 GLBs from Quaternius / Poly Pizza,
and it was made on three grounds:

1. **Licence risk is the whole point of this file.** A hundred separate assets is a hundred
   separate grants to verify, and grants rot: the `ferrari.glb` entry in the "rejected" table
   below is already an example of a licence page that has gone dark and can no longer be
   checked. Zero files is the only number of third-party files that stays clean by itself.
2. **The painted look.** Colour and material index ride on per-vertex attributes here. An
   imported GLB has to be re-materialled by guessing at its material names — `loadedCar.js`
   does exactly that, and it only works because Quaternius happens to name parts plainly.
   Built in code, a prop is in the painting from its first vertex, with the palette from
   `src/core/palette.js` and no texture at all.
3. **Cost.** Because colour is per-vertex, every prop in a 384 m tile — a shrine, a barn, a
   fingerpost, a whole petrol station — bakes into ONE geometry and draws in ONE call. A
   hundred imported meshes would be a hundred materials and a hundred draw calls, for objects
   that are rare by design. Measured: the whole 1.2 km prop window is 20 draw calls and
   ~11 000 triangles.

The precedent is the reference pen itself, which modelled its village, mill, locomotive and
fences the same way; the cars remain the one bought asset because a car silhouette is worth
buying and a fingerpost is not.

The operator's "too cartoony" note about Kenney therefore does not apply to anything shipped:
the props take their proportions and their colours from this game's own palette. If a future
prop *is* imported, it goes in the table above with its name, author, source URL and licence,
and the CC0 / MIT / Apache-2.0 / BSD rule stands unchanged.

<!-- edited by AI from here -->

## Type — nothing downloaded, nothing to license

**There is no font file anywhere in this repository, and no font is fetched at runtime** — no
`@font-face`, no Google Fonts link, no `.woff`/`.woff2`/`.ttf`/`.otf` in `public/` or `src/`.
Every typeface the game uses is a **system font stack** in `src/ui/style.css`, so the browser
draws it with a face the operating system already licensed to the player:

| Where | Stack | Notes |
|---|---|---|
| Instruments, garage, body text — `--serif` | `'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif` | Unchanged. Every entry ships with macOS, iOS or Windows. |
| The **"Cozy Driver"** wordmark — `--cozy` | `Cochin, 'Hoefler Text', 'Book Antiqua', 'Baskerville Old Face', Baskerville, 'Palatino Linotype', Palatino, 'Iowan Old Style', Georgia, serif` | Added with the 27 July rebrand, for the loading card's `<h1>` and the in-game `#gameTitle`. Warmer and rounder than `--serif` so the name reads like a book spine rather than an instrument; falls back through `--serif`'s own faces and finally to the generic `serif` keyword, so it degrades to what the game already looked like rather than to Times. |

Nothing above is distributed by this project, so there is no licence to audit and no GPL/OFL
question to answer. If a font file is ever bundled, it goes in this table with its name,
foundry, source URL and licence, and it must be OFL, MIT, Apache-2.0 or CC0 — the same rule
the rest of this document applies to everything else.

## Audio

All audio is **synthesised at runtime by this project's own code** (`src/audio/engine.js`,
`src/audio/radio.js` and `src/audio/ambience.js`). No recording, sample or musical work is
bundled, so no third-party audio licence applies to the game as shipped. The radio composes
itself from a pentatonic scale and a chord loop; it is original and it does not repeat.

The positional ambience — the surf that grows as you approach a shoreline, and the birds
around woodland — is the same story and was a deliberate choice for the same reason as the
props: **zero files means zero licences to audit, now or later.** Every asset in it:

| Asset | Where it comes from | Licence |
|---|---|---|
| Surf body and the breaking-wave hiss | The engine's existing procedural noise buffer (`src/audio/engine.js`, generated in code) through a high-pass, a swept low-pass and a band-pass | **This project's own work.** No file, no third party. |
| The swell that makes noise read as water | Two sub-audio `OscillatorNode`s at 0.083 and 0.052 Hz modulating a gain | **This project's own work.** |
| Bird calls | Four permanently-running sine `OscillatorNode`s, frequency-swept over 45–120 ms per note from five hand-written call shapes | **This project's own work.** |

No freesound entry, no sample pack and no recording was downloaded, auditioned or bundled for
this feature. Nothing was added to `public/`. The CC0 sources listed below remain evaluated
but unused.

Sources evaluated for a future sample-based engine, kept here so the decision does not have
to be made twice:

| Source | Licence | Verdict |
|---|---|---|
| domasx2 engine loops (OpenGameArt) | CC0 | Usable. The intended set if engine audio moves to RPM-indexed sample crossfading. |
| Freesound #349170 (Iridiuss), idle bed | CC0 | Usable. No attribution required. |
| Freesound #147242 (qubodup) | CC BY 4.0, also offered under GPLv2/v3+ | **Only ever under CC BY.** Never take the GPL option. |
| Antonio-R1/engine-sound-generator | MIT | Usable as code if a physically-modelled engine is ever wanted. |

## Explicitly rejected

| What | Why |
|---|---|
| `ferrari.glb` from the three.js examples | 358k triangles, a trademarked production car, and the upstream Sketchfab page that granted the licence now returns "disabled" — so the grant cannot be verified. Not shippable at any quality bar. |
| Kenney Car Kit for the player's car | CC0 and perfectly usable, but every model shares one `colormap` texture atlas, so body / glass / tyre cannot be separated by material name. Kept as a fallback source for roadside props, where that does not matter. |
| Any GPL or AGPL dependency | The operator's standing rule. |
| Copying Slow Roads' code | The game is closed-source and its writeup is prose. Only the described technique is reusable, and only as a technique. |

## Techniques referenced (no code taken)

- Inigo Quilez — fBm, noise derivatives, domain warping (articles).
- Sebastian Lague — Hydraulic-Erosion (MIT), for the terrain-smoothing approach.
- "Slow Roads" developer writeup — road and terrain architecture, described in prose.
- MicroGSD/RoadArchitect (MIT) and TheDuckCow/godot-road-generator (MIT) — swept-ribbon road
  extrusion, as a technique to port rather than code to copy.
- *The Legend of Zelda: Ocarina of Time* (Nintendo) — cited in `src/game/cinematic.js` purely as
  a reference for the PACE of an opening: four long shots, few cuts, no text. Nothing of it is
  used — no code, no assets, no music, no imagery, no UI. The observation that a good opening is
  unhurried is not anyone's property.
