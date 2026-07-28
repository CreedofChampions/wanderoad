/* Wanderoad — playtest fixtures: where the playtester should actually go.
 *
 * A throwaway companion to tools/diag-playtest-boat.mjs (docs/BOAT-PLAN.md's own acceptance
 * script, driven for real in a headless browser). The browser side needs three coordinates it
 * cannot cheaply find for itself, because the page only ever holds a ~420 m terrain sampler
 * around the player (src/main.js's `localFor`):
 *
 *   1. a LAKESIDE ROAD — dry road, deep water within a short drive off the carriageway;
 *   2. the DEEP-WATER POINT that shore leads into, for the boat run;
 *   3. the NEAREST GEM to it, so the diamond pickup is a steer and not a hunt.
 *
 * Found by search on the shipped seed rather than hard-coded, for tools/bench-boat.mjs's own
 * stated reason: a hard-coded coordinate rots silently the moment worldgen moves.
 *
 * Exports findFixture() so the browser playtest can import it instead of duplicating the scan.
 *   node tools/diag-playtest-fixtures.mjs [seed]
 */

import { Terrain, isDryAt } from '../src/world/terrain.js';
import { BIOME_COUNT, waterLevelAt } from '../src/world/biomes.js';
import { gemsForTile, GEM_TILE, coinsInBox } from '../src/world/loot.js';

export function findFixture(seed = 20260726, opts = {}) {
  const R = opts.range ?? 3500;
  const scan = new Terrain(seed, -R - 500, -R - 500, R + 500, R + 500, 240);
  const w = new Float32Array(BIOME_COUNT);
  const depth = (x, z) => {
    const y = scan.height(x, z);
    scan.weights(x, z, w);
    const wy = waterLevelAt(w, y);
    return wy === null ? 0 : wy - y;
  };

  /* Every gem the lattice actually places inside the scanned square — the same pure function
   * src/render/loot.js itself calls, so these are the gems the game will really build. */
  const gems = [];
  const g0 = Math.floor(-R / GEM_TILE);
  const g1 = Math.floor(R / GEM_TILE);
  for (let gj = g0; gj <= g1; gj++) {
    for (let gi = g0; gi <= g1; gi++) {
      const g = gemsForTile(gi, gj, seed);
      if (g) gems.push(g);
    }
  }

  /* Candidate shores: deep water with a dry road close enough to drive off. Rank by how close
   * a real gem is, so the boat run and the diamond run can be the same voyage. */
  const cands = [];
  for (let z = -R; z <= R; z += 25) {
    for (let x = -R; x <= R; x += 25) {
      if (depth(x, z) < 2.0) continue;
      const q = scan.roads.query(x, z);
      if (!isFinite(q.d) || q.d > 45 || q.d < 12) continue;
      if (depth(q.qx, q.qz) > 0) continue; // the road itself must be dry
      if (!isDryAt(q.qx, q.qz, seed)) continue;
      let best = null;
      let bestD = Infinity;
      for (const g of gems) {
        const d = Math.hypot(g.x - x, g.z - z);
        if (d < bestD) {
          bestD = d;
          best = g;
        }
      }
      cands.push({ water: { x, z, depth: +depth(x, z).toFixed(2) }, road: q, gem: best, gemDist: bestD });
      if (cands.length > 400) break;
    }
    if (cands.length > 400) break;
  }
  if (!cands.length) throw new Error('no lakeside road found');
  cands.sort((a, b) => a.gemDist - b.gemDist);
  const pick = cands[0];

  const dx = pick.water.x - pick.road.qx;
  const dz = pick.water.z - pick.road.qz;
  const L = Math.hypot(dx, dz);

  /* A SECOND shore, at least 400 m away from the first, so a finding at the first one can be
   * shown to be the feature's behaviour rather than one odd bank's. */
  const far = cands.find((c) => Math.hypot(c.road.qx - pick.road.qx, c.road.qz - pick.road.qz) > 400);
  const alt = far
    ? (() => {
        const ax = far.water.x - far.road.qx;
        const az = far.water.z - far.road.qz;
        const aL = Math.hypot(ax, az);
        return {
          road: { x: +far.road.qx.toFixed(1), z: +far.road.qz.toFixed(1) },
          headingOut: +Math.atan2(ax / aL, az / aL).toFixed(4),
          water: far.water,
          shoreProfile: Array.from({ length: 11 }, (_, i) => {
            const s = i * 2;
            return `${s}m:${depth(far.road.qx + (ax / aL) * s, far.road.qz + (az / aL) * s).toFixed(2)}`;
          }).join('  '),
        };
      })()
    : null;

  /* OPEN WATER: keep walking out from the launch beach while it stays deep, so the feel of the
   * boat is measured somewhere a boat would actually be, not in the surf where every second
   * frame is a grounding check. */
  let deep = null;
  for (let s = 40; s <= 220; s += 10) {
    const px = pick.road.qx + (dx / L) * s;
    const pz = pick.road.qz + (dz / L) * s;
    const d = depth(px, pz);
    if (d > 2.5) deep = { x: +px.toFixed(1), z: +pz.toFixed(1), depth: +d.toFixed(2), out: s };
    else if (deep && s > deep.out + 40) break; // ran back into land — keep the last good one
  }

  /* A DRY road: a carriageway point with no water anywhere near it, so a coins-per-kilometre
   * measurement is measuring coins and not a car that drove into a lake. */
  let dryRoad = null;
  for (let z = -R; z <= R && !dryRoad; z += 60) {
    for (let x = -R; x <= R && !dryRoad; x += 60) {
      const q = scan.roads.query(x, z);
      if (!isFinite(q.d) || q.d > 6) continue;
      let wet = false;
      for (let a = 0; a < 8 && !wet; a++) {
        for (let r = 40; r <= 260 && !wet; r += 55) {
          if (depth(q.qx + Math.cos((a / 8) * Math.PI * 2) * r, q.qz + Math.sin((a / 8) * Math.PI * 2) * r) > 0.05) wet = true;
        }
      }
      if (wet || !isDryAt(q.qx, q.qz, seed)) continue;
      dryRoad = { x: +q.qx.toFixed(1), z: +q.qz.toFixed(1), heading: +Math.atan2(q.tx, q.tz).toFixed(4), width: +q.width.toFixed(1) };
    }
  }

  return {
    alt,
    dryRoad,
    deep,
    seed,
    gemCount: gems.length,
    candidates: cands.length,
    road: { x: +pick.road.qx.toFixed(1), z: +pick.road.qz.toFixed(1), width: +pick.road.width.toFixed(1) },
    /* forward is (sin yaw, cos yaw) — src/car/vehicle.js's own convention */
    headingOut: +Math.atan2(dx / L, dz / L).toFixed(4),
    water: pick.water,
    gem: pick.gem ? { x: +pick.gem.x.toFixed(1), z: +pick.gem.z.toFixed(1), y: +pick.gem.y.toFixed(2), id: pick.gem.id } : null,
    gemDist: +pick.gemDist.toFixed(1),
    shoreProfile: Array.from({ length: 11 }, (_, i) => {
      const s = i * 2;
      return `${s}m:${depth(pick.road.qx + (dx / L) * s, pick.road.qz + (dz / L) * s).toFixed(2)}`;
    }).join('  '),
  };
}

/* Coins a DRIVER meets, per kilometre — not coins that exist per kilometre.
 *
 * tools/diag-loot.mjs asserts 26.4 coins/km along its own 381.8 km arterial walk, and the
 * browser playtest measured a driver collecting 8.8/km with every reachable coin picked up
 * (7 of 7). Only one of those can be what a player experiences, so this counts coins within
 * the game's own COIN_RADIUS of a road centreline followed metre by metre — the line a car
 * on the road actually occupies. */
export function coinsAlongRoute(seed = 20260726, startX = 721.1, startZ = 384.6, metres = 4000) {
  const T = new Terrain(seed, startX - 3000, startZ - 3000, startX + 3000, startZ + 3000, 240);
  const R = 7; // src/render/loot.js's COIN_RADIUS
  const pts = [];
  let x = startX;
  let z = startZ;
  let q = T.roads.query(x, z);
  if (!isFinite(q.d)) throw new Error('no road at the start point');
  x = q.qx;
  z = q.qz;
  let tx = q.tx;
  let tz = q.tz;
  let walked = 0;
  while (walked < metres) {
    pts.push([x, z]);
    x += tx * 2;
    z += tz * 2;
    walked += 2;
    q = T.roads.query(x, z);
    if (!isFinite(q.d) || q.d > 12) break; // ran off the end of the road network
    x = q.qx;
    z = q.qz;
    if (q.tx * tx + q.tz * tz < 0) {
      tx = -q.tx;
      tz = -q.tz;
    } else {
      tx = q.tx;
      tz = q.tz;
    }
  }
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const coins = coinsInBox(Math.min(...xs) - 40, Math.min(...zs) - 40, Math.max(...xs) + 40, Math.max(...zs) + 40, seed);
  let reach = 0;
  for (const c of coins) {
    for (const p of pts) {
      if (Math.hypot(c.x - p[0], c.z - p[1]) <= R) {
        reach++;
        break;
      }
    }
  }
  const km = walked / 1000;
  return { km: +km.toFixed(2), coinsInBox: coins.length, withinPickupOfCentreline: reach, perKm: +(reach / km).toFixed(1) };
}

if (process.argv[1] && process.argv[1].endsWith('diag-playtest-fixtures.mjs')) {
  const seed = parseInt(process.argv[2] || '', 10) || 20260726;
  if (process.argv.includes('--coins')) {
    for (const [sx, sz] of [
      [721.1, 384.6],
      [997.1, -3437.7],
      [0, 0],
    ]) {
      try {
        console.log(`route from (${sx}, ${sz}): ${JSON.stringify(coinsAlongRoute(seed, sx, sz, 4000))}`);
      } catch (e) {
        console.log(`route from (${sx}, ${sz}): ${e.message}`);
      }
    }
  } else {
    console.log(JSON.stringify(findFixture(seed), null, 2));
  }
}
