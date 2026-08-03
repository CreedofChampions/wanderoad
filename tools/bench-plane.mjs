/* Wanderoad — does the plane fly, and is it earned the way it was asked to be?
 *
 * Operator: "make planes unlockable via diamonds in sea ... let me unlock via pass 123 and even spawn
 * in air", and separately "Look up air control git repos based on popularity and then use one".
 *
 * src/game/plane.js is a port of brihernandez/ArcadeJetFlightExample (MIT) and records the licence
 * search that picked it. What this file checks is that the port actually behaves like an aeroplane
 * rather than like a brick with a nose: it has to climb when you pull back, turn when you bank
 * (which is the reference's whole trick and the thing most likely to be lost in a port), lose height
 * with the throttle shut, and come down on the ground rather than through it.
 *
 * Every check reads the pose after a real fixed-step run. Nothing here trusts a flag.
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { Plane, PLANE, PLANE_UNLOCK_GEMS, PLANE_PASS } = await import('../src/game/plane.js');
const { Wallet } = await import('../src/game/wallet.js');

const DT = 1 / 120;
let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(58)} ${String(got).padStart(14)}   want ${want}`);
};

/** Flat ground at y=0, so anything the pose does is the aerodynamics and not the terrain. */
const FLAT = () => ({ height: () => 0 });
const STICK = (o = {}) => ({ steer: 0, pitch: 0, throttle: 0, brake: 0, analogue: true, ...o });

const airborne = (wallet, opts = {}) => {
  const p = new Plane({ wallet, terrain: FLAT, say: () => {} });
  p.start({ x: 0, z: 0, y: 0, yaw: 0, speed: 40 }, true);
  Object.assign(p, opts);
  return p;
};

console.log('\nWANDEROAD — THE PLANE\n' + '-'.repeat(84));

/* ── 1. it is earned with sea diamonds, or with the pass ───────────────────── */
console.log('\n── unlocked by diamonds from the sea ──────────────────────────────────────');
{
  const w = new Wallet({ storageKey: 'bench.plane.gems' });
  const p = new Plane({ wallet: w, terrain: FLAT, say: () => {} });
  check(!p.unlocked, 'a new wallet has no plane', p.unlocked, 'false');
  check(p.gemsToGo === PLANE_UNLOCK_GEMS, `and needs all ${PLANE_UNLOCK_GEMS} diamonds`, p.gemsToGo, String(PLANE_UNLOCK_GEMS));
  check(!p.start({ x: 0, z: 0, y: 0, yaw: 0, speed: 30 }, false), 'taking off without one fails', 'false', 'false');

  w.addGems(PLANE_UNLOCK_GEMS - 1);
  check(!p.unlocked, 'one diamond short is still short', p.unlocked, 'false');
  w.addGems(1);
  check(p.unlocked, `${PLANE_UNLOCK_GEMS} diamonds earns it`, p.unlocked, 'true');
  check(p.gemsToGo === 0, 'and nothing more is owed', p.gemsToGo, '0');

  const w2 = new Wallet({ storageKey: 'bench.plane.pass' });
  check(!w2.planeUnlocked, 'a second wallet is still empty-handed', w2.planeUnlocked, 'false');
  check(!w2.unlockPlaneWithPass('999', PLANE_PASS), 'the wrong pass does nothing', 'false', 'false');
  check(w2.unlockPlaneWithPass(PLANE_PASS, PLANE_PASS), `the pass "${PLANE_PASS}" works`, 'true', 'true');
  check(w2.planeUnlocked, 'and latches the same flag an earned one does', w2.planeUnlocked, 'true');
  const reloaded = new Wallet({ storageKey: 'bench.plane.pass' });
  check(reloaded.planeUnlocked, 'which survives a reload', reloaded.planeUnlocked, 'true');
}

/* ── 2. spawn in the air, and it flies ────────────────────────────────────── */
console.log('\n── it spawns in the air and stays there ───────────────────────────────────');
const w = new Wallet({ storageKey: 'bench.plane.fly' });
w.addGems(PLANE_UNLOCK_GEMS);
{
  const p = airborne(w);
  console.log(`       spawned at ${p.y.toFixed(0)} m doing ${p.kph.toFixed(0)} km/h`);
  check(p.active, 'it took off', p.active, 'true');
  check(p.y > PLANE.spawnHeight * 0.8, 'high up, as asked ("even spawn in air")', `${p.y.toFixed(0)} m`, `> ${(PLANE.spawnHeight * 0.8).toFixed(0)} m`);

  // level, hands off the stick but throttle held: it must not fall out of the sky
  const y0 = p.y;
  for (let i = 0; i < 20 / DT; i++) p.update(DT, STICK({ throttle: 0.6 }));
  console.log(`       20 s wings level at part throttle: ${y0.toFixed(0)} m -> ${p.y.toFixed(0)} m, ${p.kph.toFixed(0)} km/h`);
  check(p.y > 20, 'twenty seconds later it is still flying', `${p.y.toFixed(0)} m`, '> 20 m');
  check(p.kph > 60, 'at a real airspeed', `${p.kph.toFixed(0)} km/h`, '> 60 km/h');
}

/* ── 3. pull back to climb, push to dive ─────────────────────────────────── */
console.log('\n── the stick does what a stick does ───────────────────────────────────────');
{
  const up = airborne(w);
  const y0 = up.y;
  for (let i = 0; i < 8 / DT; i++) up.update(DT, STICK({ throttle: 1, pitch: 1 }));
  const down = airborne(w);
  for (let i = 0; i < 8 / DT; i++) down.update(DT, STICK({ throttle: 1, pitch: -1 }));
  console.log(`       8 s from ${y0.toFixed(0)} m: nose up -> ${up.y.toFixed(0)} m, nose down -> ${down.y.toFixed(0)} m`);
  check(up.y > y0 + 20, 'pulling back climbs', `${(up.y - y0).toFixed(0)} m`, '> +20 m');
  check(down.y < y0 - 20, 'pushing forward dives', `${(down.y - y0).toFixed(0)} m`, '< -20 m');
}

/* ── 4. THE BANK TRICK, which is the reference's whole idea ───────────────── */
console.log('\n── banking turns the aeroplane (the reference own trick) ──────────────────');
{
  /* This is the check worth having. brihernandez's model turns by YAWING IN PROPORTION TO BANK, read
   * off the plane's own right vector, and it is the difference between an aeroplane and a spaceship.
   * A port that dropped that line would still climb, dive and fly straight — and would fail here. */
  const roll = airborne(w);
  const yaw0 = roll.yaw;
  for (let i = 0; i < 10 / DT; i++) roll.update(DT, STICK({ throttle: 0.8, steer: 1 }));
  let turned = Math.abs(roll.yaw - yaw0);
  while (turned > Math.PI * 2) turned -= Math.PI * 2;
  console.log(`       10 s of held roll: bank ${((roll.roll * 180) / Math.PI).toFixed(0)} deg, heading changed ${((turned * 180) / Math.PI).toFixed(0)} deg`);
  check(Math.abs(roll.roll) > 0.5, 'holding the stick over banks it', `${((roll.roll * 180) / Math.PI).toFixed(0)} deg`, '> 29 deg');
  check(turned > 0.35, 'and being banked TURNS it, with no rudder input at all', `${((turned * 180) / Math.PI).toFixed(0)} deg`, '> 20 deg');

  // wings level, same time, same throttle: it must NOT turn. Otherwise the check above proves nothing.
  const straight = airborne(w);
  const s0 = straight.yaw;
  for (let i = 0; i < 10 / DT; i++) straight.update(DT, STICK({ throttle: 0.8 }));
  check(Math.abs(straight.yaw - s0) < 0.12, 'and wings level it flies straight', `${(((straight.yaw - s0) * 180) / Math.PI).toFixed(1)} deg`, 'about 0');
}

/* ── 4b. WHICH WAY IT TURNS ──────────────────────────────────────────────── */
console.log('\n── press left, go left ────────────────────────────────────────────');
{
  /* Operator: "the plane when being steered left goes right and vice versa". The bank-trick check
   * above passed the whole time it was inverted, because it only asks whether a held stick turns
   * the aeroplane AT ALL — Math.abs() on both the bank and the heading change. Sign is the thing
   * the player actually feels, so it gets its own check.
   *
   * The convention, once, from car/input.js: steer POSITIVE IS LEFT. The pose convention, from
   * plane.js: forward is (sin yaw, cos yaw), so yaw INCREASING sweeps +Z towards +X, which is to
   * the right. Left stick must therefore make yaw go DOWN. */
  const left = airborne(w);
  const l0 = left.yaw;
  for (let i = 0; i < 6 / DT; i++) left.update(DT, STICK({ throttle: 0.8, steer: 1 }));
  const dLeft = left.yaw - l0;

  const right = airborne(w);
  const r0 = right.yaw;
  for (let i = 0; i < 6 / DT; i++) right.update(DT, STICK({ throttle: 0.8, steer: -1 }));
  const dRight = right.yaw - r0;

  console.log(`       6 s of stick: left ${((dLeft * 180) / Math.PI).toFixed(0)} deg, right ${((dRight * 180) / Math.PI).toFixed(0)} deg  (negative = to the left)`);
  check(dLeft < -0.15, 'holding LEFT turns the nose to the left', `${((dLeft * 180) / Math.PI).toFixed(0)} deg`, 'negative');
  check(dRight > 0.15, 'holding RIGHT turns the nose to the right', `${((dRight * 180) / Math.PI).toFixed(0)} deg`, 'positive');
  check(left.roll < 0 && right.roll > 0, 'and it banks the way it is turning', `${((left.roll * 180) / Math.PI).toFixed(0)} / ${((right.roll * 180) / Math.PI).toFixed(0)} deg`, 'left negative, right positive');
}

/* ── 5. the ground is a floor, not a wall ────────────────────────────────── */
console.log('\n── landing is soft, and the ground holds ──────────────────────────────────');
{
  const p = airborne(w, { y: 40 });
  for (let i = 0; i < 40 / DT; i++) p.update(DT, STICK({ throttle: 0, brake: 1, pitch: -0.15 }));
  console.log(`       40 s with the throttle shut from 40 m: ${p.y.toFixed(2)} m, ${p.kph.toFixed(0)} km/h`);
  check(p.y >= 0, 'it never goes through the ground', p.y.toFixed(2), '>= 0');
  check(p.y < 6, 'it does come down', `${p.y.toFixed(2)} m`, '< 6 m');
  check(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), 'and the pose stays a real number', `${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}`, 'finite');
  check(p.kph < 90, 'at a speed a light aircraft would land at', `${p.kph.toFixed(0)} km/h`, '< 90 km/h');
}

console.log(`\n${failures ? `${failures} PLANE CHECK(S) FAILED` : 'all plane checks passed'}\n`);
process.exit(failures ? 1 : 0);
