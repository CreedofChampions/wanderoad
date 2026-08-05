/* Wanderoad — CARRY ON WHERE YOU LEFT OFF.
 *
 * Operator: "we need to make it so people can continue were they left off".
 *
 * Almost everything a player OWNS was already persisted, each by the module that owns it — the
 * wallet (suns, cars, tanks, cans, the boat, the plane), the streak's best and total, the fuel
 * mercy counter and per-car tank upgrades, the achievements. What was NOT saved is the only thing
 * that makes it feel like coming back to a game rather than starting one: WHERE YOU WERE, WHAT YOU
 * WERE DRIVING, and HOW MUCH FUEL WAS LEFT. Every reload put you back at the spawn point in the
 * default car with a full tank, several kilometres from whatever you had been doing.
 *
 * So this is a small record of the things nothing else owns. It is deliberately NOT a save file for
 * the whole game: every other module keeps saving its own state, because a second copy of the
 * wallet here would be a second opinion about how many suns you have, and the two would drift.
 *
 * THE SEED IS PART OF THE RECORD, and a resume is refused if it does not match. A position is only
 * meaningful in the world it was recorded in — restoring (4127, -2280) into a different seed drops
 * you into unrelated terrain, possibly inside a mountain or out at sea. Different world, fresh start.
 *
 * WRITTEN ON THE WAY OUT, not every frame. `pagehide` and `visibilitychange` are what actually fire
 * when a tab is closed, backgrounded or navigated away from on both desktop and mobile — `unload`
 * is unreliable and is ignored outright on iOS. A slow autosave runs as well so a crash or a lost
 * battery costs seconds rather than a session.
 */

const KEY = 'wanderoad.session.v1';

/** How often the autosave runs, in seconds. Slow on purpose: this is insurance, not the mechanism. */
export const AUTOSAVE_S = 6;

/**
 * Everything the resume needs that no other module already persists.
 *
 * @typedef {object} SessionState
 * @property {number} seed  the world this position belongs to
 * @property {number} x
 * @property {number} z
 * @property {number} yaw
 * @property {string} car   fleet id
 * @property {number} fuel  seconds of cruise left in the tank
 * @property {number} at    epoch ms, so a stale save can be recognised
 */

/** Read the saved session, or null. Never throws — a corrupt record is just a fresh start. */
export function loadSession(seed) {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object') return null;
    // A POSITION FROM ANOTHER WORLD IS NOT A POSITION. See the header.
    if ((d.seed >>> 0) !== (seed >>> 0)) return null;
    if (!Number.isFinite(d.x) || !Number.isFinite(d.z)) return null;
    return {
      seed: d.seed >>> 0,
      x: +d.x,
      z: +d.z,
      yaw: Number.isFinite(d.yaw) ? +d.yaw : 0,
      car: typeof d.car === 'string' ? d.car : null,
      fuel: Number.isFinite(d.fuel) ? +d.fuel : null,
      at: Number.isFinite(d.at) ? +d.at : 0,
    };
  } catch {
    /* Private mode, a quota, or a record written by an older build. A cozy driving game does not
     * owe anyone an error message for that — it just starts you at the beginning. */
    return null;
  }
}

/** Write the session. Cheap enough to call on a timer; silent if storage is unavailable. */
export function saveSession(state) {
  try {
    if (!state || !Number.isFinite(state.x) || !Number.isFinite(state.z)) return false;
    globalThis.localStorage?.setItem(
      KEY,
      JSON.stringify({
        seed: state.seed >>> 0,
        x: +state.x.toFixed(2),
        z: +state.z.toFixed(2),
        yaw: +(state.yaw || 0).toFixed(4),
        car: state.car || null,
        fuel: Number.isFinite(state.fuel) ? +state.fuel.toFixed(1) : null,
        at: state.at || 0,
      })
    );
    return true;
  } catch {
    return false;
  }
}

/** Forget the saved position. Used by `?fresh=1` and by anything that wants a clean start. */
export function clearSession() {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* nothing to clear, or no storage — either way there is nothing to report */
  }
}

/**
 * Should this load resume, or start fresh?
 *
 * `?fresh=1` forces a fresh start and CLEARS the record. That parameter is not decoration: every
 * diagnostic in tools/ uses it to get a clean player, and a resume that ignored it would make those
 * checks measure whatever the last run happened to leave behind.
 *
 * @param {number} seed
 * @param {string} [search] defaults to the live query string
 */
export function resumeFor(seed, search = globalThis.location?.search ?? '') {
  let fresh = false;
  try {
    fresh = new URLSearchParams(search).get('fresh') !== null;
  } catch {
    fresh = false;
  }
  if (fresh) {
    clearSession();
    return null;
  }
  return loadSession(seed);
}

/**
 * Is a saved spot safe to drop into?
 *
 * A record can outlive the thing that made it valid: a build that moved the water table, a seed
 * whose terrain functions changed, or simply a player who quit while airborne. Dropping someone
 * inside a mountain or into the sea is a worse welcome than the spawn point, so the caller hands in
 * a ground probe and a water test and this refuses anything it cannot stand on.
 *
 * @param {{x:number,z:number}} spot
 * @param {(x:number,z:number)=>number} groundY
 * @param {(x:number,z:number)=>boolean} [isWet]
 */
export function spotIsSafe(spot, groundY, isWet = null) {
  if (!spot) return false;
  const y = groundY(spot.x, spot.z);
  if (!Number.isFinite(y)) return false;
  if (isWet && isWet(spot.x, spot.z)) return false;
  return true;
}
