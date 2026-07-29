/* Wanderoad — the coin economy, end to end.
 *
 * Operator: "add dealerships where you can buy cars with coins -- make the whole new reward
 * system run via coins. Streaks = coins. Gas bonus = buy it for coins. New cars = coins."
 *
 * Four claims, and each one is asserted against the thing that actually decides it rather than
 * against a flag: coins in a wallet that has been driven, a car in the owned set after paying
 * for it, a tank whose CAPACITY in seconds actually grew, and dealerships that really exist in
 * the world at a spacing a driver can reach.
 *
 * A localStorage stub is installed because every one of these is persisted, and a purchase that
 * does not survive a reload is not a purchase. The stub is a real Map, so the checks below go
 * through the save/load round trip rather than only through the in-memory object.
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { Wallet, STREAK_METRES_PER_COIN, BOAT_UNLOCK_COINS } = await import('../src/game/wallet.js');
const { FLEET, FLEET_BY_ID, priceOf, isUnlocked } = await import('../src/game/garage.js');
const { Fuel, TANK_PRICE_BASE, TANK_PRICE_STEP } = await import('../src/game/fuel.js');
const { stationsInBox, DEAL_SHARE } = await import('../src/world/props.js');

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(58)} ${String(got).padStart(14)}   want ${want}`);
};

console.log('\nWANDEROAD — COINS ARE THE WHOLE ECONOMY\n' + '-'.repeat(84));

/* ── 1. a streak mints coins, and a broken streak is not charged for ───────── */
console.log('\n── streaks pay ────────────────────────────────────────────────────────────');
{
  const w = new Wallet({ storageKey: 'bench.econ.streak' });
  check(w.coins === 0, 'a new wallet is empty', w.coins, '0');

  // a run, read every frame the way main.js reads it
  let minted = 0;
  for (let m = 0; m <= 1000; m += 5) minted += w.mintStreak(m);
  console.log(`       1000 m of streak, read every 5 m: ${minted} coins (one per ${STREAK_METRES_PER_COIN} m)`);
  check(minted === Math.floor(1000 / STREAK_METRES_PER_COIN), 'a kilometre pays the rate exactly, once', minted, String(Math.floor(1000 / STREAK_METRES_PER_COIN)));
  check(w.coins === minted, 'and the coins are in the wallet', w.coins, String(minted));

  // reading the SAME distance again must not pay again
  const before = w.coins;
  for (let i = 0; i < 100; i++) w.mintStreak(1000);
  check(w.coins === before, 'reading the same run again pays nothing', w.coins, String(before));

  // the streak breaks: distance goes to 0, then a new run starts paying from its own metre 1
  w.mintStreak(0);
  let second = 0;
  for (let m = 0; m <= 500; m += 5) second += w.mintStreak(m);
  console.log(`       streak broke, then 500 m more: ${second} coins`);
  check(second === Math.floor(500 / STREAK_METRES_PER_COIN), 'a new run pays from its own first metre', second, String(Math.floor(500 / STREAK_METRES_PER_COIN)));
}

/* ── 2. cars are bought, and stay bought ──────────────────────────────────── */
console.log('\n── new cars = coins ───────────────────────────────────────────────────────');
{
  const w = new Wallet({ storageKey: 'bench.econ.cars' });
  const first = FLEET[0];
  const second = FLEET[1];
  check(w.owns(first.id, first.id), 'the car you start in is yours from the first frame', w.owns(first.id, first.id), 'true');
  check(!w.owns(second.id, first.id), `and ${second.label} is not`, w.owns(second.id, first.id), 'false');
  check(priceOf(second) > 0, `${second.label} has a price`, `${priceOf(second)} coins`, '> 0');

  check(!w.buyCar(second.id, priceOf(second)), 'buying with no money fails', 'false', 'false');
  check(!w.owns(second.id, first.id), 'and does not hand the car over anyway', w.owns(second.id, first.id), 'false');

  w.addCoins(priceOf(second));
  const bought = w.buyCar(second.id, priceOf(second));
  console.log(`       bought ${second.label} for ${priceOf(second)}; ${w.coins} coins left`);
  check(bought, `paying for ${second.label} works`, bought, 'true');
  check(w.coins === 0, 'and the money is actually gone', w.coins, '0');
  check(w.owns(second.id, first.id), 'the car is owned', w.owns(second.id, first.id), 'true');
  check(isUnlocked(second, 0, w), 'and the garage lets you drive it on 0 m of streak', isUnlocked(second, 0, w), 'true');
  check(!isUnlocked(FLEET[2], 0, w), 'while the NEXT one up is still locked', isUnlocked(FLEET[2], 0, w), 'false');
  check(!w.buyCar(second.id, priceOf(second)), 'buying it twice is a no-op, not a second charge', 'false', 'false');

  // and it survives a reload
  const reloaded = new Wallet({ storageKey: 'bench.econ.cars' });
  check(reloaded.owns(second.id, first.id), 'the purchase survives a reload', reloaded.owns(second.id, first.id), 'true');
}

/* ── 3. the gas bonus is bought, per car, and the tank really grows ───────── */
console.log('\n── gas bonus = coins ──────────────────────────────────────────────────────');
{
  const w = new Wallet({ storageKey: 'bench.econ.tank' });
  const a = new Fuel({ carId: 'econ-a', wallet: w });
  const capBefore = a.capacity;
  check(a.tankPrice === TANK_PRICE_BASE, 'the first upgrade costs the base price', `${a.tankPrice} coins`, String(TANK_PRICE_BASE));
  check(!w.buyTank('econ-a', a.tankPrice), 'and cannot be bought with an empty wallet', 'false', 'false');
  check(Math.abs(a.capacity - capBefore) < 1e-6, 'so the tank has not changed', a.capacity.toFixed(1), capBefore.toFixed(1));

  w.addCoins(TANK_PRICE_BASE);
  check(w.buyTank('econ-a', a.tankPrice), 'with the money, it goes through', 'true', 'true');
  console.log(`       car A tank: ${(capBefore / 60).toFixed(1)} min -> ${(a.capacity / 60).toFixed(1)} min, next upgrade ${a.tankPrice} coins`);
  check(a.capacity > capBefore, 'and the CAPACITY IN SECONDS actually grew', `${(a.capacity / 60).toFixed(1)} min`, `> ${(capBefore / 60).toFixed(1)} min`);
  check(a.tankPrice === TANK_PRICE_BASE + TANK_PRICE_STEP, 'the next one is dearer', `${a.tankPrice} coins`, String(TANK_PRICE_BASE + TANK_PRICE_STEP));

  // per car: a different car is back to the base tank, because capacity belongs to the car
  const b = new Fuel({ carId: 'econ-b', wallet: w });
  console.log(`       car B tank: ${(b.capacity / 60).toFixed(1)} min`);
  check(Math.abs(b.capacity - capBefore) < 1e-6, 'another car does NOT get car A upgrade', `${(b.capacity / 60).toFixed(1)} min`, `${(capBefore / 60).toFixed(1)} min`);

  const reloaded = new Wallet({ storageKey: 'bench.econ.tank' });
  check(reloaded.tankLevel('econ-a') === 1, 'the upgrade survives a reload', reloaded.tankLevel('econ-a'), '1');
}

/* ── 4. the boat is EARNED and spending cannot take it away ───────────────── */
console.log('\n── spending never un-earns something ──────────────────────────────────────');
{
  const w = new Wallet({ storageKey: 'bench.econ.boat' });
  w.addCoins(BOAT_UNLOCK_COINS);
  check(w.boatUnlocked, `reaching ${BOAT_UNLOCK_COINS} coins earns the boat`, w.boatUnlocked, 'true');
  check(w.spend(BOAT_UNLOCK_COINS), 'then spend every coin of it', 'true', 'true');
  /* This is the trap the whole change had to avoid: boatUnlocked used to read "do you hold 50
   * coins RIGHT NOW", which was fine while nothing could be spent and would have quietly taken
   * the boat back the first time anyone bought a car. */
  check(w.boatUnlocked, 'and the boat is STILL yours', w.boatUnlocked, 'true');
  check(w.coins === 0, 'with an empty wallet', w.coins, '0');
}

/* ── 5. dealerships are real places, at a reachable spacing ──────────────── */
console.log('\n── dealerships exist in the world ─────────────────────────────────────────');
{
  for (const seed of [20260726, 7, 424242]) {
    const st = stationsInBox(-6000, -6000, 6000, 6000, seed);
    const deals = st.filter((s) => s.deal);
    const pumps = st.length - deals.length;
    // mean distance from any dealership to its nearest neighbour dealership
    let sum = 0;
    for (const d of deals) {
      let best = Infinity;
      for (const o of deals) if (o !== d) best = Math.min(best, Math.hypot(o.x - d.x, o.z - d.z));
      if (isFinite(best)) sum += best;
    }
    const mean = deals.length > 1 ? sum / deals.length : Infinity;
    console.log(`       seed ${seed}: ${st.length} stations = ${pumps} pumps + ${deals.length} dealerships, nearest-neighbour mean ${(mean / 1000).toFixed(1)} km`);
    check(deals.length >= 4, `seed ${seed}: dealerships exist in a 12 km box`, deals.length, '>= 4');
    check(pumps > deals.length, `seed ${seed}: and pumps are still the common case`, `${pumps} vs ${deals.length}`, 'more pumps');
    check(mean < 4000, `seed ${seed}: and one is reachable on a tank`, `${(mean / 1000).toFixed(1)} km apart`, '< 4 km');
  }
  // the split is deterministic: the same seed gives the same dealerships every time
  const a = stationsInBox(-3000, -3000, 3000, 3000, 20260726).filter((s) => s.deal).map((s) => s.key).sort();
  const b = stationsInBox(-3000, -3000, 3000, 3000, 20260726).filter((s) => s.deal).map((s) => s.key).sort();
  check(a.length > 0 && a.join() === b.join(), 'which station sells cars is a pure function of the seed', `${a.length} identical`, 'identical');
  console.log(`       DEAL_SHARE is ${DEAL_SHARE}, measured share above`);
}

console.log(`\n${failures ? `${failures} ECONOMY CHECK(S) FAILED` : 'all economy checks passed'}\n`);
process.exit(failures ? 1 : 0);
