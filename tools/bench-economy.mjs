/* Wanderoad — the sun economy, end to end.
 *
 * Operator: "add dealerships where you can buy cars with suns -- make the whole new reward
 * system run via suns. Streaks = suns. Gas bonus = buy it for suns. New cars = suns."
 *
 * Four claims, and each one is asserted against the thing that actually decides it rather than
 * against a flag: suns in a wallet that has been driven, a car in the owned set after paying
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

const { Wallet, BOAT_UNLOCK_SUNS, CAN_PRICE, CAN_MAX, milestoneLength, milestoneReward } = await import('../src/game/wallet.js');
const { FLEET, FLEET_BY_ID, priceOf, isUnlocked, unlockRule } = await import('../src/game/garage.js');
const { Fuel, TANK_PRICE_BASE, TANK_PRICE_STEP } = await import('../src/game/fuel.js');
const { stationsInBox, DEAL_SHARE } = await import('../src/world/props.js');

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(58)} ${String(got).padStart(14)}   want ${want}`);
};

console.log('\nWANDEROAD — SUNS ARE THE WHOLE ECONOMY\n' + '-'.repeat(84));

/* ── 1. a filled bar pays, and a broken run starts again from the first bar ── */
console.log('');
console.log('-- one bar, one milestone, one payout --');
{
  const w = new Wallet({ storageKey: 'bench.econ.streak' });
  check(w.suns === 0, 'a new wallet is empty', w.suns, '0');
  check(w.milestone.index === 0, 'and starts on the first bar', w.milestone.index, '0');
  console.log(`       the ladder: ${[0, 1, 2, 3, 4, 5].map((i) => `${(milestoneLength(i) / 1000)}km->${milestoneReward(i)}`).join('  ')}`);

  // a run read every 5 m, the way main.js reads it
  let minted = 0;
  for (let m = 0; m <= milestoneLength(0); m += 5) minted += w.mintStreak(m);
  check(minted === milestoneReward(0), 'finishing the first bar pays its own reward', minted, String(milestoneReward(0)));
  check(w.milestone.index === 1, 'and moves you onto the second bar', w.milestone.index, '1');
  check(w.milestone.length > milestoneLength(0), 'which is longer than the first', `${w.milestone.length} m`, `> ${milestoneLength(0)} m`);

  const fill = w.takeFill();
  check(!!fill && fill.suns === milestoneReward(0), 'and records a fill for the HUD to throw a sun for', fill ? fill.suns : 'none', String(milestoneReward(0)));
  check(w.takeFill() === null, 'popped exactly once, so the sun cannot double up', 'null', 'null');

  // reading the same distance again must not pay again
  const before = w.suns;
  for (let i = 0; i < 100; i++) w.mintStreak(milestoneLength(0));
  check(w.suns === before, 'reading the same run again pays nothing', w.suns, String(before));

  // the run breaks: back to the first bar
  w.mintStreak(0);
  check(w.milestone.index === 0, 'leaving the road puts you back on the FIRST bar', w.milestone.index, '0');
  check(w.milestoneProgress(0) === 0, 'with an empty bar', w.milestoneProgress(0), '0');

  /* AND THE CURVE MUST NOT INVERT. The first shape tried paid a flat 1, 1, 2, 2, 3 ... while the bars
   * got longer, which measured as thirty separate 1 km runs paying 30 suns against one unbroken 30 km
   * run paying 16 — the exact opposite of "the more they do it, the more suns they get", and it would
   * have taught players to break their streak on purpose. This check is here so that can never come
   * back unnoticed. */
  const longRun = new Wallet({ storageKey: 'bench.econ.long' });
  let longPay = 0;
  for (let m = 0; m <= 25000; m += 10) longPay += longRun.mintStreak(m);
  const shortRuns = new Wallet({ storageKey: 'bench.econ.short' });
  let shortPay = 0;
  for (let r = 0; r < 25; r++) {
    for (let m = 0; m <= 1000; m += 10) shortPay += shortRuns.mintStreak(m);
    shortRuns.mintStreak(0);
  }
  console.log(`       one unbroken 25 km run pays ${longPay} suns; twenty-five separate 1 km runs pay ${shortPay}`);
  check(longPay > shortPay, 'ONE LONG RUN BEATS THE SAME DISTANCE IN SHORT ONES', `${longPay} vs ${shortPay}`, 'long wins');
}

/* ── 2. cars are bought, and stay bought ──────────────────────────────────── */
console.log('\n── new cars = suns ───────────────────────────────────────────────────────');
{
  const w = new Wallet({ storageKey: 'bench.econ.cars' });
  const first = FLEET[0];
  const second = FLEET[1];
  check(w.owns(first.id, first.id), 'the car you start in is yours from the first frame', w.owns(first.id, first.id), 'true');
  check(!w.owns(second.id, first.id), `and ${second.label} is not`, w.owns(second.id, first.id), 'false');
  check(priceOf(second) > 0, `${second.label} has a price`, `${priceOf(second)} suns`, '> 0');

  check(!w.buyCar(second.id, priceOf(second)), 'buying with no money fails', 'false', 'false');
  check(!w.owns(second.id, first.id), 'and does not hand the car over anyway', w.owns(second.id, first.id), 'false');

  w.addSuns(priceOf(second));
  const bought = w.buyCar(second.id, priceOf(second));
  console.log(`       bought ${second.label} for ${priceOf(second)}; ${w.suns} suns left`);
  check(bought, `paying for ${second.label} works`, bought, 'true');
  check(w.suns === 0, 'and the money is actually gone', w.suns, '0');
  check(w.owns(second.id, first.id), 'the car is owned', w.owns(second.id, first.id), 'true');
  check(isUnlocked(second, 0, w), 'and the garage lets you drive it on 0 m of streak', isUnlocked(second, 0, w), 'true');
  /* THE NEXT DEALERSHIP CAR, not FLEET[2]. This used to index the fleet directly, and when the Ford
   * became the starter car (so the order changed) FLEET[2] happened to be a car the 30 suns just
   * earned had already unlocked — the check went red without anything being wrong. Ask for a car that
   * is still locked BY RULE and the assertion stops depending on the order of a list. */
  const stillShut = FLEET.find((c) => c.id !== second.id && unlockRule(c).how === 'buy' && !isUnlocked(c, 0, w));
  check(!!stillShut, `while ${stillShut ? stillShut.label : 'the next one up'} is still locked`, !!stillShut, 'true');
  check(!w.buyCar(second.id, priceOf(second)), 'buying it twice is a no-op, not a second charge', 'false', 'false');

  // and it survives a reload
  const reloaded = new Wallet({ storageKey: 'bench.econ.cars' });
  check(reloaded.owns(second.id, first.id), 'the purchase survives a reload', reloaded.owns(second.id, first.id), 'true');
}

/* ── 2b. two ladders: the first three are COLLECTED, the rest are BOUGHT ──── */
console.log('\n── first three on total collected, the rest at a dealership ───────────────');
{
  const w = new Wallet({ storageKey: 'bench.econ.earn' });
  const earned = FLEET.filter((c) => unlockRule(c).how === 'earn');
  const bought = FLEET.filter((c) => unlockRule(c).how === 'buy');
  check(earned.length === 3, 'exactly THREE cars open on total suns collected', earned.length, '3');
  check(bought.length === FLEET.length - 3, 'and every other car needs a dealership', bought.length, String(FLEET.length - 3));

  const [, two, three] = earned;
  check(!isUnlocked(two, 0, w), `${two.label} starts locked`, isUnlocked(two, 0, w), 'false');

  /* THE ODOMETER IS NOT THE BALANCE, and this is the check that matters: earn past the threshold,
   * then spend it all. The car must stay. Anything else means a shop can take a car back off you. */
  w.addSuns(unlockRule(two).at);
  check(isUnlocked(two, 0, w), `collecting ${unlockRule(two).at} suns opens ${two.label}`, isUnlocked(two, 0, w), 'true');
  check(!isUnlocked(three, 0, w), `but not ${three.label}, which wants ${unlockRule(three).at}`, isUnlocked(three, 0, w), 'false');

  const spent = w.spend(w.suns);
  check(spent && w.suns === 0, 'spend the balance down to nothing', `${w.suns} suns`, '0');
  check(w.sunsEarned >= unlockRule(two).at, 'the lifetime total does NOT move when you spend', w.sunsEarned, `>= ${unlockRule(two).at}`);
  check(isUnlocked(two, 0, w), `and ${two.label} is STILL yours after spending`, isUnlocked(two, 0, w), 'true');

  // Reload: the odometer persists, so the car does not evaporate between sessions.
  const back = new Wallet({ storageKey: 'bench.econ.earn' });
  check(isUnlocked(two, 0, back), `${two.label} survives a reload with a zero balance`, isUnlocked(two, 0, back), 'true');

  /* A BOUGHT CAR CANNOT BE COLLECTED INTO. Reaching a huge lifetime total must not hand over the
   * dealership fleet — that would delete the reason to ever find a dealership. */
  const rich = new Wallet({ storageKey: 'bench.econ.rich' });
  rich.addSuns(100000);
  const stillShut = bought.filter((c) => !isUnlocked(c, 0, rich));
  check(stillShut.length === bought.length, '100000 suns collected opens NO dealership car', `${stillShut.length}/${bought.length} shut`, 'all shut');

  /* MIGRATION: a save written before `sunsEarned` existed has a balance and no odometer. It must
   * read back as having earned at least what it is holding, or a returning player loses cars. */
  const KEY = 'bench.econ.legacy';
  globalThis.localStorage.setItem(KEY, JSON.stringify({ suns: 300, owned: [] }));
  const legacy = new Wallet({ storageKey: KEY });
  check(legacy.sunsEarned >= 300, 'an old save without an odometer inherits its balance', legacy.sunsEarned, '>= 300');
  check(isUnlocked(two, 0, legacy) && isUnlocked(three, 0, legacy), 'so a returning player keeps the earned cars', 'both open', 'both open');
}

/* ── 3. the gas bonus is bought, per car, and the tank really grows ───────── */
console.log('\n── gas bonus = suns ──────────────────────────────────────────────────────');
{
  const w = new Wallet({ storageKey: 'bench.econ.tank' });
  const a = new Fuel({ carId: 'econ-a', wallet: w });
  const capBefore = a.capacity;
  check(a.tankPrice === TANK_PRICE_BASE, 'the first upgrade costs the base price', `${a.tankPrice} suns`, String(TANK_PRICE_BASE));
  check(!w.buyTank('econ-a', a.tankPrice), 'and cannot be bought with an empty wallet', 'false', 'false');
  check(Math.abs(a.capacity - capBefore) < 1e-6, 'so the tank has not changed', a.capacity.toFixed(1), capBefore.toFixed(1));

  w.addSuns(TANK_PRICE_BASE);
  check(w.buyTank('econ-a', a.tankPrice), 'with the money, it goes through', 'true', 'true');
  console.log(`       car A tank: ${(capBefore / 60).toFixed(1)} min -> ${(a.capacity / 60).toFixed(1)} min, next upgrade ${a.tankPrice} suns`);
  check(a.capacity > capBefore, 'and the CAPACITY IN SECONDS actually grew', `${(a.capacity / 60).toFixed(1)} min`, `> ${(capBefore / 60).toFixed(1)} min`);
  check(a.tankPrice === TANK_PRICE_BASE + TANK_PRICE_STEP, 'the next one is dearer', `${a.tankPrice} suns`, String(TANK_PRICE_BASE + TANK_PRICE_STEP));

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
  w.addSuns(BOAT_UNLOCK_SUNS);
  /* THE RULE CHANGED, on instruction: "making buying a boat and unlock that. It isn't automatic, but
   * something you get at the harbor." Holding the price used to latch the unlock right there in
   * addSuns, which made the boat the one thing in the game that arrived without you going anywhere.
   * These two checks asserted that old behaviour; they now assert the new one. */
  check(!w.boatUnlocked, `holding ${BOAT_UNLOCK_SUNS} suns does NOT hand you the boat`, w.boatUnlocked, 'false');
  const ev = [];
  for (let e = w.drain(); e; e = w.drain()) ev.push(e.kind);
  check(ev.includes('boat-affordable'), 'but it does tell you, once, that you can afford one', ev.join(',') || '(none)', 'boat-affordable');

  check(w.buyBoat(), 'buying it at a harbour works', 'true', 'true');
  check(w.suns === 0, 'and the money is gone', w.suns, '0');
  check(w.boatUnlocked, 'the boat is yours', w.boatUnlocked, 'true');
  check(!w.buyBoat(), 'buying it twice is a no-op', 'false', 'false');

  w.addSuns(200);
  check(w.spend(200), 'then spend everything else you own', 'true', 'true');
  /* The trap the whole change had to avoid: boatUnlocked used to read "do you hold 50 suns RIGHT
   * NOW", which was fine while nothing could be spent and would have taken the boat back the first
   * time anyone bought a car. */
  check(w.boatUnlocked, 'and the boat is STILL yours on an empty wallet', w.boatUnlocked, 'true');

  const reloaded = new Wallet({ storageKey: 'bench.econ.boat' });
  check(reloaded.boatUnlocked, 'and it survives a reload', reloaded.boatUnlocked, 'true');
}

/* ── 4b. spare fuel cans, bought at a pump ────────────────────────────────── */
console.log('\n── gas cans = suns, bought at a petrol station ───────────────────────────');
{
  const w = new Wallet({ storageKey: 'bench.econ.cansbought' });
  check(w.cans === 0, 'the boot starts empty', w.cans, '0');
  check(!w.buyCan(CAN_PRICE), 'a can cannot be bought with no money', 'false', 'false');
  w.addSuns(CAN_PRICE * (CAN_MAX + 2));
  for (let k = 0; k < CAN_MAX; k++) check(w.buyCan(CAN_PRICE), `can ${k + 1} of ${CAN_MAX} bought`, 'true', 'true');
  console.log(`       bought ${w.cans} cans at ${CAN_PRICE} suns each; ${w.suns} suns left`);
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
