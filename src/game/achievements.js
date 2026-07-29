/* Cozy Driver — achievements.
 *
 * The game has exactly one mechanic: distance without leaving the road. Everything else is
 * scenery. So the achievements are not a checklist bolted on the side, they are the handful of
 * moments where that one mechanic produced a story worth telling — the run that survived a
 * rollover, the tank that lasted, the night that never touched the verge.
 *
 * Each one is a pure predicate over a snapshot. Nothing in here reaches into the solver, nothing
 * animates, nothing blocks. `check()` is handed the same state the HUD already has and returns
 * the ids that just unlocked, which the caller turns into a toast. That keeps this file
 * testable without a browser (tools/diag-achievements.mjs) and keeps the game loop honest.
 *
 * Progress is persisted as a plain set of ids in localStorage. No server, no account, no sync —
 * an achievement you earned on your laptop is yours on your laptop, which for a cozy game is
 * enough. The LEADERBOARD is the thing that goes over the wire, and that lives in net/board.js.
 */

const KEY = 'cozydriver.achievements.v1';

/* The operator's own idea, and the best one here: "flip say on road and dont lose streak".
 * Rolling the car and keeping the streak is the single most surprising thing that can happen in
 * this game, because a rollover feels terminal and is not. It gets pride of place. */
export const ACHIEVEMENTS = [
  {
    id: 'first_km',
    title: 'First kilometre',
    hint: 'drive 1 km without leaving the road',
    test: (s) => s.distance >= 1000,
  },
  {
    id: 'rubber_side_down',
    title: 'Rubber side up',
    hint: 'roll the car and keep the streak alive',
    /* The whole point: `rolled` goes true while the body is on its side or its roof, and the
     * streak only breaks on leaving the ROAD. So a car that flips and lands still on the tarmac
     * has not broken anything. Rare, entirely legitimate, and it makes people laugh. */
    test: (s) => s.rolled && s.onRoad && s.distance > 0,
  },
  {
    id: 'ten_km',
    title: 'Long way round',
    hint: 'drive 10 km without leaving the road',
    test: (s) => s.distance >= 10000,
  },
  {
    id: 'night_shift',
    title: 'Night shift',
    hint: 'hold a 5 km streak after dark',
    test: (s) => s.distance >= 5000 && s.night === true,
  },
  {
    id: 'thirsty',
    title: 'Running on fumes',
    hint: 'reach a station with less than a tenth of a tank',
    test: (s) => s.refuelled === true && s.fuelBefore > 0 && s.fuelBefore < 0.1,
  },
  {
    id: 'marathon',
    title: 'Marathon',
    hint: 'drive 42 km without leaving the road',
    test: (s) => s.distance >= 42000,
  },
  {
    id: 'tourist',
    title: 'Tourist',
    hint: 'drive through every biome in one streak',
    /* `biomes` is a Set the caller grows while a streak runs and clears when it breaks. Five
     * is the whole world — meadow, steppe, highland, dunes, wetland. */
    test: (s) => s.biomes instanceof Set && s.biomes.size >= 5,
  },
  {
    id: 'century',
    title: 'Century',
    hint: 'drive 100 km without leaving the road',
    test: (s) => s.distance >= 100000,
  },
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

function read() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);
  } catch {
    /* private mode, or a corrupted value from an older build. Starting empty is strictly
     * better than refusing to boot over a cosmetic feature. */
    return new Set();
  }
}

function write(set) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify([...set]));
  } catch {
    /* nothing to do and nothing worth saying — the run still counts, it just will not persist */
  }
}

export class Achievements {
  constructor() {
    this.earned = read();
    /** Biomes seen during the CURRENT streak. Grown by note(), cleared by reset(). */
    this.biomes = new Set();
  }

  /** How many are unlocked, and out of how many. For the menu. */
  get progress() {
    return { earned: this.earned.size, total: ACHIEVEMENTS.length };
  }

  has(id) {
    return this.earned.has(id);
  }

  /** A streak ended. The per-streak accumulators start again. */
  reset() {
    this.biomes.clear();
  }

  /** Called each frame with the dominant biome index while a streak is running. */
  note(biomeIndex) {
    if (Number.isInteger(biomeIndex) && biomeIndex >= 0) this.biomes.add(biomeIndex);
  }

  /**
   * Test everything against one snapshot and return the ids that unlocked THIS call.
   *
   * Returns ids, not messages, so the caller owns presentation — the HUD wants a toast, the
   * menu wants a list, and a node test wants neither.
   *
   * @param {object} state distance, rolled, onRoad, night, refuelled, fuelBefore
   * @returns {string[]} newly earned ids, in declaration order
   */
  check(state) {
    const s = { ...state, biomes: this.biomes };
    const fresh = [];
    for (const a of ACHIEVEMENTS) {
      if (this.earned.has(a.id)) continue;
      let ok = false;
      try {
        ok = !!a.test(s);
      } catch {
        /* A predicate that throws on a missing field must not take the frame with it. */
        ok = false;
      }
      if (ok) {
        this.earned.add(a.id);
        fresh.push(a.id);
      }
    }
    if (fresh.length) write(this.earned);
    return fresh;
  }
}
