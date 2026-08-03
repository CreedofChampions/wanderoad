// created by AI
/* Wanderoad — the two switchers in the Garage, and the two micro-cars in the fleet.
 *
 * Three agents built seven waters, seven driving models and a pair of micro-cars. This tool is
 * about the only thing none of them could check: that a PLAYER can reach any of it. The operator's
 * ask was "just clicking a button on the menu", and there are exactly four ways that promise breaks
 * behind code that compiles — the button is not there, it does not cycle, it does not reach the
 * thing it names, or it forgets what you chose the moment you reload.
 *
 * It is written under diag-seedui.mjs's rule, which is this repository's own gotcha 3: a flag set is
 * not a thing visible. So nothing here asserts that a function exists. It stands up a stub DOM,
 * builds the REAL `Menu` from src/ui/menu.js with the same hook shape main.js passes it, PRESSES the
 * buttons the player presses — including through `padNav`, i.e. as a gamepad — and then reads back
 * what actually moved: the label on the button, the shader source on a registered water material,
 * the numbers in the shared tuning tables, and the keys in localStorage.
 *
 * WHAT IT CANNOT PROVE, stated plainly, because two other tools already cover it and this one must
 * not pretend to: that the seven waters COMPILE on a GPU (tools/diag-waterstyles.mjs, 25/25 on real
 * hardware) or that they LOOK different in the running game (tools/diag-waterlive.mjs, which
 * photographs all seven in one page load and measures the distinctness matrix). Nor that the seven
 * driving models feel different (tools/diag-driving-models.mjs, 21/21 pairs across nine cars), nor
 * that the Tricycle falls over (tools/diag-microcar.mjs, 44 assertions). This tool proves the WIRE.
 *
 * Section 7 is a source scan of src/main.js rather than an execution of it, and says so where it
 * runs: main.js boots a game and cannot be imported into node. What a scan can honestly assert is
 * that the calls are present and that the one call that MUST NOT survive — a bare `applyCarFeel`,
 * which would leave the previous driving model standing in every table it does not know about — is
 * gone.
 *
 *   node tools/diag-switchers.mjs
 *
 * Exits non-zero if any check fails.
 */

import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installStubDom } from './stub-dom.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
};
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 74 - t.length))}`);

/* The globals go in BEFORE src/ is imported: car/drivingModels.js resolves its stored choice at
 * module load, and render/waterStyles.js subscribes to water.js's material hook at module load. */
installStubDom();

const { Menu, nextInCycle } = await import('../src/ui/menu.js');
const { WATER_STYLES, WATER_STYLE_KEY, WATER_STYLE_DEFAULT, currentWaterStyle } = await import(
  '../src/render/waterStyles.js'
);
const { liveWaterMaterials } = await import('../src/render/water.js');
const { DRIVING_MODELS, DEFAULT_DRIVING_MODEL, currentDrivingModel, applyDrivingModel, restoreStockTuning } =
  await import('../src/car/drivingModels.js');
const { FLEET, FLEET_BY_ID, FIRST_CAR, priceOf, earnAtOf, unlockRule } = await import('../src/game/garage.js');
const { MICRO_FLEET } = await import('../src/car/microPhysics.js');
const { CARS } = await import('../src/car/loadedCar.js');
const { Wallet } = await import('../src/game/wallet.js');
const { STEER, TYRE, BRAKE, TIERS } = await import('../src/car/tuning.js');

/* ── the Garage, built exactly as main.js builds it ─────────────────────────
 * The hooks are the same shape, and `onDrive` does what main.js's does: applies the chosen model to
 * the car being driven. There is no Vehicle here, so it is passed null — `applyDrivingModel` writes
 * the shared tuning tables either way, and those tables ARE what the solver reads every step. */
const wallet = new Wallet({ storageKey: 'diag.switchers.wallet' });
const said = [];
let droveCalls = 0;
const CAR_LIVE = FLEET_BY_ID.coupe; // an ordinary fleet car, so nothing here rides on the micro pass
const menu = new Menu({
  camera: () => 'chase',
  bestStreak: () => 0,
  wallet: () => wallet,
  say: (t) => said.push(t),
  onDrive: () => {
    droveCalls++;
    applyDrivingModel(CAR_LIVE, null);
  },
});
menu.setCurrent({ car: 'coupe', feel: 'road', terrain: 'rolling' });

const row = (g) => menu.root.querySelector(`[data-group="${g}"]`);
const buttons = (g) => (row(g) ? row(g).children.filter((c) => c.tagName === 'BUTTON') : []);
const nameBtn = (g) => buttons(g)[1];
const prevBtn = (g) => buttons(g)[0];
const press = (b) => b.dispatch('click', { target: b });
const hintOf = (g) => menu.root.querySelector(`[data-hint="${g}"]`)?.textContent ?? '';

/* ── 1. the two rows are really in the panel ─────────────────────────────── */
head('1. the rows exist, and they say what is in force');

for (const [g, title, list] of [
  ['water', 'Water', WATER_STYLES],
  ['drive', 'Driving', DRIVING_MODELS],
]) {
  check(`there is a ${g} row in the Garage sheet`, !!row(g) && row(g).classList.contains('row'), row(g) ? 'found' : 'absent');
  check(
    `it is a cycler: one "the one before" button and one that names what is in force`,
    buttons(g).length === 2 && prevBtn(g).dataset.key === 'prev' && nameBtn(g).dataset.key !== 'prev',
    buttons(g).map((b) => `${b.dataset.key}="${b.textContent}"`).join(' | '),
  );
  check(
    `the name button leads with "${title}: " so it is readable without the small heading`,
    nameBtn(g).textContent.startsWith(`${title}: `),
    `"${nameBtn(g).textContent}"`,
  );
  check(
    `it names the ${g} actually in force, not a hard-coded first entry`,
    nameBtn(g).dataset.key === list[0].id && nameBtn(g).textContent === `${title}: ${list[0].label}`,
    `${nameBtn(g).dataset.key} vs ${list[0].id}`,
  );
  check(
    `the blurb and the position are shown, so seven options do not hide behind one label`,
    hintOf(g).includes(list[0].blurb) && /\b1 of 7\b/.test(hintOf(g)),
    `"${hintOf(g)}"`,
  );
  check(
    `the ${g} button carries the blurb as a tooltip too`,
    nameBtn(g).getAttribute('title') === list[0].blurb,
    nameBtn(g).getAttribute('title'),
  );
  check(
    `it is marked as the current choice (the "on" class the rest of the panel uses)`,
    nameBtn(g).classList.contains('on'),
    nameBtn(g).className,
  );
}

/* THE HEADINGS MUST NOT PROMISE A RELOAD, and the Grass row directly above the Water one must still
 * promise exactly that. Both halves matter: this panel's own rule is that a button says what it
 * does, and the whole point of the water work was that this one does not reload. */
/* The heading's own word plus the `<small>` beside it, which is where the promise actually lives —
 * "reloads the world", "the sea changes at once". Matched on the leading word rather than anywhere
 * in the string: the invite panel's own heading is "Drive together", and a looser test found that
 * instead of the Driving row and reported a failure about the wrong element entirely. */
const headings = menu.root.all
  .filter((n) => n.tagName === 'H3')
  .map((n) => `${n.textContent} ${n.querySelector('small')?.textContent ?? ''}`.trim());
const headingFor = (word) => headings.find((h) => h.toLowerCase().startsWith(word)) ?? '';
/* The two rows that genuinely cannot switch live still say so, which is what makes the two new rows'
 * silence on the subject mean something. (Noted rather than fixed while wiring: the GRASS row also
 * reloads — see its `location.reload()` — but its heading does not say so; only the toast afterwards
 * does. That is a pre-existing gap in a row this task did not touch, and inventing a "reloads" into
 * its heading here would be changing something nobody asked to have changed.) */
check(
  'the Land heading still says it reloads (it genuinely does — the terrain is meshed in workers)',
  /reload/i.test(headingFor('land')),
  headingFor('land'),
);
check(
  'the Seed heading still says it reloads',
  /reload/i.test(headingFor('seed')),
  headingFor('seed'),
);
check(
  'the Water heading does NOT say reload, and says the sea changes at once',
  !/reload/i.test(headingFor('water')) && /at once/i.test(headingFor('water')),
  headingFor('water'),
);
check(
  'the Driving heading does NOT say reload, and says it changes as you drive',
  !/reload/i.test(headingFor('driving')) && /as you drive/i.test(headingFor('driving')),
  headingFor('driving'),
);

/* ── 2. clicking cycles through all seven, both ways ─────────────────────── */
head('2. one button reaches all seven, and wraps at both ends');

for (const [g, title, list] of [
  ['water', 'Water', WATER_STYLES],
  ['drive', 'Driving', DRIVING_MODELS],
]) {
  const seen = [nameBtn(g).dataset.key];
  for (let i = 0; i < list.length; i++) {
    press(nameBtn(g));
    seen.push(nameBtn(g).dataset.key);
  }
  check(
    `${g}: seven presses walk every entry in order and come back to the first`,
    seen.join(',') === [...list.map((s) => s.id), list[0].id].join(','),
    seen.join(' → '),
  );
  check(
    `${g}: the label follows the choice on every press, never left stale`,
    nameBtn(g).textContent === `${title}: ${list[0].label}`,
    nameBtn(g).textContent,
  );
  press(prevBtn(g));
  check(
    `${g}: ◀ off the front lands on the LAST one rather than dead-ending`,
    nameBtn(g).dataset.key === list[list.length - 1].id,
    `${nameBtn(g).dataset.key} (expected ${list[list.length - 1].id})`,
  );
  press(nameBtn(g));
  check(`${g}: and forward from the last wraps to the first`, nameBtn(g).dataset.key === list[0].id, nameBtn(g).dataset.key);
}

check(
  'nextInCycle is the arithmetic behind both, and it wraps in both directions',
  nextInCycle(WATER_STYLES, WATER_STYLES[6], 1).id === WATER_STYLES[0].id &&
    nextInCycle(WATER_STYLES, WATER_STYLES[0], -1).id === WATER_STYLES[6].id &&
    nextInCycle(WATER_STYLES, 'not-a-style', 1).id === WATER_STYLES[1].id,
  `6→${nextInCycle(WATER_STYLES, WATER_STYLES[6], 1).id}, 0←${nextInCycle(WATER_STYLES, WATER_STYLES[0], -1).id}`,
);

/* ── 3. the click reaches the sea, in the same frame ─────────────────────── */
head('3. the water button reaches every water surface — no reload');

/* A stand-in for a water plane's material, registered in the same Set render/water.js puts the real
 * ones in (`liveWaterMaterials`) and carrying the same `userData.waterSeed`. That Set is the whole
 * mechanism: waterStyles.js walks it. Registering one here asks the exact question the player asks
 * — "does pressing the button change the water that is in the scene" — without a GPU.
 *
 * What it does not claim: that the source it now carries links. tools/diag-waterstyles.mjs compiles
 * and links all seven on real hardware, which is the other half and is not this tool's job. */
const SEED = 20260726;
const plane = { isMaterial: true, vertexShader: '', fragmentShader: '', needsUpdate: false, userData: { waterSeed: SEED } };
liveWaterMaterials.add(plane);

const whereBefore = { search: globalThis.location.search, href: globalThis.location.href };
const sources = new Set();
for (let i = 0; i < WATER_STYLES.length; i++) {
  press(nameBtn('water'));
  const want = WATER_STYLES[(i + 1) % WATER_STYLES.length].build(SEED);
  const ok = plane.fragmentShader === want.fragmentShader && plane.vertexShader === want.vertexShader;
  sources.add(plane.fragmentShader);
  if (!ok) check(`pressing to ${WATER_STYLES[(i + 1) % WATER_STYLES.length].id} rewrote the material`, false);
}
check(
  'every press swapped the shader source on a registered water material, to that style exactly',
  sources.size === WATER_STYLES.length,
  `${sources.size} distinct fragment shaders from ${WATER_STYLES.length} presses`,
);
check(
  'and asked three to relink it (mat.needsUpdate) — the one line that makes it live',
  plane.needsUpdate === true,
  String(plane.needsUpdate),
);
check(
  'NOTHING NAVIGATED: no reload, no query string rewritten, over 21 presses',
  globalThis.location.search === whereBefore.search && globalThis.location.href === whereBefore.href,
  `search "${globalThis.location.search}" href "${globalThis.location.href}"`,
);
liveWaterMaterials.delete(plane);

/* ── 4. the driving button reaches the tuning tables ─────────────────────── */
head('4. the driving button reaches the solver — no reload, no new Vehicle');

/* The fingerprint is read out of the tables car/vehicle.js consults on every one of its 120 steps a
 * second. If two models produced the same fingerprint the button would be decoration; if the hook
 * never fired, all seven would. */
const fingerprint = () =>
  [
    STEER.comfortG,
    STEER.buildBase,
    STEER.minRadius,
    TYRE.muLatRear,
    TYRE.muLatFront,
    TYRE.muLongPeak,
    BRAKE.torque,
    TIERS[CAR_LIVE.tier].mass,
    TIERS[CAR_LIVE.tier].cgHeight,
  ]
    .map((v) => (+v).toFixed(6))
    .join('|');

const before = droveCalls;
const prints = new Map();
for (let i = 0; i < DRIVING_MODELS.length; i++) {
  press(nameBtn('drive'));
  prints.set(currentDrivingModel().id, fingerprint());
}
check(
  'every press called the hook main.js hands in — the panel does not touch the car itself',
  droveCalls - before === DRIVING_MODELS.length,
  `${droveCalls - before} calls for ${DRIVING_MODELS.length} presses`,
);
check(
  'all seven leave a DIFFERENT set of numbers in the shared tuning tables',
  new Set(prints.values()).size === DRIVING_MODELS.length,
  `${new Set(prints.values()).size} distinct fingerprints of ${DRIVING_MODELS.length}`,
);
check(
  'coming back to Stock reproduces Stock exactly — a switch is not cumulative',
  (() => {
    const stock = prints.get('stock');
    for (let i = 0; i < DRIVING_MODELS.length; i++) press(nameBtn('drive'));
    return fingerprint() === stock;
  })(),
  `${fingerprint().slice(0, 46)}…`,
);
check(
  'the toast names the model and says what it is, rather than an id',
  said.some((t) => t.startsWith('driving: ')) && said.some((t) => t.startsWith('water: ')),
  said.slice(-2).join('  //  '),
);

/* ── 5. the choice survives the tab being closed ─────────────────────────── */
head('5. both choices are remembered');

const waterPick = nextInCycle(WATER_STYLES, currentWaterStyle(), 1).id;
press(nameBtn('water'));
const drivePick = nextInCycle(DRIVING_MODELS, currentDrivingModel(), 1).id;
press(nameBtn('drive'));
check(
  `the water choice is in localStorage under ${WATER_STYLE_KEY}`,
  globalThis.localStorage.getItem(WATER_STYLE_KEY) === waterPick,
  `"${globalThis.localStorage.getItem(WATER_STYLE_KEY)}" (chose ${waterPick})`,
);
check(
  'the driving choice is in localStorage too',
  globalThis.localStorage.getItem('wanderoad.drivingModel.v1') === drivePick,
  `"${globalThis.localStorage.getItem('wanderoad.drivingModel.v1')}" (chose ${drivePick})`,
);
check(
  'neither is the default, so "remembered" is a real claim and not a coincidence',
  waterPick !== WATER_STYLE_DEFAULT && drivePick !== DEFAULT_DRIVING_MODEL,
  `${waterPick} / ${drivePick}`,
);

/* A FRESH MODULE INSTANCE is the only honest way to ask "what would the next page load do". Both
 * modules cache their resolved choice in module state, so re-reading the live one would only prove
 * that a variable still holds what it was assigned. A cache-busting import specifier gives node a
 * genuinely new instance, which runs its own resolution against the localStorage left behind above.
 *
 * The tables are put back to stock FIRST: a fresh drivingModels.js snapshots the tuning tables at
 * load, and snapshotting a set of tables that six models have already dirtied would give it a false
 * idea of stock. That is a hazard of the reload trick, not of the game, and it is worth writing
 * down rather than leaving as a surprise for the next person who copies this pattern. */
restoreStockTuning();
const freshWater = await import('../src/render/waterStyles.js?reload=1');
const freshDrive = await import('../src/car/drivingModels.js?reload=1');
check(
  'a fresh page load starts on the water you last chose, not on painted',
  freshWater.currentWaterStyle().id === waterPick,
  `${freshWater.currentWaterStyle().id} (chose ${waterPick})`,
);
check(
  'and on the driving model you last chose, not on stock',
  freshDrive.currentDrivingModel().id === drivePick,
  `${freshDrive.currentDrivingModel().id} (chose ${drivePick})`,
);
/* `?water=` and `?drive=` beat the stored choice, the same way `?car=` beats a resumed session. */
globalThis.location.search = '?water=glass&drive=kart';
const urlWater = await import('../src/render/waterStyles.js?reload=2');
const urlDrive = await import('../src/car/drivingModels.js?reload=2');
check(
  'a URL beats the stored choice for both — ?water=glass&drive=kart',
  urlWater.currentWaterStyle().id === 'glass' && urlDrive.currentDrivingModel().id === 'kart',
  `${urlWater.currentWaterStyle().id} / ${urlDrive.currentDrivingModel().id}`,
);
globalThis.location.search = whereBefore.search;

/* A SECOND Menu, built after the choice, must not show the old label — the rows are refilled in
 * show() for exactly this reason (a URL parameter, or another session, moves the truth). */
const menu2 = new Menu({ camera: () => 'chase', bestStreak: () => 0, wallet: () => wallet });
menu2.show();
const name2 = (g) => menu2.root.querySelector(`[data-group="${g}"]`).children.filter((c) => c.tagName === 'BUTTON')[1];
check(
  'a Garage opened afterwards shows the remembered choice, not the default',
  name2('water').dataset.key === currentWaterStyle().id && name2('drive').dataset.key === currentDrivingModel().id,
  `${name2('water').dataset.key} / ${name2('drive').dataset.key}`,
);

/* ── 6. a gamepad can reach both rows and press them ─────────────────────── */
head('6. a pad reaches them — Start, stick, A');

menu.show();
const padRows = [...menu.root.querySelectorAll('.row')].filter((r) => r.children.some((c) => c.tagName === 'BUTTON'));
const groupUnderFocus = () => globalThis.document.activeElement?.dataset?.group ?? '(none)';
const visited = [];
for (let i = 0; i < padRows.length + 2; i++) {
  menu.padNav({ dx: 0, dy: 1, confirm: false, cancel: false });
  visited.push(groupUnderFocus());
}
check(
  'the stick walks onto the Water row and the Driving row like every other row',
  visited.includes('water') && visited.includes('drive'),
  visited.join(' → '),
);

/* Drive the stick to the Driving row, then press A twice: padNav focuses on the first press and
 * clicks when the focus is already on the button, which is its own documented behaviour. */
let guard = 0;
while (groupUnderFocus() !== 'drive' && guard++ < 40) menu.padNav({ dx: 0, dy: 1, confirm: false, cancel: false });
const padWas = currentDrivingModel().id;
menu.padNav({ dx: 1, dy: 0, confirm: false, cancel: false }); // step along the row, onto the name
menu.padNav({ dx: 0, dy: 0, confirm: true, cancel: false });
check(
  'A on the pad presses the button the ring is on, and the model changes',
  currentDrivingModel().id !== padWas,
  `${padWas} → ${currentDrivingModel().id}`,
);

/* ── 7. the fleet: two micro-cars, and the ladder they sit on ────────────── */
head('7. the fleet — the Tricycle starts you, and the three earned cars are untouched');

check('FLEET[0] is the Tricycle, so it is the car a new player arrives in', FIRST_CAR === 'threewheeler' && FLEET[0].id === 'threewheeler', `${FIRST_CAR} / ${FLEET[0].id}`);
const freshWallet = new Wallet({ storageKey: 'diag.switchers.fresh' });
/* Free TWICE OVER, and both routes are asserted because each one carries a different consequence:
 * being FLEET[0] is what hands it to a brand new player before a single sun exists, and `earnAt: 0`
 * is what makes the fleet describe it as earned rather than as stock a dealership is holding. */
check(
  'a brand new wallet owns it from the first frame — FLEET[0], before any sun is collected',
  freshWallet.owns(FLEET[0].id, FLEET[0].id, Infinity) && freshWallet.sunsEarned === 0,
  `owns=${freshWallet.owns(FLEET[0].id, FLEET[0].id, Infinity)} with ${freshWallet.sunsEarned} collected`,
);
check(
  'and it is on the earned ladder at 0, not in the shop with a price of nothing',
  earnAtOf(FLEET[0]) === 0 && unlockRule(FLEET[0]).how === 'earn',
  `earnAt ${earnAtOf(FLEET[0])}, unlockRule "${unlockRule(FLEET[0]).how}"`,
);
/* The bar tools/bench-economy.mjs holds FLEET[1] to, asserted here as well so a future reorder
 * fails in the tool that is about the fleet rather than only in the one that is about the economy. */
check(
  'FLEET[1] is priced and unowned — the second car is what proves the shop takes money',
  priceOf(FLEET[1]) > 0 && !freshWallet.owns(FLEET[1].id, FLEET[0].id, earnAtOf(FLEET[1])),
  `${FLEET[1].label} at ${priceOf(FLEET[1])} suns`,
);

const earned = FLEET.filter((c) => Number.isFinite(earnAtOf(c))).sort((a, b) => earnAtOf(a) - earnAtOf(b));
check(
  "EXACTLY THREE cars are earned with suns — the operator's rule, still literally true",
  earned.length === 3,
  earned.map((c) => `${c.label}@${earnAtOf(c)}`).join(', '),
);
check(
  'the ladder shifted down one rung and kept its two thresholds — 0, 25, 70',
  earned.map((c) => `${c.id}:${earnAtOf(c)}`).join(',') === 'threewheeler:0,hatch:25,coupe:70',
  earned.map((c) => `${c.id}:${earnAtOf(c)}`).join(','),
);
/* STRICTLY ASCENDING, and it is not a tidiness check. tools/bench-economy.mjs destructures the
 * earned list as `[, two, three]` and asserts that `two` STARTS LOCKED — so a second rung at 0
 * (which is what leaving the Hatch at 0 beside a Tricycle at 0 would have produced) makes that
 * check fail with an error about the wrong thing entirely. */
check(
  'the three rungs strictly ascend, so the second one can start locked',
  earned.every((c, i) => i === 0 || earnAtOf(c) > earnAtOf(earned[i - 1])),
  earned.map((c) => earnAtOf(c)).join(' < '),
);
check(
  'every earned car is reported as earned rather than as a price — two ladders, one source',
  earned.every((c) => unlockRule(c).how === 'earn'),
  earned.map((c) => unlockRule(c).how).join(','),
);
/* The other half of the same rule, and the one that failed while this was being wired: FLEET[0] is
 * open to everybody by definition, so if it were classified as a forecourt car the fleet would be
 * offering a free car for sale. */
const rich = new Wallet({ storageKey: 'diag.switchers.rich' });
rich.addSuns(100000);
const forSale = FLEET.filter((c) => unlockRule(c).how === 'buy');
check(
  'no car the shop sells is open to a player who has merely collected a lot',
  forSale.length === FLEET.length - 3 && forSale.every((c) => !rich.owns(c.id, FIRST_CAR, earnAtOf(c))),
  `${forSale.length} for sale, ${forSale.filter((c) => rich.owns(c.id, FIRST_CAR, earnAtOf(c))).length} of them wrongly open`,
);

for (const id of ['threewheeler', 'microcar']) {
  const c = FLEET_BY_ID[id];
  const src = MICRO_FLEET.find((m) => m.id === id);
  check(`${id} is in the fleet`, !!c, c ? c.label : 'absent');
  check(
    `${id} keeps car/microPhysics.js's own feel — the spread dropped nothing`,
    c.feel === src.feel && c.tier === src.tier && c.length === src.length && c.file === src.file,
    `tier ${c.tier}, ${c.length} m, ${c.file}`,
  );
  check(
    `${id}'s tier really exists — an unknown one would silently drive as a sports car`,
    !!TIERS[c.tier],
    `TIERS.${c.tier} = ${TIERS[c.tier] ? `track ${TIERS[c.tier].track} m, cgHeight ${TIERS[c.tier].cgHeight}` : 'MISSING'}`,
  );
  check(
    `${id} is in the loadedCar registry, so the Garage button can actually load it`,
    !!CARS[id] && CARS[id].file === c.file,
    CARS[id] ? CARS[id].file : 'absent',
  );
  check(
    `${id} carries a real ladder position rather than the module's 0/0 placeholders`,
    Number.isFinite(c.unlockAt) && Number.isFinite(c.price) && (c.id === FIRST_CAR || c.price > 0),
    `unlockAt ${c.unlockAt}, price ${c.price}`,
  );
}

/* A fleet entry whose model file is not on disk is a car that fails to load with a console error and
 * a toast — checked for the WHOLE fleet, because adding two was the moment to notice. */
const missing = FLEET.filter((c) => !existsSync(resolve('public/models/cars', c.file)));
check('every car in the fleet has its .glb on disk', missing.length === 0, missing.map((c) => c.file).join(', ') || `${FLEET.length} files, all present`);

/* ── 8. main.js is wired, read out of the file ───────────────────────────── */
head('8. src/main.js — a source scan, because a game cannot be imported into node');

const MAIN = readFileSync(resolve('src/main.js'), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // comments talk ABOUT these calls
const code = strip(MAIN);
check(
  'the feel goes through applyDrivingModel at boot and on every car swap',
  (code.match(/applyDrivingModel\(/g) || []).length >= 3,
  `${(code.match(/applyDrivingModel\(/g) || []).length} calls`,
);
check(
  'NO bare applyCarFeel survives — it would leave the last model standing in every other table',
  !/\bapplyCarFeel\b/.test(code),
  /\bapplyCarFeel\b/.test(code) ? 'still present' : 'gone from code and from the import list',
);
check(
  'the micro pass runs after it, at boot and on every car swap',
  (code.match(/applyMicroPhysics\(/g) || []).length >= 3,
  `${(code.match(/applyMicroPhysics\(/g) || []).length} calls`,
);
check(
  'applyMicroPhysics follows applyDrivingModel in the swap block, never the other way round',
  (() => {
    const swap = code.slice(code.indexOf('async function swapCar'));
    const a = swap.indexOf('applyDrivingModel(');
    const b = swap.indexOf('applyMicroPhysics(');
    return a >= 0 && b > a;
  })(),
  'order is what stops the restore inside the model wiping the micro tables',
);
check(
  'the Garage is handed an onDrive hook, which is how the button reaches the live car',
  /onDrive:\s*\(\)\s*=>/.test(code),
  'menu hook present',
);

console.log(`\n${failed === 0 ? `all switcher checks passed` : `${failed} FAILED`}`);
process.exitCode = failed === 0 ? 0 : 1;
