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

## Audio

All audio is **synthesised at runtime by this project's own code** (`src/audio/engine.js` and
`src/audio/radio.js`). No recording, sample or musical work is bundled, so no third-party
audio licence applies to the game as shipped. The radio composes itself from a pentatonic
scale and a chord loop; it is original and it does not repeat.

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
