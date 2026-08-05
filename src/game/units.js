// created by AI
/* Wanderoad — miles and mph, or kilometres and km/h.
 *
 * Operator, verbatim: "a metric and the other system for miles per hour for the Americans...
 * a switch between defaulted to the American system." Two things in one sentence and both are
 * load-bearing: a SWITCH, so nobody who prefers kilometres is stuck with miles, and DEFAULTED TO
 * AMERICAN, so nobody who has never touched a setting sees anything else. The game already
 * speaks km/h everywhere it shows a number — DEFAULT_IMPERIAL below is the one line that
 * overrides that on a first-ever visit, and is the whole point of this file.
 *
 * The conversion is exact, not a rounded constant carried from memory: 1 km is DEFINED as
 * exactly 0.62137119223733 international miles, and mph/km-h share that same ratio because both
 * are just "distance per hour" in their own distance unit. One constant, MPH_PER_KPH, covers the
 * speedometer in both directions — and, divided into a metre figure instead of a kph one, the
 * streak's distance readout too (via MI_PER_M/FT_PER_M below).
 *
 * Same storage discipline as car/drivingModels.js and render/waterStyles.js: every localStorage
 * touch is wrapped, because a corrupt or unavailable store (private mode, quota, whatever) is not
 * worth a crash over a unit label.
 */

import { fmtDistance as fmtDistanceMetric } from './streak.js';

const KEY = 'wanderoad.units.v1';
export const MPH_PER_KPH = 0.62137119223733; // exact: 1 km is exactly 0.62137119223733 international miles
export const MI_PER_M = 0.00062137119223733;
export const FT_PER_M = 3.28084;
export const DEFAULT_IMPERIAL = true; // American system by default — the operator's explicit instruction

function readStored() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'us' ? true : v === 'metric' ? false : null;
  } catch {
    return null;
  }
}

/** `?units=us` or `?units=metric` — the same shape as `?drive=` and `?water=`, for a link that
 *  wants to hand someone a specific system rather than whatever they last chose. */
export function unitsFromUrl(search = typeof location === 'undefined' ? '' : location.search) {
  try {
    const want = new URLSearchParams(search).get('units');
    return want === 'us' ? true : want === 'metric' ? false : null;
  } catch {
    return null;
  }
}

/* THE URL WINS OVER STORAGE, STORAGE WINS OVER THE DEFAULT — the same order car/drivingModels.js
 * already resolves `?drive=` in (see its own note), and for the same reason: someone who typed
 * `?units=metric` meant it. Resolved once at module load so `isImperial()` is honest before
 * anyone has called `setImperial` — and because DEFAULT_IMPERIAL is `true`, a first-ever visit
 * with no URL parameter and nothing in storage lands on mph without either of those having to
 * say a word. That is the one property this whole file exists to guarantee. */
let imperial = DEFAULT_IMPERIAL;
{
  const fromUrl = unitsFromUrl();
  const stored = readStored();
  imperial = fromUrl !== null ? fromUrl : stored !== null ? stored : DEFAULT_IMPERIAL;
}

/** The unit system in force. Never null — American until something says otherwise. */
export function isImperial() {
  return imperial;
}

/** Choose a system and remember it. Truthy for mph, falsy for km/h. */
export function setImperial(next) {
  imperial = !!next;
  try {
    localStorage.setItem(KEY, imperial ? 'us' : 'metric');
  } catch {
    // private mode — the choice lasts the session
  }
  return imperial;
}

/** The one-key version, for a control that only ever has two states to flip between. */
export function toggleUnits() {
  return setImperial(!imperial);
}

/** For the HUD speedometer. kph in (the car's internal unit, unchanged); a display value and its
 * unit word out. Rounded once, here, so every caller shows the same number. */
export function speedDisplay(kph) {
  return imperial
    ? { value: Math.round(kph * MPH_PER_KPH), label: 'mph' }
    : { value: Math.round(kph), label: 'km/h' };
}

/** For the streak readout. Mirrors game/streak.js's fmtDistance exactly in structure — small unit
 * under 1000, large unit over it, two decimals until the large unit reaches double digits, one
 * after — just with feet/miles in place of metres/kilometres. */
export function fmtDistanceUnits(m) {
  if (!imperial) return fmtDistanceMetric(m);
  const ft = m * FT_PER_M;
  if (ft < 1000) return `${Math.round(ft)} ft`;
  const mi = m * MI_PER_M;
  return `${mi.toFixed(mi < 10 ? 2 : 1)} mi`;
}
