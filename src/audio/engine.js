/* Wanderoad — sound.
 *
 * Entirely synthesised. There are no audio files in this project, which keeps the whole game
 * a few hundred kilobytes and means the engine note is a genuine function of rpm rather than
 * a loop being pitch-shifted.
 *
 * The mix is built for cruising, not for racing. At a steady 90 km/h you should mostly hear
 * wind and tyre roar; the engine only asserts itself when you ask it to. The one thing that
 * is deliberately loud is the tyre scrub, because a browser game has no force feedback and
 * "you never know how close you are to losing grip" is the single most damning thing said
 * about the game we are learning from. Sound is our only channel for that.
 *
 * WebAudio will not start until the user gestures at the page, so everything here is lazy
 * and silent-safe: calling update() before the first click does nothing and throws nothing.
 */

import { clamp, clamp01, lerp } from '../core/math.js';
import { ENGINE_VOICE } from '../game/garage.js';
import { Radio } from './radio.js';
import { Ambience } from './ambience.js';

export class EngineAudio {
  /**
   * @param {number} [seed] the world seed, so the ambience layer can ask the worldgen where
   *        the water and the woods are. Optional: if it is not passed the first update()
   *        takes it off `car.terrain.seed` instead, which is the same number. That fallback
   *        is not defensive programming for its own sake — this class is constructed in
   *        main.js, which several people edit, and a positional mix that goes silent because
   *        one argument got dropped in a merge would be a very quiet kind of bug to find.
   */
  constructor({ volume = 0.38, seed = null } = {}) {
    this.ctx = null;
    this.volume = volume;
    this.seed = seed;
    this.enabled = true;
    this._started = false;
    this._limitSmooth = 0;
    // Autoplay policy: the context can only start inside a user gesture, so arm one.
    const arm = () => this.start();
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
      addEventListener(ev, arm, { once: true, passive: true });
    }
  }

  start() {
    if (this._started || !this.enabled) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this._started = true;
    const ctx = (this.ctx = new AC());

    const master = (this.master = ctx.createGain());
    master.gain.value = this.volume;
    master.connect(ctx.destination);

    /* ── engine ────────────────────────────────────────────────────────────
     * Three sawtooths an octave apart plus a sub sine. Real engines are a comb of
     * harmonics of the firing frequency; three is enough to read as an engine and cheap
     * enough to keep on permanently. */
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 420;
    engFilter.Q.value = 0.8;
    this.engFilter = engFilter;
    this.engGain.connect(engFilter).connect(master);

    this.oscs = [];
    for (const [type, mul, gain] of [
      ['sawtooth', 0.5, 0.5],
      ['sawtooth', 1.0, 0.34],
      ['triangle', 2.0, 0.06],
      ['sine', 0.25, 0.42],
    ]) {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(this.engGain);
      o.start();
      this.oscs.push({ o, mul });
    }

    /* ── wind + tyre roar ─────────────────────────────────────────────────
     * One noise buffer, two filters. Wind is a wide band that opens with speed; tyre roar
     * is a narrow resonant band whose centre frequency tracks wheel speed, which is what
     * makes a coarse surface sound different from tarmac. */
    const noise = ctx.createBufferSource();
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Pink-ish noise: white through a cheap one-pole, so it does not hiss.
    let b0 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99 * b0 + 0.01 * w;
      d[i] = b0 * 3.5 + w * 0.25;
    }
    noise.buffer = buf;
    noise.loop = true;
    noise.start();
    this.noise = noise;
    // Kept so the ambience layer can run its surf off the same two seconds of noise rather
    // than generating and holding a second copy.
    this._noiseBuf = buf;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 700;
    this.windFilter.Q.value = 0.5;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noise.connect(this.windFilter).connect(this.windGain).connect(master);

    this.roadFilter = ctx.createBiquadFilter();
    this.roadFilter.type = 'bandpass';
    this.roadFilter.frequency.value = 180;
    this.roadFilter.Q.value = 1.6;
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    noise.connect(this.roadFilter).connect(this.roadGain).connect(master);

    /* ── tyre scrub — the limit cue ──────────────────────────────────────── */
    this.scrubFilter = ctx.createBiquadFilter();
    this.scrubFilter.type = 'bandpass';
    this.scrubFilter.frequency.value = 1100;
    this.scrubFilter.Q.value = 2.6;
    this.scrubGain = ctx.createGain();
    this.scrubGain.gain.value = 0;
    noise.connect(this.scrubFilter).connect(this.scrubGain).connect(master);

    /* The radio. Generative and original — no recording is bundled, so there is no licence
     * riding along with the game. Starts off; the player turns it on. */
    this.radio = new Radio(ctx, master);
  }

  /**
   * Build the positional ambience graph. Called from update(), not from start(), for one
   * reason: it needs the world seed and start() runs inside a raw DOM event that knows
   * nothing about the game. It runs EXACTLY ONCE — the `this.ambience` guard is the whole
   * mechanism, and `_ambienceBuilds` exists so a test can assert it rather than believe it.
   */
  _ensureAmbience(car) {
    if (this.ambience || !this._noiseBuf) return;
    const seed = this.seed ?? car?.terrain?.seed;
    if (seed === undefined || seed === null) return;
    // Hangs off `master`, so setVolume() and any future mute already own it and there is no
    // second volume control to keep in step.
    this.ambience = new Ambience(this.ctx, this.master, this._noiseBuf, seed);
    this._ambienceBuilds = (this._ambienceBuilds || 0) + 1;
  }

  /** @param {Vehicle} car */
  update(dt, car) {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'suspended') return;
    const t = ctx.currentTime;
    const k = 0.06; // one setTargetAtTime constant for everything, so nothing pops

    const speed = Math.abs(car.speed);
    const rpmFrac = clamp01((car.rpm - 900) / (car.spec.redline - 900));

    /* THE PITCH. The first live build was described as "way too high pitched and strong",
     * "like you're attacked with bees", and it was: 34 Hz rising to 152 Hz puts the whole
     * engine in the ear's most sensitive band and keeps it there. A real engine's fundamental
     * at 6000 rpm on a four-cylinder is about 200 Hz, but you do not HEAR the fundamental —
     * you hear the low harmonics through a car body. So the range is now 26 to 74 Hz, which
     * is felt more than heard, and the sawtooth harmonics do the rest. */
    /* PER CAR. The 26/48 pair is the shape of an engine note; `voice.pitch` is which engine it is.
     * Read from the fleet entry the car is actually running (game/garage.js's engineVoice), so the
     * sound and the car cannot disagree, and a car with no spec falls back to the old global note. */
    const voice = ENGINE_VOICE;
    const base = (26 + rpmFrac * 48) * voice.pitch;
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(base * mul, t, k);

    // Off throttle the engine gets quieter AND darker — that is most of what makes a
    // lift-off audible.
    const load = clamp01(car.throttle * 0.85 + rpmFrac * 0.3);
    // Quieter, and much darker. The low-pass used to open to 3.9 kHz under load, which is
    // where the bees lived.
    this.engGain.gain.setTargetAtTime(0.032 + load * 0.10, t, k);
    // The same voice opens the filter: a bigger engine is darker as well as lower, which is what
    // stops a deep note simply sounding like the same note played slowly.
    this.engFilter.frequency.setTargetAtTime((260 + load * 640 + rpmFrac * 240) * voice.timbre, t, k);

    // Wind starts to matter around 55 km/h and dominates by 200.
    // Wind is the one layer allowed to grow with speed, because it is broadband and calm.
    // Even so it is half what it was, and its band no longer climbs into a whistle.
    const windAmt = Math.pow(clamp01((speed - 15) / 60), 1.4);
    this.windGain.gain.setTargetAtTime(windAmt * 0.085, t, k);
    this.windFilter.frequency.setTargetAtTime(330 + speed * 4.5, t, k);

    // Tyre roar tracks wheel speed and gets rougher off tarmac.
    const rough = car.surfaceKind === 'tarmac' ? 0.35 : 1.0;
    this.roadGain.gain.setTargetAtTime(clamp01(speed / 26) * 0.062 * (0.6 + rough), t, k);
    this.roadFilter.frequency.setTargetAtTime(78 + speed * 3.2, t, k);
    this.roadFilter.Q.setTargetAtTime(lerp(2.4, 0.9, rough), t, k);

    // The limit cue. Nothing below 0.72 — a constant hint of scrub would be noise, and a
    // cue that is always on is not a cue.
    this._limitSmooth = lerp(this._limitSmooth, car.limit, Math.min(1, dt * 12));
    const scrub = clamp01((this._limitSmooth - 0.72) / 0.28);
    // The scrub is a warning, so it stays audible — but 2.4 kHz with Q 5.5 was a shriek.
    this.scrubGain.gain.setTargetAtTime(scrub * scrub * 0.10 * clamp01(speed / 8), t, 0.03);
    this.scrubFilter.frequency.setTargetAtTime(900 + scrub * 620, t, k);

    // The station thins out when the driving gets busy, and comes back when it calms down.
    if (this.radio) {
      const calm = clamp01(1 - Math.max(car.limit, Math.abs(car.slip) / 0.5) * 1.2);
      this.radio.update(dt, calm);
    }

    /* The place, as opposed to the car: surf near water, birds near trees. It is told
     * whether a station is playing so it can get out of the way of it — see duckFor() in
     * audio/ambience.js. */
    this._ensureAmbience(car);
    if (this.ambience) this.ambience.update(dt, car, this.radio ? this.radio.on : false);
  }

  /** Cycle the station. Returns its label for the HUD. */
  nextStation() {
    this.start();
    return this.radio ? this.radio.next() : 'no audio';
  }

  /** A short soft double note. Cozy game, cozy horn. */
  horn() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, delay] of [
      [392, 0],
      [523.25, 0.11],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(0.16, t + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.42);
      o.connect(g).connect(this.master);
      o.start(t + delay);
      o.stop(t + delay + 0.5);
    }
  }

  /** Hitting something. A thud, not a crash — nobody wants a car crash in a cozy game. */
  thump(strength = 0.5) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140 + 90 * strength, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.24);
    const g = ctx.createGain();
    g.gain.setValueAtTime(clamp(strength, 0.05, 1) * 0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.34);
  }

  /** A short, soft note for the moment autopilot takes the wheel — confirmation, not an alarm,
   *  so it settles DOWN in pitch rather than rising the way chime() does for a milestone. Fires
   *  once per activation only: the one call site is Autopilot.toggle() in car/autopilot.js,
   *  guarded there so it never fires on the way off and never fires from inside update()'s
   *  per-frame path. */
  ping() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(587.33, t); // D5
    o.frequency.exponentialRampToValueAtTime(493.88, t + 0.5); // ...down to B4 — letting go of the wheel
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.65);
  }

  /**
   * Picking up a can of fuel. A clear, positive, unmistakable little arpeggio.
   *
   * NOTE ON HISTORY: this file briefly carried TWO pickup() methods — two agents built the
   * same backlog line in the same hour, and in a JS class the second definition silently wins,
   * so the first was dead code that read as live. One source of truth: this is the one, the
   * duplicate was deleted, and the caller (src/main.js's `collectCans`) reaches this.
   *
   * Playtest report, verbatim: "a clear, positive pick-up sound when you collect a fuel can",
   * and the audit found the pickup wired as `collectCans: () => props.drainCollectedFuel()`
   * with no audio call anywhere near it — seven cans collected live through the real path and
   * not one sound function invoked. This is that sound.
   *
   * SYNTHESISED, like every other sound in this game. There are no audio files in this
   * project and there will not be one for this: the operator offered credentials for a
   * sound-effects service and the answer is that the WebAudio graph two lines above already
   * makes an engine, a radio, surf and birdsong out of oscillators, so a three-note chime is
   * not the thing to break that for.
   *
   * WHY IT IS DIFFERENT FROM chime() AND ping(), all three of which live in this file:
   *   ping()   settles DOWN (D5 -> B4) — "you have let go of the wheel".
   *   chime()  is two notes rising, soft and slow — a milestone, seen out of the corner of
   *            the eye while driving.
   *   pickup() is three notes rising fast (E5 - B5 - E6, an open fifth then the octave) with
   *            a short bright attack. It is an EVENT: it happened just now, it happened
   *            because of something you did, and it is over in under half a second. That is
   *            what makes a collect sound read as a collect sound rather than as ambience.
   *
   * Loudness is deliberately just above chime() and well under the horn: at 0.115 peak it
   * carries over engine and wind at cruise without ever being the loudest thing in the mix.
   * Cozy is the filter; this is bright, not loud.
   */
  pickup() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, delay, gain] of [
      [659.25, 0, 0.085],    // E5
      [987.77, 0.075, 0.100], // B5
      [1318.51, 0.15, 0.115], // E6 — the top of the arpeggio is the one you actually notice
    ]) {
      const o = ctx.createOscillator();
      // Triangle rather than sine: one extra odd harmonic is the difference between a note
      // that sits under the tyre roar and one that sits on top of it, at the same peak gain.
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(gain, t + delay + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.34);
      o.connect(g).connect(this.master);
      o.start(t + delay);
      o.stop(t + delay + 0.4);
    }
    /* Diagnostics only — tools and the live probe read this to prove the sound was actually
     * invoked on a real collection rather than believe a code path. Never read by the game. */
    this.pickups = (this.pickups || 0) + 1;
  }

  /**
   * A gold sun. Short, bright, TWO notes rather than pickup()'s three — a lighter touch, so
   * the two are never confused mid-drive even though a sun is collected far more often than a
   * fuel can. Same triangle-oscillator shape as pickup(), a faster decay (0.22 s vs 0.34 s):
   * suns come in clusters (world/loot.js), so several of these can overlap in under a second
   * and each one needs to be OVER before the next lands, not ring into it.
   */
  sun() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, delay, gain] of [
      [880.0, 0, 0.07], // A5
      [1318.51, 0.05, 0.085], // E6
    ]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(gain, t + delay + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.22);
      o.connect(g).connect(this.master);
      o.start(t + delay);
      o.stop(t + delay + 0.26);
    }
    /* Diagnostics only, same idea as pickup()'s own `this.pickups` counter. */
    this.suns = (this.suns || 0) + 1;
  }

  /**
   * A diamond. Three notes like pickup()'s arpeggio, but sine rather than triangle and a slow
   * 0.1 s stagger rather than a fast rise — gems are rare and only ever found by boat, so this
   * is unhurried where pickup() and sun() are both quick, a shimmer rather than a chime.
   */
  gem() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, delay, gain] of [
      [987.77, 0, 0.065], // B5
      [1479.98, 0.1, 0.08], // F#6
      [1975.53, 0.2, 0.09], // B6
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(gain, t + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.6);
      o.connect(g).connect(this.master);
      o.start(t + delay);
      o.stop(t + delay + 0.65);
    }
    this.gems = (this.gems || 0) + 1;
  }

  /** A soft two-note rise. Used once per streak milestone and never otherwise. */
  chime() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [
      [659.25, 0],
      [987.77, 0.14],
    ].forEach(([f, delay]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(0.09, t + delay + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.9);
      o.connect(g).connect(this.master);
      o.start(t + delay);
      o.stop(t + delay + 1);
    });
  }

  setVolume(v) {
    this.volume = clamp01(v);
    if (this.master) this.master.gain.value = this.volume;
  }

  dispose() {
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
