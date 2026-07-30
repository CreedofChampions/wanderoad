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

const { Wallet, STREAK_METRES_PER_COIN, BOAT_UNLOCK_COINS, CAN_PRICE, CAN_MAX } = await import('../src/game/wallet.js');
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

/* ── 4. the boat is BOUGHT at a harbour, and spending cannot take it back ─── */
console.log('\n── the boat is bought, not granted ────────────────────────────────────────');
{
  const w = new Wallet({ storageKey: 'bench.econ.boat' });
  w.addCoins(BOAT_UNLOCK_COINS);
  /* THE RULE CHANGED, on instruction: "making buying a boat and unlock that. It isn't automatic, but
   * something you get at the harbor." Holding the price used to latch the unlock right there in
   * addCoins, which made the boat the one thing in the game that arrived without you going anywhere.
   * These two checks asserted that old behaviour; they now assert the new one. */
  check(!w.boatUnlocked, `holding ${BOAT_UNLOCK_COINS} coins does NOT hand you the boat`, w.boatUnlocked, 'false');
  const ev = [];
  for (let e = w.drain(); e; e = w.drain()) ev.push(e.kind);
  check(ev.includes('boat-affordable'), 'but it does tell you, once, that you can afford one', ev.join(',') || '(none)', 'boat-affordable');

  check(w.buyBoat(), 'buying it at a harbour works', 'true', 'true');
  check(w.coins === 0, 'and the money is gone', w.coins, '0');
  check(w.boatUnlocked, 'the boat is yours', w.boatUnlocked, 'true');
  check(!w.buyBoat(), 'buying it twice is a no-op', 'false', 'false');

  w.addCoins(200);
  check(w.spend(200), 'then spend everything else you own', 'true', 'true');
  /* The trap the whole change had to avoid: boatUnlocked used to read "do you hold 50 coins RIGHT
   * NOW", which was fine while nothing could be spent and would have taken the boat back the first
   * time anyone bought a car. */
  check(w.boatUnlocked, 'and the boat is STILL yours on an empty wallet', w.boatUnlocked, 'true');

  const reloaded = new Wallet({ storageKey: 'bench.econ.boat' });
  check(reloaded.boatUnlocked, 'and it survives a reload', reloaded.boatUnlocked, 'true');
}

/* ── 4b. spare fuel cans, bought at a pump ────────────────────────────────── */
console.log('\n── gas cans = coins, bought at a petrol station ───────────────────────────');
{
  const w = new Wallet({ storageKey: 'bench.econ.cansbought' });
  check(w.cans === 0, 'the boot starts empty', w.cans, '0');
  check(!w.buyCan(CAN_PRICE), 'a can cannot be bought with no money', 'false', 'false');
  w.addCoins(CAN_PRICE * (CAN_MAX + 2));
  for (let k = 0; k < CAN_MAX; k++) check(w.buyCan(CAN_PRICE), `can ${k + 1} of ${CAN_MAX} bought`, 'true', 'true');
  console.log(`       bought ${w.cans} cans at ${CAN_PRICE} coins each; ${w.coins} coins left`);
  check(w.cans === CAN_MAX, 'the boot holds the maximum', w.cans, String(CAN_MAX));
  check(!w.buyCan(CAN_PRICE), 'and refuses one more', 'false', 'false');
  check(w.useCan(), 'pouring one in works', 'true', 'true');
  check(w.cans === CAN_MAX - 1, 'and takes it out of the boot', w.cans, String(CAN_MAX - 1));
  const reloaded = new Wallet({ storageKey: 'bench.econ.cansbought' });
  check(reloaded.cans === CAN_MAX - 1, 'the cans survive a reload', reloaded.cans, String(CAN_MAX - 1));
}

/* ── 4c. harbours are real places on real coastline ───────────────────────── */
console.log('\n── harbours exist, on water deep enough for a boat ────────────────────────');
{
  const { harboursInBox, HARBOUR_DEPTH, HARBOUR_MAX_ROAD } = await import('../src/world/props.js');
  const { Terrain, isDryAt, findSpawn } = await import('../src/world/terrain.js');
  const { waterLevelAt } = await import('../src/world/biomes.js');
  for (const seed of [20260726, 7]) {
    const spawn = findSpawn(seed);
    const R = 12000;
    const big = new Terrain(seed, spawn.x - R - 800, spawn.z - R - 800, spawn.x + R + 800, spawn.z + R + 800);
    const probe = {
      height: (x, z) => big.height(x, z),
      dry: (x, z) => isDryAt(x, z, seed),
      waterY: (x, z) => {
        const su = big.surface(x, z);
        return su && su.w ? waterLevelAt(su.w, su.y) : null;
      },
    };
    const list = harboursInBox(spawn.x - R, spawn.z - R, spawn.x + R, spawn.z + R, seed, probe);
    let nearest = Infinity;
    let shallow = 0;
    let farFromRoad = 0;
    for (const h of list) {
      nearest = Math.min(nearest, Math.hypot(h.x - spawn.x, h.z - spawn.z));
      if (h.depth < HARBOUR_DEPTH) shallow++;
      if (h.roadDist > HARBOUR_MAX_ROAD) farFromRoad++;
    }
    console.log(`       seed ${seed}: ${list.length} harbours within ${R / 1000} km of spawn, nearest ${(nearest / 1000).toFixed(1)} km`);
    check(list.length >= 3, `seed ${seed}: harbours exist near spawn`, list.length, '>= 3');
    check(shallow === 0, `seed ${seed}: every one has water deep enough to float a boat`, `${shallow} too shallow`, '0');
    check(farFromRoad === 0, `seed ${seed}: and every one is reachable from a road`, `${farFromRoad} unreachable`, '0');
    check(nearest < R, `seed ${seed}: the nearest is a drive, not an expedition`, `${(nearest / 1000).toFixed(1)} km`, `< ${R / 1000} km`);
  }
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
