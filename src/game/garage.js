/* Wanderoad — the fleet.
 *
 * A car and a way of driving are the same choice. Splitting them into two pickers was a
 * testing convenience that leaked into the game: nobody wants to pick a body and then
 * separately pick how it handles. So each car now OWNS its feel, and the only question the
 * player is ever asked is which car.
 *
 * Cars unlock with the streak — the longest run you have ever managed without leaving the
 * road. That makes the one mechanic in the game the thing that opens the game up, and it
 * means the first car is deliberately the easiest to keep on the road with.
 *
 * The unlock ladder is exponential, because a linear one stops meaning anything: going from
 * 8 km to 9 km is not the achievement that going from 1 km to 2 km was.
 */

import { STEER, TYRE, BRAKE } from '../car/tuning.js';

/**
 * `unlockAt` is metres of BEST streak. `feel` is everything that used to live in a separate
 * preset: how much lateral acceleration full stick asks for, which aid ladder rung, how fast
 * the keyboard reaches full lock, and the rear grip that decides whether it rotates.
 */
export const FLEET = [
  {
    id: 'estate',
    file: 'estate.glb',
    label: 'Estate',
    blurb: 'Soft, slow and forgiving. The one you learn the roads in.',
    unlockAt: 0,
    price: 0, // the car you start in
    tier: 'gt',
    length: 4.6,
    feel: { comfortG: 7.0, assist: 'cruise', rearGrip: 1.06, buildRate: 2.6, brakeMul: 1.15 },
  },
  {
    id: 'hatch',
    file: 'hatch.glb',
    label: 'Hatch',
    blurb: 'Light and eager. Turns in more sharply than it has any right to.',
    unlockAt: 1000,
    price: 20,
    tier: 'gt',
    length: 4.0,
    feel: { comfortG: 8.2, assist: 'cruise', rearGrip: 1.0, buildRate: 3.0, brakeMul: 1.1 },
  },
  {
    id: 'coupe',
    file: 'coupe.glb',
    label: 'Coupe',
    blurb: 'The road car. Quick enough to be interesting, calm enough to cruise.',
    unlockAt: 3000,
    price: 45,
    tier: 'sports',
    length: 4.3,
    feel: { comfortG: 9.2, assist: 'sport', rearGrip: 1.0, buildRate: 2.8, brakeMul: 1.0 },
  },
  {
    id: 'sedan',
    file: 'sedan.glb',
    label: 'Sedan',
    blurb: 'Long wheelbase, loose rear. It will hold a slide if you ask nicely.',
    unlockAt: 8000,
    price: 90,
    tier: 'sports',
    length: 4.5,
    feel: { comfortG: 10.4, assist: 'sport', rearGrip: 0.9, buildRate: 3.2, brakeMul: 1.0 },
  },
  {
    id: 'rally',
    file: 'rally.glb',
    label: 'Rally',
    blurb: 'Made for the gravel. The only one that is genuinely happy off the tarmac.',
    unlockAt: 20000,
    price: 180,
    tier: 'sports',
    length: 4.2,
    feel: { comfortG: 11.6, assist: 'sport', rearGrip: 0.94, buildRate: 3.6, brakeMul: 1.05, offRoad: 1.35 },
  },
  {
    id: 'taxi',
    file: 'taxi.glb',
    label: 'Taxi',
    blurb: 'Somebody has to. Slow, indestructible, oddly relaxing.',
    unlockAt: 45000,
    price: 320,
    tier: 'gt',
    length: 4.5,
    feel: { comfortG: 7.6, assist: 'cruise', rearGrip: 1.04, buildRate: 2.4, brakeMul: 1.2 },
  },
  {
    id: 'patrol',
    file: 'patrol.glb',
    label: 'Patrol',
    blurb: 'All-wheel drive and the strongest brakes in the fleet. The long-distance one.',
    unlockAt: 100000,
    price: 600,
    tier: 'hyper',
    length: 4.6,
    feel: { comfortG: 9.8, assist: 'sport', rearGrip: 1.02, buildRate: 2.8, brakeMul: 1.3 },
  },
];

export const FLEET_BY_ID = Object.fromEntries(FLEET.map((c) => [c.id, c]));
export const FIRST_CAR = FLEET[0].id;

const KEY = 'wanderoad.unlocks.v1';

/** Cheat mode: everything open, for testing and for anyone who just wants to drive. */
export function cheatOn() {
  try {
    return new URLSearchParams(location.search).has('cheat') || localStorage.getItem(KEY + '.cheat') === '1';
  } catch {
    return false;
  }
}

export function setCheat(on) {
  try {
    localStorage.setItem(KEY + '.cheat', on ? '1' : '0');
  } catch {
    /* private mode; the URL parameter still works */
  }
}

/** Best streak ever, in metres. The single number the whole fleet unlocks against. */
export function bestStreak() {
  try {
    const raw = localStorage.getItem('wanderoad.streak.v1');
    return raw ? +JSON.parse(raw).best || 0 : 0;
  } catch {
    return 0;
  }
}

/* ── CARS ARE BOUGHT, NOT PASSED ──────────────────────────────────────────────
 * Operator: "add dealerships where you can buy cars with coins ... New cars = coins."
 *
 * `unlockAt` is kept — it still places each car's badge along the unlock bar, and it is still
 * what `nextUnlock` reports, so the bar continues to answer "what is coming next". But it no
 * longer GRANTS anything: a car is yours when you have paid for it at a dealership.
 *
 * The wallet is passed in rather than imported, for the same reason `best` is: this module is
 * pure and testable, and a hard dependency on localStorage-backed state would end that. A
 * caller with no wallet to hand gets the old distance rule, which is what keeps every existing
 * tool and fixture in this repo working unchanged.
 */
export function isUnlocked(car, best = bestStreak(), wallet = null) {
  if (cheatOn()) return true;
  if (wallet) return wallet.owns(car.id, FLEET[0].id);
  return best >= car.unlockAt;
}

/** What this car costs at a dealership, in coins. */
export function priceOf(car) {
  return Math.max(0, +car.price || 0);
}

/** The next car you have not yet earned, and how far away it is. */
export function nextUnlock(best = bestStreak()) {
  if (cheatOn()) return null;
  for (const c of FLEET) {
    if (best < c.unlockAt) return { car: c, remaining: c.unlockAt - best, progress: best / c.unlockAt };
  }
  return null;
}

/** Apply a car's feel to the shared tuning tables. One solver, many cars. */
export function applyCarFeel(car) {
  const f = car.feel;
  STEER.comfortG = f.comfortG;
  STEER.attackG = f.comfortG * 1.6;
  STEER.buildBase = f.buildRate;
  STEER.buildBonus = f.buildRate * 1.6;
  TYRE.muLatRear = 1.34 * f.rearGrip;
  /* Each car's brakes. This was declared in the fleet and then never applied — the Patrol's
   * "strongest brakes in the fleet" and the Estate's forgiving ones were the same brakes. */
  BRAKE.torque = BRAKE.baseTorque * (f.brakeMul || 1);
  /* The Rally's `offRoad: 1.35` was the same story a second time — declared above ("the only
   * one that is genuinely happy off the tarmac") and read nowhere. car/vehicle.js's dunes
   * sand-bog severity now divides by this, so the Rally takes proportionally longer to bog
   * down than the rest of the fleet instead of the number sitting there doing nothing. */
  TYRE.offRoadMul = f.offRoad || 1;
  return f;
}

/** Pick a car from the URL, falling back to the first one you can actually drive. */
export function carFromUrl(search = location.search) {
  const want = new URLSearchParams(search).get('car');
  const best = bestStreak();
  const c = FLEET_BY_ID[want];
  if (c && isUnlocked(c, best)) return c;
  return FLEET_BY_ID[FIRST_CAR];
}

/** Metres formatted the way the unlock bar wants them. */
export function fmtUnlock(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
