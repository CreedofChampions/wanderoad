// streak logic, headless. localStorage does not exist in node — stub it.
globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v} };
const { Streak, fmtDistance, fmtScore } = await import('../src/game/streak.js');
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
