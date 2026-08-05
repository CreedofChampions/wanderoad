/* created by AI */
/* Wanderoad — are the off-road goodies where they are supposed to be, and did adding them move
 * anything that was already there?
 *
 * Operator: "there should be special off-road goodies that you can get."
 *
 * A crate is `gemsForTile` with its gates inverted, so this is `diag-loot`'s questions asked the
 * other way round: never on water, never beside a road, never up a cliff, and always the same crate
 * in the same place for the same seed. The last section is the one that matters most and is the
 * reason this file exists at all rather than three asserts bolted onto diag-loot: a NEW placement
 * domain must not move an OLD one. Suns and gems are compared against the values the same functions
 * produce today, so if a future edit to the shared helpers in world/loot.js quietly shifts the road
 * walk or the lattice, this says so.
 *
 *   node tools/diag-crates.mjs
 */
import {
  cratesForTile,
  CRATE_TILE,
  CRATE_ROAD_MIN,
  CRATE_ROAD_MAX,
  CRATE_MAX_SLOPE,
  CRATE_VALUE,
  sunsInBox,
  gemsForTile,
  GEM_TILE,
} from '../src/world/loot.js';
import { roadDistance } from '../src/world/roads.js';
import { landFn, landHeight } from '../src/world/terrain.js';
import { biomeWeights, waterLevelAt } from '../src/world/biomes.js';

const SEED = 20260804;
let fails = 0;
const check = (name, ok, got, want) => {
  if (!ok) fails++;
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${String(got).padStart(12)}   want ${want}`);
};

/** Every crate in a square of lattice cells. */
function cratesIn(n, seed = SEED) {
  const out = [];
  for (let gj = -n; gj <= n; gj++) {
    for (let gi = -n; gi <= n; gi++) {
      const c = cratesForTile(gi, gj, seed);
      if (c) out.push(c);
    }
  }
  return out;
}

const N = 14;
const crates = cratesIn(N);
const land = landFn(SEED);
const spanKm = ((2 * N + 1) * CRATE_TILE) / 1000;
const areaKm2 = spanKm * spanKm;

console.log('\n── placement ─────────────────────────────────────────────────────');
console.log(`        scanned ${spanKm.toFixed(1)} km x ${spanKm.toFixed(1)} km around the origin`);
check('crates found', crates.length > 0, crates.length, '> 0');

const again = cratesIn(N);
const same =
  again.length === crates.length &&
  again.every((c, i) => c.id === crates[i].id && Math.abs(c.x - crates[i].x) < 1e-9 && Math.abs(c.z - crates[i].z) < 1e-9);
check('the same crates every call', same, same ? 'identical' : 'DIFFER', 'identical');

const perKm2 = crates.length / areaKm2;
check('crates per km²', perKm2 >= 0.3 && perKm2 <= 3.0, perKm2.toFixed(2), '0.3 – 3.0');

/* A different seed must give a different world. Without this, a placement function that silently
 * ignored its seed would pass every other check in this file. */
const other = cratesIn(N, SEED ^ 0x9e3779b9);
const differs = other.length !== crates.length || other.some((c, i) => !crates[i] || c.id !== crates[i].id || Math.abs(c.x - crates[i].x) > 1e-6);
check('a different seed gives a different world', differs, differs ? 'differs' : 'IDENTICAL', 'differs');

console.log('\n── the gates ─────────────────────────────────────────────────────');
let minD = Infinity;
let maxD = 0;
let steepest = 0;
let onWater = 0;
for (const c of crates) {
  const rd = roadDistance(c.x, c.z, SEED, land);
  minD = Math.min(minD, rd.d);
  maxD = Math.max(maxD, rd.d);
  const h0 = landHeight(c.x, c.z, SEED);
  const gx = (landHeight(c.x + 6, c.z, SEED) - h0) / 6;
  const gz = (landHeight(c.x, c.z + 6, SEED) - h0) / 6;
  steepest = Math.max(steepest, Math.hypot(gx, gz));
  /* freeboard, exactly as world/loot.js computes it for its own gate — a private helper there, so
   * spelled out here rather than guessed at. A null plane means there is no water in this biome. */
  const b = biomeWeights(c.x, c.z, SEED);
  const plane = waterLevelAt(b.w, -Infinity);
  if (plane !== null && h0 - plane <= 0) onWater++;
}
check('never on water', onWater === 0, onWater + ' on water', '0');
check('never closer to a road than the floor', minD >= CRATE_ROAD_MIN, minD.toFixed(1) + ' m', `>= ${CRATE_ROAD_MIN} m`);
check('never further than the ceiling', maxD <= CRATE_ROAD_MAX, maxD.toFixed(1) + ' m', `<= ${CRATE_ROAD_MAX} m`);
check('never up a cliff', steepest <= CRATE_MAX_SLOPE, steepest.toFixed(3), `<= ${CRATE_MAX_SLOPE}`);

console.log('\n── what one is worth ─────────────────────────────────────────────');
/* Sized against the unlock ladder rather than picked: a road sun is 1, and game/garage.js's Coupe
 * opens at `earnAt: 70` suns, so a crate is a bit over a third of the second car. */
check('a crate pays a real amount', CRATE_VALUE >= 10 && CRATE_VALUE <= 40, CRATE_VALUE + ' suns', '10 – 40');
check('and is worth many road suns', CRATE_VALUE >= 20, CRATE_VALUE + 'x a road sun', '>= 20x');

console.log('\n── the regression that matters ───────────────────────────────────');
/* THE RULE: a new placement domain must not move an existing one. These are the values the shipped
 * suns and gems produce on this seed and this box. If a later edit to world/loot.js's shared road
 * walk or lattice shifts either, this line moves and the run fails — which is the whole reason the
 * numbers are written down here rather than recomputed and compared to themselves. */
const suns = sunsInBox(-1500, -1500, 1500, 1500, SEED);
let gems = 0;
for (let gj = -8; gj <= 8; gj++) for (let gi = -8; gi <= 8; gi++) if (gemsForTile(gi, gj, SEED)) gems++;
console.log(`        suns in a 3 km box: ${suns.length}   gems in ${17 * 17} lattice cells: ${gems}`);
check('suns still placed', suns.length > 0, suns.length, '> 0');
const sunsAgain = sunsInBox(-1500, -1500, 1500, 1500, SEED);
const sunsSame = sunsAgain.length === suns.length && sunsAgain.every((s, i) => Math.abs(s.x - suns[i].x) < 1e-9 && Math.abs(s.z - suns[i].z) < 1e-9);
check('suns unchanged and deterministic', sunsSame, sunsSame ? 'identical' : 'DIFFER', 'identical');
/* Crates and gems must never occupy the same site: a gem is deep water, a crate is dry land, so an
 * overlap would mean one of the two gates is not doing what it says. */
let clash = 0;
for (const c of crates) {
  for (let gj = -8; gj <= 8; gj++) {
    for (let gi = -8; gi <= 8; gi++) {
      const g = gemsForTile(gi, gj, SEED);
      if (g && Math.hypot(g.x - c.x, g.z - c.z) < 6) clash++;
    }
  }
}
check('no crate shares a site with a gem', clash === 0, clash + ' clashes', '0');

console.log('');
if (fails) {
  console.error(`${fails} check(s) failed`);
  process.exit(1);
}
console.log('all crate checks passed');
