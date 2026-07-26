/* Wanderoad — positional ambience: the sea, and the birds.
 *
 * "You should hear the ocean as it gets closer. Birds as they come closer." Everything else
 * in the mix is a property of the CAR — engine, tyres, wind, the radio on the dashboard — and
 * so it is the same everywhere. This layer is a property of the PLACE, which means it has to
 * be sampled out of the world rather than derived from the vehicle state, and it has to know
 * which way round it is: water on your left is water on your left.
 *
 * Three things it must do and one it must not:
 *
 *   1. Attenuate with distance. A coast 400 m off is a hint; a coast 30 m off is the sea.
 *   2. Point somewhere. Both layers are panned by the bearing of what is making the noise,
 *      taken in the car's own frame so it swings as you turn.
 *   3. Cost nothing. The graph is built ONCE, by EngineAudio._ensureAmbience() on the first
 *      frame after the audio context is running; update() only sets AudioParams and never
 *      creates a node, an object or an array. Even a bird call allocates nothing — it is
 *      automation on an oscillator that has been running since the graph was built. The
 *      world sampling is spread over ~0.3 s of frames rather than done in a burst.
 *   4. Never fight the radio or the engine. Both layers ARE ducked, hard, by road speed and
 *      by whether a station is playing — see duckFor(). At 120 km/h with the radio on you
 *      are meant to hear the car and the music; the sea comes back when you slow down for it.
 *
 * NO SAMPLES, NO LICENCES. Same principle as the radio: this is synthesised in the WebAudio
 * graph out of one noise buffer and a handful of oscillators, so there is no recording riding
 * along with the game and nothing to audit. The surf is filtered noise under a two-oscillator
 * swell; a bird is a sine whose frequency is swept over ~90 ms. Both are original.
 *
 * WHY IT SOUNDS LIKE SURF AND NOT LIKE WIND. Filtered noise on its own is wind — the engine
 * already has some, two filters away in this same graph. What makes it read as water is the
 * SWELL: a slow, irregular amplitude envelope (two sub-audio sines at 0.083 and 0.052 Hz, so
 * the pattern takes minutes to repeat) plus a hiss band that only comes up in the last
 * hundred metres, which is the sound of a wave actually breaking rather than of a bay heard
 * from a hill.
 */

import { clamp, clamp01, lerp, smoothstep, damp } from '../core/math.js';
import { landHeight } from '../world/terrain.js';
import { biomeWeights, waterLevelAt, blendScalar, BIOME_SCATTER, BIOME_COUNT } from '../world/biomes.js';
import { forestDensity } from '../world/scatter.js';

/* ── the world probe ─────────────────────────────────────────────────────────
 *
 * Everything the audio needs is two questions about the ground around the car: where is the
 * nearest water and how much of it is there, and how many trees are within earshot. Both are
 * pure functions of (x, z, seed) — no chunk has to be loaded and no worker consulted, which
 * matters because a chunk 400 m away may not have streamed in yet and you should still hear
 * the sea behind it.
 *
 * A ring lattice, not a scan. Twelve bearings by seven radii gives 85 samples that between
 * them cover a 500 m disc, and the ones that matter for direction — the near rings — are the
 * ones with the tightest angular spacing in metres. A square grid at the same fidelity would
 * be well over a thousand samples. The rings bunch up close in and spread out far away for
 * the same reason: at 500 m a hundred metres of error is inaudible, at 30 m it is the whole
 * difference between a bay and a beach.
 *
 * SAMPLE POSITIONS ARE STORED IN WORLD SPACE, not as offsets. A probe taken 0.2 s ago is
 * still a true statement about where the water is; only the distance from the car has changed,
 * and recomputing that from the stored position is one hypot. Storing offsets instead would
 * drag the whole ring along behind a car doing 55 m/s and put the shoreline in the wrong place.
 *
 * Cost: ~9 µs per probe measured in node (landHeight + biomeWeights + forestDensity, JIT
 * warm — tools/diag-ambience.mjs prints it). The budget below spends 240 of them a second,
 * i.e. ~2.2 ms per second of wall clock, spread evenly. That is 0.036 ms of a 16.6 ms frame,
 * and it sweeps the whole lattice every 0.35 s.
 */
const PROBE_DIRS = 12;
const PROBE_RINGS = [25, 55, 100, 165, 250, 360, 500];
const PROBE_COUNT = 1 + PROBE_DIRS * PROBE_RINGS.length;

/** Probes per second. Fixed in TIME, not in frames, so a 144 Hz screen does not do 2.4x the
 *  work of a 60 Hz one for an identical result. 240/s sweeps the whole ring every 0.3 s. */
const PROBE_RATE = 240;
/** Ceiling on catch-up after a stall (an alt-tab hands us a huge dt exactly once). */
const PROBE_MAX_PER_CALL = 8;

/* Distance weight used when asking "how much water is around", metres. Deliberately larger
 * than the lattice, i.e. nearly flat across it: extent answers "how BIG is this water", and
 * the gain law already has a distance term. Weighting extent by distance too was measurably
 * wrong — a coast 400 m off came out with an extent of 0.004 and was therefore treated as a
 * farm pond and turned down twice for the same reason. */
const EXTENT_FALLOFF = 600;
/** Distance weight for the bearing of the water — near probes decide which way it is. */
const BEARING_FALLOFF = 150;
/** Distance weight for how many trees are within earshot. Birds are a local phenomenon. */
const TREE_FALLOFF = 70;

/**
 * The ground truth behind the ambience: where the water is and where the trees are.
 *
 * Kept separate from the audio graph on purpose — it has no AudioContext, so
 * tools/diag-ambience.mjs can drive it in node and print real gains at real places. A mix
 * you cannot measure is a mix you are guessing at.
 */
export class AmbienceField {
  constructor(seed) {
    this.seed = seed >>> 0;
    // Per-probe state. Flat typed arrays, allocated once, never resized.
    this._px = new Float64Array(PROBE_COUNT); // world position of the sample
    this._pz = new Float64Array(PROBE_COUNT);
    this._wet = new Uint8Array(PROBE_COUNT); // 1 if the ground there is under its water plane
    this._fb = new Float32Array(PROBE_COUNT); // metres of dry ground above the water plane
    this._trees = new Float32Array(PROBE_COUNT); // trees per hectare the scatter would place
    this._live = new Uint8Array(PROBE_COUNT); // 0 until this slot has been sampled at least once
    // Ring geometry, precomputed once: unit x/z per probe times its radius.
    this._ox = new Float32Array(PROBE_COUNT);
    this._oz = new Float32Array(PROBE_COUNT);
    this._inner = new Int16Array(PROBE_COUNT); // the probe one ring in on the same bearing
    let p = 1; // slot 0 is the car's own position, offset (0,0)
    for (let r = 0; r < PROBE_RINGS.length; r++) {
      const rad = PROBE_RINGS[r];
      for (let d = 0; d < PROBE_DIRS; d++) {
        // Half a step of twist per ring so the rings do not line up into 12 spokes with
        // 30-degree blind alleys between them.
        const a = ((d + (r % 2) * 0.5) / PROBE_DIRS) * Math.PI * 2;
        this._ox[p] = Math.sin(a) * rad;
        this._oz[p] = Math.cos(a) * rad;
        p++;
      }
    }
    /* Each probe's inward neighbour: the one on the next ring in whose bearing is closest.
     * (The half-ring twist means it is not simply p - PROBE_DIRS.) Ring 0's neighbour is the
     * car itself. This is what lets the shoreline be located BETWEEN two probes — see the
     * interpolation in read(), which is the difference between hearing a beach at its real
     * distance and hearing it at the radius of whichever ring first went wet. */
    this._inner[0] = 0;
    for (let i = 1; i < PROBE_COUNT; i++) {
      const r = ((i - 1) / PROBE_DIRS) | 0;
      if (r === 0) {
        this._inner[i] = 0;
        continue;
      }
      const ux = this._ox[i] / PROBE_RINGS[r];
      const uz = this._oz[i] / PROBE_RINGS[r];
      let best = 0;
      let bestDot = -2;
      for (let d = 0; d < PROBE_DIRS; d++) {
        const j = 1 + (r - 1) * PROBE_DIRS + d;
        const dot = (this._ox[j] * ux + this._oz[j] * uz) / PROBE_RINGS[r - 1];
        if (dot > bestDot) {
          bestDot = dot;
          best = j;
        }
      }
      this._inner[i] = best;
    }
    this._cursor = 0;
    this._acc = 0;
    this._w = new Float32Array(BIOME_COUNT); // scratch for biome weights, reused

    /* The reading. One object, mutated in place — update() must not allocate. */
    this.seaDist = Infinity; // metres to the nearest water
    this.seaExtent = 0; // 0..1, how much of the surroundings is water
    this.seaRight = 0; // -1..1, sea bearing in the car's frame (+1 = starboard)
    this.trees = 0; // distance-weighted trees per hectare within earshot
    this.treeRight = 0; // -1..1, which side the wood is on
  }

  /** Sample one slot. Pure world lookup; no state beyond the arrays. */
  _probe(i, cx, cz) {
    const x = cx + this._ox[i];
    const z = cz + this._oz[i];
    const b = biomeWeights(x, z, this.seed, this._w);
    // waterLevelAt(w, -Infinity) always returns the blended plane rather than null, so this
    // is the plane's height whether or not the ground here happens to be under it.
    const plane = waterLevelAt(b.w, -Infinity);
    const land = landHeight(x, z, this.seed);
    // Freeboard: metres of dry ground above the water plane, signed. Kept rather than just
    // the sign of it because read() interpolates the waterline out of two of these.
    const fb = plane === null ? 1e9 : land - plane;
    const wet = fb < 0;
    this._px[i] = x;
    this._pz[i] = z;
    this._fb[i] = fb;
    this._wet[i] = wet ? 1 : 0;
    /* Trees per hectare the scatter WOULD place here: the biome's book figure times the
     * forest field. Same two terms world/scatter.js multiplies, so a wood you can hear is a
     * wood you can see. Underwater ground grows nothing. */
    this._trees[i] = wet ? 0 : forestDensity(x, z, this.seed) * blendScalar(b.w, BIOME_SCATTER, 'trees');
    this._live[i] = 1;
  }

  /** Fill every slot at once. For the diagnostics tool and for the first frame. */
  prime(cx, cz) {
    for (let i = 0; i < PROBE_COUNT; i++) this._probe(i, cx, cz);
    this._cursor = 0;
    this._acc = 0;
  }

  /**
   * Advance the rolling sweep and re-read the aggregate.
   * @param {number} dt seconds @param {number} cx,cz car position @param {number} yaw
   */
  update(dt, cx, cz, yaw) {
    this._acc += dt * PROBE_RATE;
    let n = Math.min(this._acc | 0, PROBE_MAX_PER_CALL);
    this._acc -= n;
    if (this._acc > PROBE_MAX_PER_CALL) this._acc = 0; // a stall dropped frames; do not chase it
    while (n-- > 0) {
      this._probe(this._cursor, cx, cz);
      this._cursor = (this._cursor + 1) % PROBE_COUNT;
    }
    this.read(cx, cz, yaw);
  }

  /**
   * Aggregate the probe set into the five numbers the mix wants.
   *
   * HANDEDNESS. Three.js puts +X on your LEFT when you look down +Z, so with the car's
   * forward being (sin yaw, cos yaw) — the convention placeAt() and the autopilot both use —
   * its starboard side is (-cos yaw, sin yaw). The right-hand component of a delta D is
   * therefore `D.z*sin - D.x*cos`, which is the same sign as car/autopilot.js's `lateral`
   * with the roles swapped (there the CAR is offset from the line; here the target is offset
   * from the car). Getting this backwards puts the sea out of the wrong window, and it is
   * exactly the bug this project has already paid for three times.
   */
  read(cx, cz, yaw) {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);

    let near = Infinity;
    let extW = 0;
    let extWet = 0;
    let bx = 0;
    let bz = 0;
    let bw = 0;
    let treeSum = 0;
    let treeW = 0;
    let tx = 0;
    let tz = 0;
    let tdw = 0;

    for (let i = 0; i < PROBE_COUNT; i++) {
      if (!this._live[i]) continue;
      const dx = this._px[i] - cx;
      const dz = this._pz[i] - cz;
      // sqrt, not hypot: hypot guards against overflow we cannot reach and costs several
      // times as much, and this runs 85 times a frame.
      const d = Math.sqrt(dx * dx + dz * dz);

      const we = 1 / (1 + (d / EXTENT_FALLOFF) * (d / EXTENT_FALLOFF));
      extW += we;
      if (this._wet[i]) {
        extWet += we;
        /* THE WATERLINE IS BETWEEN THE PROBES, NOT AT ONE.
         *
         * Taking the distance to the nearest wet SAMPLE reports the radius of whichever ring
         * first went wet, which is systematically too far: measured against a dense ray-march
         * on a real beach it read 95 m for a shore that was 68 m away and 40 m for one that
         * was 28 m away — a 40% overshoot, and always in the same direction, so the sea was
         * quietly wrong everywhere rather than noisily wrong somewhere.
         *
         * The fix costs one lerp. Freeboard is a signed height, so where a wet probe's
         * inward neighbour is dry the waterline sits where freeboard crosses zero, and linear
         * interpolation between the two puts it there to within the local slope. Terrain is
         * not linear over 30–120 m, so this is an estimate — but it is an estimate scattered
         * either side of the truth instead of a bound that is always long.
         */
        let dd = d;
        const j = this._inner[i];
        const fbj = this._fb[j];
        if (j !== i && this._live[j] && fbj > 0) {
          const t = clamp01(fbj / (fbj - this._fb[i]));
          const sx = this._px[j] + (this._px[i] - this._px[j]) * t - cx;
          const sz = this._pz[j] + (this._pz[i] - this._pz[j]) * t - cz;
          dd = Math.sqrt(sx * sx + sz * sz);
        }
        if (dd < near) near = dd;
        // Bearing: sum of unit vectors, weighted towards the near water. A broad coast then
        // reads as one direction instead of flickering between whichever probe is closest.
        const bwi = 1 / (1 + (d / BEARING_FALLOFF) * (d / BEARING_FALLOFF));
        const inv = d > 0.001 ? bwi / d : 0;
        bx += dx * inv;
        bz += dz * inv;
        bw += bwi;
      }

      const t = this._trees[i];
      const tw = 1 / (1 + (d / TREE_FALLOFF) * (d / TREE_FALLOFF));
      treeSum += t * tw;
      treeW += tw;
      if (t > 0 && d > 0.001) {
        /* Weighted by the TREES as well as by the distance, and normalised by the same
         * quantity below. Weighting by distance alone would drag the bearing towards the
         * middle whenever part of the ring is bare ground, which is precisely the case where
         * the wood is unambiguously on one side. */
        const twd = (t * tw) / d;
        tx += dx * twd;
        tz += dz * twd;
        tdw += t * tw;
      }
    }

    this.seaDist = near;
    this.seaExtent = extW > 0 ? extWet / extW : 0;
    this.trees = treeW > 0 ? treeSum / treeW : 0;

    // Bearings, in the car's frame. Length is clamped to 1: a direction that is agreed on by
    // every probe pans fully, one the probes disagree about sits nearer the middle, which is
    // the honest answer for water on both sides of the road.
    const bl = Math.sqrt(bx * bx + bz * bz);
    this.seaRight = bl > 1e-6 ? clamp((bz * fx - bx * fz) / bl, -1, 1) * clamp01(bl / (bw || 1)) : 0;
    const tl = Math.sqrt(tx * tx + tz * tz);
    this.treeRight = tl > 1e-6 ? clamp((tz * fx - tx * fz) / tl, -1, 1) * clamp01(tl / (tdw || 1)) : 0;
  }
}

/* ── the gain laws ───────────────────────────────────────────────────────────
 * Pure functions, exported so tools/diag-ambience.mjs can print a table of them and so the
 * numbers in that table are the numbers the game uses. A tunable nobody can measure is a
 * tunable that quietly stops being applied — this project has shipped two of those.
 */

/** How far away the sea can still be heard at all. Past this the layer is exactly zero.
 *  A little beyond the outermost probe ring (500 m) on purpose: the window term below then
 *  never has to do its fade at the exact radius where water first becomes detectable, which
 *  would put a step in the gain right where a coast comes into range. */
export const SEA_RANGE = 540;
/** Half-distance-ish. At SEA_D0 the level is about a third of its close-up value. */
const SEA_D0 = 95;
const SEA_POW = 1.35;
/** Peak gain of the surf bus, before ducking. The engine's wind layer peaks at 0.085. */
export const SEA_MAX = 0.075;

/**
 * Surf level for a distance and a size of water body.
 *
 * The rolloff is 1/(1+(d/d0)^1.35), not the inverse square a point source would give. A
 * shoreline is a LINE source kilometres long: its intensity falls roughly as 1/d, and the
 * exponent above sits just above that because air absorption takes the rest. Inverse square
 * would put the sea out of earshot in eighty metres, which is not how a beach works.
 *
 * `extent` is the share of the probed disc that is water, and it is why a farm pond does not
 * roar. It cannot go to zero — a stream you are driving beside should still trickle, and a
 * coast seen from far enough away covers very little of the disc however big it is — so it
 * only spans 0.5 to 1. Half the difference between a puddle and the sea, no more.
 */
export function seaGain(dist, extent = 1) {
  if (!(dist < SEA_RANGE)) return 0;
  const roll = 1 / (1 + Math.pow(dist / SEA_D0, SEA_POW));
  // Fade the last 18% of the range to nothing so a probe flipping wet at 539 m cannot click.
  const window = smoothstep(SEA_RANGE, SEA_RANGE * 0.82, dist);
  const size = lerp(0.5, 1, smoothstep(0.02, 0.22, extent));
  return SEA_MAX * roll * window * size;
}

/** Peak gain of one bird call. Kept under the surf: a bird is a detail, not an event. */
export const BIRD_MAX = 0.055;
/** Calls per second in a closed canopy. One every two seconds is a wood; more is an aviary. */
export const BIRD_RATE_MAX = 0.5;

/**
 * How loud a bird call is, from the trees-per-hectare within earshot.
 *
 * The biome table's book density is 26 trees/ha in meadow and the forest field multiplies
 * that up to 3.4x in a closed canopy, so ~26 is "an ordinary wood" and ~88 is "deep forest".
 * Saturating at 24 means an ordinary wood is already at full voice and the deep forest gets
 * its extra as RATE rather than as volume — more birds, not louder ones, which is what a
 * forest actually sounds like.
 */
export function birdGain(trees) {
  return BIRD_MAX * smoothstep(0.8, 24, trees);
}

/** Calls per second. Keeps climbing past the point the gain saturates. */
export function birdRate(trees) {
  return BIRD_RATE_MAX * Math.pow(clamp01(trees / 45), 0.75);
}

/**
 * The one rule this layer must never break: it is furniture behind the car and the radio.
 *
 * Speed does most of the work and does it honestly — at 120 km/h the wind layer alone is
 * louder than any bird, and pretending otherwise would just be two things shouting. The radio
 * term is the explicit part of the brief: a station playing takes a fixed bite out of both
 * layers so the music is never in a fight it has to win.
 *
 * @param {number} speed m/s @param {number} floor level at motorway speed @param {boolean} radio
 * @param {number} radioDuck multiplier applied while a station is playing
 */
export function duckFor(speed, floor, radio, radioDuck) {
  return lerp(1, floor, smoothstep(11, 40, Math.abs(speed))) * (radio ? radioDuck : 1);
}
const SEA_SPEED_FLOOR = 0.5;
const BIRD_SPEED_FLOOR = 0.2;
const SEA_RADIO_DUCK = 0.78;
const BIRD_RADIO_DUCK = 0.7;

/* ── bird calls ──────────────────────────────────────────────────────────────
 * Five shapes, chosen at random per call. Each is [notes, f1/f0 per note, note seconds,
 * gap seconds, tail seconds]. They are deliberately short and deliberately in the 2–4 kHz
 * band where a whistle reads as a small bird; anything lower is a pigeon and anything with a
 * hard attack is a car alarm.
 */
const CALLS = [
  [1, 1.28, 0.09, 0.0, 0.26], // a single rising cheep
  [2, 1.22, 0.07, 0.075, 0.2], // a two-note chirrup
  [3, 1.0, 0.055, 0.055, 0.16], // a flat trill
  [2, 0.72, 0.12, 0.1, 0.3], // a falling pair
  [4, 1.06, 0.045, 0.05, 0.14], // a fast chatter
];
const BIRD_VOICES = 4;

/**
 * The audio graph. Built once, by EngineAudio._ensureAmbience(), and connected to the
 * engine's MASTER gain — so the existing volume control (EngineAudio.setVolume, which sets
 * master.gain) already owns it. There is no second volume to forget about, turning the game
 * down turns the sea down, and a mute is a mute.
 */
export class Ambience {
  /** @param {AudioContext} ctx @param {GainNode} destination @param {AudioBuffer} noise */
  constructor(ctx, destination, noiseBuffer, seed) {
    this.ctx = ctx;
    this.field = new AmbienceField(seed);
    this._sea = 0; // smoothed gains, so a probe flipping is never a step
    this._birdG = 0;
    this._birdRate = 0;
    this._birdPhase = 0;
    this._nextThresh = 0.7;
    this._voice = 0;
    this._primed = false;

    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(destination);

    /* ── surf ──────────────────────────────────────────────────────────────
     * One noise source, shared with the engine's wind and tyre roar (it is the same buffer;
     * a second one would cost another two seconds of memory for no audible difference).
     * Two bands: a body that is always there and gets brighter as you approach, and a break
     * that only exists inside about 220 m of open water. */
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    src.start();
    this.noise = src;

    /* THE HIGH-PASS IS NOT COSMETIC. The shared noise buffer is deliberately bass-heavy —
     * white through a one-pole at about 76 Hz, times 3.5, plus a quarter of the raw white —
     * so a plain low-pass on it does not give surf, it gives a sub-bass rumble. And 26 to
     * 74 Hz is exactly where engine.js puts the engine's fundamental, on purpose, because
     * that is the band you feel rather than hear. A sea sitting in it would mud the one cue
     * the player actually steers by. So: cut below 150 Hz, then open the top with distance.
     * Q at 0.707 on both, which is the flat-passband setting — a resonant peak on noise is a
     * whistle, and this project has already been told once that it sounded like bees. */
    this.seaHP = ctx.createBiquadFilter();
    this.seaHP.type = 'highpass';
    this.seaHP.frequency.value = 150;
    this.seaHP.Q.value = 0.707;

    this.seaLow = ctx.createBiquadFilter();
    this.seaLow.type = 'lowpass';
    this.seaLow.frequency.value = 420;
    this.seaLow.Q.value = 0.707;

    /* The break. Above about 1 kHz the shared buffer is flat white at a quarter amplitude,
     * roughly 11 dB under the body band, so this needs a healthy gain to be heard at all —
     * it is not as loud as the number looks. */
    this.seaHiss = ctx.createBiquadFilter();
    this.seaHiss.type = 'bandpass';
    this.seaHiss.frequency.value = 1500;
    this.seaHiss.Q.value = 0.65;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;

    /* The swell. Two sub-audio sines at 12.0 s and 19.2 s. The periods are picked to share no
     * small common factor, so the combined envelope does not come back round inside any drive
     * anyone will take — a swell you can hear repeating is a loop, and a loop is the thing
     * this whole file exists to avoid. This is the single term that makes filtered noise
     * sound like water rather than like wind. */
    this.swell = ctx.createGain();
    this.swell.gain.value = 0.68;
    this.lfoDepth = [];
    for (const [hz, depth] of [
      [0.0833, 0.22],
      [0.0521, 0.13],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(this.swell.gain);
      o.start();
      this.lfoDepth.push({ g, depth });
    }

    this.seaGainNode = ctx.createGain();
    this.seaGainNode.gain.value = 0;
    this.seaPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    src.connect(this.seaHP);
    this.seaHP.connect(this.seaLow).connect(this.swell);
    this.seaHP.connect(this.seaHiss).connect(this.hissGain).connect(this.swell);
    this.swell.connect(this.seaGainNode);
    if (this.seaPan) this.seaGainNode.connect(this.seaPan).connect(this.out);
    else this.seaGainNode.connect(this.out);

    /* ── birds ─────────────────────────────────────────────────────────────
     * A fixed pool of four voices. The oscillators start now and never stop; a call is a
     * handful of automation events on a running oscillator, so firing one allocates NOTHING —
     * no node, no buffer, no array. Four is enough that a call is never cut off by the next
     * one: the fastest rate here is one call every two seconds and a call lasts under half a
     * second. */
    this.birdBus = ctx.createGain();
    this.birdBus.gain.value = 1;
    this.birdBus.connect(this.out);
    this.voices = [];
    for (let i = 0; i < BIRD_VOICES; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 3000;
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (p) o.connect(g).connect(p).connect(this.birdBus);
      else o.connect(g).connect(this.birdBus);
      o.start();
      this.voices.push({ o, g, p });
    }
  }

  /**
   * @param {number} dt seconds
   * @param {object} car the vehicle — x, z, yaw, speed
   * @param {boolean} radioOn true while a station is playing
   */
  update(dt, car, radioOn) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    if (!this._primed) {
      // One full sweep on the first running frame, so you do not drive out of a bay in
      // silence while the rolling scan catches up.
      this.field.prime(car.x, car.z);
      this._primed = true;
    }
    const f = this.field;
    f.update(dt, car.x, car.z, car.yaw);

    const t = ctx.currentTime;
    const k = 0.35; // slow: this layer is scenery, it must never snap

    /* SEA. The gain law is seaGain() — the same function tools/diag-ambience.mjs tabulates.
     * Damped in JS as well as smoothed in the graph, because the probe set is discrete and
     * the nearest wet sample can jump a whole ring in one step. */
    const seaTarget = seaGain(f.seaDist, f.seaExtent) * duckFor(car.speed, SEA_SPEED_FLOOR, radioOn, SEA_RADIO_DUCK);
    this._sea = damp(this._sea, seaTarget, 1.6, dt);
    this.seaGainNode.gain.setTargetAtTime(this._sea, t, k);

    /* Closer water is brighter water, and OPEN water is brighter than a still pond: the hiss
     * band is a wave breaking, which a marsh does not do. Both terms, or a causeway over a
     * wetland gets surf. */
    const close = clamp01(1 - f.seaDist / 220);
    const open = smoothstep(0.04, 0.3, f.seaExtent);
    this.seaLow.frequency.setTargetAtTime(420 + close * 1700, t, k);
    this.hissGain.gain.setTargetAtTime(0.8 * close * close * open, t, k);
    // A still pond barely swells; a bay does. Depth rides on the same openness term.
    // Indexed, not for-of: this runs every frame and an iterator is an allocation the engine
    // is only usually clever enough to remove.
    for (let i = 0; i < this.lfoDepth.length; i++) {
      const l = this.lfoDepth[i];
      l.g.gain.setTargetAtTime(l.depth * lerp(0.3, 1, open), t, k);
    }
    if (this.seaPan) {
      // Never hard-panned: a sea is wide, and the wider it is the more it surrounds you.
      this.seaPan.pan.setTargetAtTime(f.seaRight * 0.8 * (1 - 0.5 * f.seaExtent), t, 0.25);
    }

    /* BIRDS. Rate and gain both come out of the trees within earshot; ducking hits the gain
     * only, so at speed the birds thin in volume rather than disappearing, which is what it
     * is like with a window open. */
    const duck = duckFor(car.speed, BIRD_SPEED_FLOOR, radioOn, BIRD_RADIO_DUCK);
    this._birdG = damp(this._birdG, birdGain(f.trees) * duck, 1.2, dt);
    this._birdRate = damp(this._birdRate, birdRate(f.trees), 1.2, dt);

    /* WHEN THE NEXT BIRD SINGS.
     *
     * A phase that advances at the current rate, not a countdown in seconds. The obvious
     * version — pick a wait of (1/rate) seconds and count down — is wrong at exactly the
     * moment that matters: you set a 30 second wait out on the steppe, then drive into a
     * wood, and the wood is silent for the rest of that wait. Measured, it cost 12 calls
     * where there should have been 25. Integrating the rate instead means a wood starts
     * singing as soon as you are in it, and a rate of zero simply stops the clock rather than
     * banking up a burst to let off the moment a tree appears.
     *
     * The threshold averages 1.0 so birdRate() means calls per second and nothing else; the
     * spread around it is what stops the calls sounding like a metronome.
     */
    this._birdPhase += dt * this._birdRate;
    if (this._birdPhase >= this._nextThresh) {
      this._birdPhase = 0;
      this._nextThresh = 0.35 + Math.random() * 1.3;
      if (this._birdG > 0.0015) this._call(f.treeRight);
    }
  }

  /** Fire one call on the next voice. Zero allocation: automation on a running oscillator. */
  _call(right) {
    const ctx = this.ctx;
    const v = this.voices[this._voice];
    this._voice = (this._voice + 1) % BIRD_VOICES;

    const c = CALLS[(Math.random() * CALLS.length) | 0];
    const notes = c[0];
    const ratio = c[1];
    const dur = c[2];
    const gap = c[3];
    const tail = c[4];
    // 2.1–3.9 kHz. Each call picks one bird and stays with it.
    const f0 = 2100 + Math.random() * 1800;
    const peak = this._birdG * (0.7 + Math.random() * 0.5);

    const now = ctx.currentTime + 0.02;
    v.o.frequency.cancelScheduledValues(now);
    v.g.gain.cancelScheduledValues(now);
    v.g.gain.setValueAtTime(0, now);
    if (v.p) {
      // Birds are individuals, not a wall: each call is offset from the wood's bearing so
      // they scatter across the trees instead of stacking on one point.
      v.p.pan.setValueAtTime(clamp(right * 0.85 + (Math.random() - 0.5) * 0.5, -1, 1), now);
    }

    let at = now;
    for (let i = 0; i < notes; i++) {
      // A little pitch drift between notes of the same call — a bird is not a synthesiser.
      const fa = f0 * (1 + (Math.random() - 0.5) * 0.06);
      v.o.frequency.setValueAtTime(fa, at);
      v.o.frequency.exponentialRampToValueAtTime(fa * ratio, at + dur);
      v.g.gain.setValueAtTime(0, at);
      v.g.gain.linearRampToValueAtTime(peak, at + 0.012);
      // Down to 1e-5, not to 0: an exponential ramp to zero is illegal, and a linear one
      // gives the flat-topped decay of a beep rather than the ring-off of a whistle.
      v.g.gain.exponentialRampToValueAtTime(1e-5, at + dur + tail);
      at += dur + tail * 0.45 + gap;
    }
  }

  /** Sub-mix trim. The real volume control is EngineAudio's master gain, upstream of this. */
  setVolume(v) {
    if (this.out) this.out.gain.setTargetAtTime(clamp01(v), this.ctx.currentTime, 0.2);
  }
}
