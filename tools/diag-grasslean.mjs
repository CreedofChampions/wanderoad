// created by AI
/* Wanderoad — grass BASE position is not where a blade actually is: it leans.
 *
 * Operator, verbatim (this pass): "grass still tips onto the road" even after
 * `ROAD_GRASS_MARGIN` (0.4 m) widened the base-density suppression window in
 * `src/render/grass.js`. That margin only ever tested the blade's ROOT against the
 * carriageway. `GRASS_VS`'s vertex shader solves a quasi-static Bezier for the STEM —
 * `iv2` alone (`p0 + up*hgt*0.965 + front*hgt*(0.20+rH*0.34)`) already offsets the tip up to
 * 0.54*hgt sideways from the root with NO wind at all, before gravity's own forward droop
 * (`gF`) and the wind term (`wf`) are added and the whole polyline is rescaled to length
 * `hgt` (`rr = hgt / L`). A base standing just past the old fade window can therefore carry
 * a tip that swings back over the tarmac.
 *
 * This is a byte-for-byte JS port of that exact vertex-shader arithmetic (the hashes,
 * `vn2`, the Bezier solve and its two state corrections), run on the CPU against the REAL
 * `Terrain`/`RoadField.carve()` used everywhere else in this game — not a stand-in model.
 * It scans real road edges (the same technique `diag-verge.mjs` already uses) and, at every
 * base position that clears grass.js's own PRESENCE_GATE for a given candidate margin,
 * computes where that blade's TIP actually lands and asks `carve()` whether that point is
 * on the tarmac.
 *
 *   node tools/diag-grasslean.mjs [--seed 20260726] [--terrain meadow] [--sweep]
 *
 * `--sweep` walks a list of candidate margins and reports the incursion count/depth for
 * each, which is how the shipped constant below was chosen — not by inspection.
 */
import { Terrain } from '../src/world/terrain.js';
import { BIOME_COUNT, BIOME_SCATTER, waterLevelAt, setBiomeBias } from '../src/world/biomes.js';
import { BIOME_TINT } from '../src/core/palette.js';
import { applyTerrain, terrainBias } from '../src/game/presets.js';
import { clamp01, smoothstep } from '../src/core/math.js';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const SEED = (+arg('seed', 20260726)) >>> 0;
const LAND = arg('terrain', 'meadow');
const SWEEP = process.argv.includes('--sweep');

applyTerrain(LAND);
setBiomeBias(terrainBias(LAND));

const SCAT_GRASS = BIOME_SCATTER.map((b) => b.grass);
const TINT_DRY = BIOME_TINT.map((b) => b.dryness);
const TINT_SNOW = BIOME_TINT.map((b) => b.snow);
const TINT_WET = BIOME_TINT.map((b) => b.wet);

const PRESENCE_GATE = 0.004; // grass.js pass 3's own real cutoff, verbatim
const CANOPY_THIN = 0.45; // grass.js's own constant, no canopy shade modelled here (open verge)

/* ── exact ports of src/core/glsl.js's GL_HASH / GL_NOISE, the ones GRASS_VS calls ──────── */
const fract = (x) => x - Math.floor(x);
function hash12(px, py) {
  let x = fract(px * 0.1031),
    y = fract(py * 0.1031),
    z = fract(px * 0.1031);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d;
  y += d;
  z += d;
  return fract((x + y) * z);
}
function hash32(px, py) {
  let x = fract(px * 0.1031),
    y = fract(py * 0.103),
    z = fract(px * 0.0973);
  const d = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33);
  x += d;
  y += d;
  z += d;
  return [fract((x + y) * z), fract((x + z) * y), fract((y + z) * x)];
}
function vn2(px, py) {
  const ix = Math.floor(px),
    iy = Math.floor(py);
  const fx = px - ix,
    fy = py - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash12(ix, iy),
    b = hash12(ix + 1, iy);
  const c = hash12(ix, iy + 1),
    d = hash12(ix + 1, iy + 1);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uy;
}
const windProfile = (z) => Math.log((Math.max(z, 0.015) + 0.06) / 0.06) * 0.19523;

const WIND_GAIN = 0.235;
/* Steady mean flow — src/render/wind.js's own constructor defaults, no gust cell, no
 * turbulence: the "calm, most of the time" state, not a stress spike. */
const BASE_SPEED = 4.2;
const BASE_DIR = 292 * (Math.PI / 180);
const WIND_FX = Math.sin(BASE_DIR + Math.PI);
const WIND_FZ = Math.cos(BASE_DIR + Math.PI);
const WIND_MULT = +arg('windmult', 1.0); // 1.45 = wind.js's own upper meander bound on speed
const WIND = { x: WIND_FX * BASE_SPEED * WIND_MULT, z: WIND_FZ * BASE_SPEED * WIND_MULT };

/**
 * Exact port of GRASS_VS's per-vertex Bezier solve, evaluated only for the TIP (t=1, where
 * the shader's own `c = mix(a,b,1) = v2` and the width term is zero — see buildBladeGeometry,
 * the tip vertex sits at (0.5, 1, 0)). `camX/camZ` reproduce the `faceCam` swing exactly as
 * the shader computes it from `uCamPos`; pass the car's own position, since that is what the
 * game actually renders from at the moment a driver would notice this.
 */
function bladeTip({ x, z, y, dryv, snowv, lush, hs, camX, camZ }) {
  const h3 = hash32(x * 0.9173 + 11.0, z * 0.9173 + 11.0);
  const rH = h3[0],
    rO = h3[1],
    rS = h3[2];

  const clumpA = vn2(x * 0.0147, z * 0.0147);
  const clumpB = vn2(x * 0.00342 + 17.3, z * 0.00342 + 17.3);

  let hgt = 0.3 + rH * 0.3;
  hgt *= 0.68 + 0.74 * clumpB;
  hgt *= 0.84 + 0.38 * clumpA;
  hgt *= 1.24 + (0.82 - 1.24) * dryv;
  hgt *= 0.55 + (1.0 - 0.55) * lush;
  const snowK = smoothstep(120, 240, y) * snowv;
  hgt *= 1.0 + (0.42 - 1.0) * snowK;
  hgt *= hs;
  hgt = Math.max(hgt, 0.08);

  const stiff = Math.max(0.52 + rS * 0.46 + clumpB * 0.1, 0.18);

  // ── frame: axis, then swung toward the camera past 16 m — front === axis (see file banner
  // math in src/render/grass.js's own derivation; sideV = cross(up,axis), front = cross(sideV,up)
  // collapses back to axis whenever axis.y === 0, which it always is here).
  const orient = rO * 6.2831853 + clumpA * 2.4;
  let ax = Math.cos(orient),
    az = Math.sin(orient);
  const distToCam = Math.hypot(camX - x, camZ - z);
  const faceCam = smoothstep(16, 80, distToCam);
  if (faceCam > 0) {
    const tl = Math.hypot(camX - x, camZ - z) || 1e-5;
    const tcx = (camX - x) / tl,
      tcz = (camZ - z) / tl;
    // cross(up, toCam) with up=(0,1,0), toCam=(tcx,0,tcz) => (tcz, 0, -tcx)
    const rx = tcz,
      rz = -tcx;
    const t = faceCam * 0.88;
    let mx = ax + (rx - ax) * t,
      mz = az + (rz - az) * t;
    const ml = Math.hypot(mx, mz) || 1e-5;
    ax = mx / ml;
    az = mz / ml;
  }
  const frontX = ax,
    frontZ = az;

  const p0 = { x, y: y - 0.035, z };
  const lean0 = hgt * (0.2 + rH * 0.34);
  const iv2 = { x: p0.x + frontX * lean0, y: p0.y + hgt * 0.965, z: p0.z + frontZ * lean0 };

  const gEmag = 1.6 + 1.4 * rH;
  const gFx = 0.25 * gEmag * frontX,
    gFz = 0.25 * gEmag * frontZ;
  const gvx = gFx * 0.048,
    gvy = -gEmag * 0.048,
    gvz = gFz * 0.048;

  const prof = windProfile(hgt * 0.7);
  const w3x = WIND.x * prof,
    w3z = WIND.z * prof;

  const dir0x = iv2.x - p0.x,
    dir0y = iv2.y - p0.y,
    dir0z = iv2.z - p0.z;
  const dir0L = Math.hypot(dir0x, dir0y, dir0z) || 1e-5;
  const d0x = dir0x / dir0L,
    d0y = dir0y / dir0L,
    d0z = dir0z / dir0L;
  const wL = Math.hypot(w3x, w3z) || 1e-5;
  const wnx = w3x / wL,
    wnz = w3z / wL;
  const fd = 1.0 - Math.abs(wnx * d0x + wnz * d0z);
  const fr = clamp01((iv2.y - p0.y) / hgt);
  const wfScale = (0.3 + 0.95 * fd) * fr * WIND_GAIN * (0.55 + 0.75 * hgt);
  const wfx = w3x * wfScale,
    wfz = w3z * wfScale;

  let v2x = iv2.x + (gvx + wfx) / stiff;
  let v2y = iv2.y + gvy / stiff;
  let v2z = iv2.z + (gvz + wfz) / stiff;

  // state correction 1: v2 -= up*min(dot(up,v2-p0),0) — clamps v2.y >= p0.y
  if (v2y < p0.y) v2y = p0.y;

  // state correction 2: v1 sits directly above p0
  const d20x = v2x - p0.x,
    d20z = v2z - p0.z;
  const lproj = Math.hypot(d20x, d20z);
  const r = lproj / hgt;
  const K = Math.max(1 - r, 0.05 * Math.max(r, 1.0));
  let v1x = p0.x,
    v1y = p0.y + hgt * K,
    v1z = p0.z;

  const L0 = Math.hypot(v2x - p0.x, v2y - p0.y, v2z - p0.z);
  const L1 = Math.hypot(v1x - p0.x, v1y - p0.y, v1z - p0.z) + Math.hypot(v2x - v1x, v2y - v1y, v2z - v1z);
  const L = (2 * L0 + L1) / 3;
  const rr = hgt / Math.max(L, 1e-4);
  const nv1x = p0.x + rr * (v1x - p0.x),
    nv1y = p0.y + rr * (v1y - p0.y),
    nv1z = p0.z + rr * (v1z - p0.z);
  const nv2x = nv1x + rr * (v2x - v1x),
    nv2y = nv1y + rr * (v2y - v1y),
    nv2z = nv1z + rr * (v2z - v1z);

  return { tipX: nv2x, tipZ: nv2z, tipY: nv2y, hgt, base: p0 };
}

/** grass.js pass 1's own density gate, margin as a parameter for the sweep. */
function densityAt(T, x, z, margin) {
  const w = T.weights(x, z).w;
  let g = 0,
    dry = 0,
    snow = 0,
    wet = 0;
  for (let b = 0; b < BIOME_COUNT; b++) {
    const wb = w[b];
    if (wb < 0.002) continue;
    g += wb * SCAT_GRASS[b];
    dry += wb * TINT_DRY[b];
    snow += wb * TINT_SNOW[b];
    wet += wb * TINT_WET[b];
  }
  if (g <= 0) return null;
  const rc = T.roads.carve(x, z);
  let edge = rc.edge;
  if (rc.width > 0) {
    const half = rc.width * 0.5;
    const marginEdge = 1 - smoothstep(half - 0.4 + margin, half + 0.35 + margin, rc.d);
    if (marginEdge > edge) edge = marginEdge;
  }
  const y = T.height(x, z);
  const waterY = waterLevelAt(w, -Infinity);
  const submerged = waterY !== null && y < waterY + 0.05;
  const dens = submerged ? 0 : g * (1 - clamp01(edge)) * (1 - CANOPY_THIN * 0);
  return { dens, dry, snow, wet, y, rc };
}

function onTarmac(T, x, z) {
  const rc = T.roads.carve(x, z);
  if (rc.width <= 0) return { on: false, incursion: -Infinity };
  const half = rc.width * 0.5;
  return { on: rc.d < half, incursion: half - rc.d };
}

/** Sweep road edges over a grid of windows, exactly diag-verge.mjs's own technique. */
function scan(margin, { hs = 1.0, step = 0.06 } = {}) {
  let baseSamples = 0;
  let survivors = 0;
  let tipOnTarmac = 0;
  let worstIncursion = -Infinity;
  let worst = null;
  const examples = [];

  outer: for (let gx = -2; gx <= 2; gx++) {
    for (let gz = -2; gz <= 2; gz++) {
      const cx = gx * 700,
        cz = gz * 700;
      const T = new Terrain(SEED, cx - 360, cz - 360, cx + 360, cz + 360, 260);
      for (const e of T.roads.edges) {
        const n = e.pts.length / 2;
        for (let k = 1; k < n - 1; k++) {
          const x = e.pts[k * 2],
            z = e.pts[k * 2 + 1];
          if (Math.abs(x - cx) > 300 || Math.abs(z - cz) > 300) continue;
          const tx = e.pts[k * 2 + 2] - e.pts[k * 2 - 2];
          const tz = e.pts[k * 2 + 3] - e.pts[k * 2 - 1];
          const L = Math.hypot(tx, tz) || 1;
          const nx = -tz / L,
            nz = tx / L;
          const half = e.width * 0.5;
          for (const s of [1, -1]) {
            for (let m = half - 1.0; m <= half + 3.0; m += step) {
              const px = x + nx * s * m,
                pz = z + nz * s * m;
              const info = densityAt(T, px, pz, margin);
              if (!info) continue;
              baseSamples++;
              if (info.dens <= PRESENCE_GATE) continue;
              survivors++;
              const tip = bladeTip({
                x: px,
                z: pz,
                y: info.y,
                dryv: info.dry,
                snowv: info.snow,
                lush: clamp01(info.dens),
                hs,
                camX: x,
                camZ: z, // camera modelled at the nearby centreline point — a driver on this road
              });
              const t = onTarmac(T, tip.tipX, tip.tipZ);
              if (t.on) {
                tipOnTarmac++;
                if (t.incursion > worstIncursion) {
                  worstIncursion = t.incursion;
                  worst = { x: +px.toFixed(2), z: +pz.toFixed(2), tipX: +tip.tipX.toFixed(2), tipZ: +tip.tipZ.toFixed(2), hgt: +tip.hgt.toFixed(3), incursion: +t.incursion.toFixed(3) };
                }
                if (examples.length < 5) examples.push({ base: [+px.toFixed(2), +pz.toFixed(2)], tip: [+tip.tipX.toFixed(2), +tip.tipZ.toFixed(2)], hgt: +tip.hgt.toFixed(3), incursion: +t.incursion.toFixed(3) });
              }
            }
          }
          if (baseSamples >= 400000) break outer;
        }
      }
    }
  }
  return { margin, baseSamples, survivors, tipOnTarmac, worstIncursion, worst, examples };
}

console.log(`\n=== grass TIP lean vs the carriageway, seed ${SEED}, terrain "${LAND}" ===`);
console.log('(a real per-blade port of GRASS_VS: hashes, vn2, the Bezier solve, both state corrections)\n');

const RING_HS = arg('rings', '1.0,1.08,1.36,1.95')
  .split(',')
  .map(Number);

if (SWEEP) {
  for (const hs of RING_HS) {
    console.log(`-- ring hs=${hs} --`);
    for (const margin of [0.4, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5]) {
      const r = scan(margin, { hs, step: hs > 1.5 ? 0.1 : 0.06 });
      console.log(
        `  margin ${margin.toFixed(1)} m: ${r.survivors} surviving bases / ${r.baseSamples} scanned, ` +
          `${r.tipOnTarmac} tips ON tarmac, worst incursion ${r.worstIncursion > -Infinity ? r.worstIncursion.toFixed(3) + ' m' : 'n/a'}`
      );
    }
  }
} else if (arg('formula', null) || !process.argv.includes('--margin')) {
  // MARGIN(hs) = a + b*hs, evaluate the candidate against every real ring's hs. Defaults to
  // the exact constants shipped in src/render/grass.js (ROAD_GRASS_MARGIN_A/B) — plain
  // `node tools/diag-grasslean.mjs` with no flags checks the REAL game, not a hypothetical.
  const [a, b] = arg('formula', '0.55,0.45').split(',').map(Number);
  console.log(`candidate MARGIN(hs) = ${a} + ${b}*hs  (src/render/grass.js's shipped ROAD_GRASS_MARGIN_A/B unless --formula overrides)`);
  let allPass = true;
  for (const hs of RING_HS) {
    const margin = a + b * hs;
    const r = scan(margin, { hs, step: hs > 1.5 ? 0.1 : 0.06 });
    const pass = r.tipOnTarmac === 0;
    allPass = allPass && pass;
    console.log(`  hs=${hs}  margin=${margin.toFixed(3)} m -> ${r.tipOnTarmac} tips on tarmac ${pass ? '(PASS)' : '(FAIL, worst ' + r.worstIncursion.toFixed(3) + ' m)'}`);
  }
  console.log(allPass ? 'ALL RINGS PASS' : 'SOME RINGS FAIL');
  process.exitCode = allPass ? 0 : 1;
} else {
  const CURRENT = +arg('margin', 0.4);
  const r = scan(CURRENT, { hs: 1.0 });
  console.log(`margin ${CURRENT} m — ${r.baseSamples} base samples scanned, ${r.survivors} clear the ${PRESENCE_GATE} presence gate`);
  console.log(`tips landing ON tarmac: ${r.tipOnTarmac} (${((100 * r.tipOnTarmac) / Math.max(r.survivors, 1)).toFixed(2)}% of survivors)`);
  console.log(`worst incursion: ${r.worstIncursion > -Infinity ? r.worstIncursion.toFixed(3) + ' m onto the tarmac' : 'n/a'}`);
  if (r.worst) console.log('worst example:', r.worst);
  if (r.examples.length) {
    console.log('examples (base off the tarmac, tip on it):');
    for (const e of r.examples) console.log(`  base (${e.base[0]},${e.base[1]}) -> tip (${e.tip[0]},${e.tip[1]})  hgt ${e.hgt} m  incursion ${e.incursion} m`);
  }
  console.log(`\nRESULT: ${r.tipOnTarmac === 0 ? 'PASS — no blade tip reaches the tarmac' : 'FAIL — ' + r.tipOnTarmac + ' tip(s) reach the tarmac'}`);
  process.exitCode = r.tipOnTarmac === 0 ? 0 : 1;
}
