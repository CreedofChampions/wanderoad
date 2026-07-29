/* Cozy Driver — achievements and leaderboard, proven without a browser.
 *
 *   node tools/diag-achievements.mjs
 *
 * The achievement predicates are pure functions over a snapshot, so they can be driven directly.
 * The one that matters most is the operator's own idea — roll the car, stay on the road, keep
 * the streak — because it is the only achievement whose whole point is that two things people
 * assume are exclusive are not. If that one ever silently stops firing, this is what catches it.
 */

import { Achievements, ACHIEVEMENTS, ACHIEVEMENT_BY_ID } from '../src/game/achievements.js';
import { fmtBoard } from '../src/net/board.js';

/* A localStorage that lives for one run. The module degrades gracefully without one, but then
 * every check would look like a first unlock and the "does not fire twice" test would be a lie. */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

let fails = 0;
const check = (ok, label, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? ' PASS ' : ' FAIL '} ${label.padEnd(52)} ${detail}`);
};

const base = {
  distance: 0, rolled: false, onRoad: true, night: false,
  refuelled: false, fuelBefore: 1,
};

console.log('\n── the catalogue ──────────────────────────────────────────────');
check(ACHIEVEMENTS.length >= 6, 'enough achievements to be worth a panel', `${ACHIEVEMENTS.length}`);
check(
  new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length,
  'every id is unique',
  `${ACHIEVEMENTS.length} ids`,
);
check(
  ACHIEVEMENTS.every((a) => a.title && a.hint && typeof a.test === 'function'),
  'every entry has a title, a hint and a test',
  'all fields present',
);

console.log('\n── the operator\'s own: flip, stay on the road, keep the streak ──');
{
  const a = new Achievements();
  // Driving normally: no flip, no unlock.
  a.check({ ...base, distance: 2000 });
  const beforeFlip = a.has('rubber_side_down');
  // Now roll it, ON the road, streak intact.
  const fresh = a.check({ ...base, distance: 2000, rolled: true, onRoad: true });
  check(!beforeFlip, 'does not fire from ordinary driving', 'not earned before the flip');
  check(fresh.includes('rubber_side_down'), 'fires on a flip that stays on the road', 'earned');
  check(a.has('rubber_side_down'), 'and it sticks', 'persisted');
}
{
  // The negative case that gives it meaning: rolled, but OFF the road. Streak is gone, so is
  // the achievement — otherwise it would just be "did you crash", which nobody would value.
  mem.clear();
  const a = new Achievements();
  const fresh = a.check({ ...base, distance: 2000, rolled: true, onRoad: false });
  check(!fresh.includes('rubber_side_down'), 'does NOT fire if the flip left the road', 'correctly withheld');
}

console.log('\n── unlocks fire once, in order ────────────────────────────────');
{
  mem.clear();
  const a = new Achievements();
  const first = a.check({ ...base, distance: 1000 });
  const again = a.check({ ...base, distance: 1500 });
  check(first.includes('first_km'), 'first kilometre unlocks at 1000 m', `${first.join(', ')}`);
  check(again.length === 0, 'and never fires a second time', `${again.length} repeats`);

  const ten = a.check({ ...base, distance: 10000 });
  check(ten.includes('ten_km'), '10 km unlocks on its own', `${ten.join(', ')}`);
  check(!ten.includes('first_km'), 'without re-awarding the earlier one', 'no duplicate');
}

console.log('\n── every biome in one streak ──────────────────────────────────');
{
  mem.clear();
  const a = new Achievements();
  for (const b of [0, 1, 2, 3]) a.note(b);
  const four = a.check({ ...base, distance: 3000 });
  a.note(4);
  const five = a.check({ ...base, distance: 3000 });
  check(!four.includes('tourist'), 'four biomes is not enough', '4 seen');
  check(five.includes('tourist'), 'five unlocks it', '5 seen');

  a.reset();
  check(a.biomes.size === 0, 'a broken streak clears the biome set', 'reset to 0');
}

console.log('\n── persistence ────────────────────────────────────────────────');
{
  mem.clear();
  const a = new Achievements();
  a.check({ ...base, distance: 1000 });
  const b = new Achievements(); // a fresh session reading the same storage
  check(b.has('first_km'), 'survives a reload', 'read back from storage');
  check(b.progress.earned === 1, 'progress counts what was earned', `${b.progress.earned}/${b.progress.total}`);
}

console.log('\n── a predicate that throws cannot take the frame down ─────────');
{
  mem.clear();
  const a = new Achievements();
  let threw = false;
  try {
    // `biomes` arrives as the wrong type — exactly the shape of a caller bug.
    a.check({ ...base, distance: 1000, biomes: 'not a set' });
  } catch {
    threw = true;
  }
  check(!threw, 'check() survives a malformed snapshot', 'no exception escaped');
}

console.log('\n── leaderboard formatting ─────────────────────────────────────');
check(fmtBoard(940) === '940 m', 'metres under a kilometre', fmtBoard(940));
check(fmtBoard(1500) === '1.5 km', 'one decimal below 10 km', fmtBoard(1500));
check(fmtBoard(42000) === '42 km', 'no decimals above 10 km', fmtBoard(42000));

console.log(
  `\n${fails === 0 ? 'achievements: OK' : `achievements: ${fails} FAILED`}\n`,
);
process.exit(fails === 0 ? 0 : 1);
