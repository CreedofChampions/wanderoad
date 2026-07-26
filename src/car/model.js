/* Wanderoad — the player's car.
 *
 * Built entirely out of render/painted.js, which is the same pipeline the pen's village
 * and locomotive are made of: flat colour bands, per-vertex colour, per-vertex material
 * slot, one draw call per mesh. No PBR, no textures, no imported model. If it looks like
 * a different hand painted it, that is a bug.
 *
 * Frame (matches world/terrain.js's `heading = atan2(dx, dz)`, so `group.rotation.y =
 * heading` just works):
 *   +Z  nose            +Y  up            +X  the driver's left
 *   y = 0 is the contact patch — the physics puts the group on the road surface, not
 *   at the car's centre of mass.
 *
 * Rig:
 *   group
 *     chassis   — rolls and pitches; carries the body shell only
 *     steer×2   — front hub pivots, yaw only
 *       wheel   — spins about its own X
 *     wheel×2   — rear, straight on the group
 * The wheels hang off `group` and NOT off `chassis` on purpose: the body leans, the
 * contact patches do not. Rolling the wheels with the body is the single most common way
 * an arcade car ends up looking like a toy.
 *
 * Budget: the car is drawn twice for the local player (colour + sun shadow) and up to 16
 * more times for other players, so the whole thing is ~1.8 k triangles across 5 meshes.
 * Read `.triangles` if you change the shape and want to check.
 */

import { Group, Mesh } from 'three';
import {
  PB, pbox, pcyl, pquad, finishPainted, createPaintedMaterial, createPaintedDepthMaterial,
  MAT, LC, tint, mixc,
} from '../render/painted.js';
import { TAU, lerp, clamp01 } from '../core/math.js';

/** Tier ids, in the order car/tuning.js declares them. */
export const CAR_TIERS = ['gt', 'sports', 'hyper'];

/**
 * The paint chips. Six straight off the palette's paintA..paintF plus two mixes, because
 * eight cars in a lobby all wearing one of six colours is a coincidence you notice.
 * `body` is the shell, `accent` the stripe/trim that reads against it.
 */
export const PAINTS = [
  { name: 'Persimmon', body: LC('paintA'), accent: LC('paintD') },
  { name: 'Barley', body: LC('paintB'), accent: LC('paintF') },
  { name: 'Cobalt', body: LC('paintC'), accent: LC('paintD') },
  { name: 'Chalk', body: LC('paintD'), accent: LC('paintF') },
  { name: 'Verdigris', body: LC('paintE'), accent: LC('paintD') },
  { name: 'Ink', body: LC('paintF'), accent: LC('paintB') },
  { name: 'Rust', body: mixc(LC('paintA'), LC('paintF'), 0.42), accent: LC('paintB') },
  { name: 'Seafoam', body: mixc(LC('paintE'), LC('paintD'), 0.45), accent: LC('paintC') },
];

/* ── the three silhouettes ─────────────────────────────────────────────────────
 * A station is one cross-section of the shell: `yb`/`wb` the floor edge, `yt`/`wt` the
 * beltline edge, and the flank is the ruled surface between them. Stations run nose to
 * tail. Everything else on the car — lamps, mirrors, sills — is positioned by sampling
 * this table, so moving a station moves the details with it.
 *
 * The wheels deliberately intersect the shell: the top of a tyre is inside the body
 * volume and the flank cuts across it, which is exactly the line a wheel arch draws.
 * Nothing is booleaned, nothing needs to be.
 */
const SHAPE = {
  // Long bonnet, cabin set back, roof falling all the way into the tail.
  gt: {
    hull: [
      { z: 2.35, yb: 0.34, yt: 0.74, wb: 0.56, wt: 0.62 },
      { z: 1.98, yb: 0.26, yt: 0.80, wb: 0.78, wt: 0.82 },
      { z: 1.39, yb: 0.22, yt: 0.86, wb: 0.86, wt: 0.92 },
      { z: 0.60, yb: 0.22, yt: 0.90, wb: 0.88, wt: 0.92 },
      { z: -0.10, yb: 0.22, yt: 0.94, wb: 0.88, wt: 0.92 },
      { z: -0.95, yb: 0.24, yt: 0.96, wb: 0.88, wt: 0.90 },
      { z: -1.39, yb: 0.26, yt: 0.94, wb: 0.86, wt: 0.88 },
      { z: -2.35, yb: 0.44, yt: 0.82, wb: 0.62, wt: 0.66 },
    ],
    cabin: [
      { z: 0.58, yb: 0.86, yt: 0.99, wb: 0.84, wt: 0.66 },
      { z: -0.14, yb: 0.90, yt: 1.36, wb: 0.82, wt: 0.62 },
      { z: -0.86, yb: 0.92, yt: 1.36, wb: 0.82, wt: 0.62 },
      { z: -2.06, yb: 0.84, yt: 0.98, wb: 0.74, wt: 0.50 },
    ],
    axle: [1.39, -1.39],
    track: [0.80, 0.80],
    wheel: { rf: 0.34, rr: 0.35, wf: 0.145, wr: 0.155 },
    lamps: 'round', tail: 'blocks', wing: 'none', intakes: false,
  },
  // Mid-engined wedge: chisel nose, short bonnet, engine deck rising behind the cabin.
  sports: {
    hull: [
      { z: 2.15, yb: 0.26, yt: 0.60, wb: 0.54, wt: 0.64 },
      { z: 1.72, yb: 0.20, yt: 0.70, wb: 0.80, wt: 0.88 },
      { z: 1.28, yb: 0.18, yt: 0.76, wb: 0.86, wt: 0.94 },
      { z: 0.45, yb: 0.18, yt: 0.84, wb: 0.88, wt: 0.94 },
      { z: -0.35, yb: 0.20, yt: 0.96, wb: 0.90, wt: 0.96 },
      { z: -1.05, yb: 0.22, yt: 1.02, wb: 0.90, wt: 0.96 },
      { z: -1.28, yb: 0.24, yt: 1.02, wb: 0.88, wt: 0.94 },
      { z: -2.15, yb: 0.46, yt: 0.88, wb: 0.70, wt: 0.74 },
    ],
    cabin: [
      { z: 0.42, yb: 0.80, yt: 0.88, wb: 0.80, wt: 0.58 },
      { z: -0.18, yb: 0.86, yt: 1.24, wb: 0.78, wt: 0.56 },
      { z: -0.66, yb: 0.90, yt: 1.24, wb: 0.76, wt: 0.54 },
      { z: -1.02, yb: 0.92, yt: 1.02, wb: 0.72, wt: 0.46 },
    ],
    axle: [1.28, -1.28],
    track: [0.80, 0.82],
    wheel: { rf: 0.33, rr: 0.35, wf: 0.15, wr: 0.175 },
    lamps: 'slim', tail: 'blocks', wing: 'lip', intakes: true,
  },
  // Low and wide: floor almost on the road, full-width tail bar, standing rear wing.
  hyper: {
    hull: [
      { z: 2.30, yb: 0.16, yt: 0.48, wb: 0.64, wt: 0.76 },
      { z: 1.85, yb: 0.14, yt: 0.58, wb: 0.92, wt: 1.00 },
      { z: 1.35, yb: 0.13, yt: 0.66, wb: 0.96, wt: 1.03 },
      { z: 0.50, yb: 0.13, yt: 0.74, wb: 0.96, wt: 1.02 },
      { z: -0.30, yb: 0.14, yt: 0.88, wb: 0.98, wt: 1.03 },
      { z: -1.05, yb: 0.16, yt: 0.96, wb: 0.98, wt: 1.03 },
      { z: -1.35, yb: 0.18, yt: 0.96, wb: 0.96, wt: 1.00 },
      { z: -2.30, yb: 0.36, yt: 0.84, wb: 0.78, wt: 0.84 },
    ],
    cabin: [
      { z: 0.46, yb: 0.70, yt: 0.80, wb: 0.82, wt: 0.54 },
      { z: -0.14, yb: 0.80, yt: 1.16, wb: 0.80, wt: 0.50 },
      { z: -0.62, yb: 0.84, yt: 1.16, wb: 0.78, wt: 0.48 },
      { z: -1.06, yb: 0.86, yt: 0.98, wb: 0.72, wt: 0.42 },
    ],
    axle: [1.35, -1.35],
    track: [0.84, 0.85],
    wheel: { rf: 0.34, rr: 0.36, wf: 0.165, wr: 0.20 },
    lamps: 'slim', tail: 'bar', wing: 'high', intakes: true,
  },
};

/* ── shell helpers ─────────────────────────────────────────────────────────── */

const ring = (s) => [
  [s.wb, s.yb, s.z], [-s.wb, s.yb, s.z], [-s.wt, s.yt, s.z], [s.wt, s.yt, s.z],
];

/** Loft a station table into a closed shell. Outward hints keep the winding honest. */
function loft(M, st, col, mat, capFront = true, capBack = true) {
  let A = ring(st[0]);
  if (capFront) pquad(M, A[0], A[1], A[2], A[3], col, mat, [0, 0, 1]);
  for (let i = 1; i < st.length; i++) {
    const B = ring(st[i]);
    pquad(M, A[0], A[3], B[3], B[0], col, mat, [1, 0, 0]);   // left flank
    pquad(M, A[1], A[2], B[2], B[1], col, mat, [-1, 0, 0]);  // right flank
    pquad(M, A[3], A[2], B[2], B[3], col, mat, [0, 1, 0]);   // deck
    pquad(M, A[0], A[1], B[1], B[0], col, mat, [0, -1, 0]);  // floor
    A = B;
  }
  if (capBack) pquad(M, A[0], A[1], A[2], A[3], col, mat, [0, 0, -1]);
}

/** The shell's cross-section at an arbitrary z, so details can be hung off the body. */
function hullAt(st, z) {
  if (z >= st[0].z) return st[0];
  for (let i = 1; i < st.length; i++) {
    if (z >= st[i].z) {
      const a = st[i - 1], b = st[i], t = (a.z - z) / (a.z - b.z);
      return {
        z,
        yb: lerp(a.yb, b.yb, t), yt: lerp(a.yt, b.yt, t),
        wb: lerp(a.wb, b.wb, t), wt: lerp(a.wt, b.wt, t),
      };
    }
  }
  return st[st.length - 1];
}

/** A flat annulus in the YZ plane — the tyre sidewall and the rim face. */
function pring(M, x, r0, r1, seg, col, mat, nx) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    pquad(M,
      [x, r0 * c0, r0 * s0], [x, r0 * c1, r0 * s1],
      [x, r1 * c1, r1 * s1], [x, r1 * c0, r1 * s0],
      col, mat, [nx, 0, 0]);
  }
}

/* ── the wheel ─────────────────────────────────────────────────────────────────
 * Axle along local X, so spin is rotation.x and the steering pivot above it is
 * rotation.y. Open-centred on purpose: the brake disc is a separate glowing slot
 * (MAT.LAMP_C) sitting behind the spokes, and if the rim face were a solid disc you
 * would never see it come up to temperature.
 */
function buildWheelGeometry(r, hw) {
  const M = PB();
  const tyre = LC('tyre');
  const rim = mixc(LC('chrome'), LC('paintF'), 0.34);
  const hub = tint(LC('chrome'), 0.72);
  // A dark iron that goes cherry: the lamp channel multiplies this colour, so it has to
  // start warm or braking hard just makes the disc grey and bright.
  const disc = mixc(LC('tyre'), LC('tail'), 0.34);

  pcyl(M, [-hw, 0, 0], [hw, 0, 0], r, r, 14, tyre, MAT.MATTE, false, false);      // tread
  pring(M, hw, r, r * 0.68, 14, tint(tyre, 1.18), MAT.MATTE, 1);                  // sidewalls
  pring(M, -hw, r, r * 0.68, 14, tint(tyre, 1.18), MAT.MATTE, -1);
  pcyl(M, [-hw * 0.92, 0, 0], [hw * 0.92, 0, 0], r * 0.68, r * 0.68, 8, tint(rim, 0.7), MAT.METAL, false, false);
  pring(M, hw * 0.92, r * 0.68, r * 0.52, 12, rim, MAT.METAL, 1);                 // rim lip
  pring(M, -hw * 0.92, r * 0.68, r * 0.52, 12, rim, MAT.METAL, -1);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU, ca = Math.cos(a), sa = Math.sin(a);
    for (const s of [-1, 1]) {
      const x = s * hw * 0.9;
      pcyl(M, [x, r * 0.18 * ca, r * 0.18 * sa], [x, r * 0.56 * ca, r * 0.56 * sa],
        r * 0.07, r * 0.06, 4, rim, MAT.METAL, false, false);
    }
  }
  pcyl(M, [-hw * 0.96, 0, 0], [hw * 0.96, 0, 0], r * 0.19, r * 0.19, 8, hub, MAT.METAL, true, true);
  pcyl(M, [-hw * 0.42, 0, 0], [hw * 0.42, 0, 0], r * 0.60, r * 0.60, 12, disc, MAT.LAMP_C, true, true);
  return finishPainted(M);
}

/* ── the shell ─────────────────────────────────────────────────────────────── */

function buildBodyGeometry(t, paint, ghost) {
  const M = PB();
  const body = paint.body;
  const accent = paint.accent;
  const dark = LC('paintF');
  const chrome = LC('chrome');
  const glass = LC('glass');
  const head = LC('head');
  const tailC = LC('tail');

  const noseZ = t.hull[0].z;
  const tailZ = t.hull[t.hull.length - 1].z;
  const nose = t.hull[0];
  const rear = t.hull[t.hull.length - 1];

  // MAT.BODY, not MAT.METAL: metal's ramp puts a hot sun rim on every panel and its tight
  // bands bleach a whole shell to a pale wash. Coach paint keeps the hue through all three
  // bands — see painted.js MAT.BODY, and tools/diag-carpaint.mjs for the numbers.
  loft(M, t.hull, body, MAT.BODY);
  // Glasshouse first, then a painted roof panel laid on top of it — the pen's own trick
  // for the coach body: one loft cannot be two materials, so it is two lofts.
  loft(M, t.cabin, glass, MAT.GLASS);
  const roofA = t.cabin[1], roofB = t.cabin[2];
  pbox(M, 0, roofA.yt + 0.012, (roofA.z + roofB.z) * 0.5,
    roofA.wt * 0.94, 0.02, Math.abs(roofA.z - roofB.z) * 0.5 + 0.05, 0, body, MAT.BODY);

  // Sills: a dark band under the doors between the axles. Without it a flat-shaded car
  // reads as a bar of soap.
  const sillZ = (t.axle[0] + t.axle[1]) * 0.5;
  const sill = hullAt(t.hull, sillZ);
  for (const s of [-1, 1]) {
    pbox(M, s * (sill.wb + 0.01), sill.yb + 0.07, sillZ,
      0.035, 0.07, (t.axle[0] - t.axle[1]) * 0.5 - 0.34, 0, dark, MAT.MATTE);
  }

  // Front: splitter, intake, lamps. The intake is MAT.GLASS so it reads as a hole rather
  // than a black sticker.
  pbox(M, 0, nose.yb + 0.015, noseZ - 0.14, nose.wb * 1.02, 0.025, 0.18, 0, dark, MAT.MATTE);
  pbox(M, 0, lerp(nose.yb, nose.yt, 0.28), noseZ - 0.03, nose.wb * 0.72, 0.09, 0.06, 0, dark, MAT.GLASS);
  const lampY = lerp(nose.yt, nose.yb, 0.26);
  for (const s of [-1, 1]) {
    const x = s * (nose.wt * 0.62);
    if (t.lamps === 'round') {
      pcyl(M, [x, lampY, noseZ - 0.12], [x, lampY, noseZ + 0.03], 0.115, 0.105, 8, head, MAT.LAMP_A, false, true);
      pcyl(M, [x, lampY, noseZ - 0.14], [x, lampY, noseZ - 0.11], 0.125, 0.125, 8, chrome, MAT.METAL, false, true);
    } else {
      pbox(M, x, lampY, noseZ - 0.02, 0.20, 0.045, 0.08, 0, head, MAT.LAMP_A);
      pbox(M, x, lampY - 0.055, noseZ - 0.03, 0.20, 0.02, 0.07, 0, dark, MAT.MATTE);
    }
  }

  // Tail: a bumper band across the bottom, then lights, then the tier's aero. The band is
  // there because a lofted tail cap is one big flat quad, and one big flat quad in a
  // three-band shading model reads as a wall.
  pbox(M, 0, rear.yb + 0.17, tailZ + 0.015, rear.wb * 0.94, 0.06, 0.04, 0, dark, MAT.MATTE);
  const tailY = lerp(rear.yt, rear.yb, 0.34);
  if (t.tail === 'bar') {
    pbox(M, 0, tailY, tailZ + 0.02, rear.wt * 0.82, 0.035, 0.05, 0, tailC, MAT.LAMP_B);
  } else {
    for (const s of [-1, 1]) {
      pbox(M, s * rear.wt * 0.55, tailY, tailZ + 0.02, 0.22, 0.05, 0.05, 0, tailC, MAT.LAMP_B);
    }
  }
  if (t.wing === 'lip') {
    pbox(M, 0, rear.yt + 0.04, tailZ + 0.16, rear.wt * 0.90, 0.035, 0.14, 0, body, MAT.BODY);
  } else if (t.wing === 'high') {
    const wz = tailZ + 0.24, wy = rear.yt + 0.30;
    pbox(M, 0, wy, wz, rear.wt * 0.92, 0.025, 0.16, 0, body, MAT.BODY);
    for (const s of [-1, 1]) {
      pbox(M, s * rear.wt * 0.92, wy - 0.02, wz, 0.02, 0.10, 0.20, 0, accent, MAT.BODY);
      pbox(M, s * 0.30, wy - 0.16, wz - 0.02, 0.03, 0.16, 0.05, 0, dark, MAT.METAL);
    }
  }

  // Flank intakes ahead of the rear wheels — the cue that says the engine is behind you.
  if (t.intakes) {
    const iz = t.axle[1] + 0.62;
    const h = hullAt(t.hull, iz);
    for (const s of [-1, 1]) {
      pbox(M, s * (lerp(h.wb, h.wt, 0.55) + 0.005), lerp(h.yb, h.yt, 0.58), iz, 0.03, 0.10, 0.26, 0, dark, MAT.GLASS);
      pbox(M, s * (lerp(h.wb, h.wt, 0.55) + 0.02), lerp(h.yb, h.yt, 0.58), iz + 0.28, 0.02, 0.11, 0.05, 0, accent, MAT.BODY);
    }
  }

  // Mirrors: two pieces each, and worth every triangle — they are most of what tells you
  // which way a distant car is pointing.
  const mz = t.cabin[0].z + 0.06;
  const mh = hullAt(t.hull, mz);
  for (const s of [-1, 1]) {
    const x = s * (mh.wt + 0.02);
    pcyl(M, [x, mh.yt + 0.02, mz], [x + s * 0.09, mh.yt + 0.09, mz - 0.02], 0.018, 0.018, 4, dark, MAT.MATTE, false, false);
    pbox(M, x + s * 0.11, mh.yt + 0.10, mz - 0.03, 0.035, 0.045, 0.075, 0, body, MAT.BODY);
  }

  if (!ghost) {
    // Interior: two headrests and a dash line, seen through the glass and nothing more.
    // The ghost variant drops all of it — nobody reads another player's cabin at 60 m.
    const cab = t.cabin[1];
    for (const s of [-1, 1]) {
      pbox(M, s * 0.32, cab.yt - 0.22, cab.z - 0.16, 0.13, 0.11, 0.05, 0, dark, MAT.MATTE);
      pbox(M, s * 0.32, cab.yt - 0.40, cab.z - 0.02, 0.17, 0.10, 0.20, 0, tint(dark, 1.5), MAT.MATTE);
    }
    pbox(M, 0, cab.yb + 0.06, t.cabin[0].z - 0.10, cab.wb * 0.80, 0.05, 0.12, 0, tint(dark, 1.2), MAT.MATTE);

    // Underbody: diffuser fins and two pipes. Only ever seen from behind, so the ghost
    // skips them too.
    for (let i = -1; i <= 1; i++) {
      pbox(M, i * rear.wb * 0.42, rear.yb + 0.06, tailZ + 0.18, 0.025, 0.06, 0.18, 0, dark, MAT.MATTE);
    }
    for (const s of [-1, 1]) {
      pcyl(M, [s * 0.22, rear.yb + 0.06, tailZ + 0.12], [s * 0.22, rear.yb + 0.06, tailZ - 0.03],
        0.042, 0.047, 6, tint(chrome, 0.72), MAT.METAL, false, true);
    }
  }

  return finishPainted(M);
}

/* ── assembly ──────────────────────────────────────────────────────────────── */

function assemble(tierName, paintIndex, ghost) {
  // A tier arrives either as its id or, off the wire (net/remotes.js sends 'p.tier | 0'),
  // as an index into CAR_TIERS. Anything else is a caller bug and not a reason to throw
  // in the middle of a race: fall back to the middle car.
  const key = typeof tierName === 'number'
    ? CAR_TIERS[tierName] || 'sports'
    : (CAR_TIERS.indexOf(tierName) >= 0 ? tierName : 'sports');
  const t = SHAPE[key];
  const n = PAINTS.length;
  const paint = PAINTS[(((paintIndex | 0) % n) + n) % n];

  const material = createPaintedMaterial(ghost ? { ghost: true, opacity: 0.85 } : {});
  const depth = createPaintedDepthMaterial();
  const geoms = [];

  const bodyGeo = buildBodyGeometry(t, paint, ghost);
  const wheelF = buildWheelGeometry(t.wheel.rf, t.wheel.wf);
  const wheelR = buildWheelGeometry(t.wheel.rr, t.wheel.wr);
  geoms.push(bodyGeo, wheelF, wheelR);

  const group = new Group();
  group.name = `car:${key}`;

  const chassis = new Group();
  chassis.name = 'chassis';
  group.add(chassis);

  const shell = new Mesh(bodyGeo, material);
  shell.userData.depth = depth;   // pen convention: the sun pass swaps to this
  chassis.add(shell);

  const steer = [];
  const wheels = [];
  const place = (front, side) => {
    const geo = front ? wheelF : wheelR;
    const z = front ? t.axle[0] : t.axle[1];
    const x = side * t.track[front ? 0 : 1];
    const y = front ? t.wheel.rf : t.wheel.rr;
    const wheel = new Mesh(geo, material);
    wheel.userData.depth = depth;
    if (front) {
      const pivot = new Group();
      pivot.position.set(x, y, z);
      group.add(pivot);
      pivot.add(wheel);
      steer.push(pivot);
    } else {
      wheel.position.set(x, y, z);
      group.add(wheel);
    }
    wheels.push(wheel);
  };
  // Order is [front-left, front-right, rear-left, rear-right]; +X is the driver's left.
  place(true, 1); place(true, -1); place(false, 1); place(false, -1);

  const lamp = material.uniforms.uLamp.value;
  let lightsOn = false;
  let brake = 0;
  // Tail lamps sit at a quarter brightness with the lights on and go to full under the
  // brakes; the same channel does both, which is how a real tail light works.
  const syncLamps = () => {
    lamp.x = lightsOn ? 1 : 0;
    lamp.y = Math.max(lightsOn ? 0.28 : 0, brake);
    lamp.z = brake;
  };

  // As DRAWN, not as built: each wheel geometry is built once and instanced twice.
  const tris = (g) => (g.getIndex().count / 3) | 0;
  const triangles = tris(bodyGeo) + 2 * tris(wheelF) + 2 * tris(wheelR);

  return {
    group,
    wheels,
    /** Front-hub steer angle, radians. Positive = nose swings toward +X (left). */
    setSteer(rad) {
      steer[0].rotation.y = rad;
      steer[1].rotation.y = rad;
    },
    /** Absolute wheel angle, radians. Increasing = rolling forward (+Z). */
    setWheelSpin(rad) {
      for (const w of wheels) w.rotation.x = rad;
    },
    /** 0..1 brake effort: lights the tail lamps and heats the discs. */
    setBrakeGlow(v) {
      brake = clamp01(v);
      syncLamps();
    },
    /** Head and tail lamps on or off. */
    setLights(on) {
      lightsOn = !!on;
      syncLamps();
    },
    /** Body attitude in radians. Rotates the shell only — the wheels stay on the road. */
    setBodyRoll(rollRad, pitchRad) {
      chassis.rotation.z = rollRad;
      chassis.rotation.x = pitchRad;
    },
    /** Triangles in this car as drawn, wheel geometry counted per instance. */
    triangles,
    dispose() {
      for (const g of geoms) g.dispose();
      material.dispose();
      depth.dispose();
      if (group.parent) group.parent.remove(group);
    },
  };
}

/**
 * The player's car. `tier` picks the silhouette, `paint` indexes PAINTS (wrapping).
 * Returns the rig described at the top of this file; nothing in it needs rebuilding to
 * animate, so hold onto it for the session.
 */
export function buildCar({ tier = 'sports', paint = 0 } = {}) {
  return assemble(tier, paint, false);
}

/**
 * The same car for a remote player: 85% alpha, rim-lit against the sky, no interior and
 * no underbody. Same returned shape as buildCar, so the net layer can drive one exactly
 * like the other.
 */
export function buildGhostCar({ tier = 'sports', paint = 0 } = {}) {
  return assemble(tier, paint, true);
}
