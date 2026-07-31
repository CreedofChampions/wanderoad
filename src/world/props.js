/* Wanderoad — points of interest, and the petrol stations.
 *
 * This is the "there is somewhere to go" layer. `scatter.js` fills the whole landscape with
 * trees and rocks at a per-hectare density; this file does the opposite job. A point of
 * interest is RARE, it is a landmark, and it only means anything if you see it from the car
 * — so it is placed against the ROAD NETWORK by arc length, not against the ground by area.
 *
 * Why anchored to roads rather than scattered on a lattice:
 *
 *   - A cozy driving game is seen from a road. A jizo shrine 900 m into a field is a shrine
 *     nobody will ever meet. Anchoring to arc length also gives direct control over the one
 *     number that matters — how often you find something — in the unit the player actually
 *     experiences it (metres of driving), instead of props per hectare filtered by whatever
 *     fraction of the map happens to be near a lane.
 *   - It makes "never blocking the road" structural rather than a test: the lateral offset
 *     starts outside the carriageway and the verge, so a prop cannot be placed on the
 *     tarmac in the first place.
 *
 * Determinism, the same rules as everywhere else in src/world/:
 *
 *   - Every decision is a pure function of (edge lattice coords, slot index, seed). No
 *     Math.random, no state carried between calls.
 *   - Slots are indexed by ARC LENGTH ALONG THE WHOLE EDGE, then filtered by the query box.
 *     A slot therefore belongs to its edge, not to the box you happened to ask about, so the
 *     same prop is emitted exactly once no matter how the world is tiled — the same argument
 *     scatter.js makes for its global lattice.
 *   - Edge geometry has always been box-independent (pts, width, key are pure hashes), and
 *     `e.y` now is too — see "one road, ONE height" in roads.js. Where a road height is
 *     needed (the petrol-station forecourt) this file asks `edgeProfile()` for THE elevation
 *     rather than profiling a private copy, which is what it had to do while a RoadField's
 *     `y` still depended on the box you asked about.
 *
 * No three.js and no DOM here — the geometry lives in src/render/props.js.
 */

import { edgesInBox, edgeProfile } from './roads.js';
import { landFn, waterFn } from './terrain.js';
import { hash3i, rng, clamp01, TAU } from '../core/math.js';

/* ── how often you find something ─────────────────────────────────────────────
 * A candidate slot every SLOT metres of road, accepted with the tier's probability. Lanes
 * are luckier than arterials because a back lane is where you are meant to find things —
 * that is the whole reason to leave the trunk road.
 *
 * These two numbers are the entire "rarity" dial, and they are CANDIDATE rates, not
 * delivered ones. Measured over 44 km of road (tools/bench-props.mjs), only about one
 * candidate in six survives: most of the loss is the freeboard test, because a good half of
 * this world sits within 60 cm of its local water plane and a barn does not go in a marsh.
 * So these numbers look about six times too generous and are not. Tune them by running the
 * bench and reading "one find every N m", never by reasoning about the probability. */
const SLOT = 38;
const SLOT_P = [0.17, 0.24];

/** Salts. One per decision stream, so a prop's kind and its offset are independent draws. */
const SALT_PROP = 0x50524f50; // 'PROP'
const SALT_ACCEPT = 0x504f4931; // 'POI1'
/** Share of stations that are car dealerships rather than pumps — see the `deal` flag. */
export const DEAL_SHARE = 0.34;

const SALT_STATION = 0x46554c31; // 'FUL1'

/** uint32 -> [0,1). Same constant roads.js uses. */
const F32 = 1 / 4294967296;

/** Nothing is placed nearer the centreline than half the carriageway plus this. */
const VERGE_CLEAR = 2.2;

/** Furthest a prop may sit from the road it belongs to. Also the query-box expansion. */
export const MAX_OFFSET = 150;

/* ── the catalogue ────────────────────────────────────────────────────────────
 * 100 kinds. Every field is placement data — the geometry is keyed by `id` in
 * src/render/props.js and the two files must agree on the id list, which
 * tools/bench-props.mjs asserts.
 *
 *   w      relative weight in the draw. Landmarks are deliberately rare.
 *   off    [min, max] metres from the centreline. The minimum is a floor; the real minimum
 *          is max(off[0], halfWidth + VERGE_CLEAR + foot).
 *   foot   footprint radius, metres. Used to clear the road, to sample the ground under the
 *          whole object, and to sink it so no corner floats.
 *   face   'road' faces the carriageway, 'along' faces down it, 'free' takes any yaw.
 *   slope  steepest ground it will stand on, as cos(angle) — same convention as scatter.js.
 *   r,h    collision cylinder. r = 0 means you can drive through it, which is the right
 *          answer for anything low, soft, or that you might want to park inside.
 *   wet    'dry' needs freeboard, 'shore' wants to be near water, 'any' does not care.
 *   biome  preferred biome indices (see BIOME_NAMES); null = anywhere. A preference is a
 *          x4 weight there and x0.25 elsewhere, never a hard filter — a hard filter puts a
 *          visible seam along every climate border.
 */
const K = (id, label, group, w, off, foot, face, slope, r, h, wet, biome) => ({
  id, label, group, w, off, foot, face, slope, r, h, wet, biome,
});

/* Slope tolerances, as cos(angle), named so the table reads. */
const FLATTISH = 0.985; // ~10 deg — buildings, anything with a floor
const GENTLE = 0.95;   // ~18 deg
const ROUGH = 0.90;    // ~26 deg — statues, stones, stacks

export const PROP_KINDS = [
  /* ── shrines and wayside stones ─────────────────────────────────────────── */
  K('torii_red', 'vermilion torii', 'shrine', 5, [7, 22], 2.6, 'road', GENTLE, 0.5, 5.2, 'dry', null),
  K('torii_stone', 'stone torii', 'shrine', 4, [8, 30], 2.4, 'road', GENTLE, 0.5, 4.4, 'dry', null),
  K('torii_moss', 'mossy torii', 'shrine', 3, [10, 40], 1.8, 'road', GENTLE, 0.42, 3.4, 'any', [0, 4]),
  K('jizo_trio', 'three jizo', 'shrine', 7, [5, 12], 1.1, 'road', ROUGH, 0, 0, 'dry', null),
  K('jizo_single', 'a jizo in a bib', 'shrine', 8, [4, 10], 0.6, 'road', ROUGH, 0, 0, 'dry', null),
  K('stone_lantern', 'stone lantern', 'shrine', 7, [4, 14], 0.8, 'road', GENTLE, 0.4, 2.1, 'dry', null),
  K('lantern_pair', 'a pair of lanterns', 'shrine', 4, [6, 16], 2.2, 'road', GENTLE, 0.4, 2.1, 'dry', null),
  K('paper_lanterns', 'strung paper lanterns', 'shrine', 3, [6, 18], 3.4, 'along', GENTLE, 0, 0, 'dry', null),
  K('wayside_shrine', 'wayside shrine', 'shrine', 5, [6, 18], 1.6, 'road', FLATTISH, 1.1, 2.6, 'dry', null),
  K('ema_rack', 'ema boards', 'shrine', 3, [6, 16], 1.4, 'road', GENTLE, 0, 0, 'dry', null),
  K('shimenawa_post', 'a roped stone', 'shrine', 4, [5, 20], 1.0, 'free', ROUGH, 0.8, 1.8, 'any', null),
  K('fox_statue', 'a stone fox', 'shrine', 4, [4, 12], 0.7, 'road', ROUGH, 0, 0, 'dry', null),
  K('cat_statue', 'a beckoning cat', 'shrine', 3, [4, 11], 0.6, 'road', ROUGH, 0, 0, 'dry', null),
  K('moss_buddha', 'a buddha under moss', 'shrine', 2, [8, 30], 1.2, 'road', ROUGH, 0.8, 1.6, 'any', [0, 4]),
  K('prayer_cairn', 'a prayer cairn', 'shrine', 6, [5, 40], 1.0, 'free', ROUGH, 0.7, 1.4, 'any', [2, 3]),
  K('standing_stones', 'standing stones', 'shrine', 2, [30, 130], 6.0, 'free', GENTLE, 1.0, 3.4, 'dry', [1, 2]),
  K('stone_arch', 'a ruined arch', 'shrine', 2, [20, 90], 4.0, 'road', FLATTISH, 1.2, 5.0, 'dry', null),

  /* ── farm and field ─────────────────────────────────────────────────────── */
  K('barn', 'a red barn', 'farm', 4, [22, 90], 6.5, 'road', FLATTISH, 6.0, 7.5, 'dry', [0, 1]),
  K('shed', 'a tool shed', 'farm', 6, [10, 40], 2.2, 'road', FLATTISH, 2.0, 2.6, 'dry', null),
  K('potting_shed', 'a potting shed', 'farm', 4, [10, 36], 2.4, 'road', FLATTISH, 2.2, 2.8, 'dry', [0]),
  K('grain_silo', 'a grain silo', 'farm', 3, [25, 100], 3.2, 'free', FLATTISH, 3.0, 9.0, 'dry', [0, 1]),
  K('charcoal_kiln', 'a charcoal kiln', 'farm', 3, [14, 60], 2.4, 'free', GENTLE, 2.2, 3.0, 'dry', [0, 2]),
  K('hay_bales', 'stacked hay bales', 'farm', 6, [12, 70], 2.6, 'along', GENTLE, 2.4, 2.4, 'dry', [0, 1]),
  K('hay_cart', 'a hay cart', 'farm', 5, [8, 30], 2.4, 'along', GENTLE, 1.6, 2.2, 'dry', [0, 1]),
  K('hand_cart', 'a hand cart', 'farm', 5, [6, 20], 1.4, 'free', GENTLE, 0, 0, 'dry', null),
  K('scarecrow', 'a scarecrow', 'farm', 6, [10, 60], 0.7, 'road', GENTLE, 0, 0, 'dry', [0, 1]),
  K('beehives', 'a row of beehives', 'farm', 5, [10, 45], 2.0, 'along', GENTLE, 0, 0, 'dry', [0]),
  K('milk_churns', 'milk churns on a stand', 'farm', 5, [4, 14], 1.2, 'road', GENTLE, 0, 0, 'dry', [0]),
  K('water_trough', 'a stone trough', 'farm', 5, [5, 20], 1.3, 'along', GENTLE, 0.9, 0.7, 'any', null),
  K('drystone_wall', 'a drystone wall', 'farm', 6, [6, 22], 5.5, 'along', GENTLE, 0, 0, 'any', [0, 2]),
  K('pasture_fence', 'a pasture fence', 'farm', 7, [6, 24], 6.0, 'along', GENTLE, 0, 0, 'dry', [0, 1]),
  K('wooden_gate', 'a five-bar gate', 'farm', 6, [5, 16], 2.2, 'road', GENTLE, 0, 0, 'dry', [0, 1]),
  K('washing_line', 'a washing line', 'farm', 4, [10, 40], 3.4, 'along', GENTLE, 0, 0, 'dry', [0]),
  K('sunflower_patch', 'sunflowers', 'farm', 5, [6, 40], 3.0, 'free', GENTLE, 0, 0, 'dry', [0, 1]),
  K('flower_bed', 'a bed of flowers', 'farm', 6, [4, 20], 2.4, 'free', GENTLE, 0, 0, 'dry', [0]),
  K('topiary', 'a clipped topiary', 'farm', 3, [6, 24], 1.4, 'free', GENTLE, 0, 0, 'dry', [0]),
  K('hedge_arch', 'a hedge arch', 'farm', 3, [7, 26], 2.4, 'road', GENTLE, 0, 0, 'dry', [0]),
  K('tractor', 'an old tractor', 'farm', 4, [8, 34], 2.0, 'free', GENTLE, 1.5, 2.4, 'dry', [0, 1]),
  K('plough', 'a rusting plough', 'farm', 4, [8, 34], 1.4, 'free', GENTLE, 0, 0, 'dry', [0, 1]),

  /* ── roadside furniture ─────────────────────────────────────────────────── */
  K('bus_shelter', 'a bus shelter', 'roadside', 5, [5, 11], 2.2, 'road', FLATTISH, 0, 0, 'dry', null),
  K('bus_stop_sign', 'a bus stop', 'roadside', 6, [4, 9], 0.4, 'road', GENTLE, 0, 0, 'dry', null),
  K('bench', 'a bench with a view', 'roadside', 8, [5, 22], 1.2, 'road', GENTLE, 0, 0, 'dry', null),
  K('picnic_table', 'a picnic table', 'roadside', 6, [7, 30], 1.5, 'free', FLATTISH, 0, 0, 'dry', null),
  K('picnic_shelter', 'a picnic shelter', 'roadside', 3, [10, 40], 2.8, 'road', FLATTISH, 0, 0, 'dry', null),
  K('phone_box', 'a telephone box', 'roadside', 4, [4, 12], 0.6, 'road', FLATTISH, 0.6, 2.6, 'dry', null),
  K('vending_machine', 'a lit vending machine', 'roadside', 5, [4, 10], 0.7, 'road', FLATTISH, 0.7, 1.9, 'dry', null),
  K('post_box', 'a post box', 'roadside', 6, [4, 9], 0.4, 'road', GENTLE, 0, 0, 'dry', null),
  K('letterbox_post', 'a letterbox on a post', 'roadside', 6, [4, 12], 0.3, 'road', GENTLE, 0, 0, 'dry', null),
  K('notice_board', 'a parish notice board', 'roadside', 5, [4, 12], 0.8, 'road', GENTLE, 0, 0, 'dry', null),
  K('fingerpost', 'a fingerpost', 'roadside', 8, [4, 10], 0.5, 'free', GENTLE, 0, 0, 'dry', null),
  K('village_sign', 'a village sign', 'roadside', 5, [4, 12], 1.0, 'road', GENTLE, 0, 0, 'dry', null),
  K('milestone_big', 'a milestone', 'roadside', 6, [3.5, 8], 0.4, 'road', ROUGH, 0, 0, 'any', null),
  K('water_pump', 'a village pump', 'roadside', 4, [4, 14], 0.6, 'road', GENTLE, 0, 0, 'any', null),
  K('electrical_cabinet', 'a green cabinet', 'roadside', 4, [4, 10], 0.6, 'road', FLATTISH, 0, 0, 'dry', null),
  K('bicycle', 'a leaning bicycle', 'roadside', 5, [4, 12], 0.9, 'along', GENTLE, 0, 0, 'dry', null),
  K('telegraph_pole', 'a telegraph pole', 'roadside', 8, [5, 14], 0.4, 'along', GENTLE, 0.24, 7.5, 'dry', null),
  K('flag_pole', 'a flagpole', 'roadside', 3, [6, 24], 0.4, 'free', GENTLE, 0.2, 7.0, 'dry', null),
  K('windsock', 'a windsock', 'roadside', 3, [10, 60], 0.5, 'free', GENTLE, 0.2, 5.5, 'dry', [1, 3]),
  K('bird_house_pole', 'a bird house', 'roadside', 6, [4, 20], 0.35, 'free', GENTLE, 0, 0, 'dry', null),
  K('weather_vane', 'a weather vane', 'roadside', 4, [6, 26], 0.4, 'free', GENTLE, 0, 0, 'dry', null),
  K('wind_chime_arch', 'a wind-chime arch', 'roadside', 3, [6, 20], 1.8, 'road', GENTLE, 0, 0, 'dry', null),
  K('sundial', 'a sundial', 'roadside', 3, [5, 18], 0.7, 'free', GENTLE, 0, 0, 'dry', null),
  K('stone_steps', 'steps going up', 'roadside', 4, [4, 14], 1.6, 'road', ROUGH, 0, 0, 'dry', [0, 2]),
  K('crate_stack', 'stacked crates', 'roadside', 5, [4, 16], 1.2, 'free', GENTLE, 0, 0, 'dry', null),
  K('barrel_stack', 'stacked barrels', 'roadside', 5, [4, 16], 1.3, 'free', GENTLE, 0, 0, 'dry', null),
  K('market_stall', 'a shuttered market stall', 'roadside', 3, [6, 20], 2.0, 'road', FLATTISH, 0, 0, 'dry', null),

  /* ── buildings you pass ─────────────────────────────────────────────────── */
  K('cottage', 'a cottage', 'dwelling', 4, [16, 70], 4.6, 'road', FLATTISH, 4.2, 5.5, 'dry', [0]),
  K('log_cabin', 'a log cabin', 'dwelling', 4, [18, 80], 4.0, 'road', FLATTISH, 3.6, 4.6, 'dry', [0, 2]),
  K('tea_house', 'a tea house', 'dwelling', 3, [12, 50], 3.4, 'road', FLATTISH, 3.0, 4.0, 'dry', null),
  K('chapel', 'a small chapel', 'dwelling', 3, [18, 80], 3.8, 'road', FLATTISH, 3.4, 7.0, 'dry', null),
  K('dovecote', 'a dovecote', 'dwelling', 3, [12, 50], 1.8, 'free', FLATTISH, 1.6, 5.0, 'dry', [0]),
  K('gazebo', 'a gazebo', 'dwelling', 3, [12, 50], 2.6, 'free', FLATTISH, 0, 0, 'dry', [0]),
  K('bandstand', 'a bandstand', 'dwelling', 2, [16, 70], 3.6, 'free', FLATTISH, 0, 0, 'dry', [0]),
  K('yurt', 'a yurt', 'dwelling', 3, [14, 70], 2.8, 'free', FLATTISH, 2.6, 3.0, 'dry', [1, 2]),
  K('signal_box', 'a signal box', 'dwelling', 2, [14, 60], 2.4, 'road', FLATTISH, 2.2, 4.2, 'dry', null),
  K('clock_tower', 'a clock tower', 'dwelling', 2, [22, 110], 2.6, 'road', FLATTISH, 2.4, 14.0, 'dry', null),
  K('water_tower', 'a water tower', 'dwelling', 2, [25, 120], 3.0, 'free', FLATTISH, 2.6, 15.0, 'dry', [1]),
  K('windmill', 'a windmill', 'dwelling', 2, [40, 150], 4.4, 'road', FLATTISH, 4.0, 16.0, 'dry', [0, 1]),
  K('watermill', 'a watermill', 'dwelling', 2, [20, 70], 4.2, 'road', FLATTISH, 3.8, 7.0, 'shore', [0, 4]),
  K('lighthouse', 'a lighthouse', 'dwelling', 1, [30, 140], 3.2, 'free', FLATTISH, 3.0, 18.0, 'shore', [3, 4]),
  K('mooring_mast', 'an airship mast', 'dwelling', 1, [35, 150], 2.4, 'free', FLATTISH, 1.4, 20.0, 'dry', [1, 2]),
  K('ruined_tower', 'a ruined tower', 'ruin', 2, [25, 130], 3.0, 'free', GENTLE, 2.8, 8.0, 'dry', [2]),
  K('ruined_wall', 'a ruined wall', 'ruin', 3, [16, 90], 4.0, 'free', GENTLE, 0, 0, 'any', [1, 2]),
  K('rusted_truck', 'a truck going back to the earth', 'ruin', 3, [8, 34], 2.6, 'along', GENTLE, 1.8, 2.4, 'dry', null),
  K('caravan', 'a parked caravan', 'ruin', 3, [8, 30], 2.6, 'along', FLATTISH, 2.0, 2.8, 'dry', null),
  K('rail_trolley', 'a rail trolley on a stub of track', 'ruin', 2, [10, 45], 2.2, 'along', FLATTISH, 0, 0, 'dry', null),

  /* ── water's edge ───────────────────────────────────────────────────────── */
  K('jetty', 'a wooden jetty', 'water', 4, [8, 40], 3.6, 'free', GENTLE, 0, 0, 'shore', [4, 3]),
  K('rowboat', 'a rowing boat', 'water', 4, [6, 34], 1.8, 'free', GENTLE, 0, 0, 'shore', [4, 0]),
  K('upturned_boat', 'an upturned boat', 'water', 4, [6, 34], 1.8, 'free', GENTLE, 0, 0, 'any', [4, 3]),
  K('fishing_hut', 'a fishing hut', 'water', 3, [10, 45], 2.4, 'road', FLATTISH, 2.2, 3.0, 'shore', [4]),
  K('boathouse', 'a boathouse', 'water', 2, [12, 55], 3.4, 'road', FLATTISH, 3.0, 4.0, 'shore', [4]),
  K('crab_pots', 'stacked crab pots', 'water', 4, [5, 24], 1.2, 'free', GENTLE, 0, 0, 'shore', [3, 4]),
  K('buoy_cluster', 'a huddle of buoys', 'water', 3, [5, 26], 1.2, 'free', GENTLE, 0, 0, 'shore', [3, 4]),

  /* ── things that grew ───────────────────────────────────────────────────── */
  K('giant_mushrooms', 'improbable mushrooms', 'wild', 4, [6, 40], 2.2, 'free', GENTLE, 0, 0, 'any', [0, 4]),
  K('giant_acorn', 'an acorn the size of a car', 'wild', 2, [8, 45], 1.6, 'free', GENTLE, 1.4, 2.2, 'dry', [0]),
  K('bamboo_clump', 'a clump of bamboo', 'wild', 4, [6, 36], 2.0, 'free', GENTLE, 0, 0, 'dry', [0, 4]),
  K('tree_stump_axe', 'a stump with an axe in it', 'wild', 5, [5, 26], 1.0, 'free', GENTLE, 0, 0, 'dry', [0, 2]),
  K('fallen_log', 'a fallen log', 'wild', 6, [6, 40], 3.2, 'free', GENTLE, 0, 0, 'any', [0, 2]),
  K('log_pile', 'a stack of cut logs', 'wild', 6, [6, 30], 1.8, 'along', GENTLE, 1.6, 1.4, 'dry', [0, 2]),
  K('erratic_boulder', 'a boulder left by a glacier', 'wild', 4, [8, 60], 2.6, 'free', ROUGH, 2.4, 3.0, 'any', [2, 1]),
];

/** The id list, in catalogue order. src/render/props.js must provide geometry for each. */
export const PROP_IDS = PROP_KINDS.map((k) => k.id);

/** Look-up by id, so the renderer never has to scan. */
export const PROP_BY_ID = Object.fromEntries(PROP_KINDS.map((k) => [k.id, k]));

if (PROP_KINDS.length !== 100) {
  // Not fatal — the system works with any number — but the count is a stated deliverable,
  // so say so loudly rather than let it drift.
  console.warn(`[props] catalogue has ${PROP_KINDS.length} kinds, not 100`);
}

/* ── the road walk ────────────────────────────────────────────────────────── */

/** Cumulative arc length along an edge's polyline. */
function arcTable(e) {
  const n = e.pts.length / 2;
  const cum = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    const dx = e.pts[k * 2] - e.pts[k * 2 - 2];
    const dz = e.pts[k * 2 + 1] - e.pts[k * 2 - 1];
    cum[k] = cum[k - 1] + Math.hypot(dx, dz);
  }
  return cum;
}

/** Point and unit tangent at arc length `s` along an edge. */
function atArc(e, cum, s, out) {
  const n = cum.length;
  let k = 1;
  while (k < n - 1 && cum[k] < s) k++;
  const s0 = cum[k - 1];
  const seg = cum[k] - s0 || 1;
  const t = clamp01((s - s0) / seg);
  const ax = e.pts[k * 2 - 2], az = e.pts[k * 2 - 1];
  const bx = e.pts[k * 2], bz = e.pts[k * 2 + 1];
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  const l = Math.hypot(bx - ax, bz - az) || 1;
  out.tx = (bx - ax) / l;
  out.tz = (bz - az) / l;
  out.k = k;
  out.t = t;
  return out;
}

/* `e.key` is `${tier}:${i},${j},${dir}` (see roads.js buildEdge). Those four integers ARE
 * the edge's identity in the lattice and they are what the hashes must key on — a string
 * hash would work too, but the integers are already there and they mix better. If the key
 * format ever changes this parse fails loudly (NaN -> hash of 0), which is the failure mode
 * you want: every prop in the world collapsing onto one kind is impossible to miss. */
const KEY_RE = /^(\d+):(-?\d+),(-?\d+),(\d+)$/;
function edgeIds(e) {
  const m = KEY_RE.exec(e.key);
  if (!m) {
    console.error('[props] road edge key format changed:', e.key);
    return { tier: 0, i: 0, j: 0, dir: 0 };
  }
  return { tier: +m[1], i: +m[2], j: +m[3], dir: +m[4] };
}

/* One cumulative weight table per biome, built once. The draw used to re-weight all 100
 * kinds twice per candidate; there are only five biomes, so the whole thing is five arrays
 * and a linear scan. */
const BIOME_SLOTS = 8; // more than BIOME_COUNT, so a new biome cannot index past the end
const CUM = [];
for (let b = 0; b < BIOME_SLOTS; b++) {
  const table = new Float64Array(PROP_KINDS.length);
  let acc = 0;
  for (let i = 0; i < PROP_KINDS.length; i++) {
    const k = PROP_KINDS[i];
    // A biome preference is a x4 weight there and x0.25 elsewhere, never a hard filter: a
    // hard filter puts a visible seam along every climate border.
    acc += !k.biome ? k.w : k.biome.includes(b) ? k.w * 4 : k.w * 0.25;
    table[i] = acc;
  }
  CUM.push(table);
}

/** Weighted pick over the catalogue, with the biome preference applied. */
function pickKind(u, dominant) {
  const table = CUM[dominant] || CUM[0];
  const target = u * table[table.length - 1];
  for (let i = 0; i < table.length; i++) if (target <= table[i]) return PROP_KINDS[i];
  return PROP_KINDS[PROP_KINDS.length - 1];
}

/**
 * Every point of interest whose foot lands inside the box.
 *
 * @param {number} x0,z0,x1,z1 world box
 * @param {number} seed
 * @param {{site:Function, height:Function}} probe ground probes the caller owns, because it
 *        already has a Terrain for the region and building a second one here would double
 *        the most expensive thing in the generator.
 *        `probe.site(x,z) -> {y, dominant, wy}` — full: height including the road carve, the
 *        biome index, and the local water plane (null on dry land). Called ONCE per
 *        candidate.
 *        `probe.height(x,z) -> number` — height only, called four more times per candidate
 *        for the footprint. Kept separate because the full probe costs a second climate
 *        lookup and the footprint corners do not need one.
 * @param {object} [stats] optional counter bag. Every rejection reason is tallied into it,
 *        which is the only sane way to tune SLOT_P — the delivered density is about a sixth
 *        of the candidate rate and which test is eating them changes by biome.
 * @returns {Array} prop records, world space, ready to render.
 */
export function propsInBox(x0, z0, x1, z1, seed, probe, stats = null) {
  const site = probe.site;
  const height = probe.height || ((x, z) => probe.site(x, z).y);
  const out = [];
  const tally = (k) => {
    if (stats) stats[k] = (stats[k] || 0) + 1;
  };
  // Expanded so an edge whose curve lies outside the box can still throw a landmark into it.
  const edges = edgesInBox(x0 - MAX_OFFSET, z0 - MAX_OFFSET, x1 + MAX_OFFSET, z1 + MAX_OFFSET, seed, 20);
  const at = { x: 0, z: 0, tx: 1, tz: 0, k: 0, t: 0 };

  for (const e of edges) {
    const ids = edgeIds(e);
    const cum = arcTable(e);
    const total = cum[cum.length - 1];
    const p = SLOT_P[ids.tier] ?? SLOT_P[0];
    const half = e.width * 0.5;
    const slots = Math.floor(total / SLOT);

    const key0 = ids.i * 4 + ids.dir * 2 + ids.tier;
    for (let s = 0; s < slots; s++) {
      /* Acceptance from a plain hash, BEFORE any stream exists. Nineteen slots in twenty are
       * rejected on this line, and `rng()` allocates a closure — building one for every slot
       * of every road in the window cost more than every other test in this function put
       * together (9.9 ms a tile, measured, against 1.9 after). */
      if (hash3i(key0, ids.j, s, seed ^ SALT_ACCEPT) * F32 >= p) continue;
      // One stream per accepted slot. Every draw below comes from it, in a fixed order, so
      // adding a decision at the END of the sequence does not move props that already exist.
      const rnd = rng(hash3i(key0, ids.j, s, seed ^ SALT_PROP));
      tally('candidates');

      // Jitter within the slot so the finds are not on a metronome.
      atArc(e, cum, (s + 0.15 + rnd() * 0.7) * SLOT, at);
      if (at.x < x0 - MAX_OFFSET || at.x > x1 + MAX_OFFSET) continue;

      const here = site(at.x, at.z);
      const kind = pickKind(rnd(), here.dominant);

      // Left or right of the road, then out. The floor is what keeps props off the road:
      // half the carriageway, the verge clearance, and the object's own footprint.
      const sideSign = rnd() < 0.5 ? 1 : -1;
      const scale = 0.9 + rnd() * 0.24;
      const foot = kind.foot * scale;
      const minOff = Math.max(kind.off[0], half + VERGE_CLEAR + foot);
      const maxOff = Math.max(minOff + 1, kind.off[1]);
      const off = minOff + Math.pow(rnd(), 1.4) * (maxOff - minOff);

      // Right-hand normal in the ground plane, the same convention render/road.js uses for
      // its marker posts: (rx, rz) = (tz, -tx). Getting this backwards mirrors every prop
      // to the wrong verge, which is invisible in a screenshot and obvious in motion.
      const rx = at.tz * sideSign;
      const rz = -at.tx * sideSign;
      const x = at.x + rx * off;
      const z = at.z + rz * off;
      if (x < x0 || x >= x1 || z < z0 || z >= z1) {
        tally('outsideBox');
        continue;
      }

      /* The offset above only clears the road this prop hangs off. Two roads cross wherever
       * the two lattices happen to put them, so a prop placed a legal 8 m from a lane can
       * land 2 m from an arterial — measured: one prop in twenty-five sat on the tarmac
       * before this test existed. Clearing EVERY nearby centreline is the only version that
       * holds. */
      if (!clearOfRoads(edges, x, z, VERGE_CLEAR + foot)) {
        tally('rejectRoad');
        continue;
      }

      const probeFoot = site(x, z);
      if (!waterOk(kind.wet, probeFoot.y, probeFoot.wy)) {
        tally('rejectWater');
        continue;
      }

      // Ground under the whole footprint, not just under the origin. `lo` is what the object
      // stands on (so nothing floats) and `hi` - `lo` is how out-of-level the site is. The
      // sample radius and the slope limit MUST use the same radius: reading the rise across
      // 0.6 m and comparing it against the tolerance for a 0.3 m footprint rejected two
      // thirds of the small props for standing on ordinary ground.
      const probeR = Math.max(foot * 1.15, 0.6);
      const g = footprintGround(height, probeFoot.y, x, z, probeR);
      if (g.hi - g.lo > maxDrop(kind, probeR)) {
        tally('rejectSlope');
        continue;
      }

      // Facing. 'road' turns its front to the carriageway — which is the side the object is
      // OFFSET FROM, so the yaw points back along -r, not along +r.
      const yawAlong = Math.atan2(at.tx, at.tz);
      const yaw =
        kind.face === 'road' ? Math.atan2(-rx, -rz)
        : kind.face === 'along' ? yawAlong
        : rnd() * TAU;

      tally('placed');
      out.push({
        id: kind.id,
        group: kind.group,
        // Sit on the LOW corner and then a few more centimetres in, so a footing is never
        // visible hanging in the air on the downhill side. Buildings sample wide enough that
        // this is small; a stone on rough ground buries a little more, which is correct.
        y: g.lo - 0.04 - foot * 0.03,
        x,
        z,
        yaw: yaw + (rnd() - 0.5) * 0.12,
        scale,
        hue: rnd(),
        dominant: probeFoot.dominant,
        edgeKey: e.key,
        slot: s,
      });
    }
  }
  return out;
}

/**
 * How out-of-level a site may be, in metres of ground between the low and high probe.
 *
 * Two limits, whichever is tighter. The ANGLE limit is the physical one — a hut on a 20°
 * slope has nothing to sit on. The ABSOLUTE limit exists because the angle limit scales with
 * the footprint, so a barn on ground within its own 10° tolerance can still be dug 2.6 m
 * into the hillside, which measured as the worst burial in the whole world and looks like
 * the building is sinking. A prop may bed into the ground by about a sixth of its footprint
 * radius, and no more.
 */
function maxDrop(kind, probeR) {
  return Math.min(probeR * 2 * Math.tan(Math.acos(kind.slope)), 0.30 + kind.foot * 0.16);
}

/**
 * Is (x, z) at least `need` metres clear of the SHOULDER of every edge in the list?
 * `need` is measured from the edge of the carriageway, so the road's own width is added
 * here rather than by every caller.
 */
function clearOfRoads(edges, x, z, need) {
  for (const e of edges) {
    const m = e.width * 0.5 + need;
    if (x < e.minX - m || x > e.maxX + m || z < e.minZ - m || z > e.maxZ + m) continue;
    const m2 = m * m;
    const pts = e.pts;
    // Inlined point-segment distance rather than core/math.js segDist(): that one returns a
    // fresh object, and this loop runs a few hundred times per candidate.
    for (let k = 0; k < pts.length - 2; k += 2) {
      const ax = pts[k];
      const az = pts[k + 1];
      const dx = pts[k + 2] - ax;
      const dz = pts[k + 3] - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const qx = x - (ax + dx * t);
      const qz = z - (az + dz * t);
      if (qx * qx + qz * qz < m2) return false;
    }
  }
  return true;
}

/** Ground at the four footprint corners plus the centre (which the caller already has). */
function footprintGround(height, centreY, x, z, r) {
  let lo = centreY;
  let hi = centreY;
  for (let i = 0; i < 4; i++) {
    const v = height(i === 0 ? x + r : i === 1 ? x - r : x, i === 2 ? z + r : i === 3 ? z - r : z);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo, hi };
}

/** Freeboard rules, same shape as scatter.js's WATER_OK. */
function waterOk(rule, y, wy) {
  if (rule === 'any') return wy === null || y >= wy - 0.2;
  if (rule === 'shore') return wy !== null ? y >= wy - 0.1 && y <= wy + 2.6 : false;
  return wy === null || y >= wy + 0.6;
}

/* ── petrol stations ──────────────────────────────────────────────────────────
 * A station is not a fuel mechanic with a building attached, it is a REASON TO STOP. So it
 * is placed where stopping is nice: on the flattest stretch of an arterial, set back from
 * the road with room to pull in.
 *
 * Spacing is the number that matters. `FuelTank` holds about six minutes of cruising, which
 * at 90 km/h is roughly 9 km, so a station every ~3 km of arterial means a tank covers two
 * or three of them and you are never hunting. Arterial edges run 1.8-2.6 km, so one station
 * per edge at p = 0.72 lands there — IF the edge actually has somewhere flat enough. It does
 * not always.
 *
 * STATION_MAX_GRADE and STATION_AT were tuned before the relief pass that raised meadow
 * arterials to a worst grade of 27% and alpine to 53% (docs/BACKLOG.md, the W4 and
 * alpine-gradient entries) — before that, a 6% cap and five fixed sample points along the
 * edge were plenty. tools/diag-stations.mjs walks REAL connected chains of arterial (never a
 * box average, which is what the old acceptance test measured and which stayed green through
 * all of this) and reads off the gaps a driver actually meets:
 *
 *   preset    grade at 6%/5pt, worst real gap     candidate sites over cap    edges lost outright
 *   meadow           14.0-27.5 km                          25%                      5%
 *   rolling          13.1-33.6 km                          31%                      6%
 *   alpine           13.5-18.8 km                          59%                     22%
 *   plains           19.9-26.8 km                          19%                      3%
 *   dunes            22.0-35.3 km                          22%                      4%
 *   marsh            21.6-34.4 km                          18%                      3%
 *
 * A tank at cruise covers 9.5 km and 5.6 km flat out (tools/bench-fuel.mjs), so ANY of the
 * above is "ran completely dry, in the open, with nothing in sight" — the exact experience
 * behind the operator's report. And grade is not even the biggest single rejection reason in
 * most presets: with only five fixed points along a 1.8-2.6 km edge, the flattest of the five
 * is very often also sitting over water (the "no pumps on a causeway" rule, `waterOk`'s
 * cousin below), which measured as costing MORE candidates than grade in five of six presets
 * (only alpine's grade loss, 22% of edges, outweighs it). So this is not purely a grade
 * problem: it is a SEARCH DENSITY problem that grade makes worse. The fix is both — more
 * candidate points per edge, so a real flat-and-dry pocket that exists somewhere along a
 * 2+ km edge is actually found instead of missed by unlucky fixed sampling, AND a higher cap,
 * because alpine's own median road grade (7.4%, tools/diag-relief.mjs) already exceeds the
 * old 6% ceiling — no amount of extra sampling finds a flat spot that is not there.
 *
 * Re-measured after (STATION_MAX_GRADE 0.06 -> 0.11, STATION_AT 5 -> 11 points, and the water
 * test moved to run per-candidate instead of only on the single flattest one — see below):
 * across all six presets, four seeds, ~545 km of real connected arterial each (13 113 km
 * total), the worst real gap seen anywhere drops from 35.3 km to 17.99 km. Better, but STILL
 * short of the 5.6 km flat-out floor on its own — see "why stations alone are not enough"
 * below and the floating-can section further down, which is what actually closes it (worst
 * gap to ANY fuel source, stations and cans together, over 2 333 km of real routes: 4.54 km,
 * comfortably inside both the 5.6 km flat-out and 9.5 km cruise ranges). `node
 * tools/diag-stations.mjs`.
 *
 * WHY STATIONS ALONE ARE NOT ENOUGH, even fixed: STATION_P is an independent 72% draw per
 * arterial edge. Rejecting the diagnosis-first-then-fix-second questions honestly: with grade
 * and water rejection isolated out entirely (STATION_MAX_GRADE raised to a number nothing can
 * fail — a real experiment, not a guess), the worst real gap is STILL 10-18 km, because a
 * sequence of unlucky 28%-fail draws in a row is not rare over hundreds of edges. Raising
 * STATION_P to chase that away would either flood the road with stations (losing "a REASON TO
 * STOP") or still not fully close it. That combinatorial tail is what the floating cans exist
 * to backstop — see below.
 *
 * Unlike the props, this is a PURE function of the seed — no ground probe — because
 * src/game/fuel.js has to be able to ask "where is the nearest pump" from anywhere without
 * building a Terrain. It reads the edge's canonical elevation to find the flat spot, which
 * `edgeProfile` makes deterministic.
 */
/* ── distance from spawn widens the gaps, gently, with a floor ───────────────────────────
 * Operator: "the further you get from spawn, the further apart the gas stations are. They
 * should still be findable though, not too hard." Flat (today's spacing, unchanged) out to
 * STATION_NEAR_KM — comfortably past a full tank's own cruise range, so nobody near home ever
 * notices anything changed — then EASES the accept probability down to a floor by
 * STATION_FAR_KM and goes no further past it: a hard cap on sparseness, not an unbounded
 * drift into "genuinely unfindable".
 *
 * The floating-can layer (CAN_SLOT_P, below) is deliberately NOT scaled by this. Cans already
 * exist specifically to backstop STATION_P's own combinatorial tail (see the file comment on
 * fuelCansInBox) and stay a constant safety net at any distance — that division of labour is
 * what lets "harder to find" widen honestly for stations without ever crossing into "actually
 * stranded" (diag-stations.mjs's combined-source section measures this directly).
 *
 * Distance is read off the EDGE's own bounding-box centre rather than the real spawn point,
 * because stationForEdge has to stay a pure function of the edge alone (no ground probe, no
 * knowledge of where findSpawn happened to land this session) — and findSpawn always lands
 * within a few km of the world origin by construction, so "far from the origin" and "far from
 * spawn" are the same statement in practice.
 */
const STATION_NEAR_KM = 9; // flat out to here — about a cruise tank's own range
const STATION_FAR_KM = 70; // eased down to the floor by here, and no further past it
const STATION_FAR_MUL = 0.4; // floor: stations roughly 2.5x rarer far out than close to home

/** 1.0 near spawn, smoothstep-eased down to STATION_FAR_MUL by STATION_FAR_KM, flat at both
 *  ends — no kink a driver could ever feel at the near boundary. */
function stationDistanceMul(distM) {
  const km = distM / 1000;
  if (km <= STATION_NEAR_KM) return 1;
  if (km >= STATION_FAR_KM) return STATION_FAR_MUL;
  const t = (km - STATION_NEAR_KM) / (STATION_FAR_KM - STATION_NEAR_KM);
  const s = t * t * (3 - 2 * t);
  return 1 - s * (1 - STATION_FAR_MUL);
}

const STATION_P = [0.72, 0.1];
/** Candidate positions along an edge, as fractions of its length — kept off both ends, which
 *  sit inside a junction's pinned ramp and are not representative of the road's own grade.
 *  Eleven points rather than the original five: measured (tools/diag-stations.mjs) as the
 *  difference between a real flat-and-dry pocket existing on an edge and it being FOUND. */
const STATION_AT = [0.08, 0.16, 0.24, 0.32, 0.40, 0.48, 0.56, 0.64, 0.72, 0.80, 0.88];
/** Steepest road a forecourt will be built beside, as a gradient. Was 0.06 — raised after the
 *  relief pass left even alpine's MEDIAN road grade at 7.4%, above the old cap, so no amount
 *  of extra search finds a legal spot on a preset whose typical ground already exceeds it. */
export const STATION_MAX_GRADE = 0.11;

/* ── the forecourt has to stand on the ground it is drawn on ──────────────────
 * Operator, twice: "the collisions of fuel stations are still non-existent". The hitboxes
 * (render/props.js STATION_HITBOXES) were there the whole time and are registered on every
 * baked tile; measured, 24.3% of them were being thrown away by collide.js's own height gate
 * (`car.y - 0.4 > s.y + s.h`) before they could ever be tested, and at 12 of 30 sampled
 * stations 4-6 of the 7 were gone. That gate is CORRECT — nothing invisible may be solid —
 * and it was firing because the building really was invisible: underground.
 *
 * WHY. A forecourt is graded to the ROAD (`y: best.y` below, which is right — a real one is,
 * and a forecourt that followed the ground would tilt and the pumps would lean), but it sits
 * `e.width/2 + STATION_OFFSET` ≈ 19 m OFF the road, and nothing carves the terrain out there.
 * Nothing checked what the ground 19 m away was doing. Measured across three seeds, 30
 * stations: the ground under the forecourt centre missed the road height by a MEDIAN of 5.5 m
 * and by as much as 9.4 m — stations buried in a hillside, or standing on a plinth of air over
 * a valley. render/props.js can only lift the slab by ±1 m before the access spur becomes a
 * cliff, so the fix has to be in the PLACEMENT: put the forecourt where the hill isn't.
 *
 * The lever costs nothing, because the search was already there and was spending itself on the
 * wrong question. STATION_AT offers 11 candidate sites along the edge and each has two sides;
 * the old code took the flattest ROAD grade of the eleven and then picked a side by a sun
 * flip. Ranking the same 22 (site, side) pairs by the STEP between the road and the ground the
 * forecourt would stand on instead — grade and water still hard requirements, not preferences —
 * moves the achievable step from "≤1 m at 18% of edges" to "≤1 m at 64%, ≤2 m at 76%"
 * (tools/bench-props.mjs re-measures this; the raw sweep is in the station section there).
 *
 * The cap below is then what turns "the best of 22" into a guarantee. An edge whose best
 * pairing still steps more than this gets no station at all: better a slightly longer hunt
 * than a petrol station you can drive through, and the floating cans (below) are the layer
 * that exists precisely so a rarer station is not a stranding. */
export const STATION_MAX_STEP = 3.0;
/** How far along the road either side of the forecourt centre the step is sampled — half the
 *  apron's own depth plus a little, so a site is rejected for a hill CROSSING the forecourt as
 *  well as for one that merely misses its centre. Three probes, not nine: the same measurement
 *  that chose the cap shows the centre probe alone already carries the signal, and this is
 *  evaluated 22 times per arterial edge. */
const STATION_STEP_PROBE = 8;
/** Metres from the centreline to the middle of the forecourt. */
export const STATION_OFFSET = 15.5;
/** Within this of the pumps, stopped, and you are refuelling. */
export const STATION_RADIUS = 11;
/** Forecourt half-extents, ALONG the road and AWAY from it. The single source of truth for
 *  the apron slab (src/render/props.js buildStation, which used to hardcode these as local
 *  AW/AD) and for anything else that needs to know where its edge is — the access spur, the
 *  collision hitboxes on the kiosk/pumps/canopy, and the little town cluster all read these
 *  rather than each guessing the forecourt's own size a second way. */
/* ── THE SHOWROOM LINE-UP ─────────────────────────────────────────────────────
 *
 * Operator: "The dealership should have the other cars, you know, show room type situation where
 * they can see the different cars physically and choose them."
 *
 * Four slots on the open apron, BEHIND the canopy, in the station's own local frame — the same
 * frame buildStation draws in and stationSolids collides in. It lives here, in the pure world
 * module, precisely because three separate things have to agree about where a display car is:
 * the renderer draws it, the collider makes it solid, and the game asks "which one am I standing
 * next to". Three copies of these numbers would drift, and the failure would be silent — a price
 * plaque on one car and the purchase of another.
 *
 * The geometry is dictated by what is already on the apron. The canopy posts stand at local
 * z = +4.4 and x = ±5.2; the pumps are at z = +1.0; the kiosk is at z = -4.8 beside the driveway
 * mouth (measured, `node tools/probe-station-frame.mjs`). So z = +5.9 is the one clear strip that
 * keeps a display car clear of every post, and ±8.0 / ±4.0 / 0 spaces five of them 4 m apart across
 * a 19 m apron with a 0.35 m margin at the tightest post.
 *
 * FIVE, not four, because the Ford F150 joined the dealership fleet and bench-props asserts that the
 * row IS the fleet, in order. That check earned its place immediately: adding the truck turned it red
 * on the same commit rather than shipping a forecourt that silently sold a car it did not display.
 *
 * A display car's NOSE overhangs the apron's front edge onto the grass — 2.2 m for the saloons, 2.8 m
 * for the truck. That is deliberate rather than unnoticed: pulling the row back to fit would put it
 * inside the canopy posts, and a forecourt display facing the open field is what a real one looks
 * like. What must stay inside the apron is the row's WIDTH, and bench-props checks that against each
 * car's real half-width rather than against the slot centre.
 */
export const SHOWROOM_SLOTS = [
  { dx: -8.0, dz: 5.9 },
  { dx: -4.0, dz: 5.9 },
  { dx: 0.0, dz: 5.9 },
  { dx: 4.0, dz: 5.9 },
  { dx: 8.0, dz: 5.9 },
];

/** How close you have to be to a display car for it to be the one you are looking at, in metres. */
export const SHOWROOM_REACH = 5.0;

/**
 * Where a dealership's display cars actually are, in world space.
 *
 * @param {object} st a station with `deal` set
 * @returns {Array<{slot: number, x: number, z: number, yaw: number}>} empty for a plain petrol station
 */
export function showroomSpots(st) {
  if (!st || !st.deal) return [];
  const ca = Math.cos(st.yaw);
  const sa = Math.sin(st.yaw);
  return SHOWROOM_SLOTS.map((b, i) => ({
    slot: i,
    x: st.x + b.dx * ca - b.dz * sa,
    z: st.z + b.dx * sa + b.dz * ca,
    // Parked square to the building, nose out, the way a forecourt actually lines cars up.
    yaw: st.yaw,
  }));
}

export const STATION_APRON_HALF_WIDTH = 9.5;
export const STATION_APRON_HALF_DEPTH = 7.0;

let _land = null;
let _water = null;
let _fnSeed = null;
function pureFns(seed) {
  if (_fnSeed !== seed) {
    _fnSeed = seed;
    _land = landFn(seed);
    _water = waterFn(seed);
  }
  return { land: _land, water: _water };
}

/**
 * Station outcome for ONE edge, independent of any query box. Factored out of stationsInBox
 * so a route walk can ask about edges in DRIVEN ORDER (tools/diag-stations.mjs) rather than a
 * box average — a box average is what the old acceptance test measured, and it is the wrong
 * question: a driver experiences the GAPS along the road they are actually on, and relief
 * (and therefore grade, and therefore where this function says no) is spatially correlated,
 * so a box-wide mean can look fine while one real corridor through the hills goes station-to-
 * station for three or four times the average.
 *
 * `stats`, if given, tallies WHY an edge did or did not get a station — candidate sites tried,
 * how many of those were over STATION_MAX_GRADE, and whether the whole edge came up empty
 * because of it. That is the only way this cap has ever been tuned instead of guessed at (see
 * the SLOT_P comment above for the same argument applied to the props rarity dial).
 */
function stationForEdge(e, seed, stats = null) {
  const tally = (k) => {
    if (stats) stats[k] = (stats[k] || 0) + 1;
  };
  const ids = edgeIds(e);
  // Distance from the world origin — see stationDistanceMul's own comment above for why the
  // edge's bounding-box centre is the right proxy for "distance from spawn" here.
  const distM = Math.hypot((e.minX + e.maxX) * 0.5, (e.minZ + e.maxZ) * 0.5);
  const p = (STATION_P[ids.tier] ?? 0) * stationDistanceMul(distM);
  tally(ids.tier === 0 ? 'arterialEdges' : 'laneEdges');
  const rnd = rng(hash3i(ids.i * 4 + ids.dir * 2 + ids.tier, ids.j, 0x5a, seed ^ SALT_STATION));
  if (rnd() >= p) return null;
  tally(ids.tier === 0 ? 'arterialSelected' : 'laneSelected');

  /* THE road elevation — the same one the terrain carves to and the ribbon is drawn on.
   * This used to profile a private copy, because a RoadField's `y` was levelled against
   * whatever else happened to be in ITS box and so was not a function of the edge alone;
   * two clients querying different boxes put the forecourt at two different heights. That
   * is fixed at the source now (see "one road, ONE height" in world/roads.js), and a
   * private profile here would be a forecourt built on a road that is not where the road
   * is. Memoised inside edgeProfile, so neighbouring tiles asking about the same arterial
   * still pay for it once. */
  const { land, water } = pureFns(seed);
  edgeProfile(e, seed, land, water);
  const cum = arcTable(e);
  const total = cum[cum.length - 1];
  const at = { x: 0, z: 0, tx: 1, tz: 0, k: 0, t: 0 };

  /* Flattest of the candidates that are ALSO not sitting over water — both tests apply to
   * EACH candidate, not grade-first-then-water-on-whatever-won. That used to pick the single
   * flattest point on the whole edge and only then ask whether it was dry; on the flat, wet
   * presets (marsh, dunes, plains) the flattest point on an edge is disproportionately likely
   * to be the low-lying wet one, so a denser, better grade search made the causeway rejection
   * WORSE, not better — measured, tools/diag-stations.mjs: raising the candidate count alone
   * pushed marsh's worst real gap from 34 km to 54 km. Testing both constraints together and
   * keeping the flattest point that clears BOTH is what a "flattest AND dry" search actually
   * means. Grade is measured over the polyline either side, which is ~150 m for an arterial —
   * the length a forecourt and its two approaches actually need. */
  /* WHICH SIDE OF THE ROAD, and the water test that the road point alone cannot make.
   *
   * A candidate's grade test above is about the ROAD. The forecourt does not sit on the road —
   * it sits `e.width/2 + STATION_OFFSET` (~19 m) to one side with STATION_RADIUS of apron
   * around it, so a station can pass every road-side test and still have its apron running down
   * into a lake. Measured before this existed: 4 of 128 stations across 7 seeds had apron
   * within the road's own 1.6 m freeboard of open water, the worst clearing it by only 0.76 m.
   * The operator's screenshot is one of them — a forecourt at the very edge of the water.
   *
   * The side used to be a free sun flip; it is now part of the search (see STATION_MAX_STEP
   * above), and the flip survives only as the tie-break order, so a station on genuinely
   * symmetric ground still picks a side unpredictably instead of always leaning one way. */
  const off = e.width * 0.5 + STATION_OFFSET;
  /* Deepest water intrusion over the apron: its centre plus its rim. `water()` returns null on
   * dry ground. Positive means the water plane is ABOVE the graded forecourt height. */
  const apronWater = (ax, az, refY) => {
    let worst = -Infinity;
    for (let i = 0; i < 9; i++) {
      const a = i ? ((i - 1) / 8) * Math.PI * 2 : 0;
      const r = i ? STATION_RADIUS : 0;
      const w = water(ax + Math.cos(a) * r, az + Math.sin(a) * r);
      if (w !== null) worst = Math.max(worst, w - refY);
    }
    return worst;
  };
  /* How far the ground under the forecourt misses the height the forecourt will be BUILT at
   * (the road's own graded height). Sampled at the centre and one apron-depth either way along
   * the road, so a hill crossing the forecourt is caught as well as one that misses its
   * centre. This is the number the whole station-collision bug came down to — see
   * STATION_MAX_STEP. */
  const apronStep = (ax, az, tx, tz, refY) => {
    let worst = 0;
    for (const u of [0, -STATION_STEP_PROBE, STATION_STEP_PROBE]) {
      const d = Math.abs(land(ax + tx * u, az + tz * u) - refY);
      if (d > worst) worst = d;
    }
    return worst;
  };
  // Same freeboard the road itself uses, so a forecourt is held to the road's own standard.
  const FREEBOARD = -1.6;
  const first = rnd() < 0.5 ? 1 : -1;

  let best = null;
  for (const f of STATION_AT) {
    atArc(e, cum, f * total, at);
    tally('candidateSites');
    const k = at.k;
    const run = Math.max(1, cum[Math.min(k + 1, cum.length - 1)] - cum[Math.max(k - 1, 0)]);
    const rise = Math.abs(e.y[Math.min(k + 1, e.y.length - 1)] - e.y[Math.max(k - 1, 0)]);
    const grade = rise / run;
    if (grade > STATION_MAX_GRADE) {
      tally('rejectGrade');
      continue;
    }
    const roadY = e.y[k - 1] + (e.y[k] - e.y[k - 1]) * at.t;
    const w = water(at.x, at.z);
    if (w !== null && roadY < w + 1.6) {
      tally('rejectCauseway'); // no pumps on a causeway
      continue;
    }
    /* Both sides, both hard tests, and the STEP is what ranks the survivors. Ordering the two
     * sides by the sun flip is what makes the tie-break unbiased; `<` (not `<=`) then keeps
     * the first-tried side when the two are exactly equal. */
    let wet = 0;
    for (const s of [first, -first]) {
      // Same right-hand ground normal as propsInBox and render/road.js: (tz, -tx).
      const rx = at.tz * s;
      const rz = -at.tx * s;
      const ax = at.x + rx * off;
      const az = at.z + rz * off;
      if (apronWater(ax, az, roadY) >= FREEBOARD) {
        wet++;
        continue;
      }
      const step = apronStep(ax, az, at.tx, at.tz, roadY);
      if (step > STATION_MAX_STEP) continue;
      if (!best || step < best.step) {
        best = { grade, step, x: at.x, z: at.z, tx: at.tx, tz: at.tz, y: roadY, frac: f, side: s, rx, rz };
      }
    }
    if (wet === 2) tally('rejectApronWater'); // both sides put this forecourt in the water
  }
  if (!best) {
    tally('edgeEmpty');
    return null;
  }

  const sideSign = best.side;
  const rx = best.rx;
  const rz = best.rz;
  const x = best.x + rx * off;
  const z = best.z + rz * off;
  tally('placed');

  return {
    key: `st:${e.key}`,
    /* ── DEALERSHIP OR PETROL STATION ─────────────────────────────────────────
     * Operator: "add dealerships where you can buy cars with suns".
     *
     * A dealership needs exactly what a station needs — a graded pad beside the road, an access
     * spur onto it, flat ground, a hitbox and something visible from a distance — and all of
     * that already exists here and has been measured (diag-stations, bench-props,
     * diag-junction-cover). So a dealership IS a station, with a flag: a deterministic share of
     * them sell cars instead of fuel. Building a second, parallel placement system would have
     * meant a second set of the same bugs.
     *
     * DEAL_SHARE of them, off the station's own hash so it is a pure function of the edge and
     * every client agrees. Not a half: petrol is the thing you NEED and a dealership is the
     * thing you save up for, so pumps stay the common case. */
    deal: rnd() < DEAL_SHARE,
    x,
    z,
    // The forecourt is GRADED, exactly like the road it serves: it takes the road's own
    // smoothed height, not the raw land's. A forecourt that followed the ground would tilt
    // and the pumps would lean.
    y: best.y,
    roadX: best.x,
    roadZ: best.z,
    // The unit normal FROM the road TO the station — the same (rx, rz) the offset above was
    // built from, kept on the record so anything downstream (the access spur, the town
    // cluster) can walk back toward the road without re-deriving it from yaw a second,
    // independent way. And the host edge's own width at the connection point, so the spur
    // knows exactly where the carriageway's own edge is.
    nx: rx,
    nz: rz,
    width: e.width,
    // Faces the road across the apron.
    yaw: Math.atan2(-rx, -rz),
    along: Math.atan2(best.tx, best.tz),
    side: sideSign,
    grade: best.grade,
    /** Worst |ground - graded height| over the forecourt, in metres — the number
     *  STATION_MAX_STEP caps. Kept on the record so the acceptance harness measures what the
     *  placement actually promised rather than re-deriving it a second way. */
    step: best.step,
    // Fraction along the edge's own arc length, [0,1) — not used by the renderer, only by a
    // route walk that needs to know WHERE in the edge the forecourt sits to add up real gaps.
    edgeFrac: best.frac,
  };
}

/**
 * Every petrol station whose forecourt centre lands inside the box.
 * Pure: same seed, same answer, no ground probe needed.
 * `stats`, if given, is forwarded to stationForEdge — see it for what gets tallied.
 *
 * `probe`, if given, must be the tile's REAL ground probe ({ height(x, z) }) — the same one
 * propsInBox already takes. With it, a forecourt whose real ground is too broken to grade a
 * slab into is dropped here rather than drawn floating over a ravine (see stationPad's own
 * header for the measurement and STATION_MAX_ROUGH for the cap). WITHOUT it this function is
 * unchanged and still pure, which is what `nearestStation` over a 10 km box and
 * `stationSpacing` rely on — a carve-aware probe is far too expensive at that size.
 */
export function stationsInBox(x0, z0, x1, z1, seed, stats = null, probe = null) {
  const out = [];
  const edges = edgesInBox(x0 - 60, z0 - 60, x1 + 60, z1 + 60, seed, 20);
  const h = probe && probe.height;
  for (const e of edges) {
    const st = stationForEdge(e, seed, stats);
    if (!st) continue;
    if (st.x < x0 || st.x >= x1 || st.z < z0 || st.z >= z1) continue;
    if (h && !stationSits(st, h)) {
      if (stats) stats.rejectRoughGround = (stats.rejectRoughGround || 0) + 1;
      continue;
    }
    out.push(st);
  }
  return out;
}

export { stationForEdge };

/**
 * The two ends of a station's own access spur — a real, short driveway from the edge of the
 * HOST road's own carriageway to the forecourt, built because a screenshot showed a station
 * sitting on a raised apron with a kerb-like edge and nothing connecting it to the road you
 * would have to drive over that edge to reach it.
 *
 *   mouth — right at the edge of the host road's own tarmac (half its width out from the
 *           centreline), so the spur butts up against the arterial's EXISTING geometry
 *           without overlapping or displacing a single vertex of it. Per the operator: "it
 *           should also not cancel your street" — this never touches the host edge's own
 *           lattice entry, its polyline, or its tangent, so that edge's continuity is
 *           completely untouched. A true lattice junction (buildJunction() in
 *           render/road.js, reused for the ROAD-crossing case earlier this round) was
 *           considered and rejected for this: wiring a synthetic edge into the road lattice
 *           risks exactly the class of bug this project has already been bitten by once
 *           (drawn geometry disagreeing with the terrain the car drives on) for a feature
 *           that does not need the lattice's own machinery — this IS the documented fallback,
 *           a clean T-spur that leaves the host edge alone.
 *   apron — tucked 0.4 m inside the forecourt's own near edge (STATION_APRON_HALF_DEPTH back
 *           from the station centre, along the same normal the forecourt itself is offset
 *           on), so the two meet with no hairline gap.
 *
 * Pure geometry, no ground probe: it is a function of the station record alone (which is
 * itself a pure function of the edge — see stationForEdge). Only render/props.js adds real
 * heights to these two points, because only it has a ground probe to hand; a diagnostic tool
 * can still call this directly to PROVE the spur reaches both ends geometrically, which is
 * the reason this is its own exported function rather than inlined into the renderer.
 */
export function stationSpur(st) {
  const halfW = (st.width ?? 0) * 0.5;
  const mouthX = st.roadX + st.nx * halfW;
  const mouthZ = st.roadZ + st.nz * halfW;
  const apronX = st.x - st.nx * (STATION_APRON_HALF_DEPTH - 0.4);
  const apronZ = st.z - st.nz * (STATION_APRON_HALF_DEPTH - 0.4);
  return { mouthX, mouthZ, apronX, apronZ };
}

/* ── the forecourt against the ground the car actually drives on ──────────────
 * MEASURED, 2026-07-28, and this is the "who asked?" bug (tools/diag-seam.mjs's own header)
 * reopening in a new place. Every ground test in stationForEdge above — apronStep, and the
 * STATION_MAX_STEP guarantee it exists to enforce — asks `land()`, the RAW biome relief. The
 * car, the terrain mesher and the drawn ribbon all ask `Terrain.height()`, which is that land
 * BENT BY THE ROAD CARVE. Beside a road those two are not the same surface, and stations live
 * 19 m from a road by construction. Profiled across the normal at one real station
 * (st:0:0,-2,1, seed 20260726): land() runs a smooth 267 -> 254 while Terrain.height() runs
 * 262 -> 248 with a 17 m trench at 10 m off the centreline, where a neighbouring edge is cut
 * into the hill. The placement scored that site at `step` 0.07 m — a perfect forecourt, on a
 * surface nothing else in the game uses.
 *
 * The consequence is exactly the operator's report ("the roads that lead to them need to work
 * (no fall through)"): the apron slab and its access spur were drawn on `land`'s ground and
 * the wheels are on `Terrain.height`'s, so the tarmac floated. Measured over 42 stations on
 * three seeds before this landed: worst drawn-above-driven 16.28 m, and 24 of the 42 over
 * half a metre (tools/diag-spur.mjs).
 *
 * Making the PLACEMENT carve-aware is not available at this size: a carve sample needs a
 * RoadField, `stationsInBox` is called per streamed tile AND by `nearestStation` over a 10 km
 * box, and the field for one arterial edge already costs render/road.js about 10 ms. So the
 * two numbers a forecourt actually stands on are computed HERE, once, from whatever real
 * ground probe the caller has (the tiler always has one), and everything downstream — the
 * slab height, the access spur, the collision hitbox base, and the acceptance harness — reads
 * this one function instead of each grading the station its own way.
 */

/** Where the slab's own ground is sampled, in the station's local (along-road, toward-road)
 *  frame: the four corners, the four edge midpoints and the centre of the apron rectangle. */
export const STATION_PAD_PROBES = [
  [0, 0],
  [STATION_APRON_HALF_WIDTH, STATION_APRON_HALF_DEPTH], [-STATION_APRON_HALF_WIDTH, STATION_APRON_HALF_DEPTH],
  [STATION_APRON_HALF_WIDTH, -STATION_APRON_HALF_DEPTH], [-STATION_APRON_HALF_WIDTH, -STATION_APRON_HALF_DEPTH],
  [0, STATION_APRON_HALF_DEPTH], [0, -STATION_APRON_HALF_DEPTH],
  [STATION_APRON_HALF_WIDTH, 0], [-STATION_APRON_HALF_WIDTH, 0],
];

/**
 * How much the REAL ground may vary under one forecourt slab before that slab stops being a
 * forecourt and becomes a mesa. A petrol station is a graded pad and a graded pad is flat, so
 * some plinth is correct and unavoidable — measured over 185 stations on five seeds, the
 * median real-ground spread under an apron is 1.60 m and the 90th percentile 4.04 m. This cap
 * is the tail: 12 of those 185 (6.5%) stand on ground that moves more than the canopy is tall,
 * and those are the ones drawn floating over a ravine. They are dropped rather than drawn,
 * which is the same trade STATION_MAX_STEP already makes ("better a slightly longer hunt than
 * a petrol station you can drive through") and which the floating fuel cans exist to backstop.
 */
export const STATION_MAX_ROUGH = 5.0;

/**
 * How big a step the slab may still stand over the access spur's own arrival point. Zero for
 * most stations — the pad is graded to that exact point — and non-zero only where the bank
 * behind the forecourt would otherwise bury it deeper than PAD_BURY_MAX, at which point the
 * two constraints fight and this is the one that gives. Measured over the same 185 stations:
 * the median door step is 0.04 m and 80% are inside 0.25 m, and then the tail jumps straight
 * past a metre — there is almost nothing in between (door > 0.5 m: 32 stations; door > 1.0 m:
 * 23). So the cap buys the tight guarantee for very little: together with STATION_MAX_ROUGH,
 * 0.5 keeps 152 of 185 (82.2%) where 1.0 keeps 161 (87.0%). The 18% dropped are the ones whose
 * forecourt sits on ground no flat slab can be cut into — precisely the set that was being
 * drawn floating, and the floating fuel cans are the layer that exists to backstop a rarer
 * station (see the CAN_SLOT comment below).
 */
export const STATION_MAX_DOOR = 0.5;

/**
 * The forecourt's real seating: where the slab's top face goes, and the ground it is standing
 * on. `height(x, z)` must be the SAME ground the car drives on — src/render/props.js hands in
 * its tile Terrain's own `height`, tools/bench-props.mjs and tools/diag-spur.mjs hand in a
 * real Terrain's. Never `land()`; see this section's header for what that cost.
 *
 *   y     the slab's top face. CUT AND FILL, the way a real forecourt on a slope is built,
 *         rather than a clamp toward the road's own graded height. That clamp (padY within
 *         PAD_STEP of `s.y`) is what BURIED forecourts — up to 3.23 m of hillside standing
 *         over the slab, which is the mechanism that made collide.js's own height gate throw
 *         the hitboxes away and produced "the collisions of fuel stations are still
 *         non-existent" twice. The slab is graded to the highest real ground on its ROAD-FACING
 *         half, so the access spur arrives flush and the player drives in level; the back half
 *         is allowed to be cut into the bank behind it, but never by more than PAD_BURY_MAX,
 *         which is under every forecourt hitbox's own height and so can never gate one out.
 *   lo    the lowest ground under the apron — how deep the skirt has to reach.
 *   rough hi - lo, the number STATION_MAX_ROUGH caps.
 *   hRoad the real drivable height at the spur's mouth, i.e. the edge of the carriageway.
 */
/** How deep the bank behind a forecourt may stand over its slab. Every entry in
 *  render/props.js STATION_HITBOXES is at least 2.0 m tall and collide.js only gates a solid
 *  out once the car's own ground is more than `h + 0.4` above its base, so 1.5 m keeps every
 *  forecourt collider reachable with a margin of half a metre on the shortest of them. */
export const PAD_BURY_MAX = 1.5;

export function stationPad(st, height) {
  const ca = Math.cos(st.yaw);
  const sa = Math.sin(st.yaw);
  let lo = Infinity;
  let hi = -Infinity;
  for (const [dx, dz] of STATION_PAD_PROBES) {
    const g = height(st.x + dx * ca - dz * sa, st.z + dx * sa + dz * ca);
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  /* Graded to the ground AT THE DOOR — the exact point where the access spur meets the slab.
   * That is the one place the drawn tarmac has to be continuous, because it is where the
   * player drives on, and grading anywhere else (the road's height, the apron's high corner,
   * the apron's mean) leaves a step there that is a fall-through by another name. Everything
   * else about the slab is then absorbed: the high side is cut into the bank (capped at
   * PAD_BURY_MAX so no collider is ever gated out), and the low side stands on its own batter
   * skirt, which is what a skirt is for. */
  const sp = stationSpur(st);
  const gEnd = height(sp.apronX, sp.apronZ);
  const y = Math.max(gEnd + 0.04, hi - PAD_BURY_MAX);
  return {
    y, lo, hi, gEnd,
    /** How far the slab still stands over the spur's own arrival point — the residual step
     *  the last section of the driveway has to swallow. Zero unless the burial cap bound. */
    door: y - gEnd,
    rough: hi - lo,
    hRoad: height(sp.mouthX, sp.mouthZ),
  };
}

/** Does this forecourt stand on ground a flat slab can actually be graded into, with a
 *  driveway that meets it? See STATION_MAX_ROUGH and STATION_MAX_DOOR. */
export function stationSits(st, height) {
  const p = stationPad(st, height);
  return p.rough <= STATION_MAX_ROUGH && p.door <= STATION_MAX_DOOR;
}

/**
 * The nearest station to a point, or null. Used by the fuel gauge to tell you which way to
 * go, and by the refuelling test. `radius` is searched as a box; 5 km comfortably contains
 * one at the 3 km spacing above.
 */
export function nearestStation(x, z, seed, radius = 5000) {
  const list = stationsInBox(x - radius, z - radius, x + radius, z + radius, seed);
  let best = null;
  let bd = Infinity;
  for (const s of list) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best ? { ...best, dist: bd } : null;
}

/* ── AIRFIELDS ───────────────────────────────────────────────────────────────
 *
 * Operator: "place airports out 500m from roads randomly with a few things near by for people to
 * be able to see it -- when people drive to them (no road there) say -- 'I wonder how you unlock
 * planes'".
 *
 * So: OFF the network on purpose. Every other placed thing in this file hangs off a road, because
 * everything else in the game is something you drive to along one. An airfield is the opposite —
 * the point of it is that there is no road, you see something out in the open and go and look —
 * and that is why it gets its own placement rather than the `deal` flag treatment a dealership got.
 *
 * HOW ONE IS PLACED, and every step of this is a pure function of (i, j, seed):
 *
 *   1. One candidate per AIRFIELD_CELL of the plane, so they are rare and evenly spread rather
 *      than clustered — the same one-per-cell discipline the loot tiles use.
 *   2. Offset AIRFIELD_DIST from the nearest road, in a hashed direction. "500 m from roads" is
 *      the operator's own number and it is the whole character of the thing.
 *   3. It must be FLAT. A runway on a hillside is not a runway, and this is the one placed thing
 *      in the game that genuinely needs a long flat strip rather than a pad, so the flatness test
 *      samples along the runway's own axis rather than in a box.
 *   4. It must be DRY, and it must not have a road running through it after all that.
 *
 * A candidate that fails any of those is simply not an airfield. There is no relocation search:
 * that would make the answer depend on the order things were tried in, and every placement in this
 * file is deliberately a yes/no on a fixed candidate so two clients cannot disagree.
 */
/** One candidate airfield per this many metres of plane, each way. */
export const AIRFIELD_CELL = 6000; // one candidate cell per 6 km each way — 19 airfields survive
                                   // the flat/dry tests in a 54 km box, which is rare but findable
/** Metres from the nearest road — the operator's own "out 500m from roads". */
export const AIRFIELD_DIST = 500;
/** And after placing, no road may be closer than this. The offset above is measured from ONE road;
 *  a different one can still turn out to be nearer, and "there is no road here" is the whole idea. */
export const AIRFIELD_MIN_ROAD = 300;
/** Half the runway length, metres. 260 gives a 520 m strip, which a light aircraft can use. */
export const AIRFIELD_HALF_LEN = 190; // a 380 m strip — ample for a light aircraft, and findable
/** Half the runway width, metres. */
export const AIRFIELD_HALF_WID = 14;
/** Metres of height variation tolerated ALONG the strip. A runway is the flattest thing here. */
export const AIRFIELD_FLAT = 11; // metres along the strip, i.e. under 3% — see AIRFIELD_TRIES

/* How many places inside a cell are tried before the cell gives up.
 *
 * The first version tried ONE fixed spot per cell and 35 of 36 cells came back empty: half of them
 * were over water and the rest had 17.5 m of relief along a 520 m strip (measured), because most of
 * this world is not flat. One candidate per cell was not "rare and evenly spread", it was "almost
 * never".
 *
 * Trying several is still perfectly deterministic — the candidates come out of the same hash in a
 * fixed order and the FIRST that passes wins — so every client still agrees, which is the property
 * that mattered. It is a search over a fixed list, not a relocation that depends on what was tried
 * before it. */
const AIRFIELD_TRIES = 5;

const SALT_AIRFIELD = 0x41f1;

/**
 * The airfield for one AIRFIELD_CELL cell, or null. Pure in (gi, gj, seed).
 * @param {number} gi @param {number} gj @param {number} seed
 * @param {{height:(x:number,z:number)=>number}} [probe] a height source; without one the flatness
 *        and dryness tests are skipped and the candidate is returned unchecked, which is what lets
 *        a caller ask "where would they be" cheaply.
 */
/* IS THIS POINT UNDER WATER, CHEAPLY.
 *
 * `isDryAt` is the obvious answer and it costs 0.76 ms a call — measured — because it rebuilds what
 * it needs from the seed every time. The shoreline walk below wants up to 76 samples per candidate
 * and there are 14 candidates a cell, so using it put 800 ms of work into a single streamed tile and
 * the game ran at 11.8 fps with a car that would not pass 25 km/h. Both were caught by the browser
 * suite rather than guessed at.
 *
 * A probe that already has a Terrain in hand can answer the same question with a water height and a
 * ground height, which measured at 0.011 ms — seventy times cheaper. `isDryAt` stays as the fallback
 * for a caller that has no probe, because then correctness matters more than speed. */
const _wetCache = new Map();
function wetAt(probe, x, z) {
  /* Cached on a 12 m grid. The candidate loops walk overlapping lines out of the same cell, so the
   * same points are asked about again and again — measured, this is most of what is left after
   * dropping isDryAt. Keyed without the seed because a probe belongs to one world; cleared whenever
   * it grows, which is cheap and cannot go stale within a session. */
  const ck = `${Math.round(x / 12)},${Math.round(z / 12)}`;
  const hit = _wetCache.get(ck);
  if (hit !== undefined) return hit;
  const out = _wetAt(probe, x, z);
  if (_wetCache.size > 200000) _wetCache.clear();
  _wetCache.set(ck, out);
  return out;
}
function _wetAt(probe, x, z) {
  if (probe && typeof probe.waterY === 'function' && typeof probe.height === 'function') {
    const wy = probe.waterY(x, z);
    if (wy === null || !Number.isFinite(wy)) return false;
    return wy > probe.height(x, z);
  }
  if (probe && typeof probe.dry === 'function') return !probe.dry(x, z);
  return false;
}

/* MEMOISED, and it is not an optimisation — it is the difference between a game and a slideshow.
 *
 * These are pure in (gi, gj, seed), and every streamed TILE asks about every cell it overlaps. Each
 * unanswered ask runs up to AIRFIELD_TRIES candidates, and each candidate calls nearestRoadPoint,
 * which builds the road network over a 5.2 km box. Uncached, the frame rate fell to 11.8 fps and the
 * car would not accelerate past 25 km/h — the browser suite caught both. Cached, a cell is worked out
 * once per session and every later tile reads the answer.
 *
 * Keyed on the PROBE'S PRESENCE too: a call without one skips the flat/dry tests and returns a
 * different (unchecked) answer, and the two must never be confused for each other. */
const _afCache = new Map();
export function airfieldForCell(gi, gj, seed, probe = null) {
  const ck = `${gi},${gj},${seed},${probe ? 1 : 0}`;
  if (_afCache.has(ck)) return _afCache.get(ck);
  const out = _airfieldForCell(gi, gj, seed, probe);
  if (_afCache.size > 20000) _afCache.clear();
  _afCache.set(ck, out);
  return out;
}
function _airfieldForCell(gi, gj, seed, probe = null) {
  const rnd = rng(hash3i(gi, gj, 0x1d, seed ^ SALT_AIRFIELD));
  let first = null;
  for (let attempt = 0; attempt < AIRFIELD_TRIES; attempt++) {
    // somewhere inside the cell, well away from its edges so two neighbours cannot end up adjacent
    const cx = (gi + 0.15 + rnd() * 0.7) * AIRFIELD_CELL;
    const cz = (gj + 0.15 + rnd() * 0.7) * AIRFIELD_CELL;
    const side = rnd() < 0.5 ? 1 : -1;
    const spin = (rnd() - 0.5) * 1.2;

    /* Find the road to be 500 m FROM. Asked of the real network rather than of the lattice, because
     * "500 m from a road" has to mean the road that is actually built there. */
    const near = nearestRoadPoint(cx, cz, seed);
    if (!near) continue;

    const awayX = -near.tz * side;
    const awayZ = near.tx * side;
    const x = near.x + awayX * AIRFIELD_DIST;
    const z = near.z + awayZ * AIRFIELD_DIST;
    const heading = Math.atan2(near.tx, near.tz) + spin;
    const hx = Math.sin(heading);
    const hz = Math.cos(heading);

    const field = {
      key: `af:${gi},${gj}`,
      x,
      z,
      heading,
      hx,
      hz,
      halfLen: AIRFIELD_HALF_LEN,
      halfWid: AIRFIELD_HALF_WID,
      y: 0,
      relief: 0,
    };
    if (!first) first = field;
    if (!probe || typeof probe.height !== 'function') return field;

    /* FLAT ALONG THE STRIP, and dry. Sampled down the runway's own axis: a box test would pass a
     * site that is level across the strip and falls away down it, which is the one shape a runway
     * cannot be. */
    let lo = Infinity;
    let hi = -Infinity;
    let sum = 0;
    let n = 0;
    let bad = false;
    for (let t = -1; t <= 1.0001 && !bad; t += 0.1) {
      const px = x + hx * AIRFIELD_HALF_LEN * t;
      const pz = z + hz * AIRFIELD_HALF_LEN * t;
      const h = probe.height(px, pz);
      if (!Number.isFinite(h)) bad = true;
      else {
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
        sum += h;
        n++;
        if (wetAt(probe, px, pz)) bad = true; // over water — see wetAt for why not isDryAt
      }
    }
    if (bad || hi - lo > AIRFIELD_FLAT) continue;

    // and no road may run through it after all that — the whole idea is that there is no road here
    const road = nearestRoadPoint(x, z, seed);
    if (road && road.dist < AIRFIELD_MIN_ROAD) continue;

    field.y = sum / n;
    field.relief = hi - lo;
    field.roadDist = road ? road.dist : Infinity;
    return field;
  }
  return null;
}

/** Every airfield whose centre falls in this box. Same shape as stationsInBox. */
/* ── THE WALK-IN SHOWROOM ────────────────────────────────────────
 *
 * Operator: "Walk-in showrooms seperate to gas stations (walkable mode)".
 *
 * A dealership is currently a petrol station with a flag — same apron, same canopy, same pumps, with
 * a row of cars parked on the forecourt. That was the cheap way to get cars for sale into the world
 * and it worked, but it means a showroom is always something you happen upon while refuelling, and
 * the whole fleet has to fit on a 19 m apron between the pumps and the posts.
 *
 * This is the other thing: a BUILDING, on its own, with no pumps and no canopy. You park outside,
 * get out, and walk in. That changes what a showroom can be — it can hold the whole fleet, at proper
 * spacing, indoors, and it gives the game its first reason to be out of the car at all.
 *
 * PLACEMENT, and the trade-off is the opposite of the airfield's. An airfield is deliberately hard to
 * find and 500 m from any road (the operator asked for exactly that, as a mystery). A showroom is a
 * SHOP: it has to be beside a road, visible from it, and reachable without going off-road, or nobody
 * will ever walk into one. So:
 *
 *   1. One candidate per SHOWROOM_CELL, so they are evenly spread rather than clustered — the same
 *      one-per-cell discipline every other placed thing here uses.
 *   2. Set back SHOWROOM_SETBACK from the nearest road, which is close enough to see and to pull off
 *      into, and far enough that the building is not standing in the carriageway.
 *   3. FLAT enough for a floor slab. A building is not a runway, so the test is a box rather than a
 *      strip, and the tolerance is tighter over a much smaller area.
 *   4. Dry, and not on top of a petrol station — the point of it is that it is somewhere else.
 *
 * As everywhere else in this file, a candidate that fails is simply not a showroom. There is no
 * relocation search, so two clients cannot disagree about where one is.
 */
/** One candidate showroom per this many metres of plane, each way. Rarer than a petrol station
 *  (which is per-road-edge) and commoner than an airfield, because it is a destination you should
 *  find within a normal drive rather than an event. */
export const SHOWROOM_CELL = 7000; // measured: 4500 gave 55 halls in a 36 km box, one per 23 km2,
                                   // which is a roadside furniture rather than a destination. 7000
                                   // gives roughly one per 49 km2 - findable in a normal drive,
                                   // still worth driving to. `node tools/diag-halls.mjs`
/** Metres back from the road's centreline to the front of the building. */
export const SHOWROOM_SETBACK = 46;
/** Half the building footprint, metres: a 34 x 22 m hall, which holds the fleet with room to walk. */
export const SHOWROOM_HALF_W = 17;
export const SHOWROOM_HALF_D = 11;
/** Metres of height variation tolerated across the slab. A floor is flat or it is not a floor. */
export const SHOWROOM_FLAT = 2.6;
/** How far a petrol station has to be. A showroom next door to a forecourt dealership is the same
 *  building twice, which is exactly what this feature exists to stop being. */
export const SHOWROOM_MIN_STATION = 400;
/** Candidates tried per cell before it gives up — same reasoning as AIRFIELD_TRIES. */
const SHOWROOM_TRIES = 6;
const SALT_SHOWROOM = 0x5b0a;

/**
 * The showroom for one cell, or null. Pure in (gi, gj, seed).
 *
 * @param {number} gi @param {number} gj @param {number} seed
 * @param {{height:(x:number,z:number)=>number, water?:Function}} [probe] without one, the flatness
 *        and dryness tests are skipped and the candidate comes back unchecked — which is what lets a
 *        diagnostic ask "where would these be" without a Terrain.
 */
/* MEMOISED, and this is not an optimisation — it is the fix for a measured regression.
 *
 * Every streamed tile asks for the showrooms in its box, and each candidate calls nearestRoadPoint,
 * which builds the road network over a 5.2 km box. Six tries a cell, several cells a tile, every
 * tile: the browser suite's C4 check went from a 45+ km/h run-up to 31 km/h on the same nine seconds
 * of throttle, because the frame loop was spending its time in here and the fixed-step integrator
 * simulated less of the wall clock. The same shape of bug as the 11.8 fps harbours regression, and
 * caught the same way — by a check that measures the GAME rather than this function.
 *
 * The result is pure in (gi, gj, seed) once a probe has been applied, so it caches exactly. Keyed
 * with the probe's presence because a probe-less answer is the unchecked candidate. */
const _hallCache = new Map();
export function showroomForCell(gi, gj, seed, probe = null) {
  const ck = `${gi},${gj},${seed},${probe ? 1 : 0}`;
  if (_hallCache.has(ck)) return _hallCache.get(ck);
  const out = _showroomForCell(gi, gj, seed, probe);
  if (_hallCache.size > 20000) _hallCache.clear();
  _hallCache.set(ck, out);
  return out;
}

function _showroomForCell(gi, gj, seed, probe = null) {
  for (let k = 0; k < SHOWROOM_TRIES; k++) {
    // Same 0..1-from-a-hash idiom the rest of this file uses (`hash3i(...) * F32`).
    const h = hash3i(gi * 7919 + k, gj * 104729, SALT_SHOWROOM, seed);
    const h2 = hash3i(gj * 7919 - k, gi * 104729, SALT_SHOWROOM ^ 0x2b, seed);
    const cx = (gi + 0.12 + 0.76 * (h * F32)) * SHOWROOM_CELL;
    const cz = (gj + 0.12 + 0.76 * (h2 * F32)) * SHOWROOM_CELL;
    const rp = nearestRoadPoint(cx, cz, seed);
    if (!rp) continue;
    /* Set back along the road's NORMAL, on the side the hash picks. Using the normal rather than a
     * free direction is what puts the frontage square to the road instead of at a random angle. */
    const side = (h >>> 13) & 1 ? 1 : -1;
    const nx = -rp.tz;
    const nz = rp.tx;
    const x = rp.x + nx * side * SHOWROOM_SETBACK;
    const z = rp.z + nz * side * SHOWROOM_SETBACK;
    // Facing the road: the building's local +z points back at the carriageway.
    const yaw = Math.atan2(-nx * side, -nz * side);

    if (probe && typeof probe.height === 'function') {
      let lo = Infinity;
      let hi = -Infinity;
      let wet = false;
      for (let sx = -1; sx <= 1; sx++) {
        for (let sz = -1; sz <= 1; sz++) {
          const px = x + sx * SHOWROOM_HALF_W * 0.9;
          const pz = z + sz * SHOWROOM_HALF_D * 0.9;
          const y = probe.height(px, pz);
          if (!Number.isFinite(y)) { wet = true; break; }
          if (y < lo) lo = y;
          if (y > hi) hi = y;
          if (typeof probe.wet === 'function' && probe.wet(px, pz)) { wet = true; break; }
        }
        if (wet) break;
      }
      if (wet || hi - lo > SHOWROOM_FLAT) continue;
    }
    // and not beside a forecourt dealership, which would defeat the whole point
    const st = nearestStation(x, z, seed, SHOWROOM_MIN_STATION);
    if (st && st.dist < SHOWROOM_MIN_STATION) continue;
    return { x, z, yaw, key: `hall:${gi},${gj},${k}`, roadX: rp.x, roadZ: rp.z };
  }
  return null;
}

/** Every walk-in showroom whose centre lies in the box. */
export function showroomsInBox(x0, z0, x1, z1, seed, probe = null) {
  const out = [];
  const gi0 = Math.floor((x0 - SHOWROOM_CELL) / SHOWROOM_CELL);
  const gi1 = Math.floor((x1 + SHOWROOM_CELL) / SHOWROOM_CELL);
  const gj0 = Math.floor((z0 - SHOWROOM_CELL) / SHOWROOM_CELL);
  const gj1 = Math.floor((z1 + SHOWROOM_CELL) / SHOWROOM_CELL);
  for (let gj = gj0; gj <= gj1; gj++) {
    for (let gi = gi0; gi <= gi1; gi++) {
      const r = showroomForCell(gi, gj, seed, probe);
      if (!r) continue;
      if (r.x < x0 || r.x >= x1 || r.z < z0 || r.z >= z1) continue;
      out.push(r);
    }
  }
  return out;
}

/** Nearest walk-in showroom to a point, or null. */
export function nearestShowroom(x, z, seed, radius = 9000, probe = null) {
  const list = showroomsInBox(x - radius, z - radius, x + radius, z + radius, seed, probe);
  let best = null;
  let bd = Infinity;
  for (const r of list) {
    const d = Math.hypot(r.x - x, r.z - z);
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  return best ? { ...best, dist: bd } : null;
}

/**
 * Where the cars stand INSIDE the hall, in its local frame, and where the door is.
 *
 * Eight bays in two rows of four, which is the whole fleet with a 6 m aisle down the middle to walk
 * along. Unlike the forecourt's SHOWROOM_SLOTS this does not have to dodge pumps and canopy posts,
 * which is exactly why the building exists — the constraint on the apron was the reason only four
 * cars could ever be on show there.
 */
export const HALL_BAYS = (() => {
  const out = [];
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 4; i++)
      out.push({ dx: -12.6 + i * 8.4, dz: row === 0 ? -5.6 : 5.6, faceIn: row === 0 ? 1 : -1 });
  return out;
})();

/** The doorway, in the hall's local frame: on the road-facing wall, in the middle. */
export const HALL_DOOR = { dx: 0, dz: SHOWROOM_HALF_D, w: 5.2 };

/** How close you have to stand to a bay for it to be the car you are looking at, metres. */
export const HALL_REACH = 3.4;

/** Where a hall's display cars actually are, in world space. */
export function hallSpots(hall) {
  if (!hall) return [];
  const ca = Math.cos(hall.yaw);
  const sa = Math.sin(hall.yaw);
  return HALL_BAYS.map((b, i) => ({
    slot: i,
    x: hall.x + b.dx * ca - b.dz * sa,
    z: hall.z + b.dx * sa + b.dz * ca,
    yaw: hall.yaw + (b.faceIn > 0 ? 0 : Math.PI),
  }));
}

export function airfieldsInBox(x0, z0, x1, z1, seed, probe = null) {
  const out = [];
  const gi0 = Math.floor((x0 - AIRFIELD_CELL) / AIRFIELD_CELL);
  const gi1 = Math.floor((x1 + AIRFIELD_CELL) / AIRFIELD_CELL);
  const gj0 = Math.floor((z0 - AIRFIELD_CELL) / AIRFIELD_CELL);
  const gj1 = Math.floor((z1 + AIRFIELD_CELL) / AIRFIELD_CELL);
  for (let gj = gj0; gj <= gj1; gj++) {
    for (let gi = gi0; gi <= gi1; gi++) {
      const f = airfieldForCell(gi, gj, seed, probe);
      if (!f) continue;
      if (f.x < x0 || f.x >= x1 || f.z < z0 || f.z >= z1) continue;
      out.push(f);
    }
  }
  return out;
}

/** Nearest airfield to a point, or null. What main.js asks to know whether to say the line. */
export function nearestAirfield(x, z, seed, radius = 12000, probe = null) {
  const list = airfieldsInBox(x - radius, z - radius, x + radius, z + radius, seed, probe);
  let best = null;
  let bd = Infinity;
  for (const f of list) {
    const d = Math.hypot(f.x - x, f.z - z);
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return best ? { ...best, dist: bd } : null;
}

/** The nearest point on the real road network to (x,z), with its tangent. Null if nothing is near. */
/* nearestRoadPoint is where the money actually goes: it builds the road network over a 5.2 km box.
 * Cached on a 250 m grid, which is far finer than the placement decisions it feeds and turns the
 * repeated asks from the candidate loops above into one build per neighbourhood. */
const _nrpCache = new Map();
function nearestRoadPoint(x, z, seed) {
  const ck = `${Math.round(x / 250)},${Math.round(z / 250)},${seed}`;
  if (_nrpCache.has(ck)) return _nrpCache.get(ck);
  const out = _nearestRoadPoint(x, z, seed);
  if (_nrpCache.size > 30000) _nrpCache.clear();
  _nrpCache.set(ck, out);
  return out;
}
function _nearestRoadPoint(x, z, seed, R = 800) {
  /* 800 m, not 2600. The box this builds is (2R)^2 of road network and it is by far the most
   * expensive thing in the airfield and harbour placement — measured at 280 ms per tile-sized query
   * even with every result memoised, which is a visible stall while streaming into new ground. And it
   * was never needed: a harbour has to be within HARBOUR_MAX_ROAD (620 m) of a road and an airfield
   * sits AIRFIELD_DIST (500 m) from one, so anything further away cannot produce either. A candidate
   * with no road inside 800 m is correctly no candidate at all. */
  const edges = edgesInBox(x - R, z - R, x + R, z + R, seed, 0);
  let best = null;
  let bd = Infinity;
  for (const e of edges) {
    const n = e.pts.length / 2;
    for (let k = 0; k < n - 1; k++) {
      const ax = e.pts[k * 2];
      const az = e.pts[k * 2 + 1];
      const bx = e.pts[k * 2 + 2];
      const bz = e.pts[k * 2 + 3];
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz || 1;
      let t = ((x - ax) * dx + (z - az) * dz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t;
      const pz = az + dz * t;
      const d = Math.hypot(px - x, pz - z);
      if (d < bd) {
        bd = d;
        const l = Math.hypot(dx, dz) || 1;
        best = { x: px, z: pz, tx: dx / l, tz: dz / l, dist: d };
      }
    }
  }
  return best;
}

/* ── HARBOURS: WHERE THE BOAT IS BOUGHT ──────────────────────────────────────
 *
 * Operator: "making buying a boat and unlock that. It isn't automatic, but something you get at the
 * harbor. So you're going to have to build a harbor."
 *
 * The boat used to appear by itself the moment you held 50 suns, which is the one unlock in the
 * game that happened TO you rather than because you went somewhere. Now it is a place: find a
 * harbour, spend the suns, get the boat.
 *
 * A NOTE ON THE ASSETS. The operator pointed at the Synty POLYGON packs on the household share for
 * this. They are a proprietary EULA and the `wanderoad` repo is public, so shipping their meshes
 * would breach both their licence and this project's own MIT/Apache/BSD/CC0-only rule (docs/
 * CREDITS.md). So the harbour is modelled in code in the same painted-solid style as the hundred
 * roadside props, the petrol stations, the dealerships and the airfields — which is also why it can
 * ship today rather than after a licence review.
 *
 * PLACEMENT is the interesting part, because a harbour is the one thing here that needs a COASTLINE:
 * dry land on one side, water deep enough to float a boat on the other, and a road near enough to
 * arrive on. All three are tested against the real world, and a candidate that misses any of them is
 * simply not a harbour.
 */
/** One candidate harbour per this many metres of plane each way. */
export const HARBOUR_CELL = 5000;
/** How far out the quay reaches from the shore, metres. */
export const HARBOUR_QUAY = 46;
/** Half-width of the quay, metres. */
export const HARBOUR_HALF_WID = 11;
/** Metres of water depth wanted at the quay head — enough that a boat is plausibly afloat there. */
export const HARBOUR_DEPTH = 1.6;
/** A harbour has to be arrivable: no further than this from a road. */
export const HARBOUR_MAX_ROAD = 620;
/** How many spots in a cell are tried, in a fixed hashed order. Same reasoning as AIRFIELD_TRIES. */
const HARBOUR_TRIES = 6;

const SALT_HARBOUR = 0x48b0;

/**
 * The harbour for one HARBOUR_CELL cell, or null. Pure in (gi, gj, seed).
 *
 * `probe` needs `height(x,z)`, `dry(x,z)` and `waterY(x,z)` — the last one is what makes "deep
 * enough" answerable. Without a probe the candidate is returned unchecked, which is what lets a
 * caller ask cheaply where they would be.
 */
/** Memoised for the same reason airfieldForCell is — see its own note. A harbour candidate costs a
 *  road-network build AND a shoreline walk, and every tile asks. */
const _hbCache = new Map();
export function harbourForCell(gi, gj, seed, probe = null) {
  const ck = `${gi},${gj},${seed},${probe ? 1 : 0}`;
  if (_hbCache.has(ck)) return _hbCache.get(ck);
  const out = _harbourForCell(gi, gj, seed, probe);
  if (_hbCache.size > 20000) _hbCache.clear();
  _hbCache.set(ck, out);
  return out;
}
function _harbourForCell(gi, gj, seed, probe = null) {
  const rnd = rng(hash3i(gi, gj, 0x2b, seed ^ SALT_HARBOUR));
  for (let attempt = 0; attempt < HARBOUR_TRIES; attempt++) {
    const cx = (gi + 0.1 + rnd() * 0.8) * HARBOUR_CELL;
    const cz = (gj + 0.1 + rnd() * 0.8) * HARBOUR_CELL;
    const spin = rnd() * Math.PI * 2;

    const road = nearestRoadPoint(cx, cz, seed);
    if (!road || road.dist > HARBOUR_MAX_ROAD) continue;
    if (!probe || typeof probe.height !== 'function') {
      return { key: `hb:${gi},${gj}`, x: cx, z: cz, heading: spin, hx: Math.sin(spin), hz: Math.cos(spin), y: 0 };
    }

    /* WALK TO THE WATER. Step out from the candidate in a hashed direction until the ground goes
     * wet; the last dry step is the shore and that is where the quay is rooted. A shoreline found by
     * walking is the real one — testing a fixed point would only ever find a harbour on a seed that
     * happened to put water exactly there. */
    const dirX = Math.sin(spin);
    const dirZ = Math.cos(spin);
    let shoreX = null;
    let shoreZ = null;
    /* Coarse first, then refine. 24 m steps out to 900 m is 38 samples instead of 76, and the shore
     * is then pinned to 12 m by stepping back once — the same answer for half the work, and this loop
     * is the hot one (see wetAt). */
    for (let d = 0; d <= 900; d += 24) {
      const px = cx + dirX * d;
      const pz = cz + dirZ * d;
      if (wetAt(probe, px, pz)) {
        if (d === 0) break; // started in the water: this candidate is not a shore
        const back = wetAt(probe, cx + dirX * (d - 12), cz + dirZ * (d - 12)) ? 24 : 12;
        shoreX = cx + dirX * (d - back);
        shoreZ = cz + dirZ * (d - back);
        break;
      }
    }
    if (shoreX === null) continue;

    /* DEEP ENOUGH AT THE HEAD, and level along the quay's own line, since the quay is a flat slab
     * out over the water and a slab needs somewhere flat to start from. */
    const headX = shoreX + dirX * HARBOUR_QUAY;
    const headZ = shoreZ + dirZ * HARBOUR_QUAY;
    const wy = probe.waterY ? probe.waterY(headX, headZ) : null;
    const bed = probe.height(headX, headZ);
    if (wy === null || !Number.isFinite(wy) || !Number.isFinite(bed)) continue;
    if (wy - bed < HARBOUR_DEPTH) continue;

    // and the land end has to be usable ground, not a cliff
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = -1; t <= 0.15; t += 0.15) {
      const px = shoreX + dirX * HARBOUR_QUAY * t;
      const pz = shoreZ + dirZ * HARBOUR_QUAY * t;
      const h = probe.height(px, pz);
      if (!Number.isFinite(h)) {
        lo = Infinity;
        break;
      }
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    if (!Number.isFinite(lo) || hi - lo > 6) continue;

    return {
      key: `hb:${gi},${gj}`,
      x: shoreX,
      z: shoreZ,
      heading: spin,
      hx: dirX,
      hz: dirZ,
      /* The quay deck sits just clear of the water, so it reads as a dock rather than a causeway. */
      y: wy + 1.1,
      waterY: wy,
      depth: wy - bed,
      roadDist: road.dist,
      quay: HARBOUR_QUAY,
      halfWid: HARBOUR_HALF_WID,
    };
  }
  return null;
}

/* ── WARMING, AND WHY THE TILE PIPELINE MUST NOT DO THIS WORK ────────────────
 *
 * A cold harbour or airfield cell costs 96-182 ms to resolve — measured — and a tile-sized query
 * spans nine of them, so asking during a tile bake put over a second of work into one frame. The
 * symptoms were unmistakable and the browser suite caught both: 11.8 fps, and a car that would not
 * accelerate past 25 km/h because the physics was being starved.
 *
 * The answers memoise to 0 ms, so the cost is entirely first-contact. These two functions let the
 * caller pay it deliberately, ONE CELL AT A TIME, off the critical path: `cellsWarm` asks whether a
 * box can be answered for free, and `warmOne` resolves a single nearest unresolved cell. render/
 * props.js calls warmOne once a frame and only builds harbours and airfields for boxes that are
 * already warm — so a harbour appears a second or two after you first come near its cell rather than
 * arriving with a stutter.
 */
export function harbourCellsWarm(x0, z0, x1, z1, seed) {
  const gi0 = Math.floor((x0 - HARBOUR_CELL) / HARBOUR_CELL);
  const gi1 = Math.floor((x1 + HARBOUR_CELL) / HARBOUR_CELL);
  const gj0 = Math.floor((z0 - HARBOUR_CELL) / HARBOUR_CELL);
  const gj1 = Math.floor((z1 + HARBOUR_CELL) / HARBOUR_CELL);
  for (let gj = gj0; gj <= gj1; gj++) {
    for (let gi = gi0; gi <= gi1; gi++) if (!_hbCache.has(`${gi},${gj},${seed},1`)) return false;
  }
  return true;
}

export function airfieldCellsWarm(x0, z0, x1, z1, seed) {
  const gi0 = Math.floor((x0 - AIRFIELD_CELL) / AIRFIELD_CELL);
  const gi1 = Math.floor((x1 + AIRFIELD_CELL) / AIRFIELD_CELL);
  const gj0 = Math.floor((z0 - AIRFIELD_CELL) / AIRFIELD_CELL);
  const gj1 = Math.floor((z1 + AIRFIELD_CELL) / AIRFIELD_CELL);
  for (let gj = gj0; gj <= gj1; gj++) {
    for (let gi = gi0; gi <= gi1; gi++) if (!_afCache.has(`${gi},${gj},${seed},1`)) return false;
  }
  return true;
}

/* B11: showroom halls paid the exact same cold-cell cost as harbours/airfields did before THIS
 * warm-gate existed for them — measured live with tools/bench-props.mjs: `_showroomForCell`'s
 * up-to-6 `nearestRoadPoint` calls (each an ~800 m-radius `edgesInBox`, 20-360 ms cold) landing
 * synchronously inside render/props.js's phase 6 pushed one tile bake to 2295.9 ms, another to
 * 1427.0 ms, in a budget that assumes 12 ms worst case. Same fix, same shape: warm one cell a
 * frame off the critical path (`warmOne` below), and phase 6 only builds halls for a box every
 * cell of which is already resolved — see this section's own header comment just above. */
export function showroomCellsWarm(x0, z0, x1, z1, seed) {
  const gi0 = Math.floor((x0 - SHOWROOM_CELL) / SHOWROOM_CELL);
  const gi1 = Math.floor((x1 + SHOWROOM_CELL) / SHOWROOM_CELL);
  const gj0 = Math.floor((z0 - SHOWROOM_CELL) / SHOWROOM_CELL);
  const gj1 = Math.floor((z1 + SHOWROOM_CELL) / SHOWROOM_CELL);
  for (let gj = gj0; gj <= gj1; gj++) {
    for (let gi = gi0; gi <= gi1; gi++) if (!_hallCache.has(`${gi},${gj},${seed},1`)) return false;
  }
  return true;
}

/**
 * Resolve at most ONE unresolved cell near (x,z), nearest first. Returns true if it did any work, so
 * a caller can stop after one per frame. Harbours before airfields before showrooms: the boat and the
 * plane are both game unlocks, a showroom is not.
 */
export function warmOne(x, z, seed, probe, radiusCells = 1) {
  for (const [cell, cache, fn] of [
    [HARBOUR_CELL, _hbCache, harbourForCell],
    [AIRFIELD_CELL, _afCache, airfieldForCell],
    [SHOWROOM_CELL, _hallCache, showroomForCell],
  ]) {
    const ci = Math.floor(x / cell);
    const cj = Math.floor(z / cell);
    for (let ring = 0; ring <= radiusCells; ring++) {
      for (let dj = -ring; dj <= ring; dj++) {
        for (let di = -ring; di <= ring; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
          const gi = ci + di;
          const gj = cj + dj;
          if (cache.has(`${gi},${gj},${seed},1`)) continue;
          fn(gi, gj, seed, probe);
          return true;
        }
      }
    }
  }
  return false;
}

/** Every harbour whose shore point falls in this box. Same shape as stationsInBox. */
export function harboursInBox(x0, z0, x1, z1, seed, probe = null) {
  const out = [];
  const gi0 = Math.floor((x0 - HARBOUR_CELL) / HARBOUR_CELL);
  const gi1 = Math.floor((x1 + HARBOUR_CELL) / HARBOUR_CELL);
  const gj0 = Math.floor((z0 - HARBOUR_CELL) / HARBOUR_CELL);
  const gj1 = Math.floor((z1 + HARBOUR_CELL) / HARBOUR_CELL);
  for (let gj = gj0; gj <= gj1; gj++) {
    for (let gi = gi0; gi <= gi1; gi++) {
      const h = harbourForCell(gi, gj, seed, probe);
      if (!h) continue;
      if (h.x < x0 || h.x >= x1 || h.z < z0 || h.z >= z1) continue;
      out.push(h);
    }
  }
  return out;
}

/** Nearest harbour to a point, or null. What main.js asks to know whether the boat can be bought. */
export function nearestHarbour(x, z, seed, radius = 9000, probe = null) {
  const list = harboursInBox(x - radius, z - radius, x + radius, z + radius, seed, probe);
  let best = null;
  let bd = Infinity;
  for (const h of list) {
    const d = Math.hypot(h.x - x, h.z - z);
    if (d < bd) {
      bd = d;
      best = h;
    }
  }
  return best ? { ...best, dist: bd } : null;
}

/** Mean metres of arterial between stations, for the acceptance harness. */
export function stationSpacing(seed, halfSpan = 12000) {
  const edges = edgesInBox(-halfSpan, -halfSpan, halfSpan, halfSpan, seed, 0);
  let arterialMetres = 0;
  for (const e of edges) {
    if (e.tier !== 0) continue;
    const cum = arcTable(e);
    arterialMetres += cum[cum.length - 1];
  }
  const n = stationsInBox(-halfSpan, -halfSpan, halfSpan, halfSpan, seed).length;
  return { arterialMetres, stations: n, metresPerStation: n ? arterialMetres / n : Infinity };
}

/* ── floating fuel cans ──────────────────────────────────────────────────────
 * A supplementary, easier-to-spot pickup, offered by the operator alongside the findability
 * report: "fuel requirements but no gas stations -- maybe we can do floating gas cans?" A
 * small can that hovers over the verge and gives a PARTIAL refuel — denser and more visible
 * than a station, but still rare enough to feel like a find.
 *
 * They exist because stations alone, even after the STATION_MAX_GRADE and search-density fix
 * above, still have a real worst-case gap: STATION_P is an independent 72% draw per arterial
 * edge, and that alone has a combinatorial tail — tools/diag-stations.mjs, run with grade and
 * water rejection effectively disabled to isolate it, still shows real routes going 10-18 km
 * between stations purely from that draw. Raising STATION_P to chase that tail away would
 * either flood the road with stations (losing the "a REASON TO STOP" specialness) or still
 * not fully close it — a rare worst-case gap wants a denser SECOND layer, not a blunter first
 * one, which is exactly what was proposed. See tools/diag-stations.mjs's combined-source
 * section for the measured backstop.
 *
 * FLOATING, precisely: the can's geometry (src/render/props.js `buildFuelCan`) is modelled
 * with its own base at +CAN_HOVER in LOCAL space, so it is blitted at the exact same (x, y, z)
 * every other prop is — the same ground contact point this file works out for everything
 * else, with the same freeboard and slope tests below. Nothing is unanchored: the can still
 * rises over a hill and drops into a dip exactly like a fingerpost does: it is simply drawn
 * hovering a fixed, constant height above wherever that ground point is. The bob the operator
 * asked for ("bobs gently") is a further, tiny, TIME-based render-side wobble on top of that
 * fixed hover — see Props._updateCans in src/render/props.js — it is not part of placement.
 */
const CAN_SLOT = 90;
/** Candidate accept probability per slot, [arterial, lane]. Lanes a little luckier, same
 *  reasoning as SLOT_P above. Tuned against tools/diag-stations.mjs's "combined" spacing,
 *  not guessed: measured one can every ~600 m, denser than the 100 ambient props (~830 m) —
 *  deliberately, because this layer exists to backstop STATION_P's rare double-digit-km
 *  droughts (see above), and it has to be dense enough to reliably catch one of those, not
 *  just common on average. See the numbers recorded next to STATION_MAX_GRADE above. */
/* Operator: "Cans a bit too abundant — reduce by 50%." Halved, exactly, from [0.35, 0.42].
 * The reason this is safe to halve is the change directly below it: a can you can actually
 * reach without leaving the tarmac is worth roughly double one you cannot, so the number of
 * cans that are USE is not halved with the count. Measured: 2.61 -> 1.30 cans per km of road
 * (tools/bench-props.mjs prints both the density and the reachability). */
/* HALVED AGAIN, and this is the third time. Operator, in order: "Cans a bit too abundant -- reduce
 * by 50%", then "too many cans", now — with a second player's report behind it — "Gas cans are still
 * too abundant". 0.35/0.42 -> 0.175/0.21 -> 0.085/0.10.
 *
 * The reason it kept needing another cut is worth writing down: a can is placed per EDGE SLOT, and
 * the lane network is dense, so halving the probability only ever halves a large number. And the
 * pressure that cans relieve went away underneath them — the tank is 2.2x bigger than when this was
 * tuned (START_CAPACITY_MUL) and spare cans can now be bought at a pump and carried, so the roadside
 * ones are no longer the only answer to a low needle. They should read as a lucky find. */
const CAN_SLOT_P = [0.085, 0.1];
/** Metres above the sampled ground the can's origin sits at. A fixed constant — see the
 *  file comment above for exactly what "floating" does and does not mean. */
export const CAN_HOVER = 0.55;
/* ── reachable without breaking the streak ───────────────────────────────────
 * Operator, verbatim: "Gas cans need to be accessible from the road, otherwise you have to
 * break your streak to get a gas can. Self-defeating. ... make them a little nearer, with a
 * giant hitbox so you can tap them easily."
 *
 * "Without breaking the streak" is a precise, checkable statement, so it is worth stating the
 * arithmetic rather than picking a nice-looking number. game/streak.js breaks the streak when
 * `surf.onRoad < ON_ROAD (0.45)` at the car's centre OR at ANY of the four wheels
 * (car.onRoadMin). `onRoad` is roads.js's `edge = 1 - smoothstep(half - 0.4, half + 0.35, d)`,
 * which crosses 0.45 within 5 mm of `d = half` — so the rule is simply "every wheel inside the
 * tarmac". A wheel sits ~0.8 m off the car's centreline, so the furthest a LEGAL driving line
 * can be from the centre of the road is `half - 0.8`, and the furthest it can be from a can at
 * offset `o` is therefore `o - half + 0.8`.
 *
 * With `o = half + VERGE_CLEAR + CAN_FOOT + spread` that is `2.7 + spread` metres, independent
 * of the road's width — 3.9 m at the far end of the spread below. CAN_RADIUS clears that with
 * room for the driver to be on the WRONG side of the road (add up to 2*half ≈ 8.6 m more), for
 * a can on the outside of a bend, and for one frame of travel at full speed. Nothing here
 * moves a can onto the carriageway: VERGE_CLEAR is untouched and bench-props still measures
 * zero cans on tarmac and a positive tightest clearance.
 */
/** How far past the minimum verge clearance a can may wander, in metres. Was 7, which put the
 *  far end of the spread 9.7 m from a legal driving line — outside the old 7 m pickup, i.e.
 *  exactly the "you have to leave the road to get it" the operator hit. */
const CAN_VERGE_SPREAD = 1.2;
/** Drive within this of a can and it is collected — no stopping, no parking manoeuvre, no
 *  speed gate (render/props.js `_updateCans` is a pure distance test against the car's own
 *  position, called every frame). "A giant hitbox", sized by the arithmetic above. */
export const CAN_RADIUS = 14;
/** Fraction of a full tank one can restores. */
/* Halved on the operator's instruction — "reduce gas can 50%", "yes but too much now". They
 * were the answer to stations being unfindable; now they are common enough to remove the
 * hunt entirely, which costs the fuel mechanic its point. */
/* Halved again -- "Getting fuel still too easy (too many cans)". 0.22 -> 0.11 -> 0.055.
 * Stations remain the intended refuel; cans exist so running dry is a bad decision rather
 * than a sun flip about where the road went. */
export const CAN_FRACTION = 0.055;
/** Footprint radius for clearance and freeboard purposes — small; it is a jerry can. */
export const CAN_FOOT = 0.5;
/** As cos(angle) — a can does not need a level floor to hover over, but should not be planted
 *  on a cliff face, which would look wrong even hovering. Roughly the ROUGH tolerance above. */
const CAN_SLOPE = 0.90;
const SALT_CAN = 0x43414e31; // 'CAN1'
/** How far a can may sit from the road it hangs off, and the query-box expansion. Cans stay
 *  close to the verge on purpose — they are meant to be seen from the car in passing, not
 *  hunted for in a field. */
const CAN_MAX_OFFSET = 20;

/**
 * Every floating fuel can whose position lands inside the box. Same shape of call as
 * propsInBox (arc-length slots along the road network, a ground probe the caller owns) with
 * its own independent salt, slot length and probability — a can is not one of the 100 prop
 * kinds and is never drawn into propsInBox's weighted catalogue, because it needs to be an
 * individually removable, individually animated mesh once collected (src/render/props.js),
 * which a prop baked into one static tile mesh cannot be.
 *
 * @param {object} probe same shape propsInBox takes: `.site(x,z)` and `.height(x,z)`.
 * @param {object} [stats] optional rejection tally, same convention as propsInBox.
 */
export function fuelCansInBox(x0, z0, x1, z1, seed, probe, stats = null) {
  const site = probe.site;
  const height = probe.height || ((x, z) => probe.site(x, z).y);
  const out = [];
  const tally = (k) => {
    if (stats) stats[k] = (stats[k] || 0) + 1;
  };
  const edges = edgesInBox(x0 - CAN_MAX_OFFSET, z0 - CAN_MAX_OFFSET, x1 + CAN_MAX_OFFSET, z1 + CAN_MAX_OFFSET, seed, 20);
  const at = { x: 0, z: 0, tx: 1, tz: 0, k: 0, t: 0 };

  for (const e of edges) {
    const ids = edgeIds(e);
    const cum = arcTable(e);
    const total = cum[cum.length - 1];
    const p = CAN_SLOT_P[ids.tier] ?? CAN_SLOT_P[0];
    const half = e.width * 0.5;
    const slots = Math.floor(total / CAN_SLOT);
    const key0 = ids.i * 4 + ids.dir * 2 + ids.tier;

    for (let s = 0; s < slots; s++) {
      if (hash3i(key0, ids.j, s, seed ^ SALT_CAN) * F32 >= p) continue;
      const rnd = rng(hash3i(key0, ids.j, s, seed ^ SALT_CAN ^ 0x2f6b1c9d));
      tally('candidates');

      atArc(e, cum, (s + 0.15 + rnd() * 0.7) * CAN_SLOT, at);
      if (at.x < x0 - CAN_MAX_OFFSET || at.x > x1 + CAN_MAX_OFFSET) continue;

      // ON the verge, and clear of the tarmac — the same floor propsInBox uses, with only
      // CAN_VERGE_SPREAD of wander on top of it so the can stays inside the reach worked out
      // above rather than drifting out into the field.
      const sideSign = rnd() < 0.5 ? 1 : -1;
      const minOff = half + VERGE_CLEAR + CAN_FOOT;
      const off = minOff + rnd() * CAN_VERGE_SPREAD;
      const rx = at.tz * sideSign;
      const rz = -at.tx * sideSign;
      const x = at.x + rx * off;
      const z = at.z + rz * off;
      if (x < x0 || x >= x1 || z < z0 || z >= z1) {
        tally('outsideBox');
        continue;
      }

      if (!clearOfRoads(edges, x, z, VERGE_CLEAR + CAN_FOOT)) {
        tally('rejectRoad');
        continue;
      }

      /* 'any' rather than 'dry': still a real freeboard test (only 0.2 m of allowed
       * submersion, same as a fallen log or a prayer cairn elsewhere in this file), not a
       * skipped one — but a can that floats has no structural reason to insist on dry ground
       * the way a forecourt or a barn does, and measured (tools/diag-stations.mjs), marsh and
       * dunes are exactly where stations lose the most candidates to the SAME 'dry' rule
       * (24-45% of sites). Letting the can tolerate what the station cannot is what makes it
       * a useful backstop specifically where stations are weakest, instead of failing for the
       * same reason in the same place. */
      const here = site(x, z);
      if (!waterOk('any', here.y, here.wy)) {
        tally('rejectWater');
        continue;
      }

      const probeR = Math.max(CAN_FOOT * 1.15, 0.6);
      const g = footprintGround(height, here.y, x, z, probeR);
      if (g.hi - g.lo > Math.min(probeR * 2 * Math.tan(Math.acos(CAN_SLOPE)), 0.9)) {
        tally('rejectSlope');
        continue;
      }

      tally('placed');
      out.push({
        key: `cn:${e.key}:${s}`,
        x,
        z,
        // Ground contact height — exactly what every other prop's `y` means. The renderer
        // adds CAN_HOVER on top, in the geometry's own local space, not here.
        y: g.lo - 0.02,
        yaw: rnd() * TAU,
        hue: rnd(),
        dominant: here.dominant,
      });
    }
  }
  return out;
}

/** Mean metres of ANY road between candidate can slots, for the acceptance harness — the
 *  same shape as stationSpacing but counting both tiers, since cans are placed on both. */
export function canSpacing(seed, halfSpan = 12000) {
  const edges = edgesInBox(-halfSpan, -halfSpan, halfSpan, halfSpan, seed, 0);
  let roadMetres = 0;
  for (const e of edges) {
    const cum = arcTable(e);
    roadMetres += cum[cum.length - 1];
  }
  const n = fuelCansInBox(-halfSpan, -halfSpan, halfSpan, halfSpan, seed, {
    site: (x, z) => ({ y: 0, dominant: 0, wy: null }),
    height: () => 0,
  }).length;
  return { roadMetres, cans: n, metresPerCan: n ? roadMetres / n : Infinity };
}

/* ── the little town around a station ─────────────────────────────────────────
 * Operator: "I think we should build a town around the gas station, a very small one with
 * electrical poles and other hints that there's something there in that direction. So that
 * they're easier to spot and differentiate [from ordinary roadside scatter]..."
 *
 * A handful of the EXISTING catalogue kinds — never a new geometry family, this is "using the
 * existing prop system" taken literally — placed at FIXED offsets from the forecourt rather
 * than drawn from the road's own arc-length slots the way propsInBox works: this is one
 * landmark's own halo, findable relative to the STATION, not a dice roll along the road.
 *
 * Two tall telegraph poles (visible well before the kiosk roofline is — that is the whole
 * point, "hints that there's something there in that direction") and two small structures (a
 * shed, a phone box) so it reads as a hamlet rather than one lone building. Every candidate
 * still goes through the SAME footprint/water/slope/road-clearance discipline propsInBox
 * itself uses (reusing its own private helpers below) — a station sited on a dry spit beside
 * a marsh must not grow a pole standing in the lake next to it.
 */
const TOWN_SALT = 0x544f574e; // 'TOWN'
/** [kind id, local dx, local dz], in STATION-LOCAL space (+z toward the road — the same local
 *  frame buildStation itself uses). Every offset has |dx| > STATION_APRON_HALF_WIDTH, so none
 *  of these can ever land on the apron rectangle or the access spur regardless of dz. */
const TOWN_KIT = [
  ['telegraph_pole', -(STATION_APRON_HALF_WIDTH + 9), 3],
  ['telegraph_pole', STATION_APRON_HALF_WIDTH + 13, -4],
  ['shed', -(STATION_APRON_HALF_WIDTH + 7), -6],
  ['phone_box', STATION_APRON_HALF_WIDTH + 6, 5],
  /* ── THE SILHOUETTE, added after an audit drove to a real station and looked back ──────
   *
   * Its verdict, and the numbers are the point: at 30 m the cluster is there and reads (a
   * pole, a phone box, a shed roof, a bench); at 150 m down the road the station is "a small
   * white smudge behind trees" and the town "adds essentially nothing to the silhouette — I
   * only knew where to look because the HUD said 150 m". The operator asked for exactly the
   * opposite: "hints that there's something there in that direction... so that they're easier
   * to spot".
   *
   * The reason the old kit could not do that is arithmetic, not art. Its tallest piece is a
   * 7.5 m telegraph pole. At 200 m that subtends 2.1° — under the angular size of the tree
   * line it is standing behind. Nothing about placement or colour fixes an object that is
   * shorter than its own backdrop; the kit needed something genuinely TALL.
   *
   * So: a clock tower (14 m) and a flagpole (7 m, but slender and clear of the canopy),
   * chosen out of the EXISTING catalogue — this pass adds no new geometry family, same as the
   * original kit — plus a second small building and a wall line so the base of the cluster
   * reads as a settlement rather than as three separate objects. 14 m at 200 m is 4.0°, which
   * is roughly double the tree line and is the whole difference.
   *
   * WHY THE TALL PIECES SIT FURTHEST OUT: `clock_tower` wants FLATTISH ground and has a 2.6 m
   * footprint, and the ground immediately beside a forecourt is the apron's own batter. Out at
   * 30 m it is on real ground, and the extra distance also spreads the cluster so it reads as
   * a place rather than a pile.
   *
   * REDUNDANCY IS DELIBERATE. The audit measured the old kit delivering 2 of its 4 pieces at a
   * real station — the shed and the second pole were both rejected by the placement tests,
   * which are shared with propsInBox and are not going to be relaxed for this. A kit that
   * needs every piece to land is a kit that usually looks half-built, so several entries below
   * are near-duplicates on opposite sides: whichever side of a given station happens to be
   * flat and dry, something tall lands there. Every piece still passes the identical
   * footprint/water/slope/road-clearance discipline. */
  ['clock_tower', -(STATION_APRON_HALF_WIDTH + 21), 14, 'tower'],
  ['clock_tower', STATION_APRON_HALF_WIDTH + 22, 12, 'tower'],
  ['flag_pole', STATION_APRON_HALF_WIDTH + 4, -11, 'flag'],
  ['flag_pole', -(STATION_APRON_HALF_WIDTH + 5), 12, 'flag'],
  ['shed', STATION_APRON_HALF_WIDTH + 9, -12],
  ['drystone_wall', -(STATION_APRON_HALF_WIDTH + 13), -13],
];
/** Furthest a town candidate can sit from the forecourt centre, and the query-box expansion —
 *  the widest TOWN_KIT offset above (STATION_APRON_HALF_WIDTH + 22 + a 14 m dz ~= 34) plus a
 *  margin for the piece's own footprint. */
const TOWN_MAX_OFFSET = 60;

/**
 * A station's own small landmark cluster, whose footprint lands inside the box. Same call
 * shape as propsInBox/fuelCansInBox (a ground probe the caller owns) plus its own edges query
 * for road clearance. Output records are shaped EXACTLY like propsInBox's own, so the
 * renderer bakes them through the identical BUILDERS[id] dispatch and they pick up a
 * collision hitbox for free wherever the catalogue entry already declares one (a telegraph
 * pole, a shed) — no separate rendering or collision path needed for this cluster at all.
 *
 * @param {object} probe same shape propsInBox takes: `.site(x,z)` and `.height(x,z)`.
 * @param {object} [stats] optional rejection tally, same convention as propsInBox.
 */
export function stationTownInBox(x0, z0, x1, z1, seed, probe, stats = null) {
  const site = probe.site;
  const height = probe.height || ((x, z) => probe.site(x, z).y);
  const out = [];
  const tally = (k) => {
    if (stats) stats[k] = (stats[k] || 0) + 1;
  };
  const stations = stationsInBox(
    x0 - TOWN_MAX_OFFSET, z0 - TOWN_MAX_OFFSET, x1 + TOWN_MAX_OFFSET, z1 + TOWN_MAX_OFFSET, seed
  );
  if (!stations.length) return out;
  const edges = edgesInBox(x0 - TOWN_MAX_OFFSET, z0 - TOWN_MAX_OFFSET, x1 + TOWN_MAX_OFFSET, z1 + TOWN_MAX_OFFSET, seed, 20);

  for (const st of stations) {
    const ca = Math.cos(st.yaw);
    const sa = Math.sin(st.yaw);
    // One stream per station, drawn from in a fixed order (yaw jitter, then scale, then hue,
    // per candidate) — same discipline propsInBox documents for its own per-slot stream.
    const rnd = rng(hash3i(Math.round(st.x), Math.round(st.z), TOWN_SALT, seed));
    /* Alternative sites for the same landmark, tried in kit order until one lands — see the
     * REDUNDANCY note on TOWN_KIT. One clock tower per station, not one per side. Deterministic
     * because the kit order is fixed and every test below is a pure function of position. */
    const filled = new Set();
    for (let i = 0; i < TOWN_KIT.length; i++) {
      const [id, ldx, ldz, alt] = TOWN_KIT[i];
      if (alt !== undefined && filled.has(alt)) continue;
      const kind = PROP_BY_ID[id];
      if (!kind) continue;
      tally('candidates');
      const x = st.x + ldx * ca - ldz * sa;
      const z = st.z + ldx * sa + ldz * ca;
      if (x < x0 || x >= x1 || z < z0 || z >= z1) {
        tally('outsideBox');
        continue;
      }
      const foot = kind.foot;
      if (!clearOfRoads(edges, x, z, VERGE_CLEAR + foot)) {
        tally('rejectRoad');
        continue;
      }
      const here = site(x, z);
      if (!waterOk(kind.wet, here.y, here.wy)) {
        tally('rejectWater');
        continue;
      }
      const probeR = Math.max(foot * 1.15, 0.6);
      const g = footprintGround(height, here.y, x, z, probeR);
      if (g.hi - g.lo > maxDrop(kind, probeR)) {
        tally('rejectSlope');
        continue;
      }
      // 'road'-faced kit pieces (the shed, the phone box) present toward the station itself,
      // the same "face the thing you are offset from" rule propsInBox uses; a pole does not
      // care (gPole is radially near-symmetric) but gets a deterministic yaw anyway.
      const yawLocal = Math.atan2(-ldx, -ldz);
      tally('placed');
      if (alt !== undefined) filled.add(alt);
      out.push({
        id: kind.id,
        group: kind.group,
        y: g.lo - 0.04 - foot * 0.03,
        x,
        z,
        yaw: st.yaw + yawLocal + (rnd() - 0.5) * 0.1,
        scale: 0.95 + rnd() * 0.14,
        hue: rnd(),
        dominant: here.dominant,
        edgeKey: `town:${st.key}`,
        slot: i,
      });
    }
  }
  return out;
}
