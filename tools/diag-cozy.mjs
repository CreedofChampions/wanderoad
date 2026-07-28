/* Wanderoad — acceptance measurements for the CAR / FUEL / STREAK / HUD round.
 *
 *   node tools/diag-cozy.mjs [seed]
 *
 * Every one of these was marked PARTIAL, MISSING or BROKEN by an audit that drove the real game
 * in a real browser, so every check here measures the THING, from the real class, never a
 * constant's existence:
 *
 *   1. auto-drive burns no fuel and accrues no streak — both driven for a real minute, both
 *      branches, and compared against the identical minute with auto off
 *   2. auto-drive's stuck detector actually fires against a deliberately wedged car
 *   3. fuel cans are bigger and glowing — the real baked geometry's bounding box and its EMIT
 *      vertex count, plus the halo sprite and the litter bin beside it
 *   4. the pick-up sound is real synthesis wired to the real collection path — a stub
 *      AudioContext counts the oscillators EngineAudio.pickup() actually creates
 *   5. off-road spray emits off the road, does not on it, and is bounded
 *
 * No browser. What this canNOT prove is that any of it is PRETTY — see the note printed at the
 * end.
 */

import { Object3D } from 'three';

// localStorage: Streak and Fuel both persist, and node has none.
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
};

const { Streak } = await import('../src/game/streak.js');
const { Fuel } = await import('../src/game/fuel.js');
const { Autopilot } = await import('../src/car/autopilot.js');
const { Spray } = await import('../src/game/spray.js');
const { EngineAudio } = await import('../src/audio/engine.js');
const { Props, CAN_SCALE } = await import('../src/render/props.js');
const { CAN_HOVER, CAN_RADIUS } = await import('../src/world/props.js');

const SEED = (parseInt(process.argv[2] ?? '', 10) || 20260726) >>> 0;
let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(52)} ${String(got).padStart(16)}   want ${want}`);
};

/* ── 1. auto-drive burns no fuel and accrues no streak ─────────────────────────
 * The audit measured, in the live game: streak 33 -> 524 m in 60 s of auto-drive, and fuel
 * 0.703 -> 0.649 over the same minute. Both should now be flat, and — this is the half that is
 * easy to get wrong — the SAME minute with auto off must still move both, or the "fix" is just
 * a broken fuel system.
 */
console.log('\n── auto-drive: no fuel, no streak ────────────────────────────────────────────');
{
  const minute = (paused) => {
    const car = { speed: 33, throttle: 0.6, onGround: true, onRoad: 1, onRoadMin: 1, vy: 0 };
    const fuel = new Fuel({ start: 0.72, mercyKey: 'diag.cozy.mercy' });
    const streak = new Streak({ storageKey: `diag.cozy.streak.${paused}` });
    const dt = 1 / 60;
    for (let i = 0; i < 60 / dt; i++) {
      fuel.update(dt, car, { burn: !paused });
      streak.update(dt, car, { onRoad: 1 }, { paused });
    }
    return { fuel: fuel.fraction, streak: streak.distance, free: fuel.stats.freeSeconds, burned: fuel.stats.burned };
  };
  const off = minute(false);
  const on = minute(true);
  console.log(`       auto OFF: fuel 0.720 -> ${off.fuel.toFixed(4)}, streak ${off.streak.toFixed(0)} m`);
  console.log(`       auto ON : fuel 0.720 -> ${on.fuel.toFixed(4)}, streak ${on.streak.toFixed(0)} m`);
  check(on.streak === 0, 'streak accrued over 60 s of auto-drive (m)', on.streak.toFixed(1), 'exactly 0');
  check(Math.abs(on.fuel - 0.72) < 1e-9, 'tank after 60 s of auto-drive', on.fuel.toFixed(6), '0.720000 (unchanged)');
  check(on.burned === 0, 'fuel burned over 60 s of auto-drive (s of cruise)', on.burned.toFixed(4), 'exactly 0');
  check(on.free > 59 && on.free < 61, 'and it is COUNTED as free, not silently skipped', on.free.toFixed(1), '~60 s');
  // The control. Without these two the checks above would pass on a fuel system that had simply
  // stopped working — which is the failure mode a gate like this actually has.
  check(off.streak > 1900, 'CONTROL: the same minute with auto OFF still accrues streak', `${off.streak.toFixed(0)} m`, '> 1900 m');
  check(off.fuel < 0.70, 'CONTROL: ...and still burns fuel', off.fuel.toFixed(4), '< 0.700');
}

/* A frozen streak must also SURVIVE. Freezing by resetting to zero would satisfy "no streak
 * accrues" and quietly cost a player eighty kilometres for taking their hands off the wheel. */
{
  const car = { speed: 33, onGround: true, onRoad: 1, onRoadMin: 1 };
  const s = new Streak({ storageKey: 'diag.cozy.streak.survive' });
  for (let i = 0; i < 60 * 60; i++) s.update(1 / 60, car, { onRoad: 1 });
  const built = s.distance;
  // ...now hand the wheel over, and drive straight off the road while it is frozen.
  for (let i = 0; i < 60 * 10; i++) s.update(1 / 60, car, { onRoad: 0 }, { paused: true });
  const held = s.distance;
  for (let i = 0; i < 60 * 5; i++) s.update(1 / 60, car, { onRoad: 1 });
  check(built > 1900, 'a streak was built to freeze', `${built.toFixed(0)} m`, '> 1900 m');
  check(Math.abs(held - built) < 1e-9, 'ten off-road seconds under auto-drive did NOT break it', `${held.toFixed(0)} m`, 'unchanged');
  check(s.distance > held, '...and it resumes accruing when you take the wheel back', `${s.distance.toFixed(0)} m`, `> ${held.toFixed(0)}`);
  check(s.paused === false, 'and the paused flag clears', String(s.paused), 'false');
}

/* ── 2. the stuck detector, against a deliberately wedged car ──────────────────
 * The audit never saw this fire, which is not the same as it not working — a car has to be
 * genuinely pinned for STUCK_TIMEOUT (3.5 s) for it to have anything to do. So: wedge one.
 */
console.log('\n── auto-drive: the stuck reset, wedged on purpose ────────────────────────────');
{
  let recovered = 0;
  const said = [];
  const auto = new Autopilot({ recover: () => recovered++, say: (t) => said.push(t) });
  // A car pinned at zero speed on a road it is nowhere near — nose against a rock, the case the
  // detector exists for. `terrain.roads` is present (the detector sits AHEAD of the road logic
  // on purpose) but returns nothing useful, exactly as it would off the network.
  const car = {
    speed: 0, x: 0, z: 0, y: 0, yaw: 0, wb: 2.7, steer: 0,
    maxSteerAngle: () => 0.09,
    terrain: { roads: { edges: [], query: () => ({ edge: null, d: Infinity }) } },
  };
  auto.toggle(car);
  check(auto.on === true, 'auto-drive engaged for the test', String(auto.on), 'true');
  const manual = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
  let firedAt = -1;
  for (let i = 0; i < 60 * 8; i++) {
    auto.update(car, manual, 1 / 60);
    if (recovered && firedAt < 0) firedAt = i / 60;
  }
  check(recovered >= 1, 'the stuck detector called recover()', recovered, '>= 1');
  check(firedAt > 3.4 && firedAt < 3.7, 'and it waited STUCK_TIMEOUT first, not instantly', `${firedAt.toFixed(2)} s`, '~3.5 s');
  check(said.some((t) => /stuck/i.test(t)), 'and told the player why', said[0] ?? 'nothing', 'a "stuck" line');
  // A car that is MOVING must never trip it, or every set of traffic lights is a teleport.
  {
    let r2 = 0;
    const a2 = new Autopilot({ recover: () => r2++ });
    const moving = { ...car, speed: 14 };
    a2.toggle(moving);
    for (let i = 0; i < 60 * 20; i++) a2.update(moving, manual, 1 / 60);
    check(r2 === 0, 'CONTROL: a moving car is never reset for being stuck', r2, '0 over 20 s');
  }
}

/* ── 4. the pick-up sound ──────────────────────────────────────────────────────
 * Two separate claims, measured separately: that pickup() really synthesises something in the
 * WebAudio graph (no file, no service, no key), and that the REAL collection path calls it. The
 * second is the one that was actually broken — chime() has existed, correct and unused, for the
 * whole life of the project.
 */
console.log('\n── the pick-up sound ─────────────────────────────────────────────────────────');
{
  // The smallest AudioContext that can record what a synth asks of it.
  const made = { osc: [], gain: 0, ramps: [] };
  class StubParam {
    constructor() { this.value = 0; }
    setValueAtTime(v) { this.value = v; return this; }
    linearRampToValueAtTime(v, t) { made.ramps.push(['lin', v, t]); return this; }
    exponentialRampToValueAtTime(v, t) { made.ramps.push(['exp', v, t]); return this; }
    setTargetAtTime() { return this; }
  }
  /* One generic node shape covers every WebAudio node this graph builds — the engine, the
   * radio's convolver and delays, the ambience layer's panners. `connect` returns its argument
   * so the real `o.connect(g).connect(master)` chains work unchanged. */
  const node = () => ({
    connect: (n) => n, disconnect() {}, start() {}, stop() {},
    frequency: new StubParam(), gain: new StubParam(), Q: new StubParam(), detune: new StubParam(),
    delayTime: new StubParam(), pan: new StubParam(), positionX: new StubParam(),
    positionY: new StubParam(), positionZ: new StubParam(), playbackRate: new StubParam(),
    type: '', buffer: null, loop: false, normalize: false, curve: null, oversample: '',
  });
  globalThis.window = globalThis;
  globalThis.addEventListener = () => {};
  class StubCtx {
    constructor() {
      this.currentTime = 0;
      this.state = 'running';
      this.sampleRate = 48000;
      this.destination = node();
      this.listener = node();
      /* Anything named create* that this stub has not spelled out returns a generic node, so a
       * future layer in the audio graph cannot break THIS test, which is about one method. */
      return new Proxy(this, {
        get(t, k) {
          if (k in t) return t[k];
          if (typeof k === 'string' && k.startsWith('create')) return () => node();
          return undefined;
        },
      });
    }
    createGain() { made.gain++; return node(); }
    createOscillator() { const n = node(); made.osc.push(n); return n; }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len), duration: 2, length: len }; }
  }
  globalThis.AudioContext = StubCtx;
  const audio = new EngineAudio({ seed: SEED });
  audio.start();
  const before = made.osc.length;
  made.ramps.length = 0;
  audio.pickup();
  const voices = made.osc.length - before;
  const freqs = made.osc.slice(before).map((o) => Math.round(o.frequency.value));
  console.log(`       pickup() built ${voices} voices at ${freqs.join(', ')} Hz`);
  check(voices >= 3, 'pickup() actually synthesises voices in the WebAudio graph', voices, '>= 3');
  check(new Set(freqs).size >= 3, 'and they are distinct notes, not one note repeated', new Set(freqs).size, '>= 3 distinct');
  {
    /* A RISING figure, and quiet. Loud and falling would be a buzzer.
     *
     * The doubling filter: a voice at exactly half the pitch of the one before it is an OCTAVE
     * DOUBLING of that note (body, not a second note), not a step down in the melody. Dropping
     * those leaves the tune itself. Written this way rather than "every other voice" so this
     * check keeps working whether pickup() doubles its notes or not — two agents wrote this same
     * method in the same hour and the surviving one does not double, which a stricter test would
     * have reported as a regression in a sound that is fine. */
    const notes = freqs.filter((f, i) => i === 0 || Math.abs(f * 2 - freqs[i - 1]) > 2);
    const rising = notes.every((f, i) => i === 0 || f > notes[i - 1]);
    const peak = Math.max(...made.ramps.filter((r) => r[0] === 'lin').map((r) => r[1]));
    check(rising, 'the notes rise (positive, not a buzzer)', notes.join(' < '), 'ascending');
    // The horn is the loudest one-shot in the game at 0.16, and this must stay under it: a
    // pick-up that is louder than the horn is a scoreboard, not a kindness.
    check(peak < 0.16, 'peak voice gain is a chime, not a sting', peak.toFixed(3), '< 0.160 (the horn)');
  }

  /* The wire. main.js hands Fuel a collectCans that plays the sound when a can is found — this
   * reproduces that exact closure over a stubbed Props and drives the REAL Fuel.update(). */
  let plays = 0;
  let pending = 0;
  const fuel = new Fuel({
    start: 0.3,
    mercyKey: 'diag.cozy.mercy2',
    collectCans: () => { const g = pending; pending = 0; if (g > 0) plays++; return g; },
  });
  const car = { speed: 20, throttle: 0.4, onRoad: 1, vy: 0 };
  for (let i = 0; i < 120; i++) fuel.update(1 / 60, car);
  check(plays === 0, 'no sound while merely driving', plays, '0');
  pending = 0.22;
  fuel.update(1 / 60, car);
  check(plays === 1, 'one sound the frame a can is collected', plays, '1');
  for (let i = 0; i < 120; i++) fuel.update(1 / 60, car);
  check(plays === 1, '...and it does not repeat on later frames', plays, 'still 1');
  check(fuel.stats.cansCollected === 1, 'the can really went in the tank', fuel.stats.cansCollected, '1');
  // The gate must not silence the pickup: auto-drive suppresses the BURN, not the cans.
  pending = 0.22;
  fuel.update(1 / 60, car, { burn: false });
  check(plays === 2, 'a can collected under auto-drive still sounds', plays, '2');
}

/* ── 5. the off-road spray ─────────────────────────────────────────────────────
 * The audit: "Points 0 -> 0, Sprites 0 -> 0, no new scene children at all" after nine seconds
 * off-road at 44 km/h. Measured here from the real emitter's own state.
 */
console.log('\n── off-road spray ────────────────────────────────────────────────────────────');
{
  const scene = new Object3D();
  const spray = new Spray({ scene });
  check(scene.children.includes(spray.mesh), 'the emitter is really in the scene graph', String(scene.children.includes(spray.mesh)), 'true');
  const dunes = new Float32Array([0, 0, 0, 1, 0]); // pure Bara Dunes — sand
  const meadow = new Float32Array([1, 0, 0, 0, 0]);
  const ground = () => 0;

  // On the road at speed: nothing, ever.
  const onRoad = { x: 0, y: 0.4, z: 0, yaw: 0, speed: 22, onRoad: 1, limit: 0.3, slip: 0.02, wb: 2.7 };
  for (let i = 0; i < 60 * 9; i++) spray.update(1 / 60, onRoad, { w: meadow }, ground);
  check(spray.spawned === 0, 'nine seconds ON the road spawns nothing', spray.spawned, '0');
  check(spray.mesh.count === 0, 'and the mesh draws no instances', spray.mesh.count, '0');

  // Off the road at the same speed on sand: a lot.
  const off = { x: 0, y: 0.4, z: 0, yaw: 0, speed: 12.2, onRoad: 0, limit: 0.35, slip: 0.05, wb: 2.7 };
  for (let i = 0; i < 60 * 9; i++) {
    off.z += 12.2 / 60;
    spray.update(1 / 60, off, { w: dunes }, ground);
  }
  console.log(`       nine seconds off-road at 44 km/h: ${spray.spawned} grains thrown, ${spray.count} live`);
  check(spray.spawned > 300, 'nine seconds OFF the road throws real grains', spray.spawned, '> 300');
  check(spray.count > 0 && spray.count <= spray.max, 'live grains are bounded by MAX', `${spray.count}/${spray.max}`, `1..${spray.max}`);
  check(spray.mesh.count === spray.count, 'the mesh draws exactly the live ones', `${spray.mesh.count} vs ${spray.count}`, 'equal');
  {
    // ...and they are really THERE: a non-degenerate instance matrix behind the car, not a
    // counter that went up. (Gotcha 3, applied to particles.)
    const m = spray.mesh.instanceMatrix.array;
    let sized = 0;
    let behind = 0;
    for (let i = 0; i < spray.count; i++) {
      const o = i * 16;
      if (m[o] > 1e-4) sized++;
      // The car drives down +z, so its dust must be at SMALLER z than the car.
      if (m[o + 14] < off.z + 0.5) behind++;
    }
    check(sized === spray.count, 'every live instance has a real, non-zero scale', `${sized}/${spray.count}`, 'all');
    check(behind === spray.count, 'and every one of them is behind the car, never in front', `${behind}/${spray.count}`, 'all');
    const c = spray.mesh.instanceColor;
    check(!!c, 'grains carry a per-grain ground colour', c ? 'yes' : 'no', 'yes');
  }
  // Sand throws more than a wet meadow — the cue is the ground, not a constant.
  const rate = (w) => {
    const s = new Spray({ scene: null });
    const car = { x: 0, y: 0.4, z: 0, yaw: 0, speed: 20, onRoad: 0, limit: 0.4, slip: 0.05, wb: 2.7 };
    for (let i = 0; i < 60 * 3; i++) s.update(1 / 60, car, { w }, ground);
    return s.spawned;
  };
  const sand = rate(dunes);
  const wet = rate(new Float32Array([0, 0, 0, 0, 1]));
  check(sand > wet * 1.5, 'sand sprays more than wetland', `${sand} vs ${wet}`, 'sand > 1.5x');
  spray.reset();
  check(spray.count === 0 && spray.mesh.count === 0, 'reset() clears it (so a rescue drags no tail)', spray.count, '0');
  // A stationary car off-road, and a car with no wheel data at all, must both be silent.
  {
    const s = new Spray({ scene: null });
    const parked = { x: 0, y: 0.4, z: 0, yaw: 0, speed: 0.4, onRoad: 0, limit: 0, slip: 0, wb: 2.7 };
    for (let i = 0; i < 300; i++) s.update(1 / 60, parked, { w: dunes }, ground);
    check(s.spawned === 0, 'a parked car off-road sprays nothing', s.spawned, '0');
    const s2 = new Spray({ scene: null });
    const bare = { x: 0, y: 0.4, z: 0, yaw: 0, speed: 25, wb: 2.7 };
    for (let i = 0; i < 300; i++) s2.update(1 / 60, bare, null, ground);
    check(s2.spawned === 0, 'a car with no surface data sprays nothing (fails safe)', s2.spawned, '0');
  }
}

/* ── 3. bigger, glowing cans, and the litter bin ───────────────────────────────
 * Last because it is the slowest: it builds real tiles from the real seed.
 */
console.log('\n── fuel cans: bigger, glowing, and a bin beside them ─────────────────────────');
{
  const scene = new Object3D();
  const props = new Props({ seed: SEED, scene, solids: null });
  props.update(1 / 60, 0, 0);
  let frames = 0;
  while (props.stats.backlog > 0 && frames < 6000) {
    props.update(1 / 60, 0, 0);
    frames++;
  }
  check(props.cans.size > 0, 'real cans built from the real seed', props.cans.size, '> 0');
  const [, can] = [...props.cans.entries()][0] || [];
  if (can) {
    const g = can.mesh.geometry;
    g.computeBoundingBox();
    const b = g.boundingBox;
    const dx = b.max.x - b.min.x;
    const dy = b.max.y - b.min.y;
    const dz = b.max.z - b.min.z;
    console.log(`       can bounding box ${dx.toFixed(3)} x ${dy.toFixed(3)} x ${dz.toFixed(3)} m  (was 0.312 x 0.440 x 0.242)`);
    // The audit measured the old can at 0.312 x 0.440 x 0.242 m. x CAN_SCALE, with a little
    // slack because the lit collar under the cap is very slightly wider than the old neck.
    check(dy > 0.44 * CAN_SCALE * 0.95, 'the can is really CAN_SCALE times taller', `${dy.toFixed(3)} m`, `~${(0.44 * CAN_SCALE).toFixed(3)} m`);
    check(dx > 0.28 * CAN_SCALE * 0.95, '...and wider', `${dx.toFixed(3)} m`, `~${(0.312 * CAN_SCALE).toFixed(3)} m`);
    check(dy > 0.9, 'a can is now about a metre tall — visible at speed', `${dy.toFixed(2)} m`, '> 0.9 m');

    // The lit panel. `vmat > 1.5` is MAT.EMIT, the same test bench-props.mjs uses.
    const vm = g.attributes.vmat.array;
    let emit = 0;
    for (let i = 0; i < vm.length; i++) if (vm[i] > 1.5) emit++;
    console.log(`       ${emit} of ${vm.length} can vertices are self-lit (EMIT)`);
    check(emit > 24, 'the can carries a real lit panel, not a 5 cm glint', emit, '> 24 vertices');

    /* The halo. In node there is no DOM, so haloTexture() returns null and no sprite is made —
     * by design, and the reason this asserts the FIELD exists rather than the object: proving
     * the halo renders is a browser's job and is called out in the note at the end. */
    check('halo' in can, 'each can carries a halo slot (built in a browser, null in node)', String(can.halo), 'the field exists');
    check(typeof can.baseY === 'number', 'and the halo has a real anchor height', can.baseY.toFixed(2), 'a number');
    check(Math.abs(can.baseY - (can.mesh.geometry.boundingBox.min.y + 0.2 * CAN_SCALE)) < 0.6,
      '...anchored on the middle of the can, not its feet', can.baseY.toFixed(2), 'near the can body');

    /* The litter bin. It is baked into the TILE's shared mesh (no extra draw call), so it is
     * found by looking for tile geometry standing next to a can where, before this change,
     * there was nothing but grass for hundreds of metres in every direction. */
    let withBin = 0;
    let sample = null;
    for (const [, c] of props.cans) {
      const rec = props.live.get(c.tile);
      if (!rec || !rec.mesh) continue;
      const pos = rec.mesh.geometry.attributes.position.array;
      let n = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < pos.length; i += 3) {
        const d = Math.hypot(pos[i] - c.x, pos[i + 2] - c.z);
        if (d > 2.6) continue;
        n++;
        if (pos[i + 1] < lo) lo = pos[i + 1];
        if (pos[i + 1] > hi) hi = pos[i + 1];
      }
      if (n > 40) {
        withBin++;
        if (!sample) sample = { n, span: hi - lo };
      }
    }
    console.log(`       ${withBin} of ${props.cans.size} cans have geometry standing beside them` +
      (sample ? ` (sample: ${sample.n} vertices, ${sample.span.toFixed(2)} m tall)` : ''));
    check(withBin === props.cans.size, 'every can has a litter bin next to it', `${withBin}/${props.cans.size}`, 'all of them');
    check(!!sample && sample.span > 0.9 && sample.span < 1.6, 'and the bin is waist-high, not a speck', sample ? `${sample.span.toFixed(2)} m` : 'none', '0.9–1.6 m');

    // Collecting a can must still pay exactly what it always did — the bin changes nothing
    // about the pickup, and the size change must not have moved the collection radius.
    const before = props.drainCollectedFuel();
    props.update(1 / 60, can.x, can.z);
    const paid = props.drainCollectedFuel();
    check(before === 0 && paid > 0, 'driving onto a can still collects it', paid.toFixed(3), '> 0');
    check(CAN_RADIUS === 7 && CAN_HOVER === 0.55, 'placement contract untouched (radius, hover)', `${CAN_RADIUS} m / ${CAN_HOVER} m`, '7 / 0.55');
  }
  props.dispose();
}

console.log(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all cozy-round checks passed'}`);
console.log(
  'NOT PROVEN HERE (needs a browser, and the orchestrator has one): that the halo sprite\n' +
  'actually renders and reads as a warm glow rather than a video-game marker, that the bin\n' +
  'reads as a landmark at 150 m, that the dust looks like dust, and that the pick-up chime\n' +
  'sounds warm. Every one of those is a "look at it" claim and is not made here.'
);
process.exit(failures ? 1 : 0);
