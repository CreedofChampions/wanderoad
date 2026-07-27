/* Wanderoad — "am I falling through the road?", measured against the road you can SEE.
 *
 * The operator's report is "still falling through road regularly". Every check in the suite
 * that came near it was self-consistent by construction: it read the road's elevation and the
 * ground's elevation out of the SAME RoadField, so it could only ever agree with itself. This
 * one does not. It builds the ribbon with render/road.js's own `buildRibbon`, samples the
 * TRIANGLES that function produced, and compares them with the ground the car is standing on.
 *
 * Two numbers come out, both over many kilometres of real auto-driving:
 *
 *   FALL-THROUGH   distinct events per kilometre where the car's floor is more than 30 cm
 *                  below the drawn tarmac it is inside. This is the operator's bug.
 *   PROUD          frames where the carved ground is more than 30 cm ABOVE the drawn tarmac —
 *                  "dirt hills through the road; there should be nothing above a road ever".
 *
 * The driver is the game's own Autopilot, the solver is the real Vehicle at the real physics
 * rate, and the frame order (physics -> solids -> rescue) and the 240 m sampler-rebuild rule
 * are main.js's. No server, no browser.
 *
 *   node tools/diag-fallthrough.mjs                 # the standard 6-run sweep
 *   node tools/diag-fallthrough.mjs 20260726 rolling 200
 *
 * WR_SRC=file:///…/src/  points it at another tree, which is how a before/after is taken.
 */

const SRC = process.env.WR_SRC || new URL('../src/', import.meta.url).href;

const { Terrain, findSpawn } = await import(SRC + 'world/terrain.js');
const { Vehicle } = await import(SRC + 'car/vehicle.js');
const { PHYSICS_DT } = await import(SRC + 'car/tuning.js');
const { Solids, solidsFromScatter } = await import(SRC + 'game/collide.js');
const { Rescue } = await import(SRC + 'game/rescue.js');
const { Autopilot } = await import(SRC + 'car/autopilot.js');
const { scatterChunk } = await import(SRC + 'world/scatter.js');
const { segDist } = await import(SRC + 'core/math.js');
const { applyTerrain, terrainBias } = await import(SRC + 'game/presets.js');
const { setBiomeBias } = await import(SRC + 'world/biomes.js');
const ROAD = await import(SRC + 'render/road.js');

/** main.js: model.group.position.y = car.y - 0.36, i.e. where the bodywork's floor is. */
const MODEL_DROP = 0.36;
/** Metres of disagreement that count. A 30 cm lip is a kerb; anything more is a hole. */
const THRESH = 0.3;
/**
 * The car-body test has to allow the suspension to do its job: car/tuning.js gives it 0.22 m
 * of travel, so a car hammering over a crest legitimately carries its floor 0.22 m lower than
 * the same car parked. Counting that as "under the road" turned honest damping into 7 events
 * per kilometre. The GEOMETRIC test below has no such loophole and is the primary number.
 */
const BODY_THRESH = THRESH + 0.22;
/** How far from the car the harness keeps ribbon geometry. The renderer keeps 1900 m; the
 *  measurement only ever asks about the car's own position, so this is purely a cost dial. */
const RIBBON_R = 460;

if (typeof ROAD.ribbonEdges !== 'function' || typeof ROAD.buildRibbon !== 'function') {
  console.error(
    'This harness needs render/road.js to export ribbonEdges() and buildRibbon() — the exact\n' +
      'pair Roads.update() uses — so that it measures the drawn geometry rather than a replica.'
  );
  process.exit(2);
}

/* ── the ribbon window, built by the renderer's own code ────────────────────── */

const CELL = 32;

function ribbonRecord(edge, ctx) {
  const { geometry, ring, half } = ROAD.buildRibbon(edge, ctx);
  const pos = geometry.attributes.position.array;
  const rings = ring.length;
  const across = pos.length / 3 / rings;
  // ring index -> world cell, so sampling is a hash lookup rather than a polyline scan
  const cells = new Map();
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < rings; i++) {
    const p = ring[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
    const cx = Math.floor(p.x / CELL),
      cz = Math.floor(p.z / CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const k = `${cx + dx},${cz + dz}`;
        let a = cells.get(k);
        if (!a) cells.set(k, (a = []));
        a.push(i);
      }
    }
  }
  return { key: edge.key, pos, ring, rings, across, half, cells, minX, maxX, minZ, maxZ };
}

/** Height of the DRAWN tarmac at (x, z), read off the triangles, or null if not on one. */
function sampleRibbon(rec, x, z) {
  const list = rec.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
  if (!list) return null;
  let bd = Infinity,
    bk = 0,
    bt = 0;
  for (const i of list) {
    if (i >= rec.rings - 1) continue;
    const a = rec.ring[i],
      b = rec.ring[i + 1];
    const r = segDist(x, z, a.x, a.z, b.x, b.z);
    if (r.d < bd) {
      bd = r.d;
      bk = i;
      bt = r.t;
    }
  }
  if (!isFinite(bd)) return null;

  const A = rec.across;
  const v = (k, j) => (k * A + j) * 3;
  // lateral coordinate, taken from the drawn vertices themselves
  const i0 = v(bk, 0),
    i1 = v(bk, A - 1);
  let rx = rec.pos[i1] - rec.pos[i0],
    rz = rec.pos[i1 + 2] - rec.pos[i0 + 2];
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const f = ((x - rec.pos[i0]) * rx + (z - rec.pos[i0 + 2]) * rz) / rl; // 0..1 across
  if (f < -0.02 || f > 1.02) return { d: bd, half: rec.half, y: null, key: rec.key };
  const fj = Math.min(A - 1.0001, Math.max(0, f * (A - 1)));
  const j = Math.floor(fj),
    tj = fj - j;
  const y00 = rec.pos[v(bk, j) + 1],
    y01 = rec.pos[v(bk, j + 1) + 1];
  const y10 = rec.pos[v(bk + 1, j) + 1],
    y11 = rec.pos[v(bk + 1, j + 1) + 1];
  const y = (y00 + (y01 - y00) * tj) * (1 - bt) + (y10 + (y11 - y10) * tj) * bt;
  return { d: bd, half: rec.half, y, key: rec.key };
}

function run(seed, preset, seconds, tier = 'sports') {
  applyTerrain(preset);
  setBiomeBias(terrainBias(preset));

  const live = new Map();
  let rbx = Infinity,
    rbz = Infinity;
  const refreshRibbon = (x, z) => {
    if (Math.hypot(x - rbx, z - rbz) < 150) return;
    rbx = x;
    rbz = z;
    const { edges, ctx } = ROAD.ribbonEdges(seed, x - RIBBON_R, z - RIBBON_R, x + RIBBON_R, z + RIBBON_R);
    for (const e of edges) {
      if (live.has(e.key)) continue;
      live.set(e.key, ribbonRecord(e, ctx));
    }
    for (const [k, r] of live) {
      if (r.minX > x + RIBBON_R * 1.6 || r.maxX < x - RIBBON_R * 1.6) live.delete(k);
      else if (r.minZ > z + RIBBON_R * 1.6 || r.maxZ < z - RIBBON_R * 1.6) live.delete(k);
    }
  };
  const ribbonAt = (x, z) => {
    let best = null;
    for (const rec of live.values()) {
      const m = rec.half + 4;
      if (x < rec.minX - m || x > rec.maxX + m || z < rec.minZ - m || z > rec.maxZ + m) continue;
      const s = sampleRibbon(rec, x, z);
      if (s && s.y !== null && (!best || s.d < best.d)) best = s;
    }
    return best;
  };

  const spawn = findSpawn(seed);
  let local = new Terrain(seed, spawn.x - 420, spawn.z - 420, spawn.x + 420, spawn.z + 420);
  let lcx = spawn.x,
    lcz = spawn.z;
  const localFor = (x, z) => {
    if (Math.abs(x - lcx) > 240 || Math.abs(z - lcz) > 240) {
      local = new Terrain(seed, x - 420, z - 420, x + 420, z + 420);
      lcx = x;
      lcz = z;
    }
    return local;
  };

  const car = new Vehicle({ tier, terrain: local, preset: 'sport' });
  car.placeAt(spawn.x, spawn.z, spawn.heading);

  const solids = new Solids();
  const liveChunks = new Set();
  const streamSolids = (x, z) => {
    const want = new Set();
    const c0 = Math.floor(x / 64),
      c1 = Math.floor(z / 64);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) want.add(`${c0 + i},${c1 + j}`);
    for (const k of want) {
      if (liveChunks.has(k)) continue;
      const [cx, cz] = k.split(',').map(Number);
      solids.addChunk(k, solidsFromScatter(scatterChunk({ cx, cz, level: 0, seed })));
      liveChunks.add(k);
    }
    for (const k of [...liveChunks]) if (!want.has(k)) { solids.removeChunk(k); liveChunks.delete(k); }
  };

  let rescues = 0;
  const backToRoad = () => {
    const t = car.terrain || local;
    const q = t.roads.query(car.x, car.z);
    if (isFinite(q.d)) car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
    else {
      const s = findSpawn(seed, car.x, car.z);
      car.placeAt(s.x, s.z, s.heading);
    }
  };
  const rescue = new Rescue({ recover: backToRoad, say: () => {} });
  const auto = new Autopilot();
  auto.toggle(car);

  const FRAME = 1 / 60;
  const frames = Math.round(seconds * 60);
  const SUB = Math.max(1, Math.round(FRAME / PHYSICS_DT));
  let dist = 0,
    px = car.x,
    pz = car.z;
  let onRoad = 0,
    fall = 0,
    proud = 0,
    surfWorst = 0,
    surfWorstAt = null;
  const worstFall = { d: 0 };
  const worstProud = { d: 0 };
  const events = [];
  const holes = [];
  let inEvent = false;
  let inHole = false;

  for (let f = 0; f < frames; f++) {
    car.terrain = localFor(car.x, car.z);
    refreshRibbon(car.x, car.z);
    streamSolids(car.x, car.z);

    const cmd =
      auto.update(car, { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true }, FRAME) ||
      { steer: 0, throttle: 0.3, brake: 0, handbrake: 0, analogue: true };
    if (!auto.on) auto.toggle(car);
    for (let s = 0; s < SUB; s++) car._step(PHYSICS_DT, cmd);
    solids.resolve(car, 1.05, FRAME);
    const surf = car.terrain.surface(car.x, car.z);
    if (rescue.update(FRAME, car, surf)) rescues++;

    const rb = ribbonAt(car.x, car.z);
    if (rb && rb.d <= rb.half) {
      onRoad++;
      const carFloor = car.y - MODEL_DROP;
      const dFall = rb.y - carFloor;
      // the pure surface disagreement: drawn tarmac vs the ground the wheels stand on
      const dSurf = rb.y - surf.y;
      if (Math.abs(dSurf) > Math.abs(surfWorst)) {
        surfWorst = dSurf;
        surfWorstAt = { x: car.x, z: car.z, key: rb.key, ribbon: rb.y, ground: surf.y };
      }
      // THE HOLE: the drawn tarmac is above the ground the wheels are on. Geometry only.
      if (dSurf > THRESH) {
        if (!inHole) {
          holes.push({ x: car.x, z: car.z, d: dSurf, key: rb.key });
          inHole = true;
        }
      } else inHole = false;
      if (dFall > BODY_THRESH) {
        fall++;
        if (dFall > worstFall.d)
          Object.assign(worstFall, { d: dFall, x: car.x, z: car.z, kph: car.kph, key: rb.key });
        if (!inEvent) {
          events.push({ x: car.x, z: car.z, d: dFall, kph: car.kph, key: rb.key });
          inEvent = true;
        }
      } else inEvent = false;
      if (-dSurf > THRESH) {
        proud++;
        if (-dSurf > worstProud.d) Object.assign(worstProud, { d: -dSurf, x: car.x, z: car.z, key: rb.key });
      }
    } else {
      inEvent = false;
      inHole = false;
    }

    dist += Math.hypot(car.x - px, car.z - pz);
    px = car.x;
    pz = car.z;
  }

  return {
    seed, preset, km: dist / 1000, frames, onRoad, fall, proud, rescues,
    events, holes, worstFall, worstProud, surfWorst, surfWorstAt,
  };
}

/* ── report ─────────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const RUNS = args.length
  ? [[Number(args[0]), args[1] || 'rolling', Number(args[2] || 200)]]
  : [
      [20260726, 'rolling', 200],
      [20260726, 'alpine', 200],
      [20260726, 'meadow', 200],
      [7, 'rolling', 200],
      [7, 'alpine', 200],
      [7, 'meadow', 200],
      [424242, 'rolling', 200],
      [424242, 'alpine', 200],
      [424242, 'meadow', 200],
    ];

console.log(`src ${SRC}`);
console.log('                        HOLES (tarmac above the ground)   CAR BODY under the tarmac');
console.log('seed      preset   km    ev/km  worst      ev/km  %frames  worst   ground-above-tarmac');
let km = 0,
  evs = 0,
  holeN = 0,
  onRoad = 0,
  fall = 0,
  proud = 0,
  worst = 0,
  worstAt = null,
  worstSurf = 0,
  worstSurfAt = null;
for (const [seed, preset, secs] of RUNS) {
  const r = run(seed, preset, secs);
  km += r.km;
  evs += r.events.length;
  holeN += r.holes.length;
  onRoad += r.onRoad;
  fall += r.fall;
  proud += r.proud;
  if (r.worstFall.d > worst) {
    worst = r.worstFall.d;
    worstAt = r.worstFall;
  }
  if (Math.abs(r.surfWorst) > Math.abs(worstSurf)) {
    worstSurf = r.surfWorst;
    worstSurfAt = r.surfWorstAt;
  }
  const holeWorst = r.holes.reduce((m, h) => Math.max(m, h.d), 0);
  console.log(
    `${String(r.seed).padEnd(9)} ${r.preset.padEnd(8)} ${r.km.toFixed(2).padStart(5)}  ` +
      `${(r.holes.length / Math.max(r.km, 1e-3)).toFixed(2).padStart(5)}  ${holeWorst.toFixed(2).padStart(6)} m   ` +
      `${(r.events.length / Math.max(r.km, 1e-3)).toFixed(2).padStart(5)}  ` +
      `${((100 * r.fall) / Math.max(1, r.onRoad)).toFixed(1).padStart(6)}%  ` +
      `${r.worstFall.d.toFixed(2).padStart(5)} m  ${r.worstProud.d.toFixed(2).padStart(8)} m`
  );
}
console.log(
  `\nTOTAL ${km.toFixed(2)} km` +
    `\n  HOLES  (drawn tarmac more than ${THRESH} m above the ground under the car)  ` +
    `${holeN} events = ${(holeN / Math.max(km, 1e-3)).toFixed(3)} per km` +
    `\n  BODY   (car floor more than ${BODY_THRESH.toFixed(2)} m below the tarmac, i.e. past full suspension travel)  ` +
    `${evs} events = ${(evs / Math.max(km, 1e-3)).toFixed(3)} per km, ${((100 * fall) / Math.max(1, onRoad)).toFixed(2)}% of on-road frames` +
    `\n  GROUND ABOVE THE TARMAC  ${((100 * proud) / Math.max(1, onRoad)).toFixed(2)}% of on-road frames`
);
if (worstAt)
  console.log(
    `WORST BODY  ${worst.toFixed(2)} m at (${worstAt.x.toFixed(0)},${worstAt.z.toFixed(0)}) ` +
      `${worstAt.kph.toFixed(0)} km/h edge ${worstAt.key}`
  );
if (worstSurfAt)
  console.log(
    `WORST |ribbon - ground| under the car  ${worstSurf.toFixed(3)} m at ` +
      `(${worstSurfAt.x.toFixed(0)},${worstSurfAt.z.toFixed(0)}) edge ${worstSurfAt.key}  ` +
      `ribbon ${worstSurfAt.ribbon.toFixed(2)} ground ${worstSurfAt.ground.toFixed(2)}`
  );
