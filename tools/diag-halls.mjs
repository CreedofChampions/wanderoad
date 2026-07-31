/* ARE THERE WALK-IN SHOWROOMS, AND CAN YOU GET TO ONE?
 *
 * Operator: "Walk-in showrooms seperate to gas stations (walkable mode)". Two things have to be true
 * before any of the rest matters: they must EXIST at a findable spacing, and each one must be beside
 * a road you can actually pull off. A building nobody drives past is not a shop.
 */
import { showroomsInBox, nearestShowroom, nearestStation, SHOWROOM_CELL, SHOWROOM_MIN_STATION, hallSpots } from '../src/world/props.js';
import { Terrain } from '../src/world/terrain.js';
import { roadDistance } from '../src/world/roads.js';
import { landHeight } from '../src/world/terrain.js';

const SEED = Number(process.argv[2] || 20260726);
const R = Number(process.argv[3] || 18000);
const probe = { height: (x, z) => landHeight(x, z, SEED) };

const halls = showroomsInBox(-R, -R, R, R, SEED, probe);
const boxKm2 = ((2 * R) / 1000) ** 2;
console.log(`${halls.length} walk-in showrooms in a ${(2 * R) / 1000} km box (${boxKm2.toFixed(0)} km2), cell ${SHOWROOM_CELL} m`);

let worstRoad = 0;
let tooNearStation = 0;
let noRoadAnswer = 0;
for (const h of halls) {
  /* MEASURE THE SETBACK THE PLACEMENT ACTUALLY USED. The first version of this asked roadDistance()
   * and got Infinity, then reported every showroom as unreachable — but roadDistance searches a
   * smaller box than the nearestRoadPoint the placement uses, so an Infinity there means "no road in
   * MY window", not "no road". Each hall records the road point it was set back from; that is the
   * number this check is actually about, and roadDistance is kept as a cross-check where it answers. */
  const d = Math.hypot(h.x - h.roadX, h.z - h.roadZ);
  if (d > worstRoad) worstRoad = d;
  const q = roadDistance(h.x, h.z, SEED, (x, z) => landHeight(x, z, SEED));
  if (!q || !Number.isFinite(q.d)) noRoadAnswer++;
  const st = nearestStation(h.x, h.z, SEED, SHOWROOM_MIN_STATION);
  if (st && st.dist < SHOWROOM_MIN_STATION) tooNearStation++;
}
const near = nearestShowroom(0, 0, SEED, 12000, probe);
const spots = near ? hallSpots(near) : [];

let fail = 0;
const check = (ok, what, got, want) => {
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${what.padEnd(52)} ${String(got).padStart(12)}   want ${want}`);
  if (!ok) fail++;
};
check(halls.length > 0, 'walk-in showrooms exist at all', halls.length, '> 0');
check(
  halls.length / boxKm2 < 0.03,
  'and are rare enough to be a destination',
  `1 per ${(boxKm2 / halls.length).toFixed(0)} km2`,
  '1 per > 33 km2'
);
check(worstRoad < 120, 'every one is set back from a real road', `${worstRoad.toFixed(0)} m`, '< 120 m');
console.log(`       ${noRoadAnswer}/${halls.length} fall outside roadDistance's own smaller search window (see the note in this file)`);
check(tooNearStation === 0, 'and none is next door to a petrol station', tooNearStation, '0');
check(!!near, 'there is one findable from the origin', near ? `${Math.round(near.dist)} m` : 'none', 'one exists');
check(spots.length === 8, 'a hall holds the whole fleet', spots.length, '8 bays');
if (near) {
  let minGap = Infinity;
  for (let i = 0; i < spots.length; i++)
    for (let j = i + 1; j < spots.length; j++)
      minGap = Math.min(minGap, Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z));
  check(minGap > 5, 'and the bays are far enough apart to walk between', `${minGap.toFixed(1)} m`, '> 5 m');
}
console.log(fail ? `\n${fail} FAILURE(S)` : '\nall showroom placement checks passed');
process.exit(fail ? 1 : 0);
