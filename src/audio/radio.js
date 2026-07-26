/* Wanderoad — the radio.
 *
 * Generative, original, and endless. Nothing is sampled and no recording is bundled: the
 * station composes itself from a small set of rules, which means it never repeats, never
 * needs a download, and carries no licence with it at all.
 *
 * The design is deliberately plain, because the music is furniture. A slow chord pad, a
 * sparse bell that picks notes out of the same chord, and a very quiet low drone. Everything
 * is in one pentatonic scale so nothing can ever clash, chords change roughly every twenty
 * seconds, and the whole thing sits about twelve decibels under the wind. If you notice it,
 * it is too loud.
 *
 * Two stations, because a long drive through five biomes wants more than one mood, and a
 * dial you can turn is worth more than a soundtrack you cannot.
 */

import { clamp01, lerp } from '../core/math.js';

/* Scale degrees as semitone offsets. Both are pentatonic — five notes, no semitone clashes,
 * and every combination of them is consonant. That is what lets the sequencer choose notes
 * at random and still never sound wrong. */
const SCALES = {
  // warm major pentatonic: meadow, steppe, plains
  open: [0, 2, 4, 7, 9],
  // minor pentatonic: highlands, wetland, night
  still: [0, 3, 5, 7, 10],
};

/* Chord roots as scale steps, looping. Slow and unhurried — a change every ~20 s. */
const PROGRESSIONS = {
  open: [0, 3, 4, 2],
  still: [0, 4, 2, 3],
};

export const STATIONS = [
  { id: 'off', label: 'Radio off', scale: null },
  { id: 'valley', label: 'Valley', scale: 'open', root: 55, chordSecs: 22, bellRate: 0.16, drone: 0.5 },
  { id: 'longway', label: 'The Long Way', scale: 'still', root: 51.9, chordSecs: 26, bellRate: 0.1, drone: 0.7 },
];

const semi = (hz, n) => hz * Math.pow(2, n / 12);

export class Radio {
  /** @param {AudioContext} ctx @param {GainNode} destination */
  constructor(ctx, destination, { volume = 0.5 } = {}) {
    this.ctx = ctx;
    this.station = 0;
    this._t = 0;
    this._chordT = 1e9;
    this._bellT = 0;
    this._chord = 0;

    this.out = ctx.createGain();
    this.out.gain.value = 0;
    // A gentle low-pass over everything: the radio should sound like it is coming from the
    // dashboard of a car, not from a monitor.
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 1600;
    this.tone.Q.value = 0.4;
    this.out.connect(this.tone).connect(destination);

    // A long, cheap reverb: one noise burst with an exponential decay. Two seconds of tail
    // is the difference between "synth" and "room".
    const len = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
    }
    this.verb = ctx.createConvolver();
    this.verb.buffer = ir;
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.55;
    this.verb.connect(this.verbGain).connect(this.tone);

    this.volume = volume;
  }

  get label() {
    return STATIONS[this.station].label;
  }

  next() {
    this.station = (this.station + 1) % STATIONS.length;
    const on = STATIONS[this.station].scale !== null;
    this.out.gain.setTargetAtTime(on ? this.volume * 0.16 : 0, this.ctx.currentTime, 0.5);
    this._chordT = 1e9; // change chord immediately so the new station announces itself
    return this.label;
  }

  setVolume(v) {
    this.volume = clamp01(v);
    if (STATIONS[this.station].scale) {
      this.out.gain.setTargetAtTime(this.volume * 0.16, this.ctx.currentTime, 0.3);
    }
  }

  /** One soft voice: a triangle through its own envelope, partly into the reverb. */
  _voice(freq, when, dur, gain, type = 'triangle', detune = 0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + dur * 0.34);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g);
    g.connect(this.out);
    g.connect(this.verb);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  /**
   * @param {number} dt seconds
   * @param {number} calm 0..1 — 1 when cruising gently, 0 when being thrown about. The
   *        station thins out when you are busy, because music competing with a corner is
   *        the opposite of cozy.
   */
  update(dt, calm = 1) {
    const st = STATIONS[this.station];
    if (!st.scale) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    this._t += dt;
    this._chordT += dt;
    this._bellT += dt;

    const scale = SCALES[st.scale];
    const prog = PROGRESSIONS[st.scale];

    if (this._chordT >= st.chordSecs) {
      this._chordT = 0;
      this._chord = (this._chord + 1) % prog.length;
      const rootStep = prog[this._chord];
      const now = ctx.currentTime + 0.05;
      const dur = st.chordSecs * 1.25;

      // The pad: root, third-of-the-scale and fifth-of-the-scale, an octave apart, each
      // slightly detuned against itself so it breathes.
      for (const [step, oct, g] of [
        [rootStep, 0, 0.16],
        [(rootStep + 2) % scale.length, 0, 0.11],
        [(rootStep + 4) % scale.length, 1, 0.08],
      ]) {
        const f = semi(st.root, scale[step] + 12 * oct);
        this._voice(f, now, dur, g, 'triangle', -5);
        this._voice(f, now, dur, g * 0.8, 'triangle', +6);
      }
      // A drone two octaves down, felt rather than heard.
      this._voice(semi(st.root, scale[rootStep] - 12), now, dur, 0.09 * st.drone, 'sine');
    }

    // The bell: one note at a time, from the same scale, never on a grid. Rate falls away
    // when the driving gets busy.
    const rate = st.bellRate * lerp(0.25, 1, clamp01(calm));
    if (this._bellT > 1 / Math.max(rate, 0.01)) {
      this._bellT = 0;
      const rootStep = PROGRESSIONS[st.scale][this._chord];
      const pick = scale[(rootStep + ((Math.random() * scale.length) | 0)) % scale.length];
      const oct = 12 * (1 + ((Math.random() * 2) | 0));
      this._voice(semi(st.root, pick + oct), ctx.currentTime + 0.02, 3.4, 0.055, 'sine');
    }
  }
}
