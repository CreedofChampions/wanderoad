/* Wanderoad — vehicle tuning.
 *
 * Every number in this file traces back to something a Test Drive Unlimited player actually
 * said, or to a value in TDU's own physics config. The series' reputation rests on a few
 * specific behaviours, and its two sequels are disliked for specific, nameable failures:
 *
 *   TDU1 (loved)  weight transfer you can feel, drivetrains that differ, lift-off oversteer
 *                 that is a tool rather than an accident.
 *   TDU2 (twitchy) "there's almost nothing between having maximum grip and no grip at all.
 *                 There's no transition." Understeers everywhere, refuses to power-slide,
 *                 near-zero body roll.
 *   Solar Crown   huge steering deadzone, not enough lock to catch a slide, corner-entry
 *                 understeer, braking that "barely does anything", and no cue at all for how
 *                 close to the limit you are.
 *
 * So the highest-priority number here is not grip level — it is the SHAPE of the lateral
 * tyre curve. A long plateau and a shallow post-peak falloff is what makes a slide readable
 * and catchable. Everything else is in service of that.
 *
 * Nothing in this file is per-frame state. It is data.
 */

/* ── the solver ─────────────────────────────────────────────────────────── */
export const PHYSICS_HZ = 120; // fixed step. TDU's own bugs get worse at variable rate.
export const PHYSICS_DT = 1 / PHYSICS_HZ;
export const MAX_SUBSTEPS = 5; // clamp at 41 ms; below that we accept slow motion over a spiral

/* NOTE on cdA: these are roughly twice a real car's drag area. They are the cheapest honest
 * lever for a lower top speed that still leaves acceleration and gearing feeling normal —
 * cutting torque instead would make the car feel gutless off the line, and a speed limiter
 * would feel like a wall. Shorter final drives do the rest.
 */

/* ── the pace ─────────────────────────────────────────────────────────────
 * This is a COZY driving game, and the first playable build was not: "the sense of speed is
 * high, but this is a cozy driving game", "we need to make the speed less across the board",
 * "on hyper you can't really stop the car at all". Everything below is roughly 45% slower
 * than a real car of the same description, and it stops far harder than one. That is a
 * deliberate genre choice, not a physics error — 130 km/h down a country lane you are
 * looking at is worth more here than 300 km/h you are surviving.
 */

/* ── chassis ────────────────────────────────────────────────────────────── */
export const TIERS = {
  gt: {
    name: 'Grand Tourer',
    mass: 1520,
    izz: 2600,
    wheelbase: 2.72,
    track: 1.6,
    cgHeight: 0.45,
    weightRear: 0.5,
    power: 165, // hp, for the HUD only — torque curve below is the truth
    peakTorque: 235, // N·m at the crank
    redline: 6800,
    cdA: 1.9,
    rollPerG: 3.4,
    topSpeed: 135, // km/h, the acceptance target
    zeroTo100: 9.5,
    ratios: [4.1, 2.62, 1.9, 1.47, 1.15, 0.98],
    finalDrive: 4.1,
    wheelRadius: 0.34,
    drive: 'rwd',
  },
  sports: {
    name: 'Sports',
    mass: 1450,
    izz: 2300,
    wheelbase: 2.65,
    track: 1.62,
    cgHeight: 0.42,
    weightRear: 0.53,
    power: 300,
    peakTorque: 370,
    redline: 7200,
    cdA: 1.62,
    rollPerG: 2.5,
    topSpeed: 165,
    zeroTo100: 7.0,
    ratios: [3.9, 2.5, 1.81, 1.4, 1.1, 0.93],
    finalDrive: 3.95,
    wheelRadius: 0.34,
    drive: 'rwd',
  },
  hyper: {
    name: 'Hyper',
    mass: 1400,
    izz: 2150,
    wheelbase: 2.7,
    track: 1.68,
    cgHeight: 0.38,
    weightRear: 0.56,
    power: 380,
    peakTorque: 405,
    redline: 8200,
    cdA: 1.48,
    rollPerG: 1.7,
    topSpeed: 190,
    zeroTo100: 5.6,
    ratios: [3.7, 2.38, 1.77, 1.4, 1.12, 0.94],
    finalDrive: 3.9,
    wheelRadius: 0.35,
    drive: 'awd',
  },
};

/* ── tyres ───────────────────────────────────────────────────────────────
 * Simplified Pacejka: Fy = μ·Fz·sin(C·atan(B·α − E·(B·α − atan(B·α))))
 *
 * B/C/E are chosen so the force stays within 3% of peak across 6°–13° of slip angle and
 * only falls to 76% by 30°, with a hard floor at 0.55·peak. That floor is the whole point:
 * it is what leaves you something to steer with once the car is already sideways, and its
 * absence is precisely why TDU2 has "no way to correct" an oversteer.
 */
export const TYRE = {
  B: 7.5,
  C: 1.45,
  E: 0.92,
  peakSlipFront: (8.0 * Math.PI) / 180,
  peakSlipRear: (9.0 * Math.PI) / 180,
  tailFloor: 0.55, // never let lateral force fall below this fraction of peak
  // dry asphalt, sport tyre. Rear slightly higher than front: a mild understeer baseline
  // that lift-off can flip, which is TDU1's signature.
  muLatFront: 1.3,
  muLatRear: 1.34,
  muLongPeak: 1.42,
  peakSlipRatio: 0.12,
  // AWD is capped at +2% over RWD, not +15%. "AWD cars feel like they have glue tires" is a
  // named Solar Crown complaint.
  awdCap: 1.36,
  // Grip barely fades with speed — TDU's own SpeedEffects puts the half-grip point at
  // 1260 km/h. What makes a car feel planted at speed is downforce, not grip fade.
  speedFadeAt: 110, // m/s for the full (small) fade
  speedFade: 0.1,
  downforce: 0.22, // N per (m/s)²
  // Combined slip uses a deliberately generous exponent: 1.85 instead of 2.0 leaves ~6% more
  // simultaneous capacity, which is what lets trail-braking rotate the car instead of
  // ploughing on. Solar Crown's "braking generates massive understeer" is the 2.0 case.
  ellipseExp: 1.85,
  // lift-off oversteer: rear μ dips briefly when you close the throttle mid-corner
  liftoffDrop: 0.06,
  liftoffHold: 0.25,
  liftoffRecover: 0.6,
  liftoffMinLatG: 0.4,
};

/* ── steering ────────────────────────────────────────────────────────────
 * 40° is TDU's own steering_max_angle default. The 8° floor exists because Solar Crown's
 * fatal flaw is running out of lock: "You can't catch a slide beyond a certain angle, as it
 * just won't give you enough steering angle."
 */
export const STEER = {
  maxAngle: (40 * Math.PI) / 180,
  minAngle: (8 * Math.PI) / 180,
  taperSpeed: 16, // m/s
  taperPow: 1.5,
  /* Full stick is a LATERAL ACCELERATION, not an angle. A 40° lock tapered by speed still
   * gives 27° at 50 km/h, and 27° at 50 km/h is 0.78 rad/s — a go-kart. On a keyboard,
   * where a key press ramps to full lock in a quarter of a second, that is the whole of the
   * "worst driving controls ever / feels like flying" complaint in one number.
   *
   * So the lock available to full stick is whatever produces `comfortG` of cornering at the
   * current speed: δ = atan(L·a/v²). At walking pace that is still full lock, so parking
   * and hairpins work; at 140 km/h it is under a degree, which is what a road car actually
   * uses. The driver keeps the whole range — they just have to be going slowly to reach the
   * end of it, exactly like a real car. Ctrl (attack) raises the ceiling for a deliberate
   * throw, and the drift bonus in maxSteerAngle() still applies once you are sideways. */
  comfortG: 8.4, // m/s², about 0.86 g
  attackG: 14.0,
  /* A floor under the comfort limiter, in metres of turning radius. The limiter is a
   * lateral-acceleration cap, and a cap on acceleration says nothing useful below walking
   * pace — but it does keep shrinking the available lock all the way down, which is why
   * low-speed turning felt heavy. Below this radius the mechanical rack takes over. */
  minRadius: 7.0,
  // Asymmetric keyboard ramp: build slowly, return fast. Telemetry on keyboard driving shows
  // the winning trace has a much higher return rate than build rate.
  // "Turning left and right at low speed seems too difficult" / "the left and right feel
  // muddy". Both are this ramp: on a keyboard the only way to a big steering angle is to
  // hold the key, and at 2.0/s that is half a second of nothing happening. Doubled at low
  // speed, and it still tapers off as you go faster so a twitch at 150 km/h is impossible.
  buildBase: 2.4,
  buildBonus: 4.2,
  buildFalloff: 18, // m/s
  returnRate: 8.5,
  // gamepad: no ramp, but rate-limit the virtual wheel to TDU's 900 °/s
  padRateLimit: (900 * Math.PI) / 180,
  padDeadzone: 0.04,
  padSaturation: 0.95,
  padCurve: 1.5,
  // Self-aligning torque. Guides for Solar Crown state plainly that too much of this makes
  // the wheel "heavy and numb" — the exact adjective to avoid. 0.5 is the numb threshold.
  satGain: 0.3,
  satDamping: 0.55,
  trailPeak: 0.9,
  trailPostPeak: 0.25,
  // Drift window: once you are already sideways you get MORE lock, not less.
  driftLow: (12 * Math.PI) / 180,
  driftHigh: (35 * Math.PI) / 180,
  driftBonus: 0.18,
  driftYawDamp: 1.9,
  spinYawDamp: 4.2,
  spinAngle: (42 * Math.PI) / 180,
  hardSpin: (62 * Math.PI) / 180,
};

/* ── pedals ─────────────────────────────────────────────────────────────── */
export const PEDAL = {
  throttleUp: 1 / 0.25,
  throttleDown: 1 / 0.15,
  throttleCurve: 1.4,
  brakeUp: 1 / 0.12,
  brakeDown: 1 / 0.1,
  brakeCurve: 1.0,
};

/* ── brakes ─────────────────────────────────────────────────────────────── */
export const BRAKE = {
  // Total brake torque at the wheels. 8400 N·m gave a realistic 1.15 g, and a real car's
  // braking is not what this game wants: "on hyper you can't really stop the car at all,
  // it just goes". Cozy means the brake pedal is an answer, always. 15500 N·m is a hard
  // stop from any speed this game can reach, and ABS still modulates it so it steers.
  torque: 15500, // N·m total at the wheels
  splitFront: 0.68,
  splitFrontDive: 0.76, // shifts forward as the nose dives
  absTargetSlip: 0.11,
  absMaxSlip: 0.13,
  absHz: 18,
  absRelease: 0.3,
  // Locked fronts must keep ~25% of steering. "don't even try to turn off ABS, because
  // you'll just slide straight" is the failure mode.
  lockedLatFloor: 0.35,
  handbrakeTorque: 2200,
  handbrakeRearMu: 0.55,
  handbrakeRecover: 0.35,
  handbrakeYawCap: (130 * Math.PI) / 180,
};

/* ── gearbox ────────────────────────────────────────────────────────────── */
export const GEARBOX = {
  shiftTimeAuto: 0.14,
  shiftTimeManual: 0.09,
  shiftTorqueCut: 0.25,
  blipRpm: 900,
  downshiftHysteresis: 900,
  // Part-throttle upshifts well below redline. "unrealistic shift points are really killing
  // the immersion while cruising" — every gear revving out no matter how gently you drive.
  upshiftAtThrottle: [
    [0.0, 0.38],
    [0.2, 0.42],
    [0.5, 0.62],
    [1.0, 0.97],
  ],
  idleRpm: 900,
  driveLoss: 0.12,
};

/** Normalised torque against rpm fraction. Flat and fat: the car pulls anywhere. */
export const TORQUE_CURVE = [
  [0.0, 0.42],
  [0.12, 0.55],
  [0.3, 0.88],
  [0.55, 1.0],
  [0.8, 0.95],
  [1.0, 0.8],
];

export function curveAt(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (x <= curve[i][0]) {
      const [x0, y0] = curve[i - 1];
      const [x1, y1] = curve[i];
      const t = (x - x0) / (x1 - x0 || 1);
      return y0 + (y1 - y0) * t;
    }
  }
  return curve[curve.length - 1][1];
}

/* ── body attitude ──────────────────────────────────────────────────────── */
export const BODY = {
  rollOmega: 8.4,
  rollZeta: 0.85,
  pitchOmega: 10.5,
  pitchZeta: 0.85,
  divePerG: (1.6 * Math.PI) / 180,
  squatPerG: (1.0 * Math.PI) / 180,
  rollClamp: (5.5 * Math.PI) / 180,
  pitchClamp: (3.0 * Math.PI) / 180,
  rollRate: (50 * Math.PI) / 180,
  pitchRate: (35 * Math.PI) / 180,
  visualRollMul: 1.3, // readability only; never fed back into the solver
  loadTauPitch: 0.12,
  loadTauRoll: 0.15,
  rollStiffFront: 0.55,
};

/* ── airborne ───────────────────────────────────────────────────────────
 * TDU's "planted" feel is partly a cheat: it adds extra gravity when a wheel leaves the
 * ground, to put the car back down. Hardcore removes it, which is why hardcore cars famously
 * launch off crests.
 */
export const AIR = {
  gravity: 9.81,
  extraMin: 0.1,
  extraMax: 1.0,
  extraDelay: 0.1,
  extraRamp: 0.1,
};

/* ── suspension ─────────────────────────────────────────────────────────── */
export const SUSPENSION = {
  restLength: 0.36,
  travel: 0.22,
  stiffness: 42000, // N/m per corner
  damping: 4200, // N·s/m
  antiRollFront: 14000,
  antiRollRear: 11000,
};

/* ── assists ─────────────────────────────────────────────────────────────
 * A ladder, not a switch — TDU shipped a three-position aid selector plus Hardcore, and its
 * own guide warns against turning everything off without a wheel. SPORT is the default
 * because it is the setting a keyboard player can actually enjoy.
 */
/* NOTE on autoGears: only HARDCORE turns the automatic off, and even that is a debt — the
 * game has no manual shift keys bound, so `autoGears: false` means the car is stuck in first
 * for ever. That is exactly what happened to the Drift preset on the first live build. */
export const PRESETS = {
  cruise: { counterSteer: 0.95, stability: 0.35, tcs: 0.4, abs: 0.8, autoGears: true, lockFloor: (10 * Math.PI) / 180, brakeMul: 1.0, airborne: 1.0 },
  sport: { counterSteer: 0.7, stability: 0.2, tcs: 0.2, abs: 0.6, autoGears: true, lockFloor: STEER.minAngle, brakeMul: 1.0, airborne: 1.0 },
  off: { counterSteer: 0.3, stability: 0.05, tcs: 0.0, abs: 0.3, autoGears: true, lockFloor: STEER.minAngle, brakeMul: 1.0, airborne: 1.0 },
  hardcore: { counterSteer: 0.0, stability: 0.0, tcs: 0.0, abs: 0.0, autoGears: false, lockFloor: STEER.minAngle, brakeMul: 0.82, airborne: 0.0 },
};

/** Counter-steer assist. Keyboard defaults high; a wheel would default to zero. */
export const ASSIST = {
  csKeyboard: 0.85,
  csGamepad: 0.45,
  csLag: 0.06,
  csMinSlip: (4 * Math.PI) / 180,
  csMinSpeed: 8 / 3.6,
  csClamp: 0.75, // fraction of current max lock
  tcsTargetSlip: 0.14,
  stabilityYawGain: 1.4,
};

/* ── camera ──────────────────────────────────────────────────────────────
 * Two cameras, because TDU is two games: a cruising game and a racing game. Cruise is the
 * default for free roam, which is what the community says the series is actually for.
 */
export const CAMERA = {
  cruise: {
    behind: 6.0,
    above: 1.85,
    lookAhead: 1.0,
    lookHeight: 0.9,
    yawTau: 0.35,
    velocityBlend: 0.0,
    fov: 64,
    fovGain: 0,
    stretch: 0,
    rise: 0,
    shake: 0,
  },
  sport: {
    behind: 6.2,
    above: 1.9,
    lookAhead: 1.0,
    lookHeight: 0.9,
    yawTau: 0.22,
    velocityBlend: 0.62,
    lookIntoCorner: 0.18,
    lookIntoClamp: (9 * Math.PI) / 180,
    springOmega: 7.7,
    springZeta: 0.85,
    stretch: 1.8, // extra metres of distance by 250 km/h
    rise: 0.25,
    fov: 62,
    fovGain: 17,
    fovPow: 0.7,
    fovRate: (12 * Math.PI) / 180,
    fovKick: 5,
    fovKickTau: 0.6,
    lateralClamp: 0.12, // fraction of viewport width the car may slide toward the edge
    pitchRate: (20 * Math.PI) / 180,
    pitchClamp: (6 * Math.PI) / 180,
    shake: (0.35 * Math.PI) / 180,
    shakeHz: 11,
    shakeFrom: 145 / 3.6,
  },
  hood: { behind: -0.35, above: 1.15, lookAhead: 6, lookHeight: 1.1, yawTau: 0.05, velocityBlend: 0, fov: 58, fovGain: 0 },
};

export const SPEED_CUES = {
  blur: 0.38,
  blurFrom: 90 / 3.6,
  vignetteBase: 0.1,
  vignetteGain: 0.14,
  refSpeed: 150 / 3.6,
};
