/* Wanderoad — does the DRAWN station access spur lie on the ground the car drives on?
 *
 * `tools/diag-seam.mjs` asks this of the main road ribbon (S2: every ribbon vertex against
 * Terrain.height) and holds it to 2 cm. Nothing asked it of the STATION ACCESS SPUR, which is
 * a completely separate piece of drawn tarmac built by render/props.js's buildAccessSpur()
 * as a flat trapezoid between two heights — the real ground at the road mouth and the
 * forecourt's graded pad height. Between those two ends it is a straight line, and the ground
 * under it is not.
 *
 * The operator's report is "the roads that lead to them need to work (no fall through)".
 * A spur whose drawn surface stands ABOVE Terrain.height is exactly that: the wheels are on
 * the heightfield, the tarmac you can see is above your bonnet, and you have driven through
 * a road.
 *
 * The measurement, deliberately the same shape as diag-seam's S2:
 *   - drive a REAL Props tiler to each of the nearest stations so the pad height is the one
 *     the renderer actually baked (`s.padY`), never a re-derivation of it;
 *   - call the REAL buildAccessSpur() into a fresh painted-builder and read its actual
 *     triangles;
 *   - sample a dense grid over the spur's footprint, take the TOP drawn surface at each
 *     sample (max y over every triangle covering it — the skirt quads are vertical so they
 *     only ever contribute at the edge), and compare against Terrain.height at that (x, z).
 *
 *   drawn - ground > 0  ->  the tarmac floats: FALL-THROUGH
 *   ground - drawn > 0  ->  the hill pokes up through the tarmac
 *
 * The same grid is run over the forecourt apron slab for context, because the pad is a
 * deliberately graded slab and its own numbers are the budget the spur has to ramp.
 *
 *   node tools/diag-spur.mjs [seed]
 */

import {
  stationsInBox, stationSpur, STATION_APRON_HALF_WIDTH, STATION_APRON_HALF_DEPTH,
} from '../src/world/props.js';
import { Props, buildAccessSpur } from '../src/render/props.js';
import { LIFT } from '../src/render/road.js';
import { PB } from '../src/render/painted.js';
import { Terrain } from '../src/world/terrain.js';
import { Solids } from '../src/game/collide.js';
import { Object3D } from 'three';

const SEEDS = process.argv[2] ? [Number(process.argv[2]) >>> 0] : [20260726, 7, 424242];
/** How many of the nearest stations to each origin to measure. */
const PER_SEED = 14;
/* The bar, in metres of drawn tarmac standing over the driven ground.
 *
 * NOT diag-seam's 2 cm, and the difference is structural rather than a concession: the road
 * ribbon is drawn on the road's OWN carved deck, so it can sit on it exactly. A driveway ends
 * at a forecourt, and a forecourt is a flat graded slab — where the burial cap (PAD_BURY_MAX)
 * and the door grading fight, the slab wins and the last 30 cm of driveway carries the
 * difference. STATION_MAX_DOOR caps that residue at 0.5 m by dropping the stations that cannot
 * meet it, so 0.6 m is that bound plus the tessellation slack, and anything above it is a real
 * regression rather than geometry.
 *
 * For scale, the same measurement before this round: 16.278 m, with 24 of 42 stations over
 * half a metre. */
const TOL = 0.6;

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(52)} ${String(got).padStart(12)}   want ${want}`);
};

/** Every triangle of a painted-builder mesh, as flat [ax,ay,az, bx,by,bz, cx,cy,cz]. */
function triangles(M) {
  const out = [];
  for (let i = 0; i < M.idx.length; i += 3) {
    const t = [];
    for (let k = 0; k < 3; k++) {
      const v = M.idx[i + k] * 3;
      t.push(M.pos[v], M.pos[v + 1], M.pos[v + 2]);
    }
    out.push(t);
  }
  return out;
}

/** Height of the TOP drawn surface at (x,z), or null if no triangle covers it. */
function topAt(tris, x, z) {
  let best = null;
  for (const t of tris) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue; // vertical/degenerate in plan — the skirt
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const y = l1 * ay + l2 * by + l3 * cy;
    if (best === null || y > best) best = y;
  }
  return best;
}

const scene = new Object3D();

for (const SEED of SEEDS) {
  console.log(`\n── seed ${SEED} ──────────────────────────────────────────────────────`);
  const near = stationsInBox(-6000, -6000, 6000, 6000, SEED)
    .map((s) => ({ s, d: Math.hypot(s.x, s.z) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, PER_SEED);

  const solids = new Solids();
  const props = new Props({ seed: SEED, scene, solids });

  let n = 0;
  let over = 0;
  const rows = [];
  let worstFloat = 0, worstFloatAt = '';
  let worstPoke = 0, worstPokeAt = '';
  let worstApronFloat = 0, worstApronAt = '';
  let samples = 0;

  for (const cand of near) {
    // Bake the real tile so padY is the number the renderer chose, not a re-derivation.
    let live = null;
    for (let i = 0; i < 4000 && !live; i++) {
      props.update(1 / 60, cand.s.x, cand.s.z);
      live = props.stations.find((q) => q.key === cand.s.key) || null;
    }
    if (!live || live.padY == null) continue;
    n++;

    const T = new Terrain(SEED, live.x - 140, live.z - 140, live.x + 140, live.z + 140, 60);
    const sp = stationSpur(live);
    const hRoad = T.height(sp.mouthX, sp.mouthZ);

    // The REAL drawn spur.
    const M = PB();
    buildAccessSpur(M, sp.mouthX, sp.mouthZ, hRoad, sp.apronX, sp.apronZ, live.padY, live.width,
      (x, z) => T.height(x, z));
    const tris = triangles(M);

    // Sample its footprint: along the run, and across the width.
    const dx = sp.apronX - sp.mouthX, dz = sp.apronZ - sp.mouthZ;
    const len = Math.hypot(dx, dz) || 1;
    const tx = dx / len, tz = dz / len;
    const px = -tz, pz = tx;
    let sFloat = 0;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const cxp = sp.mouthX + dx * t, czp = sp.mouthZ + dz * t;
      // half-width at this station, interpolated the way buildAccessSpur flares it
      const halfW = Math.max(1.6, (live.width || 3.2) * 0.5);
      const mouthHalf = Math.min(halfW * 1.35, halfW + 3.0);
      const hw = mouthHalf + (2.7 - mouthHalf) * t;
      for (let j = -3; j <= 3; j++) {
        const o = (j / 3) * hw * 0.96;
        const x = cxp + px * o, z = czp + pz * o;
        const raw = topAt(tris, x, z);
        if (raw === null) continue;
        // The spur floats at exactly the road ribbon's own LIFT on purpose; diag-seam's S2
        // subtracts the same constant before comparing a ribbon vertex to the ground.
        const drawn = raw - LIFT;
        const g = T.height(x, z);
        samples++;
        if (drawn - g > sFloat) sFloat = drawn - g;
        if (drawn - g > worstFloat) {
          worstFloat = drawn - g;
          worstFloatAt = `${live.key} t=${t.toFixed(2)} (${x.toFixed(0)},${z.toFixed(0)}) drawn ${drawn.toFixed(2)} ground ${g.toFixed(2)}`;
        }
        if (g - drawn > worstPoke) {
          worstPoke = g - drawn;
          worstPokeAt = `${live.key} t=${t.toFixed(2)} (${x.toFixed(0)},${z.toFixed(0)}) drawn ${drawn.toFixed(2)} ground ${g.toFixed(2)}`;
        }
      }
    }

    // The apron slab, for context: its top face is flat at padY over the whole rectangle.
    let aFloat = -Infinity, aBury = -Infinity;
    const ca = Math.cos(live.yaw), sa = Math.sin(live.yaw);
    for (let a = -1; a <= 1; a += 0.25) {
      for (let b = -1; b <= 1; b += 0.25) {
        const lx = a * STATION_APRON_HALF_WIDTH, lz = b * STATION_APRON_HALF_DEPTH;
        const x = live.x + lx * ca - lz * sa, z = live.z + lx * sa + lz * ca;
        const d = live.padY - T.height(x, z);
        if (d > aFloat) aFloat = d;
        if (-d > aBury) aBury = -d;
        if (d > worstApronFloat) {
          worstApronFloat = d;
          worstApronAt = `${live.key} local(${lx.toFixed(1)},${lz.toFixed(1)}) pad ${live.padY.toFixed(2)} ground ${T.height(x, z).toFixed(2)}`;
        }
      }
    }
    if (sFloat > 0.5) over++;
    rows.push(`       ${live.key.padEnd(16)} spurFloat ${sFloat.toFixed(2).padStart(7)}  padAbove ${aFloat.toFixed(2).padStart(7)}  padBuried ${aBury.toFixed(2).padStart(7)}  s.y ${live.y.toFixed(1).padStart(7)}  hRoad ${hRoad.toFixed(1).padStart(7)}  padY ${live.padY.toFixed(1).padStart(7)}  placedStep ${live.step.toFixed(2)}`);
  }

  for (const r of rows) console.log(r);
  console.log(`       ${n} stations baked, ${samples} spur surface samples, ${over} with the spur floating > 0.5 m`);
  check(n >= 6, 'stations actually measured', n, '>= 6');
  check(worstFloat <= TOL, 'SPUR drawn tarmac ABOVE the driven ground (m)', worstFloat.toFixed(3), `<= ${TOL} (fall-through)`);
  if (worstFloat > 0.02) console.log(`        worst at ${worstFloatAt}`);
  check(worstPoke <= 1.0, 'SPUR ground poking up through the tarmac (m)', worstPoke.toFixed(3), '<= 1.0');
  if (worstPoke > 0.02) console.log(`        worst at ${worstPokeAt}`);
  console.log(`       context: apron slab stands up to ${worstApronFloat.toFixed(2)} m above the ground under it  (${worstApronAt})`);
}

console.log(failures ? `\n${failures} SPUR CHECK(S) FAILED` : '\nall spur checks passed');
process.exit(failures ? 1 : 0);
