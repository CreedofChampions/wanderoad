/* created by AI
 * Wanderoad — THE TWO RIDICULOUS STARTERS: a bubble micro-car and a three-wheeler.
 *
 * Operator, in full: "I want you to create a car like on the cover of the cozy driver thing. We want
 * cars that look ridiculous like the Fiat 400... Things that look like they're gonna fall over, maybe
 * with some baggage on top, maybe with a little bit of grass on it. Because it's a cozy driver. Look
 * at ridiculous cute cars, micro cars. Let them start with some hilarious cars that seem to fall over
 * every time you turn, and easily upgrade beyond that point. Like the Vespa 400 micro car. You don't
 * want to clone it exactly. Also, what's that three-wheeled car? The Reliant. Three wheels, it always
 * falls over. And it rolls over almost instantly. It would be funny to have that as a starter car."
 *
 * TRADEMARKS, once and plainly, the same stance make-truck.mjs takes. "Vespa" and "Fiat" are Piaggio's
 * and Stellantis's marks; "Reliant" and "Robin" are Reliant's. NOTHING here is a clone of any of them:
 * the proportions below are generic period micro-car and generic three-wheeler, and the in-game labels
 * suggested at the bottom of this file ("Bubble" and "Tricycle") carry no mark at all. Nothing about
 * the geometry depends on a name.
 *
 * BUILT HERE rather than downloaded, for the reason make-truck.mjs sets out at length: this game
 * paints a vehicle by reading SEPARATED material NAMES, and every free micro-car model found is a
 * single-material texture-atlas asset that would arrive as one flat lump — windows the colour of the
 * paint, no lights, no chrome, and wheel nodes named something the rig cannot see. Authoring it here
 * also means the licence is this repository's own, which is the rule.
 *
 * THE CONTRACT (car/loadedCar.js), unchanged from the truck and the scooter:
 *   - forward is +Z; the loader does NOT rotate, it trusts the model
 *   - it scales so max(x, z) equals the fleet entry's `length`, then sits min(y) on the road
 *   - a wheel is a mesh whose NAME contains "wheel", plus frontleft/frontright/rearleft/rearright,
 *     falling back to plain "front"/"rear" — which is how the three-wheeler's single front wheel
 *     gets its own steering node without a fake second wheel hidden in the bodywork
 *   - a wheel's cylinder axis is the model's X
 *   - material name decides the paint: window/glass, headlight, taillight, black, grey, else body
 *   - a BODY-classified mesh that carries its own COLOR_0 keeps those colours instead of taking the
 *     player's paint (loadedCar.js's `baked` branch, added for the Synty cars). That is how the
 *     luggage and the grass stay luggage-coloured and grass-coloured on a bright red car.
 *
 * THE THREE THINGS THAT MAKE THEM READ AS "THIS SHOULD NOT STAY UPRIGHT":
 *
 *   1. TALLER THAN THEY ARE WIDE. Measured off the built files by tools/diag-microcar.mjs section 1:
 *      the bubble is 1.41 m across the mirror and 1.91 m to the top of its suitcase on a 2.60 m
 *      body; the three-wheeler is 1.38 m and 1.98 m on 2.95 m. Every real micro-car of the period
 *      had that proportion and it is the whole silhouette joke.
 *   2. NARROW, UNDERSIZED VISUAL WHEELS. The operator: "the visual wheels are NARROW and UNDERSIZED
 *      relative to the physics wheels ... that is most of the 'this should not stay upright' read."
 *      The solver's wheel is 0.30 m in radius (car/microPhysics.js's tiers); the drawn one is 0.21 m
 *      and 0.085 m wide. A 70%-scale tyre under a full-height body is exactly the cartoon read.
 *   3. ASYMMETRIC HUBS. The operator's own numbers: left hubs at x −0.858, right at +0.940, NOT
 *      mirrored, and the front-left hub scaled (0.8, 1, 1). Reproduced below — see HUB_L/HUB_R.
 *
 *   node tools/make-microcar.mjs                     # writes BOTH glbs
 *   node tools/make-microcar.mjs micro out.glb       # or one at a time
 *   node tools/make-microcar.mjs trike out.glb
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/* ── the asymmetry, as the operator gave it ──────────────────────────────────
 * "left hubs at x -0.858, right at +0.940 (NOT mirrored), front-left hub scaled (0.8, 1, 1) while
 * the other three are 1:1. Permanently slightly cocked."
 *
 * Those are absolute metres on HIS chassis, which is 1.798 m across the hubs. A 2.60 m micro-car
 * that is 1.80 m across its hubs is a go-kart, not a bubble car, so what is carried over here is the
 * RATIO, which is what the character actually lives in:
 *
 *   asymmetry   (0.940 − 0.858) / (0.940 + 0.858) = 4.56% of half-track, i.e. the right pair sits
 *               9.6% further out than the left and the wheel centroid is 4.56% of a half-track to
 *               the right of the body centreline. On the bubble's own 0.525 m half-track that is
 *               24 mm; on his it was 41 mm. Same lean, same permanent cock, right size of car.
 *   front-left  scaled 0.8 in X — and X is the wheel's own axis, so this is a NARROWER tyre, not a
 *               smaller one. It is applied literally.
 *
 * car/microPhysics.js reads the same two constants for the permanent roll bias, so the model and the
 * solver cannot drift apart. */
export const HUB_L = -0.858;
export const HUB_R = 0.94;
/** Wheel-centroid offset as a fraction of half-track: +0.0456, to the RIGHT. */
export const HUB_SKEW = (HUB_R + HUB_L) / (HUB_R - HUB_L);
/** The front-left tyre is 80% of the width of the other three. */
export const HUB_FL_WIDTH = 0.8;

/* ── colours that are NOT the player's paint ─────────────────────────────────
 * Written as COLOR_0 on BODY-classified meshes, which loadedCar.js prefers over the paint. Values
 * are LINEAR, because the painted shader works in linear all the way to the tonemap — the same
 * conversion tools/synty-car.mjs uses and the same one core/palette.js is built on. Getting this
 * wrong is the documented "almost transparent, as if the colour is not added properly" bug, so it is
 * done here rather than eyeballed. Hexes are lifted straight from core/palette.js so the luggage and
 * the grass belong to the same painting as everything else in the world. */
const srgb1 = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const linear = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [srgb1(((n >> 16) & 255) / 255), srgb1(((n >> 8) & 255) / 255), srgb1((n & 255) / 255)];
};
const COL = {
  grassUpper: linear('#93B84E'), // palette gUpper — the meadow's own green
  grassMid: linear('#6C9A47'), // palette gMid
  caseTan: linear('#8E7659'), // palette trunkLit — old leather
  caseCream: linear('#EFE7D6'), // palette paintD
  caseTeal: linear('#4E7F79'), // palette paintE
  crate: linear('#4C3F34'), // palette trunkShade
};

/* ── primitives ──────────────────────────────────────────────────────────────
 * Identical in construction to make-truck.mjs and make-scooter.mjs, with one addition: a mesh may
 * carry a per-vertex colour array (`C`), which becomes COLOR_0. Everything else is deliberately the
 * same code so a reader who has read one of those files has read this one. */
let meshes = [];

/** An axis-aligned box, by centre and half-extents. 24 vertices so each face gets a flat normal. */
function box(name, material, cx, cy, cz, hx, hy, hz, colour = null) {
  const P = [];
  const N = [];
  const I = [];
  const faces = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  ];
  for (const [n, quad] of faces) {
    const base = P.length / 3;
    for (const [sx, sy, sz] of quad) {
      P.push(cx + sx * hx, cy + sy * hy, cz + sz * hz);
      N.push(...n);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  meshes.push({ name, material, P, N, I, C: colour ? fill(colour, P.length / 3) : null });
}

/** A box given as two corners in y and z with a half-width — how a body slab is easiest to read. */
function slab(name, material, hx, y0, y1, z0, z1, colour = null) {
  box(name, material, 0, (y0 + y1) / 2, (z0 + z1) / 2, hx, (y1 - y0) / 2, (z1 - z0) / 2, colour);
}

/** Repeat one linear rgb triple for `n` vertices. */
function fill(rgb, n) {
  const out = new Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = rgb[0];
    out[i * 3 + 1] = rgb[1];
    out[i * 3 + 2] = rgb[2];
  }
  return out;
}

/**
 * A cylinder whose axis runs along X — which is what the wheel rig assumes, and the reason a wheel
 * built about any other axis rolls in a cone rather than turning. `halfW` is HALF the tyre width, so
 * the operator's front-left (0.8, 1, 1) scale is applied by multiplying it.
 */
function wheel(name, material, cx, cy, cz, r, halfW, seg = 16) {
  const P = [];
  const N = [];
  const I = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = [
      [cx - halfW, cy + Math.sin(a0) * r, cz + Math.cos(a0) * r],
      [cx + halfW, cy + Math.sin(a0) * r, cz + Math.cos(a0) * r],
      [cx + halfW, cy + Math.sin(a1) * r, cz + Math.cos(a1) * r],
      [cx - halfW, cy + Math.sin(a1) * r, cz + Math.cos(a1) * r],
    ];
    const base = P.length / 3;
    const nm = [0, Math.sin((a0 + a1) / 2), Math.cos((a0 + a1) / 2)];
    for (const v of p) {
      P.push(...v);
      N.push(...nm);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  for (const side of [-1, 1]) {
    const base = P.length / 3;
    P.push(cx + side * halfW, cy, cz);
    N.push(side, 0, 0);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      P.push(cx + side * halfW, cy + Math.sin(a) * r, cz + Math.cos(a) * r);
      N.push(side, 0, 0);
    }
    for (let i = 0; i < seg; i++) {
      if (side > 0) I.push(base, base + 1 + i, base + 2 + i);
      else I.push(base, base + 2 + i, base + 1 + i);
    }
  }
  meshes.push({ name, material, P, N, I, C: null });
}

/**
 * A tuft of grass: three thin blades leaning off in different directions from one root.
 *
 * Operator: "maybe with a little bit of grass on it. Because it's a cozy driver." A car that has been
 * sitting in a field long enough to sprout is funnier than a clean one, and it costs 108 triangles.
 * Deterministic — a fixed lean per blade rather than a random one — because a model file that comes
 * out different every time it is built cannot be diffed.
 */
function tuft(name, cx, cy, cz, h, lean, colour) {
  const blades = [
    [lean, 0, colour],
    [-lean * 0.7, lean * 0.6, COL.grassMid],
    [lean * 0.25, -lean * 0.9, colour],
  ];
  blades.forEach(([dx, dz, col], i) => {
    const P = [];
    const N = [];
    const I = [];
    const w = 0.016;
    // A blade is a quad from a small root to a leaning tip, drawn twice (front and back) so it is
    // visible whichever way the car is facing.
    const root = [
      [cx - w, cy, cz],
      [cx + w, cy, cz],
    ];
    const tip = [
      [cx + dx - w * 0.3, cy + h, cz + dz],
      [cx + dx + w * 0.3, cy + h, cz + dz],
    ];
    const quads = [
      [root[0], root[1], tip[1], tip[0]],
      [tip[0], tip[1], root[1], root[0]],
    ];
    for (const q of quads) {
      const base = P.length / 3;
      const nm = base === 0 ? [0, 0.3, 1] : [0, 0.3, -1];
      for (const v of q) {
        P.push(...v);
        N.push(...nm);
      }
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    meshes.push({ name: `${name}_${i}`, material: 'Moss', P, N, I, C: fill(col, P.length / 3) });
  });
}

/* ═══ (a) THE BUBBLE MICRO-CAR ══════════════════════════════════════════════
 *
 * 2.60 m long, 1.30 m across the body (1.41 m over the mirror), 1.91 m to the top of the suitcase. Comic proportions on purpose: the
 * period micro-cars this is drawn from were about 2.85 x 1.27 x 1.25, so what is exaggerated is the
 * HEIGHT — a body that is taller than it is wide, on tyres far too small for it, is the whole "looks
 * like it's gonna fall over" brief in one silhouette.
 *
 * Built as a stack of slabs of decreasing half-width rather than a real curved shell: at the distance
 * this game ever draws a car, five stepped bands read as a bubble, and they cost 12 triangles each. */
function buildMicro() {
  meshes = [];
  const L = 2.6;
  const HL = L / 2;
  const HALF_TRACK = 0.525; // matches the `micro` tier's track of 1.05 m in car/microPhysics.js
  const HUB_X_L = -HALF_TRACK * (1 - HUB_SKEW); // −0.501: the operator's −0.858, to scale
  const HUB_X_R = HALF_TRACK * (1 + HUB_SKEW); // +0.549: the operator's +0.940, to scale
  const AXLE_F = 0.85;
  const AXLE_R = -0.85; // wheelbase 1.70, the `micro` tier's own figure
  const WR = 0.21; // VISUAL wheel radius. The solver's is 0.30 — see the header.
  const WW = 0.085; // and this is the whole tyre width.
  const BELT = 0.94; // bottom of the greenhouse
  const ROOF = 1.24; // top of the greenhouse / underside of the roof panel
  const ROOF_TOP = 1.38;

  /* The shell, bottom to top. Every slab is centred on the body centreline; the ASYMMETRY lives in
   * the hubs, not in the bodywork, exactly as the operator described it — the body is straight and
   * it is sitting crooked on its wheels. */
  slab('Body_Sill', 'White', 0.6, 0.26, 0.5, -HL + 0.06, HL - 0.06);
  slab('Body_Tub', 'White', 0.65, 0.5, 0.78, -HL, HL - 0.02);
  slab('Body_Waist', 'White', 0.63, 0.78, BELT, -HL + 0.04, HL - 0.1);
  // the tail bulge over the engine — a rear-engined micro-car's most recognisable lump
  slab('Body_Tail', 'White', 0.56, BELT, 1.14, -HL + 0.02, -HL + 0.42);
  // the nose, which on a car this short is barely a nose at all
  slab('Body_Nose', 'White', 0.5, 0.5, 0.84, HL - 0.16, HL);

  /* The greenhouse: four corner pillars and a roof panel, with the glass filling between them. Built
   * as an OPEN band rather than a solid block for the same reason make-truck.mjs builds its bed as
   * walls — a filled-in greenhouse is a van. */
  for (const s of [-1, 1]) {
    box('Body_PillarF' + (s < 0 ? 'L' : 'R'), 'White', s * 0.56, (BELT + ROOF) / 2, 0.66, 0.05, (ROOF - BELT) / 2, 0.06);
    box('Body_PillarR' + (s < 0 ? 'L' : 'R'), 'White', s * 0.56, (BELT + ROOF) / 2, -0.74, 0.05, (ROOF - BELT) / 2, 0.06);
  }
  slab('Body_Roof', 'White', 0.53, ROOF, ROOF_TOP, -0.86, 0.76);

  // Glass, inboard of the pillars so the pillars read as pillars. A bubble car is mostly window.
  box('Windscreen', 'Windows', 0, (BELT + ROOF) / 2 + 0.01, 0.68, 0.5, (ROOF - BELT) / 2 - 0.02, 0.03);
  for (const s of [-1, 1]) box('SideGlass' + (s < 0 ? 'L' : 'R'), 'Windows', s * 0.575, (BELT + ROOF) / 2 + 0.01, -0.04, 0.02, (ROOF - BELT) / 2 - 0.03, 0.66);
  box('RearGlass', 'Windows', 0, (BELT + ROOF) / 2 + 0.01, -0.76, 0.48, (ROOF - BELT) / 2 - 0.03, 0.03);

  /* THE ROOF RACK AND THE LUGGAGE. Operator: "maybe with some baggage on top". A micro-car has no
   * boot worth the name, so everything lives on the roof, which is also why it is top-heavy — the
   * shape is telling you what the physics is about to do to you. The cases are stacked deliberately
   * OFF CENTRE (the small one sits 40 mm to the left of the big one) to agree with the crooked hubs. */
  for (const s of [-1, 1]) box('Rack_Rail' + (s < 0 ? 'L' : 'R') + '_Grey', 'Grey', s * 0.46, ROOF_TOP + 0.04, -0.06, 0.03, 0.04, 0.68);
  for (const z of [-0.62, 0.0, 0.6]) box('Rack_Bar_Grey' + (z * 10).toFixed(0), 'Grey', 0, ROOF_TOP + 0.03, z, 0.46, 0.02, 0.03);
  box('Luggage_Case', 'Luggage', 0.02, ROOF_TOP + 0.22, 0.06, 0.34, 0.15, 0.36, COL.caseTan);
  box('Luggage_CaseSmall', 'Luggage', -0.04, ROOF_TOP + 0.45, 0.1, 0.24, 0.08, 0.24, COL.caseCream);
  box('Luggage_Roll', 'Luggage', 0.0, ROOF_TOP + 0.14, 0.58, 0.28, 0.09, 0.1, COL.caseTeal);
  box('Luggage_Crate', 'Luggage', 0.06, ROOF_TOP + 0.16, -0.5, 0.3, 0.11, 0.16, COL.crate);
  // the straps, in black, which is what stops the pile being a floating stack of boxes
  for (const z of [-0.02, 0.14]) box('Strap_Black' + (z * 100).toFixed(0), 'Black', 0.02, ROOF_TOP + 0.24, z, 0.36, 0.19, 0.015);

  /* THE GRASS. Three tufts: one in the roof gutter where seed collects, one in the joint between the
   * front wing and the bumper, one under the tail. Not a lawn — the operator said "a little bit". */
  tuft('Grass_Roof', -0.4, ROOF_TOP + 0.05, -0.5, 0.14, 0.06, COL.grassUpper);
  tuft('Grass_Nose', 0.36, 0.5, HL - 0.08, 0.11, -0.05, COL.grassUpper);
  tuft('Grass_Tail', -0.42, 0.5, -HL + 0.1, 0.12, 0.05, COL.grassMid);

  // Chrome: one bumper each end, and a single mirror on a stalk — one, because two would look tidy.
  box('Bumper_Front_Grey', 'Grey', 0, 0.44, HL - 0.03, 0.56, 0.05, 0.03);
  box('Bumper_Rear_Grey', 'Grey', 0, 0.44, -HL + 0.03, 0.56, 0.05, 0.03);
  box('Mirror_Stalk_Grey', 'Grey', -0.66, 0.98, 0.5, 0.06, 0.015, 0.015);
  box('Mirror_Grey', 'Grey', -0.74, 1.02, 0.5, 0.02, 0.05, 0.04);

  // Lights: lamps up on the wings, which is where a period micro-car put them.
  for (const s of [-1, 1]) box('Headlights' + (s < 0 ? 'L' : 'R'), 'Headlights', s * 0.42, 0.72, HL - 0.05, 0.1, 0.1, 0.04);
  for (const s of [-1, 1]) box('TailLights' + (s < 0 ? 'L' : 'R'), 'TailLights', s * 0.44, 0.72, -HL + 0.05, 0.07, 0.07, 0.04);

  /* The wheels. Names the rig matches; axis along X; and the FRONT-LEFT is 80% of the width of the
   * other three, which is the operator's (0.8, 1, 1) applied literally — X is the wheel's own axis,
   * so scaling X is scaling the tyre's WIDTH. */
  wheel('FrontLeftWheel', 'Black', HUB_X_L, WR, AXLE_F, WR, (WW / 2) * HUB_FL_WIDTH);
  wheel('FrontRightWheel', 'Black', HUB_X_R, WR, AXLE_F, WR, WW / 2);
  wheel('RearLeftWheel', 'Black', HUB_X_L, WR, AXLE_R, WR, WW / 2);
  wheel('RearRightWheel', 'Black', HUB_X_R, WR, AXLE_R, WR, WW / 2);

  return { L, W: 1.3, H: ROOF_TOP + 0.53, hubHalf: HALF_TRACK };
}

/* ═══ (b) THE THREE-WHEELER ═════════════════════════════════════════════════
 *
 * Operator: "what's that three-wheeled car? The Reliant. Three wheels, it always falls over. And it
 * rolls over almost instantly. It would be funny to have that as a starter car."
 *
 * ONE WHEEL AT THE FRONT, which is the whole point and also the whole physics. The support polygon is
 * a TRIANGLE, so the line it tips about runs from the single front contact to one rear contact, and
 * the distance from the centre of mass to that line is
 *
 *     a · halfTrack / hypot(wheelbase, halfTrack)
 *
 * — 0.275 m here against the 0.55 m a four-wheeler of the same width would have. That number, not a
 * fudge factor, is the `trike` tier's `track` in car/microPhysics.js. See that file's own note.
 *
 * 2.95 m long, 1.28 m across the body (1.38 m over the mirror), 1.98 m to the top of its bundle, and the nose tapers to 0.24 m across
 * over the single wheel — the pinched snout is what makes a three-wheeler recognisable from in front,
 * and it is the one part of the silhouette that has to be right. */
function buildTrike() {
  meshes = [];
  const L = 2.95;
  const HL = L / 2;
  const REAR_HALF = 0.55; // real rear half-track of the model
  const HUB_X_L = -REAR_HALF * (1 - HUB_SKEW); // −0.525
  const HUB_X_R = REAR_HALF * (1 + HUB_SKEW); // +0.575
  const AXLE_F = 1.02;
  const AXLE_R = -0.92; // wheelbase 1.94, the `trike` tier's own figure
  const WR = 0.21;
  const WW = 0.085;
  const BELT = 0.96;
  const ROOF = 1.3;
  const ROOF_TOP = 1.44;

  /* The shell. Same stacked-slab construction as the bubble, but every slab is SHORTER at the front
   * than the one below it, so the body tapers in plan as well as in section — that is the taper the
   * single front wheel needs, and a three-wheeler drawn with a square nose reads as a broken car. */
  slab('Body_Sill', 'White', 0.6, 0.26, 0.5, -HL + 0.08, 0.66);
  slab('Body_Tub', 'White', 0.64, 0.5, 0.8, -HL + 0.02, 0.62);
  slab('Body_Waist', 'White', 0.62, 0.8, BELT, -HL + 0.06, 0.5);
  slab('Body_Tail', 'White', 0.58, BELT, 1.18, -HL + 0.04, -HL + 0.5);

  // the snout, in four narrowing steps, ending 0.24 m across over the single front wheel
  slab('Body_Snout1', 'White', 0.5, 0.44, 0.86, 0.62, 0.9);
  slab('Body_Snout2', 'White', 0.38, 0.44, 0.82, 0.9, 1.14);
  slab('Body_Snout3', 'White', 0.26, 0.44, 0.76, 1.14, 1.34);
  slab('Body_SnoutTip', 'White', 0.16, 0.46, 0.68, 1.34, HL);
  // the single front wing, which on a three-wheeler wraps the wheel rather than sitting beside it
  slab('Body_FrontArch', 'White', 0.2, 0.42, 0.5, AXLE_F - 0.28, AXLE_F + 0.28);

  // the greenhouse: four pillars, a roof panel, and glass between
  for (const s of [-1, 1]) {
    box('Body_PillarF' + (s < 0 ? 'L' : 'R'), 'White', s * 0.55, (BELT + ROOF) / 2, 0.44, 0.05, (ROOF - BELT) / 2, 0.06);
    box('Body_PillarR' + (s < 0 ? 'L' : 'R'), 'White', s * 0.55, (BELT + ROOF) / 2, -0.86, 0.05, (ROOF - BELT) / 2, 0.06);
  }
  slab('Body_Roof', 'White', 0.52, ROOF, ROOF_TOP, -0.98, 0.54);

  box('Windscreen', 'Windows', 0, (BELT + ROOF) / 2 + 0.01, 0.46, 0.49, (ROOF - BELT) / 2 - 0.02, 0.03);
  for (const s of [-1, 1]) box('SideGlass' + (s < 0 ? 'L' : 'R'), 'Windows', s * 0.565, (BELT + ROOF) / 2 + 0.01, -0.2, 0.02, (ROOF - BELT) / 2 - 0.03, 0.62);
  box('RearGlass', 'Windows', 0, (BELT + ROOF) / 2 + 0.01, -0.88, 0.47, (ROOF - BELT) / 2 - 0.03, 0.03);

  /* Rack and baggage, and here the top-heaviness is not a joke about the shape, it is the mechanism:
   * on a vehicle whose tipping line is 0.275 m from its own centre, a strapped bundle on the roof is
   * what turns "leans a lot" into "goes over". One big bundle rather than the bubble's stack, so the
   * two vehicles are not the same car wearing different bodywork. */
  for (const s of [-1, 1]) box('Rack_Rail' + (s < 0 ? 'L' : 'R') + '_Grey', 'Grey', s * 0.45, ROOF_TOP + 0.04, -0.2, 0.03, 0.04, 0.62);
  for (const z of [-0.72, -0.2, 0.34]) box('Rack_Bar_Grey' + (z * 100).toFixed(0), 'Grey', 0, ROOF_TOP + 0.03, z, 0.45, 0.02, 0.03);
  box('Luggage_Bundle', 'Luggage', 0.03, ROOF_TOP + 0.24, -0.18, 0.36, 0.17, 0.44, COL.caseTan);
  box('Luggage_Roll', 'Luggage', -0.02, ROOF_TOP + 0.46, -0.22, 0.22, 0.08, 0.3, COL.caseTeal);
  box('Luggage_Crate', 'Luggage', 0.05, ROOF_TOP + 0.15, 0.36, 0.28, 0.1, 0.16, COL.crate);
  for (const z of [-0.36, 0.0]) box('Strap_Black' + (z * 100).toFixed(0), 'Black', 0.03, ROOF_TOP + 0.26, z, 0.38, 0.21, 0.015);

  tuft('Grass_Roof', 0.38, ROOF_TOP + 0.05, -0.72, 0.13, -0.06, COL.grassUpper);
  tuft('Grass_Snout', 0.0, 0.44, 1.2, 0.1, 0.05, COL.grassMid);
  tuft('Grass_Tail', -0.44, 0.5, -HL + 0.14, 0.12, 0.05, COL.grassUpper);

  box('Bumper_Front_Grey', 'Grey', 0, 0.42, HL - 0.03, 0.17, 0.05, 0.03);
  box('Bumper_Rear_Grey', 'Grey', 0, 0.44, -HL + 0.03, 0.56, 0.05, 0.03);
  box('Mirror_Stalk_Grey', 'Grey', 0.64, 1.0, 0.3, 0.06, 0.015, 0.015);
  box('Mirror_Grey', 'Grey', 0.72, 1.04, 0.3, 0.02, 0.05, 0.04);

  // one lamp each side of the pinched snout, sitting proud of it because there is nowhere to sink them
  for (const s of [-1, 1]) box('Headlights' + (s < 0 ? 'L' : 'R'), 'Headlights', s * 0.2, 0.68, HL - 0.05, 0.09, 0.09, 0.04);
  for (const s of [-1, 1]) box('TailLights' + (s < 0 ? 'L' : 'R'), 'TailLights', s * 0.44, 0.74, -HL + 0.05, 0.07, 0.07, 0.04);

  /* THE WHEELS, and the reason no fake fourth wheel is hidden in the bodywork: loadedCar.js keys a
   * corner off "frontleft"/"frontright"/"rearleft"/"rearright" and FALLS BACK to plain "front" and
   * "rear", so `Wheel_Front` on the centreline gets its own steering node with no change to the rig.
   * make-scooter.mjs relies on exactly the same fallback for its two wheels.
   *
   * The operator's narrow hub is (0.8, 1, 1) on the FRONT-LEFT; a three-wheeler has no front-left, so
   * it goes on the REAR-LEFT — the point is that one tyre is visibly the wrong width, not which. */
  wheel('Wheel_Front', 'Black', 0, WR, AXLE_F, WR, WW / 2);
  wheel('RearLeftWheel', 'Black', HUB_X_L, WR, AXLE_R, WR, (WW / 2) * HUB_FL_WIDTH);
  wheel('RearRightWheel', 'Black', HUB_X_R, WR, AXLE_R, WR, WW / 2);

  return { L, W: 1.28, H: ROOF_TOP + 0.54, hubHalf: REAR_HALF };
}

/* ── pack it into a GLB ──────────────────────────────────────────────────────
 * Plain glTF 2.0: one buffer, three or four accessors per mesh, one primitive per mesh, one node per
 * mesh. Identical to make-truck.mjs except that a mesh carrying `C` also writes COLOR_0 — see the
 * header for why that attribute is the thing that keeps the luggage from being painted. */
const MATERIALS = ['White', 'Grey', 'Black', 'Windows', 'Headlights', 'TailLights', 'Luggage', 'Moss'];

function writeGLB(out, tool) {
  const chunks = [];
  let offset = 0;
  const bufferViews = [];
  const accessors = [];

  function view(data, target) {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes);
    offset += bytes.length;
    return bufferViews.length - 1;
  }

  const primitives = [];
  for (const m of meshes) {
    const pos = new Float32Array(m.P);
    const nrm = new Float32Array(m.N);
    const idx = new Uint16Array(m.I);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[i + k]);
        max[k] = Math.max(max[k], pos[i + k]);
      }
    const vp = view(pos, 34962);
    const vn = view(nrm, 34962);
    accessors.push({ bufferView: vp, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    accessors.push({ bufferView: vn, componentType: 5126, count: nrm.length / 3, type: 'VEC3' });
    const attributes = { POSITION: accessors.length - 2, NORMAL: accessors.length - 1 };
    if (m.C) {
      const col = new Float32Array(m.C);
      const vc = view(col, 34962);
      accessors.push({ bufferView: vc, componentType: 5126, count: col.length / 3, type: 'VEC3' });
      attributes.COLOR_0 = accessors.length - 1;
    }
    const vi = view(idx, 34963);
    accessors.push({ bufferView: vi, componentType: 5123, count: idx.length, type: 'SCALAR' });
    primitives.push({ attributes, indices: accessors.length - 1, material: MATERIALS.indexOf(m.material) });
  }

  const gltf = {
    asset: { version: '2.0', generator: `wanderoad ${tool} (this repository, CC0)` },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, i) => i) }],
    nodes: meshes.map((m, i) => ({ name: m.name, mesh: i })),
    meshes: meshes.map((m, i) => ({ name: m.name, primitives: [primitives[i]] })),
    materials: MATERIALS.map((name) => ({ name, pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1] } })),
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };

  const json = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
  const bin = Buffer.concat(chunks);
  const binPad = Buffer.alloc((4 - (bin.length % 4)) % 4);
  const total = 12 + 8 + json.length + jsonPad.length + 8 + bin.length + binPad.length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const jHead = Buffer.alloc(8);
  jHead.writeUInt32LE(json.length + jsonPad.length, 0);
  jHead.writeUInt32LE(0x4e4f534a, 4);
  const bHead = Buffer.alloc(8);
  bHead.writeUInt32LE(bin.length + binPad.length, 0);
  bHead.writeUInt32LE(0x004e4942, 4);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.concat([head, jHead, json, jsonPad, bHead, bin, binPad]));
  return total;
}

/* ── run ─────────────────────────────────────────────────────────────────── */
const WHICH = { micro: buildMicro, trike: buildTrike };
const DEFAULT_OUT = { micro: 'public/models/cars/microcar.glb', trike: 'public/models/cars/threewheeler.glb' };

const arg = process.argv[2];
const jobs = arg && WHICH[arg] ? [[arg, process.argv[3] || DEFAULT_OUT[arg]]] : Object.keys(WHICH).map((k) => [k, DEFAULT_OUT[k]]);

for (const [key, out] of jobs) {
  const dims = WHICH[key]();
  const wheelNames = meshes.filter((m) => /wheel/i.test(m.name)).map((m) => m.name);
  const bytes = writeGLB(out, 'tools/make-microcar.mjs');
  console.log(
    JSON.stringify({
      out,
      bytes,
      meshes: meshes.length,
      tris: meshes.reduce((a, m) => a + m.I.length / 3, 0),
      materials: MATERIALS.length,
      wheels: wheelNames,
      // W x H x L, and H > W is the entire silhouette joke — see the header.
      size: [dims.W.toFixed(2), dims.H.toFixed(2), dims.L.toFixed(2)].join(' x '),
      tallerThanWide: +(dims.H / dims.W).toFixed(2),
      hubHalfTrack: dims.hubHalf,
    })
  );
}
