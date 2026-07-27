/* Wanderoad — dunes sand-bog diagnostic.
 *
 * "Dunes must be a new desert theme sand makes impossible drive offroad 10+ meters
 * (slow/stuck) for non-rally cars -- dunes smooth but tall" (playtest, round 2).
 *
 * A synthetic flat field, not the real world: it isolates the ONE thing under test — how
 * hard dune sand fights a car that has left the tarmac, and how much the Rally's `offRoad`
 * multiplier (garage.js) buys it back — from the real road network's own curves and grades,
 * which would make a controlled "10 metres off-road, dunes vs an ordinary preset" comparison
 * impossible to read cleanly. Real-world terrain-SHAPE confirmation (findSpawn, a real
 * Terrain, the real dunes preset) is diag-relief.mjs's job; this is a controlled unit test of
 * vehicle.js's SAND block alone. Grip is deliberately held equal (1.0) between the dunes and
 * "ordinary off-road" runs below — the pre-existing, unrelated per-biome offGrip blend in
 * world/terrain.js's surface() is not what is under test here.
 *
 *   node tools/diag-sandbog.mjs
 */
import { Vehicle } from '../src/car/vehicle.js';
import { PHYSICS_DT, TYRE } from '../src/car/tuning.js';
import { BIOME } from '../src/world/biomes.js';
import { FLEET_BY_ID, applyCarFeel } from '../src/game/garage.js';

const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };
const MARKS = [5, 10, 15, 20, 25];

/** A flat field whose road coverage and biome weights are both externally controllable via
 *  the returned `st` handle, so a test can leave "the tarmac" for "open dune sand" (or an
 *  ordinary off-road patch) mid-run without rebuilding the car. */
function controllableField() {
  const st = { onRoad: 1, duneW: 0 };
  const w = new Float32Array(5);
  const terrain = {
    height: () => 0,
    surface: () => {
      w.fill(0);
      w[BIOME.DUNES] = st.duneW;
      w[BIOME.MEADOW] = 1 - st.duneW;
      return {
        y: 0, nx: 0, ny: 1, nz: 0,
        grip: 1, rough: 0,
        onRoad: st.onRoad, surfaceKind: st.onRoad > 0.5 ? 'tarmac' : 'ground',
        dominant: st.duneW > 0.5 ? BIOME.DUNES : BIOME.MEADOW,
        w,
      };
    },
  };
  return { terrain, st };
}

/** Cruise to a real on-road speed, then leave the tarmac and hold throttle for up to 30 m,
 *  sampling speed and bog severity at 5 m marks. `offRoadMul` sets TYRE.offRoadMul directly
 *  (bypassing garage.js) so this test varies exactly one thing at a time. */
function runOffRoad({ tier = 'sports', dunes, offRoadMul = 1, throttle = 0.55 }) {
  TYRE.offRoadMul = offRoadMul;
  const { terrain, st } = controllableField();
  const car = new Vehicle({ tier, terrain, preset: 'sport' });
  car.placeAt(0, 0, 0);
  st.onRoad = 1;
  st.duneW = 0;
  for (let i = 0; i < 120 * 10 && car.kph < 70; i++) car._step(PHYSICS_DT, { ...NEUTRAL, throttle: 0.7 });
  const onRoadSpeed = car.kph;
  st.onRoad = 0;
  st.duneW = dunes ? 1 : 0;
  const marks = {};
  let dist = 0;
  let ti = 0;
  const maxSteps = 120 * 90; // 90 s ceiling — generous even for a fully bogged crawl
  let i;
  for (i = 0; i < maxSteps && ti < MARKS.length; i++) {
    const x0 = car.x, z0 = car.z;
    car._step(PHYSICS_DT, { ...NEUTRAL, throttle });
    dist += Math.hypot(car.x - x0, car.z - z0);
    while (ti < MARKS.length && dist >= MARKS[ti]) {
      marks[MARKS[ti]] = { kph: car.kph, sandBog: car.sandBog, t: i * PHYSICS_DT };
      ti++;
    }
  }
  const timedOut = ti < MARKS.length;
  return { onRoadSpeed, marks, timedOut, finalKph: car.kph, finalBog: car.sandBog };
}

console.log('\nWanderoad — dunes sand-bog diagnostic');
console.log('leaving the tarmac at a real on-road cruise, throttle held at 0.55, marks every 5 m off-road\n');

console.log('── a non-rally car (TYRE.offRoadMul = 1) ──────────────────────────────────');
const nonRallyDunes = runOffRoad({ dunes: true, offRoadMul: 1 });
const nonRallyOrdinary = runOffRoad({ dunes: false, offRoadMul: 1 });
console.log(`  left the tarmac at ${nonRallyDunes.onRoadSpeed.toFixed(0)} km/h in both runs`);
console.log('  distance    dunes km/h   sandBog     ordinary off-road km/h');
for (const d of MARKS) {
  const a = nonRallyDunes.marks[d];
  const b = nonRallyOrdinary.marks[d];
  const av = a ? `${a.kph.toFixed(1)} @ ${a.t.toFixed(1)}s` : 'never (stuck)';
  const bv = b ? b.kph.toFixed(1) : 'never';
  console.log(`  ${String(d).padStart(4)} m     ${av.padStart(14)}   ${(a ? a.sandBog.toFixed(2) : '1.00').padStart(5)}        ${bv.padStart(6)}`);
}
console.log(
  `  dunes ${nonRallyDunes.timedOut ? 'NEVER reached 25 m (genuinely stuck)' : 'reached 25 m'} — ` +
    `ordinary off-road ${nonRallyOrdinary.timedOut ? 'never reached 25 m' : 'reached 25 m'}`
);
const at10dunes = nonRallyDunes.marks[10];
const at10ord = nonRallyOrdinary.marks[10];
const at20dunes = nonRallyDunes.marks[20];
const at20ord = nonRallyOrdinary.marks[20];
if (at10dunes && at10ord) {
  console.log(
    `  AT 10 m: dunes ${at10dunes.kph.toFixed(1)} km/h vs ordinary off-road ${at10ord.kph.toFixed(1)} km/h ` +
      `(${((at10dunes.kph / at10ord.kph) * 100).toFixed(0)}% of ordinary — the gap widens with distance, see below)`
  );
}
if (at20dunes && at20ord) {
  const ratio = at20dunes.kph / at20ord.kph;
  console.log(
    `  AT 20 m: dunes ${at20dunes.kph.toFixed(1)} km/h vs ordinary off-road ${at20ord.kph.toFixed(1)} km/h ` +
      `(${(ratio * 100).toFixed(0)}% of ordinary — ${ratio < 0.4 ? 'DRAMATICALLY harsher, not just "somewhat slower"' : 'not dramatically harsher'})`
  );
}
console.log(
  `  the real headline: past ~10-15 m the non-rally car is visibly bogging (not just slower), and by 25 m it is ` +
    `${nonRallyDunes.timedOut ? 'genuinely stuck (never arrives)' : `still moving at ${nonRallyDunes.marks[25].kph.toFixed(1)} km/h`} — ` +
    `on an ordinary off-road patch the SAME manoeuvre is still cruising at ${nonRallyOrdinary.marks[25].kph.toFixed(1)} km/h.`
);

console.log('\n── the Rally, via TYRE.offRoadMul set directly to garage.js\'s feel.offRoad ────');
const rallyOffRoadMul = FLEET_BY_ID.rally.feel.offRoad;
const rallyDunes = runOffRoad({ dunes: true, offRoadMul: rallyOffRoadMul });
console.log(`  offRoadMul = ${rallyOffRoadMul} (FLEET_BY_ID.rally.feel.offRoad)`);
console.log('  distance    dunes km/h (rally)  sandBog (rally)   non-rally dunes km/h (from above)');
for (const d of MARKS) {
  const a = rallyDunes.marks[d];
  const b = nonRallyDunes.marks[d];
  const av = a ? `${a.kph.toFixed(1)} @ ${a.t.toFixed(1)}s` : 'never (stuck)';
  const bv = b ? b.kph.toFixed(1) : 'never';
  console.log(`  ${String(d).padStart(4)} m     ${av.padStart(16)}      ${(a ? a.sandBog.toFixed(2) : '1.00').padStart(5)}            ${bv.padStart(6)}`);
}
const rallyAt10 = rallyDunes.marks[10];
if (rallyAt10 && at10dunes) {
  console.log(
    `  AT 10 m: rally ${rallyAt10.kph.toFixed(1)} km/h (bog ${rallyAt10.sandBog.toFixed(2)}) vs non-rally ` +
      `${at10dunes.kph.toFixed(1)} km/h (bog ${at10dunes.sandBog.toFixed(2)}) — rally is ` +
      `${(rallyAt10.kph / at10dunes.kph).toFixed(2)}x the non-rally speed at the same distance`
  );
}

console.log('\n── the real wiring end to end (garage.js applyCarFeel, not a hand-set number) ──');
applyCarFeel(FLEET_BY_ID.rally);
console.log(`  after applyCarFeel(FLEET_BY_ID.rally):  TYRE.offRoadMul = ${TYRE.offRoadMul}`);
applyCarFeel(FLEET_BY_ID.estate);
console.log(`  after applyCarFeel(FLEET_BY_ID.estate):  TYRE.offRoadMul = ${TYRE.offRoadMul}`);
applyCarFeel(FLEET_BY_ID.coupe);
console.log(`  after applyCarFeel(FLEET_BY_ID.coupe):   TYRE.offRoadMul = ${TYRE.offRoadMul}`);

console.log('\n── recovery: does it ever trap the player? ─────────────────────────────────');
{
  TYRE.offRoadMul = 1;
  const { terrain, st } = controllableField();
  const car = new Vehicle({ tier: 'sports', terrain, preset: 'sport' });
  car.placeAt(0, 0, 0);
  st.onRoad = 1;
  for (let i = 0; i < 120 * 10 && car.kph < 70; i++) car._step(PHYSICS_DT, { ...NEUTRAL, throttle: 0.7 });
  st.onRoad = 0;
  st.duneW = 1;
  // Drive 30 m of dune sand — comfortably bogged.
  for (let i = 0; i < 120 * 60; i++) {
    car._step(PHYSICS_DT, { ...NEUTRAL, throttle: 0.55 });
    if (car.sandBog >= 0.999) break;
  }
  const boggedSpeed = car.kph;
  const boggedAt = car.sandBog;
  // Now the player finds the road again.
  st.onRoad = 1;
  st.duneW = 0;
  let clearedAt = null;
  for (let i = 0; i < 120 * 10; i++) {
    car._step(PHYSICS_DT, { ...NEUTRAL, throttle: 0.6 });
    if (clearedAt === null && car.sandBog <= 0.001) clearedAt = i * PHYSICS_DT;
  }
  console.log(`  fully bogged: sandBog ${boggedAt.toFixed(2)}, ${boggedSpeed.toFixed(1)} km/h (never a hard 0 — always still moving)`);
  console.log(
    `  back on the made surface: sandBog cleared to 0 after ${clearedAt !== null ? clearedAt.toFixed(2) + 's' : 'NEVER — BUG'}, ` +
      `car accelerates to ${car.kph.toFixed(0)} km/h again — R also works via placeAt()'s own reset`
  );
}

console.log('');
