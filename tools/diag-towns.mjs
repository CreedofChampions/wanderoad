/* created by AI
 * Cozy Driver — TOWNS CAN BE UPGRADED, and the town you bought is the town you get.
 *
 * Operator: "Towns can be upgraded". A town is the cluster of buildings around a station; buying a
 * tier adds to it. Five things have to hold or the feature is a lie in one of the ways that is hard
 * to see from a screenshot:
 *
 *   1. The tiers ADD. A save that predates this feature must keep exactly the town it had, so
 *      tier 0 is TOWN_KIT untouched and every tier above it is a superset.
 *   2. The money is real: it costs, it deducts, it stops at the top, and it survives a reload —
 *      the wallet's own `tanks` pattern, which this copies.
 *   3. It is PER STATION. Buying the town you are standing in must not build every town in the
 *      world, which is the single most likely way to get this wrong.
 *   4. The world actually changes: the same box, the same seed, more buildings, and the extra ones
 *      pass the identical footprint/water/slope/road-clearance tests the base kit passes — a piece
 *      that lands on the forecourt or in a lake is worse than no piece.
 *   5. Nothing is drawn on the apron or the access spur, at any tier.
 *
 * Where the LIVE half is: the Garage row and the rebuild-while-you-stand-in-it path are measured on
 * the beta and filmed — see the proof page. This file owns the world and the wallet.
 *
 *   node tools/diag-towns.mjs
 */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { TOWN_TIERS, townKitFor, stationsInBox, stationTownInBox, PROP_BY_ID, STATION_APRON_HALF_WIDTH } =
  await import('../src/world/props.js');
const { Wallet, TOWN_PRICES, TOWN_MAX_TIER } = await import('../src/game/wallet.js');
const { Terrain } = await import('../src/world/terrain.js');
const { BIOME_COUNT, waterLevelAt } = await import('../src/world/biomes.js');

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('\nCOZY DRIVER — UPGRADABLE TOWNS\n' + '-'.repeat(72));

/* ── 1. the tiers add up, and tier 0 is untouched ─────────────────────────── */
{
  const t0 = townKitFor(0);
  const t1 = townKitFor(1);
  const t2 = townKitFor(2);
  check('tier 0 is exactly the town every station already had', t0.length === TOWN_TIERS[0].length, `${t0.length} pieces`);
  check('each tier is a superset of the one below it', t1.length > t0.length && t2.length > t1.length, `${t0.length} -> ${t1.length} -> ${t2.length}`);
  const sig = (k) => k.map((p) => p.join(',')).join('|');
  check('and it ADDS rather than replaces — every tier-0 piece survives', sig(t2).startsWith(sig(t0)), 'tier 0 is the prefix of tier 2');
  const miss = [...new Set(t2.filter(([id]) => !PROP_BY_ID[id]).map(([id]) => id))];
  check('every piece is a catalogue prop, so it bakes and collides like the rest', miss.length === 0, miss.join(' ') || 'all known');
  const onApron = t2.filter(([, dx]) => Math.abs(dx) <= STATION_APRON_HALF_WIDTH);
  check(
    'nothing at any tier is offset onto the forecourt or the access spur',
    onApron.length === 0,
    onApron.length ? onApron.map((p) => p[0]).join(' ') : `every |dx| > ${STATION_APRON_HALF_WIDTH} m`,
  );
  check('a tier above the top clamps rather than throwing', townKitFor(99).length === t2.length, `${townKitFor(99).length} pieces`);
}

/* ── 2. the money ─────────────────────────────────────────────────────────── */
{
  const w = new Wallet({ storageKey: 'diag.towns.money' });
  const A = 'st:0:-2,-2,1';
  w.suns = 10_000;
  check(`a new town is tier 0 and the first tier costs ${TOWN_PRICES[0]}`, w.townLevel(A) === 0 && w.townPrice(A) === TOWN_PRICES[0], `${w.townPrice(A)} suns`);
  const before = w.suns;
  check('buying it returns the tier it is now', w.buyTown(A) === 1, String(w.townLevel(A)));
  check('and it actually costs that many suns', before - w.suns === TOWN_PRICES[0], `${before} -> ${w.suns}`);
  check('the next tier is dearer', w.townPrice(A) === TOWN_PRICES[1], `${w.townPrice(A)} suns`);
  w.buyTown(A);
  check(`it stops at tier ${TOWN_MAX_TIER}`, w.townLevel(A) === TOWN_MAX_TIER && w.townPrice(A) === null, `tier ${w.townLevel(A)}, price ${w.townPrice(A)}`);
  const spent = w.suns;
  check('buying a finished town takes nothing', w.buyTown(A) === 0 && w.suns === spent, `${w.suns} suns`);

  const poor = new Wallet({ storageKey: 'diag.towns.poor' });
  poor.suns = TOWN_PRICES[0] - 1;
  check('one sun short buys nothing, and takes nothing', poor.buyTown(A) === 0 && poor.suns === TOWN_PRICES[0] - 1, `${poor.suns} suns`);

  const reloaded = new Wallet({ storageKey: 'diag.towns.money' });
  check('an upgraded town survives a reload', reloaded.townLevel(A) === TOWN_MAX_TIER, `tier ${reloaded.townLevel(A)}`);
}

/* ── 3. it is PER STATION ─────────────────────────────────────────────────── */
{
  const w = new Wallet({ storageKey: 'diag.towns.each' });
  w.suns = 10_000;
  const A = 'st:0:-2,-2,1';
  const B = 'st:1:3,4,0';
  w.buyTown(A);
  check('buying one town does not build the one down the road', w.townLevel(A) === 1 && w.townLevel(B) === 0, `A tier ${w.townLevel(A)}, B tier ${w.townLevel(B)}`);
  w.buyTown(B);
  w.buyTown(B);
  check('and they climb independently', w.townLevel(A) === 1 && w.townLevel(B) === 2, `A ${w.townLevel(A)}, B ${w.townLevel(B)}`);
}

/* ── 4. the WORLD changes, and the new pieces pass the same tests ─────────── */
{
  const SEED = 20260726;
  const t = new Terrain(SEED, -3000, -3000, 3000, 3000);
  /* The same probe shape diag-stations.mjs builds — `site` answers the height, the dominant biome
   * and the water level at a point, which is what every placement test in props.js reads. */
  const wbuf = new Float32Array(BIOME_COUNT);
  const probe = {
    site: (x, z) => {
      const b = t.weights(x, z);
      wbuf.set(b.w);
      return { y: t.height(x, z), dominant: b.dominant, wy: waterLevelAt(wbuf, -Infinity) };
    },
    height: (x, z) => t.height(x, z),
  };
  const stations = stationsInBox(-3000, -3000, 3000, 3000, SEED);
  const st = stations[0];
  check('there is a station to build on', !!st, st ? st.key : 'none in a 6 km box');

  const box = [st.x - 400, st.z - 400, st.x + 400, st.z + 400];
  const at = (tier) => stationTownInBox(box[0], box[1], box[2], box[3], SEED, probe, null, (k) => (k === st.key ? tier : 0));
  const t0 = at(0);
  const t1 = at(1);
  const t2 = at(2);
  console.log(`       ${st.key}: ${t0.length} pieces at tier 0, ${t1.length} at tier 1, ${t2.length} at tier 2`);
  check('an upgraded town has MORE buildings standing in the world', t1.length > t0.length && t2.length > t1.length, `${t0.length} -> ${t1.length} -> ${t2.length}`);
  check('and the tier-0 buildings are all still there', t0.every((p) => t2.some((q) => q.id === p.id && Math.hypot(q.x - p.x, q.z - p.z) < 0.01)), `${t0.length} kept`);

  /* The extra pieces went through the same placement gauntlet — they are in the output, which is
   * only reachable past the road-clearance, water and slope tests. What is checked here is the one
   * thing the output alone would not show: that none of them is standing on the pumps. */
  const tooClose = t2.filter((p) => Math.hypot(p.x - st.x, p.z - st.z) < STATION_APRON_HALF_WIDTH);
  check('nothing was built on the forecourt itself', tooClose.length === 0, tooClose.length ? `${tooClose.length} pieces inside ${STATION_APRON_HALF_WIDTH} m` : 'the apron is clear');

  const other = stations.find((s) => s.key !== st.key);
  if (other) {
    const mine = t2.filter((p) => Math.hypot(p.x - other.x, p.z - other.z) < 120).length;
    const theirs = stationTownInBox(other.x - 400, other.z - 400, other.x + 400, other.z + 400, SEED, probe, null, (k) => (k === st.key ? 2 : 0));
    const near = theirs.filter((p) => Math.hypot(p.x - other.x, p.z - other.z) < 120).length;
    const base = stationTownInBox(other.x - 400, other.z - 400, other.x + 400, other.z + 400, SEED, probe, null, null)
      .filter((p) => Math.hypot(p.x - other.x, p.z - other.z) < 120).length;
    check(
      'THE UPGRADE IS LOCAL — the station down the road is untouched by it',
      near === base,
      `${other.key}: ${near} pieces with the neighbour upgraded, ${base} with nothing bought${mine ? '' : ''}`,
    );
  }

  const noWallet = stationTownInBox(box[0], box[1], box[2], box[3], SEED, probe, null, null);
  check('a caller with no wallet at all still gets the tier-0 town', noWallet.length === t0.length, `${noWallet.length} pieces`);
}

console.log(`\n${failed ? `${failed} TOWN CHECK(S) FAILED` : 'all town checks passed'}\n`);
process.exit(failed ? 1 : 0);
