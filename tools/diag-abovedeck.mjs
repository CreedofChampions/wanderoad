/* Wanderoad — is there ever GROUND STANDING ABOVE THE ROAD at the edge of the carriageway?
 *
 * The requirement, as the operator wrote it: "roads never run underwater, and there is never
 * terrain standing above a road." `diag-water.mjs` covers the first half and reports a clean
 * zero. This is the second half, and it is the half that fails: an audit driving the real game
 * found alpine highlands leaving up to 13.55 m of hillside standing at the road's shoulder.
 *
 * The measurement is deliberately the same one the audit made by hand: walk the real road
 * network, and at each sample step out perpendicular to `half-width + PROBE` metres — just off
 * the tarmac, where a wheel that clips the verge lands — and compare `Terrain.height()` there
 * against the road deck at the centreline. Positive means the ground is ABOVE the road.
 *
 * Both sides, because a road cut into a hillside is above the land on one side and below it
 * on the other, and it is only the uphill side that can wall you in.
 *
 *   node tools/diag-abovedeck.mjs [--terrain alpine] [--probe 0.5]
 */

import { Terrain } from '../src/world/terrain.js';
import { setBiomeBias } from '../src/world/biomes.js';
import { applyTerrain, terrainBias } from '../src/game/presets.js';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const SEED = 20260726;
const LAND = arg('terrain', 'alpine');
const PROBE = +arg('probe', 0.5);
/* Above this the ground beside the road is a bank you can see over the bonnet, not a texture
 * detail. Chosen at eye height rather than at zero: the fine common noise layer puts a few
 * centimetres of wobble on everything, and calling that "a wall" would make the number
 * meaningless. */
const WALL = 1.0;

applyTerrain(LAND);
setBiomeBias(terrainBias(LAND));

let samples = 0;
let above = 0;
let worstDelta = 0;
let worstAt = null;
const hist = { '1-2': 0, '2-4': 0, '4-8': 0, '8+': 0 };
let sumAbove = 0;

/* THE BANK PROFILE, and it is the number that actually matters for what the operator saw.
 *
 * The percentage above only ever probes 0.5 m off the tarmac, where the carve is at full
 * strength and the answer is nearly always "level". What he photographed was the ground a few
 * metres FURTHER out standing over the road — the shoulder failing to grade down. So walk out
 * to a set of offsets past the carriageway edge and keep, for each, the distribution of how
 * far the ground stands above the deck. A shoulder that grades properly makes these fall
 * towards zero; a wall keeps them high. */
const BANK_OFFSETS = [4, 8, 12, 16, 24];
const bank = BANK_OFFSETS.map(() => []);

/* A grid of 720 m windows so the sample is not one neighbourhood, matching diag-verge.mjs. */
for (let gx = -3; gx <= 3; gx++) {
  for (let gz = -3; gz <= 3; gz++) {
    const cx = gx * 1500 + 2700;
    const cz = gz * 1500 + 9400; // centred near the audit's own worst point (2693, 9413)
    const T = new Terrain(SEED, cx - 360, cz - 360, cx + 360, cz + 360, 120);
    for (const e of T.roads.edges) {
      const n = e.pts.length / 2;
      for (let k = 1; k < n - 1; k++) {
        const x = e.pts[k * 2],
          z = e.pts[k * 2 + 1];
        if (x < cx - 360 || x > cx + 360 || z < cz - 360 || z > cz + 360) continue;
        let tx = e.pts[k * 2 + 2] - e.pts[k * 2 - 2],
          tz = e.pts[k * 2 + 3] - e.pts[k * 2 - 1];
        const l = Math.hypot(tx, tz) || 1;
        tx /= l;
        tz /= l;
        // Perpendicular in the plane. No handedness assumption: both signs are tested.
        const nx = -tz,
          nz = tx;
        /* THE DECK IS `Terrain.height()` ON THE CENTRELINE, not `e.y[k]`, and the difference is
         * not pedantry — it is worth 9 m at a junction. `e.y` is ONE edge's profile; the ground
         * is `RoadField.carve`'s blend over every road that reaches the point (see its comment:
         * blending is the whole reason the game does not grow 80° walls where two roads pass at
         * different heights). Measured at the audit's own coordinate (2693, 9413), the nearest
         * edge's `y` sits 9.45 m above the ground at that edge's own centreline. The surface the
         * car drives on is the blend, so the blend is what a shoulder has to be compared with —
         * and it is also what `npm test`'s S1/S2 seam checks assert the drawn ribbon matches to
         * 0.0000 m, so this measurement and the renderer are reading the same surface. */
        const deck = T.height(x, z);
        const off = e.width * 0.5 + PROBE;
        for (const s of [1, -1]) {
          const px = x + nx * off * s,
            pz = z + nz * off * s;
          const g = T.height(px, pz);
          samples++;
          const d = g - deck;
          if (d > WALL) {
            above++;
            sumAbove += d;
            if (d < 2) hist['1-2']++;
            else if (d < 4) hist['2-4']++;
            else if (d < 8) hist['4-8']++;
            else hist['8+']++;
          }
          if (d > worstDelta) {
            worstDelta = d;
            worstAt = [px, pz, deck, g];
          }
          for (let b = 0; b < BANK_OFFSETS.length; b++) {
            const o = e.width * 0.5 + BANK_OFFSETS[b];
            bank[b].push(T.height(x + nx * o * s, z + nz * o * s) - deck);
          }
        }
      }
    }
  }
}

const pct = (100 * above) / Math.max(samples, 1);
console.log(`=== ground above the road deck at the carriageway edge — ${LAND}, probe ${PROBE} m ===`);
console.log(`samples                 ${samples}`);
console.log(`over ${WALL.toFixed(1)} m above the deck  ${above}  (${pct.toFixed(2)}%)`);
console.log(`mean when above         ${above ? (sumAbove / above).toFixed(2) : '0.00'} m`);
console.log(`histogram (m above)     1-2:${hist['1-2']}  2-4:${hist['2-4']}  4-8:${hist['4-8']}  8+:${hist['8+']}`);
if (worstAt) {
  console.log(
    `worst                   ${worstDelta.toFixed(2)} m at (${worstAt[0].toFixed(0)}, ${worstAt[1].toFixed(0)})  deck ${worstAt[2].toFixed(1)}  ground ${worstAt[3].toFixed(1)}`
  );
}

console.log('\n--- the bank profile: how far the ground stands above the deck, past the tarmac edge ---');
for (let b = 0; b < BANK_OFFSETS.length; b++) {
  const v = bank[b].filter((d) => d > 0).sort((p, q) => p - q);
  const p95 = v.length ? v[Math.floor(v.length * 0.95)] : 0;
  const mean = v.length ? v.reduce((s, d) => s + d, 0) / v.length : 0;
  console.log(
    `  +${String(BANK_OFFSETS[b]).padStart(2)} m off the edge:  ${((100 * v.length) / bank[b].length).toFixed(0)}% of samples above the deck, mean ${mean.toFixed(2)} m, 95th ${p95.toFixed(2)} m, worst ${(v.length ? v[v.length - 1] : 0).toFixed(2)} m`
  );
}

/* The audit's own coordinate, probed directly and in full, so a claim about it can be checked
 * rather than believed. */
console.log('\n--- the audit\'s worst point, (2693, 9413), walked out both ways ---');
{
  const T = new Terrain(SEED, 2693 - 200, 9413 - 200, 2693 + 200, 9413 + 200, 120);
  const q = T.roads.query(2693, 9413);
  if (!isFinite(q.d)) console.log('  no road within range of that point');
  else {
    const nx = -q.tz,
      nz = q.tx;
    const deckG = T.height(q.qx, q.qz);
    console.log(`  Terrain.height on the centreline: ${deckG.toFixed(2)} m   (query().y says ${q.y.toFixed(2)} m)`);
    console.log(`  nearest road: d ${q.d.toFixed(2)} m, width ${q.width.toFixed(2)} m, deck ${q.y.toFixed(2)} m, tier ${q.tier}`);
    const row = [];
    for (const off of [0, 3, 4, 6, 8, 12, 18, 26, 40]) {
      for (const s of off === 0 ? [1] : [1, -1]) {
        const g = T.height(q.qx + nx * off * s, q.qz + nz * off * s);
        row.push(`${(off * s).toFixed(0)}m:${(g - deckG >= 0 ? '+' : '')}${(g - deckG).toFixed(2)}`);
      }
    }
    console.log(`  ground minus deck, metres off the centreline: ${row.join('  ')}`);
  }
}

const PASS = pct < 1.0;
console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${pct.toFixed(2)}% of carriageway-edge samples stand over ${WALL.toFixed(1)} m above the deck (bar: under 1.00%)`);
process.exit(PASS ? 0 : 1);
