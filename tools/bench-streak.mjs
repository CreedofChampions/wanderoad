// streak logic, headless. localStorage does not exist in node — stub it.
globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v} };
const { Streak, fmtDistance, fmtScore } = await import('../src/game/streak.js');
const { Vehicle } = await import('../src/car/vehicle.js');
const { Terrain, findSpawn } = await import('../src/world/terrain.js');
const s = new Streak();
const car = { speed: 33, onGround: true };      // 120 km/h
const on = { onRoad: 1 }, off = { onRoad: 0 };
const dt = 1/60;
const drive = (secs, surf) => { for(let i=0;i<secs/dt;i++){ s.update(dt, car, surf); const e=s.drain(); if(e) console.log('  event:', e.kind, e.text||fmtDistance(e.distance)); } };

console.log('drive 5 min on road at 120 km/h');
drive(300, on);
console.log('  distance', fmtDistance(s.distance), ' mult', s.multiplier.toFixed(2), ' score', fmtScore(s.score));

console.log('brief excursion (0.4 s) — should survive');
drive(0.4, off); drive(5, on);
console.log('  distance', fmtDistance(s.distance), 'survived:', s.distance > 9000);

console.log('longer excursion (1.2 s) — should break');
drive(1.2, off);
console.log('  distance now', fmtDistance(s.distance), ' total', fmtScore(s.total), ' best', fmtDistance(s.best));

console.log('slow crawl on road contributes nothing');
const before = s.distance; car.speed = 3; drive(10, on);
console.log('  delta', (s.distance-before).toFixed(1), 'm  (want 0)');

console.log('faster = more points');
for (const kph of [40, 80, 140, 220, 300]) {
  const t = new Streak(); t.storageKey='x'; car.speed = kph/3.6;
  for(let i=0;i<60/dt;i++) t.update(dt, car, on);
  console.log(`  ${String(kph).padStart(3)} km/h -> ${fmtDistance(t.distance).padStart(9)}  ${fmtScore(t.score).padStart(7)} pts`);
}

console.log('\none side (2 wheels) off tarmac, on the real world — centre sample alone misses this;');
console.log('see vehicle.js\'s "on/off-road STATE" note. Should NOT accrue, and should break after grace.');
{
  const SEED = 20260726;
  const spawn = findSpawn(SEED);
  const terr = new Terrain(SEED, spawn.x - 300, spawn.z - 300, spawn.x + 300, spawn.z + 300);
  const rc = new Vehicle({ tier: 'sports', terrain: terr, preset: 'sport' });

  // Same straddle search as tools/diag-body.mjs: find a straight stretch (front/rear wheels
  // cross the verge at the same offset there), then step out sideways until one side of the
  // car is off tarmac and the other side is still on it.
  let near = terr.roads.query(spawn.x, spawn.z);
  let px0 = spawn.x, pz0 = spawn.z;
  for (let step = 0; step < 60; step++) {
    const a = terr.roads.query(px0 + near.tx * 2.0, pz0 + near.tz * 2.0);
    const b = terr.roads.query(px0 - near.tx * 2.0, pz0 - near.tz * 2.0);
    if (Math.abs(Math.atan2(a.tx, a.tz) - Math.atan2(b.tx, b.tz)) < 0.004) break;
    px0 += near.tx * 8; pz0 += near.tz * 8;
    near = terr.roads.query(px0, pz0);
    px0 = near.qx; pz0 = near.qz;
  }
  const heading = Math.atan2(near.tx, near.tz);
  let spot = null;
  for (let d = 0.02; d <= 6 && !spot; d += 0.02) {
    const px = px0 + near.tz * d, pz = pz0 - near.tx * d;
    rc.placeAt(px, pz, heading);
    const w = rc.wheels.map((k) => k.onRoad);
    const leftOn = w[0] > 0.99 && w[2] > 0.99 && w[1] < 0.01 && w[3] < 0.01;
    const rightOn = w[1] > 0.99 && w[3] > 0.99 && w[0] < 0.01 && w[2] < 0.01;
    if (leftOn || rightOn) spot = { px, pz };
  }
  if (!spot) {
    console.log('  FAILED to find a one-side-off offset on this seed/stretch');
  } else {
    rc.placeAt(spot.px, spot.pz, heading);
    rc.speed = 33; // 120 km/h, same as the fixture car above
    const surfAtSpot = terr.surface(spot.px, spot.pz);
    console.log(`  centre onRoad ${surfAtSpot.onRoad.toFixed(2)}  worst wheel (car.onRoadMin) ${rc.onRoadMin.toFixed(2)}`);

    const t3 = new Streak(); t3.storageKey = 'z';
    for (let i = 0; i < 10 / dt; i++) t3.update(dt, { speed: 33, onGround: true, onRoadMin: 1 }, { onRoad: 1 }); // bank a real streak first
    const before = t3.distance;
    for (let i = 0; i < 1.0 / dt; i++) t3.update(dt, rc, surfAtSpot); // then hold the one-side-off spot past the 0.55s grace
    console.log(`  streak.onRoad while one side off: ${t3.onRoad}   distance before ${fmtDistance(before)} -> after 1s ${fmtDistance(t3.distance)}  (broke: ${t3.distance === 0})`);
  }
}
