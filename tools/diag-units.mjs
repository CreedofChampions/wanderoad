// created by AI
/* Wanderoad — the units switch: mph/km-h and miles/kilometres, defaulted to the American system.
 *
 * Operator, verbatim: "a metric and the other system for miles per hour for the Americans...
 * a switch between defaulted to the American system." game/units.js is the module that resolves
 * it (URL beats storage beats default, the same order car/drivingModels.js already uses for
 * `?drive=`), src/ui/hud.js reads it for the speedometer and the streak figure, and src/ui/menu.js
 * puts the switch itself in the Garage. This tool checks that all three actually agree, the same
 * job tools/diag-switchers.mjs already does for the Water and Driving rows — built under its own
 * rule, this repository's gotcha 3: a flag set is not a thing visible. So nothing here asserts
 * that a function merely exists. It stands up a stub DOM, builds the REAL `Menu` from
 * src/ui/menu.js with the same hook shape main.js passes it, PRESSES the buttons a player
 * presses, and reads back what actually moved: the label on the button, the `on` class, the
 * module's own live `isImperial()`, and a fresh reimport's view of localStorage.
 *
 * THE FIRST CHECK IN THE FILE IS THE MOST IMPORTANT ONE: a completely fresh module, with no
 * `?units=` on the URL and nothing yet in storage, must read as American. That is the entire
 * reason this feature exists — the operator's rule was "defaulted to", not merely "available" —
 * so it runs before anything else here has had a chance to call `setImperial` and taint the
 * module-level state every later section is free to mutate.
 *
 * WHAT IT CANNOT PROVE, stated plainly, the way diag-switchers.mjs states its own boundary: that
 * the speedometer or the streak figure are legible on a real screen, or that the two new buttons
 * have a comfortable touch target on a phone. Both are browser-tools questions. This tool proves
 * the ARITHMETIC and the WIRE.
 *
 *   node tools/diag-units.mjs
 *
 * Exits non-zero if any check fails.
 */

import { installStubDom } from './stub-dom.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
};
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 74 - t.length))}`);

/* The globals go in BEFORE src/ is imported: game/units.js resolves its URL/storage choice at
 * module load (see its own note), exactly like car/drivingModels.js and render/waterStyles.js
 * already do — this is why stub-dom.mjs's own header says to call installStubDom() first. */
installStubDom();

const { isImperial, setImperial, speedDisplay, fmtDistanceUnits, unitsFromUrl, MPH_PER_KPH, DEFAULT_IMPERIAL } =
  await import('../src/game/units.js');
const { fmtDistance } = await import('../src/game/streak.js');
const { Menu } = await import('../src/ui/menu.js');
const { Wallet } = await import('../src/game/wallet.js');

/* ── 1. American by default — before ANYTHING else touches the module ───────── */
head('1. American by default — fresh module, no storage, no ?units=');

check(
  'a completely fresh module instance starts imperial — THE reason this file exists',
  isImperial() === true,
  `isImperial() = ${isImperial()}`,
);
check('DEFAULT_IMPERIAL itself is true, so nothing downstream can quietly flip the fallback', DEFAULT_IMPERIAL === true);
check(
  'the exported ratio is the exact one, not a rounded stand-in (1 km = 0.62137119223733 mi)',
  MPH_PER_KPH === 0.62137119223733,
  String(MPH_PER_KPH),
);

/* ── 2. the Units row in the Garage sheet ────────────────────────────────────
 * Run second, still ahead of any setImperial() call below, on a localStorage cleared to be sure —
 * so the "on" class this section finds on the US button is proof the default reaches the actual
 * rendered panel, not merely a read of the module the way section 1 already is. */
head('2. the Units row in the Garage — the switch a player actually sees');

globalThis.localStorage.removeItem('wanderoad.units.v1');

const wallet = new Wallet({ storageKey: 'diag.units.wallet' });
const said = [];
const menu = new Menu({
  camera: () => 'chase',
  bestStreak: () => 0,
  wallet: () => wallet,
  say: (t) => said.push(t),
});
menu.setCurrent({ car: 'coupe', feel: 'road', terrain: 'rolling' });

const unitsRow = () => menu.root.querySelector('[data-group="units"]');
const unitsButtons = () => unitsRow().children.filter((c) => c.tagName === 'BUTTON');
const unitsBtn = (key) => unitsButtons().find((b) => b.dataset.key === key);
const press = (b) => b.dispatch('click', { target: b });

check(
  'there is a units row in the Garage sheet',
  !!unitsRow() && unitsRow().classList.contains('row'),
  unitsRow() ? 'found' : 'absent',
);
check(
  'on a fresh localStorage it has exactly two buttons: us and metric',
  unitsButtons().length === 2 && !!unitsBtn('us') && !!unitsBtn('metric'),
  unitsButtons().map((b) => `${b.dataset.key}="${b.textContent}"`).join(' | '),
);
check(
  'the us button carries the "on" class — American by default, in the actual rendered panel',
  !!unitsBtn('us') && unitsBtn('us').classList.contains('on') && !unitsBtn('metric').classList.contains('on'),
  `us.on=${unitsBtn('us')?.classList.contains('on')} metric.on=${unitsBtn('metric')?.classList.contains('on')}`,
);

const headings = menu.root.all
  .filter((n) => n.tagName === 'H3')
  .map((n) => `${n.textContent} ${n.querySelector('small')?.textContent ?? ''}`.trim());
const unitsHeading = headings.find((h) => h.toLowerCase().startsWith('units')) ?? '';
check('the heading promises American by default', /american by default/i.test(unitsHeading), unitsHeading);

press(unitsBtn('metric'));
check('clicking metric flips isImperial() to false', isImperial() === false, `isImperial() = ${isImperial()}`);
check(
  'and moves the "on" class onto metric, off us',
  unitsBtn('metric').classList.contains('on') && !unitsBtn('us').classList.contains('on'),
  `us.on=${unitsBtn('us').classList.contains('on')} metric.on=${unitsBtn('metric').classList.contains('on')}`,
);
check('the toast says which system, in words rather than a code', said.some((t) => t.includes('km/h')), said.join(' | '));

press(unitsBtn('us'));
check('clicking us again flips it back to true', isImperial() === true, `isImperial() = ${isImperial()}`);
check(
  'and the "on" class moves back onto us',
  unitsBtn('us').classList.contains('on') && !unitsBtn('metric').classList.contains('on'),
  `us.on=${unitsBtn('us').classList.contains('on')} metric.on=${unitsBtn('metric').classList.contains('on')}`,
);

/* ── 3. speedDisplay — the speedometer conversion, both ways ────────────────── */
head('3. speedDisplay — the speedometer conversion, both ways');

check(
  '100 kph while imperial reads 62 mph (100 × 0.62137119223733, rounded)',
  speedDisplay(100).value === 62 && speedDisplay(100).label === 'mph',
  JSON.stringify(speedDisplay(100)),
);
setImperial(false);
check(
  'after setImperial(false), the same 100 kph reads 100 km/h — unconverted',
  speedDisplay(100).value === 100 && speedDisplay(100).label === 'km/h',
  JSON.stringify(speedDisplay(100)),
);
setImperial(true);

/* ── 4. fmtDistanceUnits — the streak readout ────────────────────────────────── */
head('4. fmtDistanceUnits — feet/miles in place of metres/kilometres');

check(
  'a short run (200 m ≈ 656 ft) reads in feet while imperial',
  fmtDistanceUnits(200).endsWith(' ft'),
  fmtDistanceUnits(200),
);
check(
  'a long run (5000 m ≈ 3.1 mi) reads in miles while imperial',
  fmtDistanceUnits(5000).endsWith(' mi'),
  fmtDistanceUnits(5000),
);
setImperial(false);
check(
  "while metric, fmtDistanceUnits matches streak.js's own fmtDistance exactly, same input",
  fmtDistanceUnits(200) === fmtDistance(200) && fmtDistanceUnits(5000) === fmtDistance(5000),
  `${fmtDistanceUnits(5000)} vs ${fmtDistance(5000)}`,
);
setImperial(true);

/* ── 5. unitsFromUrl — the same shape as ?drive= and ?water= ────────────────── */
head('5. unitsFromUrl — ?units= parsing');

check('?units=metric -> false', unitsFromUrl('?units=metric') === false);
check('?units=us -> true', unitsFromUrl('?units=us') === true);
check('a URL with no opinion -> null, not a guess', unitsFromUrl('?nothing=here') === null);

/* ── 6. persistence — a fresh page load, and a URL beating a stored choice ──── */
head('6. persistence — remembered across a reload, URL still wins on top');

setImperial(false); // store "metric" explicitly, so the reload below has something real to remember
const reload1 = await import('../src/game/units.js?reload=1');
check(
  'a fresh module instance remembers the stored metric choice with no URL param',
  reload1.isImperial() === false,
  `isImperial() = ${reload1.isImperial()}`,
);

globalThis.location.search = '?units=us';
const reload2 = await import('../src/game/units.js?reload=2');
check(
  'a URL beats the stored choice — ?units=us over a stored "metric"',
  reload2.isImperial() === true,
  `isImperial() = ${reload2.isImperial()}`,
);
globalThis.location.search = '';

console.log(`\n${failed === 0 ? 'all units checks passed' : `${failed} FAILED`}`);
process.exitCode = failed === 0 ? 0 : 1;
