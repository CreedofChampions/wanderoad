/* created by AI
 * Wanderoad — THE MICRO-CAR FEEL, ported into this game's own solver.
 *
 * Operator: "Let them start with some hilarious cars that seem to fall over every time you turn, and
 * easily upgrade beyond that point." He then handed over a complete physics config and an eight-point
 * list of what makes it feel like it is falling over. This file is that list, reproduced inside
 * car/vehicle.js's bespoke fixed-step solver — WITHOUT adding a physics engine and WITHOUT rewriting
 * the solver, both of which were explicitly off the table.
 *
 * WHAT THIS MODULE IS. A modifier that wraps `Vehicle._step` on ONE vehicle instance. Everything it
 * does is either (a) a per-step pre/post pass around the untouched solver, or (b) a per-car write to
 * the shared tuning tables, snapshotted at module load and put back on detach — the identical pattern
 * game/garage.js's `applyCarFeel` already uses for STEER/TYRE/BRAKE/BODY. Nothing in car/vehicle.js,
 * car/tuning.js, main.js or ui/menu.js is edited.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE EIGHT POINTS: WHAT IS EXACT, WHAT IS APPROXIMATED, WHAT DOES NOT MAP.
 *
 * This record is the point of the exercise. A silent partial port is worth less than an honest
 * one — the next person to touch this needs to know which numbers are his and which are a
 * translation, and why.
 *
 *  1. FIXED 50 Hz STEP; the traction-control ramp and the steer helper are PER STEP.
 *     → APPROXIMATED, deliberately, and it is the approximation that makes the rest EXACT.
 *       This game's solver is fixed 120 Hz (tuning.js PHYSICS_HZ) and that is a global decision
 *       every car in the fleet is tuned against; it is not moving for one vehicle. So the modifier
 *       carries its OWN 50 Hz accumulator and fires the ramp and the helper on it, 50 times a
 *       second exactly. That matters arithmetically: +-9.26 N.m per 120 Hz step would reach full
 *       power in 1.92 s, not the 4.6 s he specified. The continuous parts (the pendulum, the
 *       damping, the downforce) run at the solver's own 120 Hz, because a spring integrated at
 *       50 Hz inside a 120 Hz loop aliases.
 *
 *  2. CENTRE OF MASS PINNED BELOW THE AXLES. "The sprung mass hangs like a pendulum below the
 *     axles — gravity gives a huge restoring roll torque, so the body rocks and over-corrects
 *     instead of settling. This is the single biggest contributor."
 *     → APPROXIMATED, as an explicit pendulum roll degree of freedom this solver does not have.
 *       car/vehicle.js models roll in two pieces: `_lean`, a purely cosmetic spring, and `_tip`,
 *       the real rollover DOF, and neither is a pendulum. So this module adds a third: a mass
 *       hanging `PEND_ARM` = 0.32 m below the axle line (wheel radius 0.30 m, centre of mass
 *       0.02 m UNDER the contact plane — his "at/just under" — so the arm is 0.30 + 0.02). The
 *       restoring acceleration is the textbook pendulum, `-(g/arm)*sin(phi)`, which at this arm
 *       is 30.7 rad/s^2 per radian: enormous, exactly as he says, and it rings at
 *       sqrt(g/arm) = 5.54 rad/s = 0.88 Hz. That is the band this codebase has already
 *       established as a wobble you can SEE (see the Scooter's note in game/garage.js: "a wobble
 *       you can SEE is about a cycle a second"). Damping is left at zeta 0.12 so it genuinely
 *       over-corrects rather than settling.
 *
 *       WHAT IS NOT DONE, and why. The sub-plane centre of mass is NOT written into the tier's
 *       `cgHeight`. Two reasons, both load-bearing. `cgHeight` is what car/vehicle.js's rollover
 *       equation uses as the height of the mass that has to be carried over the outer contact
 *       line, and with the mass BELOW that line the load-transfer ratio can never reach 1 — a
 *       pendulum is mathematically incapable of tipping over, at any speed, on any tyre. The
 *       operator also asked, in the same breath, for a three-wheeler that "rolls over almost
 *       instantly". Both cannot be true of one number. So the pendulum carries the ROCKING and
 *       the OVER-CORRECTION, which is what he says point 2 is FOR, and `cgHeight` carries the
 *       tipping, at the tall narrow body's own honest height. The two add: `lean` is summed with
 *       `_tip` for the commit test below, so a body already rocked over is genuinely closer to
 *       going.
 *
 *  3. TYRE FORCES APPLIED 0.10 m ABOVE THE CONTACT PATCH, i.e. above the centre of mass, so
 *     lateral grip rolls the body INTO the corner, motorbike-style, then the pendulum snaps it
 *     back.
 *     → EXACT, as a torque on the pendulum. The moment arm is FORCE_H - COM_H = 0.10 - (-0.02)
 *       = 0.12 m, and the sign is the one the geometry gives: a force at height dh above the
 *       centre of mass produces a roll torque of -dh*Fy, and in this codebase's convention
 *       (+X is the driver's LEFT, positive roll is left-side-up — see car/vehicle.js's
 *       `_probeWheels` and its lean-sign note) a left turn's positive lateral acceleration
 *       therefore rolls the body NEGATIVE, which is leaning into the corner. Motorbike, as he
 *       says. The snap back is the pendulum in point 2 doing what pendulums do.
 *
 *  4. DOWNFORCE ALONG THE CAR BODY'S OWN -up, 250 x speed newtons, so a leaned car gets a
 *     sideways shove that AMPLIFIES the lean instead of planting it.
 *     → EXACT for the destabilising half, APPROXIMATED for the other half.
 *       The lateral component, `(250*v/m) * sin(roll)`, is applied to the world velocity every
 *       step in the body's own left direction. Read the sign carefully, because it is the whole
 *       mechanism and it is counter-intuitive: the shove points to the side the underside is
 *       facing, so a car leaning INTO a left corner (point 3) gets shoved OUTWARD, which
 *       increases its sideslip, which increases the tyre force, which leans it further in. That
 *       is the amplification. The VERTICAL component `250*v*cos(roll)` cannot be added to the
 *       tyre loads from out here — they are computed and consumed inside `_step`, and this
 *       module does not reach into it — so it is applied where it still does honest work, as
 *       extra effective gravity on the pendulum, which makes the rocking faster at speed. This
 *       game's own `TYRE.downforce` (0.22 N per (m/s)^2) still supplies the grip half.
 *
 *  5. STEERHELPER 0.644: every fixed step, rotate the velocity vector by 64.4% of the chassis
 *     yaw change. Skip entirely if not all wheels are grounded, and do NOT update the previous
 *     yaw when skipping. Skip if |prevYaw - yaw| >= 10 degrees.
 *     → EXACT, including both guards, with one documented decision. car/vehicle.js wraps `yaw`
 *       to +-pi (line `if (this.yaw > Math.PI) this.yaw -= TWO_PI`), so the raw difference steps
 *       by 2pi twice a lap; the delta is taken through core/math.js's `angleDelta`, which is the
 *       shortest signed turn and is what "yaw change" means. THE DECISION: he specifies that the
 *       previous yaw is not updated when the car is airborne, and says nothing about the 10 deg
 *       case. Not updating it there is a latch — the stale prevYaw keeps the difference above
 *       10 deg for ever and the helper is dead for the rest of the session — so the previous yaw
 *       IS updated on the 10 deg skip. Only the rotation is skipped.
 *
 *  6. ASYMMETRIC GEOMETRY: left hubs at x -0.858, right at +0.940 (NOT mirrored), front-left hub
 *     scaled (0.8, 1, 1). "Permanently slightly cocked."
 *     → LITERAL IN THE MODEL, APPROXIMATED IN THE SOLVER, and one part DOES NOT MAP.
 *       tools/make-microcar.mjs places the hubs at exactly that ratio and scales the front-left
 *       tyre's width to 0.8 — see its own note on why the absolute metres are scaled to each
 *       car's own track. In the solver there are no per-wheel positions at all: car/vehicle.js
 *       places four probes symmetrically from `track` and `a`/`b`, so the offset cannot reach the
 *       tyre forces. What it CAN do, honestly, is put the pendulum's rest angle off vertical: a
 *       wheel centroid HUB_SKEW = 4.56% of a half-track to one side means the body hangs
 *       permanently cocked by asin(offset/arm) — 4.3 deg on the bubble. That is the permanent
 *       cock, and it is in the pendulum equation as a constant term rather than as a fudge added
 *       afterwards. The narrower front-left TYRE does not map: this solver has one grip figure
 *       per axle and no per-corner contact width, and inventing one for two cars would be a
 *       change to the solver.
 *
 *  7. STIFF SHORT SUSPENSION: 70 kN/m over 0.20 m of travel, neutral at 10% travel, ~35 mm static
 *     sag, so it rides near topped-out and bottoms out on small bumps.
 *     → EXACT for the stiffness, the travel and the sag; the preload DOES NOT MAP.
 *       `SUSPENSION.stiffness` is per corner in this game too, so 70000 goes straight in, and
 *       1000 kg over four corners at 70 kN/m is 1000*9.81/(4*70000) = 0.0350 m of static sag —
 *       his 35 mm, arrived at from his own numbers rather than dialled to match. `travel` 0.20
 *       likewise, which is what makes the bottom-out clamp at the end of car/vehicle.js's
 *       vertical block fire on small bumps. The "neutral at 10% travel" preload is a
 *       raycast-suspension parameter (the rest length the ray relaxes to) and this solver has no
 *       equivalent — its spring is referenced to `groundY + SUSPENSION.restLength` with no
 *       preload term. `restLength` is deliberately NOT touched, because main.js draws the body at
 *       a hard-coded `car.y - 0.36` rather than reading the table, so changing it here would sink
 *       every micro-car through the road. Damping is not in his spec; it is set to zeta 0.34
 *       against this car's own spring, under the fleet's 0.54, because "bottoms out on small
 *       bumps, delivering impulses" is an underdamped car.
 *
 *  8. TRACTION-CONTROL RAMP: torque starts at 2300 x (1 - 0.926) = 170 N.m and moves +-9.26 N.m
 *     per fixed step, so full power arrives ~4.6 s after spawn and any wheelspin knocks it back.
 *     → EXACT, as a fraction. 170/2300 = 0.0739 to start, 9.26/2300 = 0.004026 per 50 Hz tick,
 *       230 ticks to full = 4.60 s. It is applied by scaling `peakTorque` on a PRIVATE CLONE of
 *       the tier record (the shared TIERS entry is never mutated), which is the one lever that
 *       reaches car/vehicle.js's drive force without touching it. Wheelspin is read from the
 *       solver's own telemetry — `forces.drive` at or past `forces.traction` IS wheelspin here —
 *       and steps the ramp down by the same 9.26 N.m instead of up. The floor is the spawn value:
 *       he gives no lower bound, and 170 N.m is where it starts, so that is where it stops.
 *
 *  PLUS THE HANDBRAKE BUG HE ASKED TO KEEP: "the rear brake torque is never cleared by the code,
 *  so after a handbrake slide the car can stay locked until you brake or get moving again."
 *     → REPRODUCED AS BEHAVIOUR, not as the same line of code. There is no persistent rear brake
 *       torque in this solver to leave uncleared — the handbrake works through rear grip
 *       (`hbMu`) and a yaw cap, both of which clear themselves. So the OBSERVABLE is rebuilt: a
 *       handbrake held longer than HB_LATCH seconds latches a lock that survives the release, and
 *       it clears on exactly the two things he names, the footbrake and getting moving again,
 *       plus a teleport (R, a rescue) because R must always be a way out — car/vehicle.js's
 *       `placeAt` says so in those words.
 *
 * OTHER NUMBERS FROM HIS SPEC, and where each one lives:
 *   mass 1000 kg, wheel radius 0.30 m ............ MICRO_TIERS below
 *   drive torque 2300 N.m split four ways ........ MICRO_TIERS: peakTorque x ratios[0] x
 *                                                  finalDrive x (1 - driveLoss) = 2308 N.m,
 *                                                  `drive: 'awd'` for the four-way split
 *   reverse 400 N.m .............................. REVERSE.force below (400 / 0.30 m / the
 *                                                  table's own 0.5 scale = 2667 N)
 *   brake 17000 N.m .............................. the FLEET entry's `feel.brakeMul`:
 *                                                  17000 / BRAKE.baseTorque(15500) = 1.097
 *   max steer 30 deg, applied instantly .......... STEER.maxAngle below; this solver's rack has
 *                                                  no lag of its own, so "instantly" is free
 *   steering input ramped at 3 units/sec .......... the FLEET entry's `feel.buildRate: 3.0`
 *   linear damping 0.1, angular 0.05 ............. applied per step as cannon does it,
 *                                                  v *= (1 - d)^dt. Only the PLANAR velocity and
 *                                                  the yaw rate: `vy` here is the suspension
 *                                                  degree of freedom, and damping it would sink
 *                                                  the car into its own springs.
 *   friction curves .............................. MICRO_FRICTION below, implemented exactly as
 *                                                  two smoothstep segments with zero tangents at
 *                                                  the keys, and then FITTED onto this solver's
 *                                                  own curve. See that block for what fits and
 *                                                  what does not — the rise shape does not.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT WRITE: anything `game/garage.js`'s `applyCarFeel` already
 * owns (TYRE.muLatRear, STEER.comfortG/attackG/buildBase/buildBonus/minRadius, BRAKE.torque,
 * TYRE.offRoadMul, the whole BODY table). Those belong in the fleet entry's `feel`, and two
 * writers on one field is how a restore clobbers the car you just switched TO. MICRO_FLEET at the
 * bottom of this file is the entry the integration agent should paste.
 */

import { TIERS, TYRE, STEER, SUSPENSION, REVERSE, AIR } from './tuning.js';
import { clamp, clamp01, angleDelta } from '../core/math.js';

/* ── HIS NUMBERS, AS DATA ────────────────────────────────────────────────────
 * Every figure the operator gave, in one object, so the diagnostic can assert against the same
 * source the solver reads rather than against a second copy that will drift. */
export const MICRO_SPEC = Object.freeze({
  hz: 50, // point 1
  comHeight: -0.02, // point 2: at/just UNDER the contact plane
  tyreForceHeight: 0.1, // point 3: 0.10 m above the contact patch
  downforcePerSpeed: 250, // point 4: newtons per (m/s), along the body's own -up
  steerHelper: 0.644, // point 5
  steerHelperMaxYaw: (10 * Math.PI) / 180, // point 5's guard
  hubLeft: -0.858, // point 6
  hubRight: 0.94, // point 6
  hubFrontLeftScale: 0.8, // point 6
  suspensionStiffness: 70000, // point 7, N/m per corner
  suspensionTravel: 0.2, // point 7, m
  driveTorque: 2300, // point 8, N.m total at the wheels
  tcInitialCut: 0.926, // point 8: starts at 2300 x (1 - 0.926) = 170 N.m
  tcStepTorque: 9.26, // point 8, N.m per fixed step
  mass: 1000,
  wheelRadius: 0.3,
  linearDamping: 0.1,
  angularDamping: 0.05,
  maxSteerDeg: 30,
  steerBuildRate: 3.0,
  reverseTorque: 400, // N.m
  brakeTorque: 17000, // N.m
});

/** Wheel-centroid offset as a fraction of half-track, from his two hub positions: +4.56%. Sign is
 *  the RIGHT-hand pair sitting further out, so the centroid moves toward the driver's right and the
 *  body hangs cocked to the left. tools/make-microcar.mjs derives the model's hubs from the same
 *  two constants, so the picture and the physics cannot disagree. */
export const HUB_SKEW = (MICRO_SPEC.hubRight + MICRO_SPEC.hubLeft) / (MICRO_SPEC.hubRight - MICRO_SPEC.hubLeft);

/** The pendulum's arm: from the axle line down to the centre of mass. Point 2. */
const PEND_ARM = MICRO_SPEC.wheelRadius - MICRO_SPEC.comHeight; // 0.32 m
/** The tyre force's moment arm about that centre of mass. Point 3. */
const FORCE_ARM = MICRO_SPEC.tyreForceHeight - MICRO_SPEC.comHeight; // 0.12 m
/** Damping ratio of the pendulum. Well under 1 on purpose: it must over-correct, not settle. */
const PEND_ZETA = 0.12;
/**
 * How much of the pendulum's lean is allowed to reach the RENDERER, in radians.
 *
 * car/loadedCar.js rotates the whole car — wheels included — about the contact plane, so every
 * degree of drawn roll pushes the outboard tyre halfTrack*sin(roll) into the terrain. That is the
 * measured "wheels are often clipping right through the ground" report, and it is why BODY.rollClamp
 * exists at all. 15 deg on the bubble's 0.525 m half-track is 0.136 m of tyre under the tarmac at
 * the very peak of a rock, which is the same trade the Scooter already ships (rollClamp 13 deg times
 * visualRollMul 1.9 = 24.7 deg on a 0.5 m half-track = 0.209 m). The PHYSICS still uses the full,
 * unclamped angle — the downforce shove and the rollover commit test both read `lean`, not this.
 */
const DISPLAY_LEAN_CLAMP = (15 * Math.PI) / 180;
/** car/vehicle.js's own TIP.commit, which is module-private there: past 1.02 x its static tipping
 *  angle the car is over. Mirrored rather than exported from vehicle.js, because exporting it would
 *  be an edit to the solver. If that number ever changes, change it here — the diagnostic prints
 *  both the angle and the threshold so a drift is visible. */
const TIP_COMMIT = 1.02;
/** Seconds of held handbrake before the lock latches. A tap must not strand anybody. */
const HB_LATCH = 0.25;
/** m/s above which "getting moving again" clears the lock, and the rate it bleeds speed at while
 *  it is on — 9 /s is car/vehicle.js's own STATIC_HOLD_RATE, so a locked micro-car feels exactly
 *  like the parked car the solver already knows how to hold. */
const STUCK_RELEASE = 2.0;
const STUCK_RATE = 9;
/** A single step that moves the car further than this is a teleport (R, a rescue, a spawn), which
 *  must always be a way out of everything — including the handbrake lock. */
const TELEPORT_M = 5;

/* ── THE FRICTION CURVES, AS HE WROTE THEM ───────────────────────────────────
 * "two smooth segments, zero tangents at the keys, smoothstep between"
 *   forward:  extremum (slip 0.4, mu 1.0) -> asymptote (slip 0.8, mu 0.5)
 *   sideways: extremum (slip 0.2, mu 1.0) -> asymptote (slip 0.5, mu 0.75)
 *
 * These are implemented properly and exported rather than paraphrased into two tuning numbers,
 * because they are the reference the fit below is measured against and tools/diag-microcar.mjs
 * prints the error.
 *
 * WHAT FITS AND WHAT DOES NOT. car/vehicle.js's tyre is a two-piece curve of its own —
 * sin(pi/2 * u^0.62) up to the peak, then floor + (1-floor)*exp(-0.125*(u-1)^1.45) — written in
 * NORMALISED slip and shared by every car in the fleet. Its exponents are a global design decision
 * argued at length in that file ("Fast off centre, then genuinely flat on top") and changing them
 * for one vehicle would change the whole game. So what is fitted is what CAN be fitted, per car:
 *
 *   PEAK LOCATION  exact. Sideways slip 0.2 is read as sin(alpha), giving a peak slip angle of
 *                  asin(0.2) = 11.537 deg, written into TYRE.peakSlipFront/Rear. (The fleet's own
 *                  cars peak at 8-9 deg, so this really is a different tyre and not a relabel.)
 *   PEAK mu        exact, 1.0, through TYRE.muLatFront here and `feel.rearGrip` in the fleet entry
 *                  (garage.js computes muLatRear as 1.34 * rearGrip, hence 0.746).
 *   TAIL           fitted. TYRE.tailFloor 0.336 is the least-squares fit of the solver's tail
 *                  against his curve over 11.5-51.6 deg of slip: RMS 0.070, worst 0.119. The
 *                  solver's tail is an exponential that keeps falling where his goes flat at 0.75,
 *                  so it cannot be exact; 0.336 is the closest it gets and it is still above the
 *                  stock 0.55 curve's value everywhere a driver actually reaches (0.855 vs 0.812
 *                  at 30 deg), so nothing is made more dangerous by it.
 *   RISE SHAPE     DOES NOT MAP, and this is the honest failure. His smoothstep builds gently —
 *                  8% of peak at 2 deg of slip — where this solver's tyre is at 51% by then. Worst
 *                  error 0.461, all of it below the peak. It is not fixable without editing
 *                  vehicle.js's RISE_POW, which every other car depends on.
 *
 *   FORWARD CURVE  partially maps, and it is worth knowing why. `longitudinalCurve()` in
 *                  car/vehicle.js is DEAD CODE — declared and called by nothing; the drive force is
 *                  limited by `TYRE.muLongPeak * grip * load` instead. So the forward curve's SHAPE
 *                  has no consumer at all. Its peak mu (1.0) and its peak slip (0.40) do have one:
 *                  muLongPeak sets the traction limit the point-8 ramp is measured against, and
 *                  peakSlipRatio normalises `vehicle.limit`, which drives the HUD, the audio and
 *                  the tyre note.
 */
const smoothstep = (t) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};

/** One of his curves. `slip` is in the same units as the keys. */
function frictionCurve(slip, exSlip, exMu, asySlip, asyMu) {
  const s = Math.abs(slip);
  if (s <= exSlip) return exMu * smoothstep(s / exSlip);
  if (s <= asySlip) return exMu + (asyMu - exMu) * smoothstep((s - exSlip) / (asySlip - exSlip));
  return asyMu;
}

/** Sideways: extremum (0.2, 1.0) -> asymptote (0.5, 0.75). `sinAlpha` = sin of the slip angle. */
export const microFrictionLat = (sinAlpha) => frictionCurve(sinAlpha, 0.2, 1.0, 0.5, 0.75);
/** Forward: extremum (0.4, 1.0) -> asymptote (0.8, 0.5). `slipRatio` is the usual dimensionless. */
export const microFrictionLong = (slipRatio) => frictionCurve(slipRatio, 0.4, 1.0, 0.8, 0.5);

/** The fitted parameters that put this solver's own curve as close to his as its shape allows. */
export const MICRO_TYRE = Object.freeze({
  peakSlipAngle: Math.asin(0.2), // 11.537 deg — his sideways extremum, read as sin(alpha)
  tailFloor: 0.336, // least-squares fit of the tail; see the block above
  muLat: 1.0,
  muLong: 1.0,
  peakSlipRatio: 0.4, // his forward extremum, verbatim
});

/* ── THE TWO TIERS ───────────────────────────────────────────────────────────
 * A tier, not a `feel`, for the reason tuning.js gives when it adds the Scooter and the Truck: mass,
 * gearing and drive layout are what `feel` cannot reach, and mass is what every force in the solver
 * is divided by. Both are 1000 kg on 0.30 m wheels with 2300 N.m at the wheels, which are his.
 *
 * `cgHeight` IS NOT HIS SUB-PLANE CENTRE OF MASS. See point 2 in the header at length: in this
 * solver that field is the height of the mass that has to be carried over the outer contact line,
 * and a value below the plane makes rollover impossible. It is the real body's own height, and the
 * pendulum rides on top of it.
 *
 * `track` on the three-wheeler is the honest bit of geometry that makes it a three-wheeler:
 *
 *   THE SUPPORT TRIANGLE. With one wheel at the front the car does not tip about a line parallel to
 *   its own axis, it tips about the line joining the single front contact to one rear contact. The
 *   distance from the centre of mass to that line is
 *
 *       a * halfTrackRear / hypot(wheelbase, halfTrackRear)
 *
 *   = 1.125 * 0.55 / hypot(1.94, 0.55) = 0.307 m, against the 0.55 m a four-wheeler of the same
 *   width would have. So `track` is 0.61: it is not a fudge, it is what the triangle measures, and
 *   it is the whole reason "it rolls over almost instantly". The same accommodation tuning.js
 *   already makes for the Scooter ("TRACK 1.0, and a scooter has no track at all — this is an honest
 *   accommodation"), arrived at the same way.
 *
 * AND THE MEASUREMENT THAT SET BOTH `cgHeight` FIGURES, which is worth writing down because it is
 * not what the arithmetic on its own predicts. A car lifts a wheel when the lateral force AT THE
 * CONTACT PATCH exceeds g * halfTrack / cgHeight. The obvious next step is to compare that against
 * what the tyres can make — 1.0 g here — and conclude that anything under 1.0 g of threshold rolls.
 * That is wrong, and tools/diag-microcar.mjs caught it: POINT 5's STEER HELPER IS DOING 64.4% OF THE
 * TURNING. It rotates the velocity vector to follow the nose, which is lateral acceleration the
 * TYRES never had to generate, so in a steady corner the contact patches were measured carrying only
 * 5.16 m/s^2 (0.53 g) while the car was actually pulling 10.5 m/s^2 (1.07 g) round a 7.6 m radius.
 * A three-wheeler whose threshold was set at 0.53 g on the naive sum therefore sat exactly on the
 * boundary and never went over at all.
 *
 * So the thresholds are set against the MEASURED ~0.53 g at the patch, not against the tyres' 1.0:
 * the three-wheeler at 0.42 g goes over in an ordinary corner, and the bubble at 0.95 g is nearly
 * twice clear of it and only rocks. Both `cgHeight` values below are then checked back against the
 * bodies tools/make-microcar.mjs actually draws (1.91 m and 1.98 m tall, luggage on the roof) — they
 * have to be honest heights as well as working ones, and they are.
 */
export const MICRO_TIERS = Object.freeze({
  micro: Object.freeze({
    name: 'Micro',
    mass: 1000, // his
    izz: 700, // m(L^2 + W^2)/12 for the 2.60 x 1.30 m body tools/make-microcar.mjs draws = 704
    wheelbase: 1.7, // the model's own axles, at +-0.85
    track: 1.05,
    /* 0.55 m. A 1.91 m tall body on a 1.30 m wide one, with two suitcases and a crate strapped to
     * the roof, carries its mass high — higher than the fleet's tallest, the truck at 0.62, is
     * relative to its own body. With half-track 0.525 that is a static tipping angle of 43.7 deg and
     * a wheel-lift threshold of 0.95 g at the contact patch, against the ~0.53 g a steady corner
     * measured there (see the steer-helper note above). Nearly twice clear: it leans horribly, it
     * rocks, and it does not actually go over — which is "SEEM to fall over every time you turn". */
    cgHeight: 0.55,
    weightRear: 0.56, // engine in the tail, as every real one of these had
    power: 20,
    /* 55 N.m x ratios[0] 4.5 x finalDrive 10.6 x (1 - driveLoss 0.12) = 2308 N.m at the wheels.
     * His 2300, arrived at from the drivetrain rather than pasted in. */
    peakTorque: 55,
    redline: 6600,
    cdA: 0.62,
    /* rollPerG 8.0 feeds the game's own cosmetic lean spring, which is SEPARATE from the pendulum
     * this module adds. Between the Scooter's 11.0 and the truck's 4.6: the drawn body should
     * already be leaning a lot before the pendulum starts throwing it about. */
    rollPerG: 8.0,
    topSpeed: 52,
    zeroTo60: 18, // it will never get there, which is correct for the vehicle
    ratios: [4.5, 2.6, 1.3], // three gears, because that is what these had
    finalDrive: 10.6,
    wheelRadius: 0.3, // his
    drive: 'awd', // his "split four ways"
  }),
  trike: Object.freeze({
    name: 'Three-Wheeler',
    mass: 1000,
    izz: 800, // the 2.95 x 1.28 m body: 1000 * (2.95^2 + 1.28^2)/12 = 862, trimmed for the taper
    wheelbase: 1.94, // the model's single front wheel at +1.02, rear axle at -0.92
    track: 0.61, // THE SUPPORT TRIANGLE — see the block above. Not the model's 1.10 rear track.
    /* 0.82 m, and this is the number that makes it fall over. A 1.98 m body, pinched to 0.24 m
     * across at the nose so almost none of its mass is low, with a bundle strapped across a 1.44 m
     * roof — over an effective half-track of 0.305 m. Static tipping angle 20.4 deg; wheel-lift at
     * 0.37 g at the contact patch, against the ~0.53 g an ordinary steady corner was measured to put
     * there.
     *
     * IT HAS TO BE WELL UNDER THAT BAR, NOT ON IT, and the measurements are the argument. At 0.58 m
     * (threshold 0.53 g, i.e. exactly the measured force) the car never went over at all. At 0.72 m
     * (0.42 g) it did, after 4.28 s of held steering, because the excess torque near the boundary is
     * tiny and the roll damper eats it. At 0.82 m (0.37 g) it goes over 2.83 s into an ordinary
     * corner — "almost instantly", which is what he asked for. tools/diag-microcar.mjs section 3
     * re-measures all of this every run. */
    cgHeight: 0.82,
    weightRear: 0.58,
    power: 18,
    peakTorque: 55,
    redline: 6400,
    cdA: 0.66,
    rollPerG: 9.5,
    topSpeed: 46,
    zeroTo60: 22,
    ratios: [4.5, 2.6, 1.34],
    finalDrive: 10.6,
    wheelRadius: 0.3,
    drive: 'awd',
  }),
});

/** Which fleet ids this module drives, and which tier each takes. */
const MICRO_BY_ID = { microcar: 'micro', threewheeler: 'trike' };

/**
 * Register the two tiers on the shared TIERS table.
 *
 * Idempotent, and called at module load so that a FLEET entry naming `tier: 'micro'` works the
 * instant garage.js imports anything from here — `Vehicle.setTier` silently falls back to the sports
 * tier for an unknown name, which would be a car that looks like a micro-car and drives like a
 * saloon, with nothing anywhere saying so.
 */
export function installMicroTiers() {
  for (const [key, spec] of Object.entries(MICRO_TIERS)) if (!TIERS[key]) TIERS[key] = { ...spec };
  return TIERS;
}
installMicroTiers();

/* ── the shared tables this module writes, and their stock values ────────────
 * Captured ONCE at module load, before anything has had a chance to change them — the identical
 * pattern game/garage.js uses for BODY_STOCK and STEER_MIN_RADIUS_DEFAULT, and for the identical
 * reason: a snapshot taken at attach time would capture whatever the LAST car left behind.
 *
 * Every key here is one `applyCarFeel` does not touch. That is not a coincidence, it is the rule —
 * see the note at the end of the header. */
const TYRE_KEYS = ['muLatFront', 'muLongPeak', 'peakSlipFront', 'peakSlipRear', 'peakSlipRatio', 'tailFloor'];
const STEER_KEYS = ['maxAngle'];
const SUSPENSION_KEYS = ['stiffness', 'travel', 'damping'];
const REVERSE_KEYS = ['force'];
const snapshot = (table, keys) => Object.freeze(Object.fromEntries(keys.map((k) => [k, table[k]])));
const TYRE_STOCK = snapshot(TYRE, TYRE_KEYS);
const STEER_STOCK = snapshot(STEER, STEER_KEYS);
const SUSPENSION_STOCK = snapshot(SUSPENSION, SUSPENSION_KEYS);
const REVERSE_STOCK = snapshot(REVERSE, REVERSE_KEYS);

/* EVERY MODIFIER CURRENTLY ATTACHED, because the tables above are global and the modifiers are not.
 * The game only ever has one player Vehicle, but a harness legitimately builds several — and the
 * first version of this module restored the stock tyres the moment ANY micro-car was released, which
 * silently gave a still-attached micro-car the fleet's grip, suspension and steering lock for the
 * rest of the run. It was tools/diag-microcar.mjs that caught it, reading a 40 degree steering lock
 * out of a table this module had written 30 into. So: restore only when the LAST one lets go, and
 * otherwise re-assert from whoever is left. */
const ATTACHED = new Set();

/**
 * Suspension damping for a given spring and mass, at a chosen damping ratio.
 *
 * car/vehicle.js applies the springs as a whole-car pair — `stiffness * 4 * compression / mass` and
 * `damping * 4 * (groundV - vy) / mass` — so the system's natural frequency is sqrt(4k/m) and the
 * per-corner damping that gives ratio `zeta` is zeta * omega * m / 2. Computed rather than typed so
 * it stays right if the mass or the spring ever moves. The fleet's own cars sit at zeta 0.54
 * (42000 N/m and 4200 N.s/m on 1450 kg); 0.34 is deliberately bouncier, which is point 7.
 */
function dampingFor(stiffness, mass, zeta) {
  const omega = Math.sqrt((4 * stiffness) / mass);
  return (zeta * omega * mass) / 2;
}

/* ── the modifier ────────────────────────────────────────────────────────── */

export class MicroPhysics {
  /**
   * @param {object} vehicle a car/vehicle.js Vehicle, already on the right tier
   * @param {string} tierKey 'micro' | 'trike'
   */
  constructor(vehicle, tierKey) {
    this.vehicle = vehicle;
    this.tierKey = tierKey;
    const tier = MICRO_TIERS[tierKey] || MICRO_TIERS.micro;

    /* THE PRIVATE SPEC CLONE. Point 8 works by scaling `peakTorque` every step, and `vehicle.spec`
     * is a reference to the SHARED TIERS record — mutating it would ramp the torque of every future
     * car built on that tier, including the ghost cars of other players. `setTier` reassigns
     * `this.spec` from the table anyway, so the clone lives exactly as long as this modifier. */
    this.basePeakTorque = (TIERS[vehicle.tier] || tier).peakTorque;
    vehicle.spec = { ...vehicle.spec };

    /* The permanent cock, point 6: the wheel centroid sits HUB_SKEW of a half-track toward the
     * driver's right, so the body's mass is that far to its LEFT of the support and hangs over.
     * Expressed as the CoM's lateral offset in the +X (left) direction, which is the sign the
     * pendulum equation below wants. */
    this.comOffset = HUB_SKEW * (vehicle.track * 0.5);
    this.restLean = -Math.asin(clamp(this.comOffset / PEND_ARM, -0.9, 0.9));

    // the pendulum, point 2, starting at rest — which is not level
    this.lean = this.restLean;
    this.leanV = 0;
    // point 8's ramp, as a fraction of full torque
    this.torqueFrac = 1 - MICRO_SPEC.tcInitialCut;
    this.torqueStep = MICRO_SPEC.tcStepTorque / MICRO_SPEC.driveTorque;
    // point 1's own accumulator
    this._acc = 0;
    this._fixedDt = 1 / MICRO_SPEC.hz;
    // point 5
    this._prevYaw = vehicle.yaw;
    // the handbrake bug
    this._hbHeld = 0;
    this.stuck = false;
    this._prevX = vehicle.x;
    this._prevZ = vehicle.z;
    this._wasRolled = false;
    // telemetry the diagnostic reads, so it never has to recompute what the modifier decided
    this.tipAngle = Math.atan2(vehicle.track * 0.5, vehicle.spec.cgHeight);
    this.commitAngle = TIP_COMMIT * this.tipAngle;
    this.rollovers = 0;
    this.fixedTicks = 0;

    ATTACHED.add(this);
    this.writeSharedTables();

    /* THE WRAP. An own property on this instance, shadowing the prototype method, so BOTH callers
     * are covered: main.js's `car.update(dt, input)` (which calls `this._step` per substep) and the
     * diagnostics' direct `car._step(PHYSICS_DT, input)`. `detach()` deletes the own property, which
     * uncovers the prototype's again — nothing is patched globally and no other Vehicle is touched. */
    this._baseStep = Object.getPrototypeOf(vehicle)._step;
    vehicle._step = (dt, input) => this.step(dt, input);
    vehicle.microPhysics = this;
  }

  /** Per-car values that live in the shared tuning tables. See the header for the split. */
  writeSharedTables() {
    TYRE.muLatFront = MICRO_TYRE.muLat;
    TYRE.muLongPeak = MICRO_TYRE.muLong;
    TYRE.peakSlipFront = MICRO_TYRE.peakSlipAngle;
    TYRE.peakSlipRear = MICRO_TYRE.peakSlipAngle;
    TYRE.peakSlipRatio = MICRO_TYRE.peakSlipRatio;
    TYRE.tailFloor = MICRO_TYRE.tailFloor;
    // 30 degrees of lock, and this solver's rack has no lag of its own, so "instantly" is free.
    STEER.maxAngle = (MICRO_SPEC.maxSteerDeg * Math.PI) / 180;
    SUSPENSION.stiffness = MICRO_SPEC.suspensionStiffness;
    SUSPENSION.travel = MICRO_SPEC.suspensionTravel;
    SUSPENSION.damping = dampingFor(MICRO_SPEC.suspensionStiffness, MICRO_SPEC.mass, 0.34);
    /* 400 N.m of reverse. The table's `force` is newtons before its own 0.5 `scale`, so
     * 400 N.m / 0.30 m / 0.5 = 2667 N — a fifth of the fleet's, which is right for a vehicle whose
     * whole reverse gear is a lever behind the seat. */
    REVERSE.force = MICRO_SPEC.reverseTorque / MICRO_SPEC.wheelRadius / REVERSE.scale;
  }

  /**
   * THE TYRE FORCE, per unit mass — which is NOT `vehicle.latAccel`, and getting that wrong is worth
   * a paragraph because the first version of this file did.
   *
   * car/vehicle.js writes `latAccel = fyBody/m - yawRate*vLong + slopeLat*contact`: the rate of
   * change of the body-frame lateral velocity, in a frame that is itself rotating. In a steady
   * corner that quantity goes to ZERO — the sideways velocity has stopped changing — and it can even
   * go negative while the tyres are working hardest. Driving point 3's roll torque from it measured a
   * three-wheeler that leant the WRONG WAY in a corner and then refused to fall over at all.
   *
   * What point 3 needs is the force the tyres are putting through the contact patch, which is
   * recovered by adding the centripetal term back: fyBody/m = latAccel + yawRate*vLong. The slope
   * term is dropped and that is deliberate, not laziness — gravity acts AT the centre of mass and
   * therefore exerts no roll torque about it, so a car cornering on a bank must not be leant by the
   * bank through this route. (car/vehicle.js's own tip solver makes the same argument at length: "a
   * car parked across a 30 degree slope does not tip".)
   */
  tyreLatAccel() {
    const v = this.vehicle;
    return v.latAccel + v.yawRate * v.speed;
  }

  /** Static sag, metres, from the numbers actually in the table. Point 7's own check. */
  get staticSag() {
    return (this.vehicle.mass * AIR.gravity) / (4 * SUSPENSION.stiffness);
  }

  /** Seconds from spawn to full power at the current ramp settings. Point 8's own check. */
  get rampSeconds() {
    return ((1 - (1 - MICRO_SPEC.tcInitialCut)) / this.torqueStep) * this._fixedDt;
  }

  /* ── one solver step ─────────────────────────────────────────────────────
   * pre -> the untouched `_step` -> post. Everything the modifier adds is in `post`, except the
   * torque ramp, which has to be in place BEFORE the drive force is computed. */
  step(dt, input) {
    const v = this.vehicle;

    // point 8, applied where the solver will read it
    v.spec.peakTorque = this.basePeakTorque * this.torqueFrac;

    this._baseStep.call(v, dt, input);

    this.post(dt, input);
  }

  post(dt, input) {
    const v = this.vehicle;
    const g = AIR.gravity;

    /* A teleport clears everything that could otherwise survive one: R must always be a way out,
     * which is car/vehicle.js's own rule for `placeAt`. Detected by distance rather than by hooking
     * `placeAt`, because hooking a second method would be a second thing to unhook. */
    const moved = Math.hypot(v.x - this._prevX, v.z - this._prevZ);
    if (moved > TELEPORT_M) {
      this.stuck = false;
      this.lean = this.restLean;
      this.leanV = 0;
      this._prevYaw = v.yaw;
    }
    this._prevX = v.x;
    this._prevZ = v.z;

    const vMag = Math.hypot(v.vx, v.vz);
    // point 4: newtons along the body's own -up, growing with speed rather than with speed squared
    const downforce = MICRO_SPEC.downforcePerSpeed * vMag;

    /* ── points 2, 3 and 4: the pendulum ───────────────────────────────────
     * phi'' = -(gEff/arm) sin(phi)          gravity, the huge restoring torque (point 2)
     *         - (gEff/arm^2) * comOffset    the permanent cock (point 6)
     *         - aLat * forceArm / arm^2     the tyre force above the CoM (point 3)
     *         - 2 zeta omega phi'           the dampers, deliberately not enough
     *
     * with the moment of inertia taken as the point-mass pendulum's, m*arm^2. That idealisation is
     * a choice and it is the one that matters: using a real body's own roll inertia about its centre
     * (roughly m*(W^2 + H^2)/12, four times larger here) drops the ring to 0.43 Hz, which is a slow
     * wallow rather than the rock he describes. sqrt(g/arm) = 0.88 Hz is the band this codebase has
     * already established you can SEE (game/garage.js, the Scooter).
     *
     * Frozen while the car is over on its side: the body is on its roof, not on its springs, and
     * car/vehicle.js's own committed-rollover branch owns the roll from that point until it rights
     * itself. */
    if (v.rolled) {
      this._wasRolled = true;
      this.leanV = 0;
    } else {
      if (this._wasRolled) {
        // it has just picked itself up — start again from rest, not from wherever it went over
        this._wasRolled = false;
        this.lean = this.restLean;
        this.leanV = 0;
      }
      const gEff = g + (downforce * Math.cos(this.lean)) / v.mass;
      const omega = Math.sqrt(gEff / PEND_ARM);
      let acc = -(gEff / PEND_ARM) * Math.sin(this.lean);
      acc -= (gEff / (PEND_ARM * PEND_ARM)) * this.comOffset;
      acc -= (this.tyreLatAccel() * FORCE_ARM) / (PEND_ARM * PEND_ARM);
      acc -= 2 * PEND_ZETA * omega * this.leanV;
      this.leanV += acc * dt;
      this.lean += this.leanV * dt;
      // A body that has swung past horizontal is not rocking any more, it is falling; the commit
      // test below will have taken it long before this, and this is only a numerical backstop.
      this.lean = clamp(this.lean, -Math.PI / 2, Math.PI / 2);
    }

    /* ── point 4: the sideways shove ───────────────────────────────────────
     * `roll` here is everything the body is actually doing — the ground under it, the game's own
     * cosmetic lean, the rollover DOF and the pendulum — because the downforce follows the BODY's
     * up axis, not any one contribution to it. The +X direction is the driver's left (see the
     * header), so `(cos yaw, -sin yaw)` is the body's left in world XZ, which is exactly the basis
     * car/vehicle.js's own `vLat = vx*cy - vz*sy` is written in. */
    const rollTotal = v.roll + this.lean;
    const aShove = (downforce / v.mass) * Math.sin(rollTotal);
    const cy = Math.cos(v.yaw);
    const sy = Math.sin(v.yaw);
    v.vx += aShove * cy * dt;
    v.vz += aShove * -sy * dt;

    /* ── cannon's own damping, at cannon's own rate ────────────────────────
     * v *= (1 - d)^dt, which is rate-based and therefore identical whether it is evaluated at 50 Hz
     * or 120 Hz — so it runs on the solver's step and is exact either way. Only the planar velocity
     * and the yaw rate: `vy` in this solver is the suspension degree of freedom rather than a free
     * body's vertical velocity, and damping it would slowly sink the car into its own springs. */
    const kLin = Math.pow(1 - MICRO_SPEC.linearDamping, dt);
    v.vx *= kLin;
    v.vz *= kLin;
    v.yawRate *= Math.pow(1 - MICRO_SPEC.angularDamping, dt);

    /* ── the handbrake bug he asked to keep ────────────────────────────────
     * Latches after a real slide, not a tap; clears on the footbrake ("until you brake"), on getting
     * moving again, and on a teleport. While it is on, the planar velocity is bled at the solver's
     * own static-hold rate, which at 9 /s beats the 7.7 m/s^2 this car can push with even at full
     * torque — so it genuinely will not pull away, which is the bug. */
    if (v.handbrake > 0.01) {
      this._hbHeld += dt;
    } else {
      if (this._hbHeld > HB_LATCH) this.stuck = true;
      this._hbHeld = 0;
    }
    if (input && input.brake > 0.05) this.stuck = false;
    if (Math.abs(v.speed) > STUCK_RELEASE) this.stuck = false;
    if (this.stuck) {
      const k = Math.exp(-STUCK_RATE * dt);
      v.vx *= k;
      v.vz *= k;
    }

    /* ── the rollover hand-over ────────────────────────────────────────────
     * The pendulum's lean and the solver's own `_tip` are the same physical roll, so the test is
     * taken on their SUM. Past 1.02 x the car's own static tipping angle it is over, and from there
     * car/vehicle.js's committed branch owns it entirely: gravity to the roof, a moment on its back,
     * then it picks itself up. Nothing about that machinery is reimplemented here — it is a cozy
     * game and "it always gets up again" is already written. */
    if (!v.rolled) {
      const combined = v._tip + this.lean;
      if (Math.abs(combined) > this.commitAngle) {
        v._tip = combined;
        v._tipV += this.leanV;
        v.rolled = true;
        v._rollTimer = 0;
        this.lean = 0;
        this.leanV = 0;
        this._wasRolled = true;
        this.rollovers++;
      }
    }

    /* What the renderer gets, clamped — see DISPLAY_LEAN_CLAMP. The physics above used the full
     * angle; this is the only place it is limited, and it is limited for the tyres-through-the-road
     * reason car/loadedCar.js and BODY.rollClamp both already exist for. */
    v.roll += clamp(this.lean, -DISPLAY_LEAN_CLAMP, DISPLAY_LEAN_CLAMP);

    /* ── point 1: the 50 Hz items ──────────────────────────────────────────
     * An accumulator rather than a counter, so it is correct whatever `dt` the caller uses. */
    this._acc += dt;
    let guard = 0;
    while (this._acc >= this._fixedDt && guard++ < 8) {
      this._acc -= this._fixedDt;
      this.fixedStep(input);
    }
  }

  /** Point 5 and point 8, both of which he specifies PER FIXED STEP. */
  fixedStep(input) {
    const v = this.vehicle;
    this.fixedTicks++;

    /* POINT 5 — the steer helper. All four wheels down means: on the ground, not over on its side,
     * and no tyre lifted by the tip solver (`forces.contact` is 1 only while every contact patch is
     * still loaded — car/vehicle.js fades it from 0.65 x the tipping angle). `wheels[i].contact` is
     * NOT used: that field is declared in the constructor and never written, so reading it would be
     * reading a constant `true`. */
    const grounded = v.onGround && !v.rolled && v.forces.contact > 0.999;
    if (grounded) {
      const d = angleDelta(this._prevYaw, v.yaw);
      if (Math.abs(d) < MICRO_SPEC.steerHelperMaxYaw) {
        const a = d * MICRO_SPEC.steerHelper;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const vx = v.vx;
        const vz = v.vz;
        // the same sense as the yaw itself: forward is (sin yaw, cos yaw), so a yaw increment of `a`
        // takes (x, z) to (x cos a + z sin a, -x sin a + z cos a).
        v.vx = vx * c + vz * s;
        v.vz = -vx * s + vz * c;
      }
      // Updated even on the 10-degree skip — see point 5 in the header for why not doing so is a
      // latch that kills the helper for the rest of the session.
      this._prevYaw = v.yaw;
    }
    // and NOT updated when airborne, which is his instruction, verbatim.

    /* POINT 8 — the ramp. Wheelspin in this solver is the drive force sitting at the traction limit:
     * `forces.drive` and `forces.traction` are both recorded every step by car/vehicle.js's own
     * telemetry block, which exists because "full throttle and the car does not move" was
     * undiagnosable from outside. `traction > 1` guards the standing-start case where it is 0. */
    const spinning =
      v.forces.traction > 1 && Math.abs(v.forces.drive) >= v.forces.traction * 0.98 && (input ? input.throttle > 0.1 : v.throttle > 0.1);
    this.torqueFrac = clamp(this.torqueFrac + (spinning ? -this.torqueStep : this.torqueStep), 1 - MICRO_SPEC.tcInitialCut, 1);
  }

  /** Put the shared tables back and unwrap the vehicle. Safe to call twice. */
  detach() {
    const v = this.vehicle;
    if (v && v.microPhysics === this) {
      delete v._step;
      delete v.microPhysics;
      // back to the shared tier record, undoing the private clone
      if (TIERS[v.tier]) v.spec = TIERS[v.tier];
    }
    ATTACHED.delete(this);
    const other = ATTACHED.values().next().value;
    if (other) {
      other.writeSharedTables(); // somebody else still needs them — see ATTACHED
      return;
    }
    Object.assign(TYRE, TYRE_STOCK);
    Object.assign(STEER, STEER_STOCK);
    Object.assign(SUSPENSION, SUSPENSION_STOCK);
    Object.assign(REVERSE, REVERSE_STOCK);
  }
}

/* ── the integration surface ─────────────────────────────────────────────── */

/** Is this fleet entry (or id) one of the micro-cars? */
export function isMicroCar(carOrId) {
  const id = typeof carOrId === 'string' ? carOrId : carOrId && carOrId.id;
  return !!MICRO_BY_ID[id];
}

/** Remove any modifier from a vehicle and put the shared tables back. Safe on a plain car. */
export function detachMicroPhysics(vehicle) {
  if (vehicle && vehicle.microPhysics) vehicle.microPhysics.detach();
}

/**
 * Attach the micro-car feel to `vehicle` if `carOrId` is one of them, or take it off if it is not.
 *
 * IDEMPOTENT AND TOTAL, on purpose: one call handles both directions, so the integration is a single
 * line in each of the two places main.js decides what car you are in, and calling it with a plain
 * car is how the tables get put back. Call it AFTER `applyCarFeel` and `setTier`, because it reads
 * `vehicle.track` and `vehicle.spec` and writes tuning fields `applyCarFeel` must not overwrite.
 *
 * @param {object} vehicle a car/vehicle.js Vehicle
 * @param {object|string|null} carOrId a game/garage.js FLEET entry, or its id
 * @returns {MicroPhysics|null} the modifier, or null if this car is not a micro-car
 */
export function applyMicroPhysics(vehicle, carOrId) {
  if (!vehicle) return null;
  const id = typeof carOrId === 'string' ? carOrId : carOrId && carOrId.id;
  const tierKey = MICRO_BY_ID[id];
  if (vehicle.microPhysics) {
    if (vehicle.microPhysics.tierKey === tierKey) {
      // Already the right modifier. Re-assert the tables anyway: this is the call main.js makes on
      // every car switch, `applyCarFeel` has just run, and re-asserting costs eleven assignments.
      vehicle.microPhysics.writeSharedTables();
      return vehicle.microPhysics;
    }
    vehicle.microPhysics.detach();
  }
  if (!tierKey) return null;
  return new MicroPhysics(vehicle, tierKey);
}

/* ── WHAT THE INTEGRATION AGENT SHOULD ADD TO game/garage.js's FLEET ─────────
 *
 * NOT added here, and not added to FLEET by this module either — the operator's instruction was
 * explicit that the fleet ordering and the choice of starter car are not this module's to make.
 * These are ready to paste, in fleet order wherever they belong.
 *
 * Everything in `feel` is a field `applyCarFeel` owns; everything this module writes is a field it
 * does not. That split is the whole reason a car switch does not clobber the car being switched to.
 *
 * THE ECONOMY FIELDS ARE PLACEHOLDERS AND ARE MARKED AS SUCH. `unlockAt: 0` and `price: 0` are here
 * only so that a paste of these entries cannot soft-lock anything — garage.js's `isUnlocked` does
 * `best >= car.unlockAt`, and an absent `unlockAt` makes that comparison against `undefined`, which
 * is false for ever. Where these two sit on the ladder, what they cost, whether either gets an
 * `earnAt`, and whether one of them becomes FLEET[0] (which is what `FIRST_CAR` reads) are all the
 * integration agent's calls, not this module's.
 *
 * NOT FROZEN, unlike MICRO_SPEC and MICRO_TIERS above: those are the operator's numbers and must not
 * be edited, whereas these are templates meant to be pasted and adjusted.
 */
export const MICRO_FLEET = [
  {
    id: 'microcar',
    unlockAt: 0, // PLACEHOLDER — see the note above
    price: 0, // PLACEHOLDER
    file: 'microcar.glb',
    label: 'Bubble', // no trademark, deliberately — see tools/make-microcar.mjs
    blurb: 'Taller than it is wide, with the luggage on the roof. Leans like it means it.',
    tier: 'micro',
    length: 2.6, // the model's own z extent, so car/loadedCar.js scales it by exactly 1
    feel: {
      /* comfortG 7.2, which is the soft Estate's number and NOT a low one, and that is the whole
       * trick. `comfortG` is how much lateral acceleration full stick ASKS for, so a low value makes
       * a car that refuses to turn — not a car that falls over. The falling-over lives in the
       * geometry (`track` and `cgHeight` in the tier), and for it to be reachable the driver has to
       * be allowed to ask for an ordinary corner in the first place. The bubble needs 0.95 g at the
       * contact patch to lift a wheel and an ordinary corner puts about 0.53 g there, so it leans
       * horribly and survives. */
      comfortG: 7.2,
      assist: 'cruise', // it needs the help
      rearGrip: 0.746, // garage.js computes muLatRear = 1.34 * this, giving his sideways mu of 1.0
      buildRate: 3.0, // his "steering input ramped at 3 units/sec"
      brakeMul: 1.097, // his 17000 N.m over BRAKE.baseTorque's 15500
      minRadius: 3.6, // a 2.6 m car turns round inside a lane, and it should
      body: {
        // the game's own cosmetic lean spring, loosened so the drawn body agrees with the pendulum
        // rather than fighting it. Same three fields the Scooter takes back, same reasoning.
        rollOmega: 6.2,
        rollZeta: 0.55,
        loadTauRoll: 0.24,
        rollClamp: (11 * Math.PI) / 180,
        visualRollMul: 1.5,
      },
    },
  },
  {
    id: 'threewheeler',
    unlockAt: 0, // PLACEHOLDER — see the note above
    price: 0, // PLACEHOLDER
    file: 'threewheeler.glb',
    label: 'Tricycle',
    blurb: 'Three wheels. One at the front. It will roll over, and then it will get up again.',
    tier: 'trike',
    length: 2.95,
    feel: {
      /* 8.4 — the pickup's number, i.e. an entirely ordinary corner request. See the bubble's note
       * above: the point is that the driver asks for a normal corner and the car goes over, which is
       * only possible if a normal corner is askable. Its own wheel-lift threshold is 0.37 g, under
       * the ~0.53 g the same corner delivers — measured, see the tier note. */
      comfortG: 8.4,
      assist: 'cruise',
      rearGrip: 0.746,
      buildRate: 3.0,
      brakeMul: 1.097,
      minRadius: 3.4,
      body: {
        rollOmega: 6.0,
        rollZeta: 0.5,
        loadTauRoll: 0.24,
        rollClamp: (12 * Math.PI) / 180,
        visualRollMul: 1.6,
      },
    },
  },
];
