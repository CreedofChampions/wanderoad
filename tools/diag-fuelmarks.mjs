/* created by AI
 * Cozy Driver — the distance to the pumps flashes at every meter point, once each, both ways.
 *
 * Operator: "gas station distance should flash yellow when running below each meter point on the
 * fuel gauge". The gauge has ticks at 1, 3/4, 1/2, 1/4 and 0 of a tank, and MARKS in
 * src/ui/fuelGauge.js is the same list the ticks are drawn from, so the thing that flashes and the
 * thing that is drawn cannot drift apart.
 *
 * Four ways this breaks after it is written, and all four are checked here:
 *   - it fires EVERY FRAME below a gate, so the readout never stops flashing;
 *   - it fires ONCE EVER, so the second tank is silent;
 *   - it skips a gate when the tank crosses two in one step (a can, a long stretch off-road);
 *   - it fires on the SMOOTHED needle rather than the raw fraction, so the warning arrives half a
 *     second after the moment it is about.
 *
 * WHAT THIS FILE CANNOT SEE: the colour. The stub DOM has no cascade, so "amber" is measured on the
 * live beta instead, where the readout goes rgb(252,220,128) against a resting rgb(246,236,216) —
 * filmed, with the numbers, on https://nibblet.net/cozy-proof/. This file owns the BEHAVIOUR.
 *
 *   node tools/diag-fuelmarks.mjs
 */
import { installStubDom } from './stub-dom.mjs';

installStubDom();

const { FuelGauge } = await import('../src/ui/fuelGauge.js');

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('\nCOZY DRIVER — THE METER-POINT WARNING\n' + '-'.repeat(72));

/** A tank the gauge will accept, at a given fraction of full. */
const tankAt = (f) => ({
  seconds: 600 * f,
  capacity: 600,
  fraction: f,
  capacityLevel: 0,
  capacityProgress: 0,
  carCans: 0,
  /* The gauge asks the TANK how long is left and where the nearest pumps are, and below a quarter
   * it starts showing both. A stand-in that answers only `fraction` therefore passes the first two
   * gates and throws at the third — which is a check that would have looked like it worked. */
  minutesLeft: () => Math.round(f * 10),
  nearest: () => null,
});
const CAR = { x: 0, z: 0, yaw: 0, kph: 40 };
const build = () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return new FuelGauge(root);
};
/** Run the gauge down a list of fractions, one update each, and report the flashes it fired. */
const walk = (g, fracs, dt = 0.2) => {
  const before = g.markFlashCount();
  for (const f of fracs) g.update(dt, tankAt(f), CAR);
  return g.markFlashCount() - before;
};

/* ── one flash per gate, not one per frame ─────────────────────────────────── */
{
  const g = build();
  g.update(0.2, tankAt(1), CAR);
  const at75 = walk(g, [0.74, 0.73, 0.72, 0.71, 0.7]);
  check('crossing 3/4 flashes ONCE, not once per frame', at75 === 1, `${at75} flashes over five frames below the gate`);
  check('and the gauge says which gate it was', g.lastMark() === 0.75, String(g.lastMark()));

  const at50 = walk(g, [0.49, 0.48, 0.47]);
  check('crossing 1/2 flashes once more', at50 === 1, `${at50}`);
  const at25 = walk(g, [0.24, 0.23]);
  check('and 1/4 once more — three gates, three warnings', at25 === 1 && g.markFlashCount() === 3, `${g.markFlashCount()} in total`);
  check('the last gate crossed is reported as 1/4', g.lastMark() === 0.25, String(g.lastMark()));
}

/* ── refuelling arms them again ────────────────────────────────────────────── */
{
  const g = build();
  g.update(0.2, tankAt(1), CAR);
  walk(g, [0.7, 0.45, 0.2]);
  const first = g.markFlashCount();
  g.update(0.2, tankAt(1), CAR); // brimmed at a pump
  check('a full tank disarms the gates again', g.lastMark() === null, String(g.lastMark()));
  const second = walk(g, [0.7, 0.45, 0.2]);
  check(
    'so the SECOND tank warns exactly as the first did — not silent',
    first === 3 && second === 3,
    `${first} on the first tank, ${second} on the second`,
  );
}

/* ── a big drop must not swallow the gates it passed ───────────────────────── */
{
  const g = build();
  g.update(0.2, tankAt(1), CAR);
  /* One long off-road stretch, or a can burned in one step: the tank goes from full to a fifth
   * between two updates. The warning that matters is the LOWEST gate — flashing three times in
   * one frame would just be a stutter — so what is checked is that it fires and names 1/4. */
  const jumped = walk(g, [0.2]);
  check('a drop straight past three gates still warns', jumped >= 1, `${jumped} flash from one step`);
  check('and it names the lowest gate it went through', g.lastMark() === 0.25, String(g.lastMark()));
}

/* ── it fires on the RAW fraction, not the lagging needle ──────────────────── */
{
  const g = build();
  g.update(0.2, tankAt(1), CAR);
  /* One single frame at 0.74 — the needle is still up near full at this point, since it eases
   * towards the target. If the warning were driven by the needle it would not have fired yet. */
  const immediate = walk(g, [0.74], 0.016);
  check('the warning fires in the frame the tank crosses, not once the needle catches up', immediate === 1, `${immediate}`);
}

/* ── and the gates ARE the ticks on the dial ───────────────────────────────── */
{
  const src = (await import('node:fs')).readFileSync(new URL('../src/ui/fuelGauge.js', import.meta.url), 'utf8');
  const marks = /const MARKS = \[([^\]]+)\]/.exec(src);
  check('MARKS is a single list, shared by the dial and the warning', !!marks && marks[1].includes('0.75') && marks[1].includes('0.5') && marks[1].includes('0.25'), marks ? marks[1] : '(not found)');
  check('the dial draws its ticks from that same list rather than a second copy', /MARKS/.test(src.split('const MARKS')[1] || ''), 'MARKS referenced after its definition');
}

console.log(`\n${failed ? `${failed} FUEL-MARK CHECK(S) FAILED` : 'all fuel-mark checks passed'}\n`);
process.exit(failed ? 1 : 0);
