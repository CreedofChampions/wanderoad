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
 *   - `buildEdge()` output is box-independent (pts, width, key are pure hashes), but `e.y`
 *     is NOT: `RoadField` levels lane/arterial crossings against whichever edges are in the
 *     box. So placement never reads a RoadField's `y`. Where a road height is needed (the
 *     petrol-station forecourt) this file profiles a private copy of the edge with
 *     `profileEdge`, which IS pure.
 *
 * No three.js and no DOM here — the geometry lives in src/render/props.js.
 */

import { edgesInBox, profileEdge } from './roads.js';
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
 * per edge at p = 0.72 lands there.
 *
 * Unlike the props, this is a PURE function of the seed — no ground probe — because
 * src/game/fuel.js has to be able to ask "where is the nearest pump" from anywhere without
 * building a Terrain. It profiles a private copy of the edge to find the flat spot, which
 * `profileEdge` makes deterministic.
 */
const STATION_P = [0.72, 0.1];
/** Candidate positions along an edge, as fractions of its length. */
const STATION_AT = [0.22, 0.36, 0.5, 0.64, 0.78];
/** Steepest road a forecourt will be built beside, as a gradient. */
const STATION_MAX_GRADE = 0.06;
/** Metres from the centreline to the middle of the forecourt. */
export const STATION_OFFSET = 15.5;
/** Within this of the pumps, stopped, and you are refuelling. */
export const STATION_RADIUS = 11;

/** edge key -> its pure elevation profile. Cleared wholesale when it gets large; an LRU
 *  would be more code than the thing it protects. */
const PROFILE_CACHE = new Map();

let _land = null;
let _water = null;
let _fnSeed = null;
function pureFns(seed) {
  if (_fnSeed !== seed) {
    _fnSeed = seed;
    _land = landFn(seed);
    _water = waterFn(seed);
    PROFILE_CACHE.clear(); // a profile is only pure for ONE seed
  }
  return { land: _land, water: _water };
}

/**
 * Every petrol station whose forecourt centre lands inside the box.
 * Pure: same seed, same answer, no ground probe needed.
 */
export function stationsInBox(x0, z0, x1, z1, seed) {
  const out = [];
  const { land, water } = pureFns(seed);
  const edges = edgesInBox(x0 - 60, z0 - 60, x1 + 60, z1 + 60, seed, 20);
  const at = { x: 0, z: 0, tx: 1, tz: 0, k: 0, t: 0 };

  for (const e of edges) {
    const ids = edgeIds(e);
    const p = STATION_P[ids.tier] ?? 0;
    const rnd = rng(hash3i(ids.i * 4 + ids.dir * 2 + ids.tier, ids.j, 0x5a, seed ^ SALT_STATION));
    if (rnd() >= p) continue;

    // Profile a private copy. RoadField's `y` is levelled against whatever else is in ITS
    // box, so it is not a function of the edge alone and cannot be used here — two clients
    // querying different boxes would put the forecourt at two different heights.
    // Cached: neighbouring tiles ask about the same arterials, and a profile is ~45 land and
    // water samples. Safe to cache precisely BECAUSE it is a pure function of the edge.
    const hit = PROFILE_CACHE.get(e.key);
    if (hit) e.y.set(hit);
    else {
      profileEdge(e, land, water);
      if (PROFILE_CACHE.size > 256) PROFILE_CACHE.clear();
      PROFILE_CACHE.set(e.key, Float32Array.from(e.y));
    }
    const cum = arcTable(e);
    const total = cum[cum.length - 1];

    // Flattest of the candidates. Grade is measured over the polyline either side, which is
    // ~150 m for an arterial — the length a forecourt and its two approaches actually need.
    let best = null;
    for (const f of STATION_AT) {
      atArc(e, cum, f * total, at);
      const k = at.k;
      const run = Math.max(1, cum[Math.min(k + 1, cum.length - 1)] - cum[Math.max(k - 1, 0)]);
      const rise = Math.abs(e.y[Math.min(k + 1, e.y.length - 1)] - e.y[Math.max(k - 1, 0)]);
      const grade = rise / run;
      if (grade > STATION_MAX_GRADE) continue;
      if (!best || grade < best.grade) {
        const roadY = e.y[k - 1] + (e.y[k] - e.y[k - 1]) * at.t;
        best = { grade, x: at.x, z: at.z, tx: at.tx, tz: at.tz, y: roadY };
      }
    }
    if (!best) continue;

    const w = water(best.x, best.z);
    if (w !== null && best.y < w + 1.6) continue; // no pumps on a causeway

    const sideSign = rnd() < 0.5 ? 1 : -1;
    // Same right-hand ground normal as propsInBox and render/road.js: (tz, -tx).
    const rx = best.tz * sideSign;
    const rz = -best.tx * sideSign;
    const off = e.width * 0.5 + STATION_OFFSET;
    const x = best.x + rx * off;
    const z = best.z + rz * off;
    if (x < x0 || x >= x1 || z < z0 || z >= z1) continue;

    out.push({
      key: `st:${e.key}`,
      x,
      z,
      // The forecourt is GRADED, exactly like the road it serves: it takes the road's own
      // smoothed height, not the raw land's. A forecourt that followed the ground would tilt
      // and the pumps would lean.
      y: best.y,
      roadX: best.x,
      roadZ: best.z,
      // Faces the road across the apron.
      yaw: Math.atan2(-rx, -rz),
      along: Math.atan2(best.tx, best.tz),
      side: sideSign,
      grade: best.grade,
    });
  }
  return out;
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
