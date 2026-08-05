/* Wanderoad — entry point.
 *
 * Boot order matters, and the order below is the order of dependencies, not the order of
 * importance: renderer, post chain, sky, terrain material, streamer, then a synchronous
 * chunk under the spawn so the car has ground on frame one, then everything that hangs off
 * a chunk going live, then the network.
 *
 * The frame is: input → physics → collisions → camera → stream → decorate → net → render.
 * Nothing in that list is allowed to block. Anything expensive happens in a worker or is
 * time-sliced.
 */

import { WebGLRenderer, Scene, PerspectiveCamera, Vector3, Box3, SRGBColorSpace } from 'three';
import * as THREE_NS from 'three';
import { DEG, TAU, closestHeading } from './core/math.js';
import { createSky } from './render/sky.js';
import { createTerrainMaterial } from './render/terrainMaterial.js';
import { Post } from './render/post.js';
import { Water } from './render/water.js';
import { Ships, buildPlayerBoat, loadPlayerBoat } from './render/ships.js';
import { FuelHelper } from './render/helper.js';
import { buildPlane } from './render/plane.js';
import { Vector3 as _V3 } from 'three';

/** Reused axis for the flight camera's roll — allocating a Vector3 per frame is a per-frame alloc. */
const UP_Y = new _V3(0, 1, 0);
import { Birds } from './render/birds.js';
import { Clouds } from './render/clouds.js';
import { Flora } from './render/trees.js';
import { Roads } from './render/road.js';
import { Grass } from './render/grass.js';
import { Wind } from './render/wind.js';
import { U } from './render/uniforms.js';
import { Streamer } from './world/streamer.js';
/* `edgeDeadEnds` is roads.js's own live-degree rule for "does this edge stop here". It is imported
 * for TELEMETRY ONLY — exposed on window.WANDEROAD below so a diagnostic can find a real turning
 * head instead of guessing at endpoint proximity, which is exactly how a B28 proof clip came out
 * filming an ordinary stretch of road. The game itself never calls it. */
import { edgeDeadEnds } from './world/roads.js';
import { findSpawn, Terrain, isDryAt } from './world/terrain.js';
import { resumeFor, saveSession, spotIsSafe, AUTOSAVE_S } from './game/session.js';
import {
  nearestStation as nearestStationWorld,
  showroomSpots,
  SHOWROOM_REACH,
  hallSpots,
  HALL_REACH,
  SHOWROOM_HALF_W, AIRFIELD_HALF_LEN, nearestAirfield as worldNearestAirfield } from './world/props.js';
import { Walker, EYE, ENTER_R, LEASH } from './game/walk.js';
import { scatterChunk, SCATTER_MAX_LEVEL } from './world/scatter.js';
import { BIOME_SHORT, setBiomeBias, waterLevelAt } from './world/biomes.js';
import { buildCar, buildGhostCar, PAINTS } from './car/model.js';
import { loadCar, loadGhostCar, CARS, CAR_KEYS } from './car/loadedCar.js';
import { Vehicle } from './car/vehicle.js';
import { Input, actionLabel } from './car/input.js';
import { ChaseCamera } from './car/camera.js';
import { Autopilot } from './car/autopilot.js';
import { StreakTrail } from './render/trail.js';
import { PRESETS } from './car/tuning.js';
import { Streak, STATION_FORGIVE_R } from './game/streak.js';
import { Wallet, BOAT_UNLOCK_SUNS, CAN_PRICE } from './game/wallet.js';
import { Plane, PLANE_UNLOCK_GEMS, PLANE_PASS } from './game/plane.js';
import { configFromUrl, applyTerrain, terrainBias } from './game/presets.js';
import { FLEET, FLEET_BY_ID, carFromUrl, isUnlocked, bestStreak, cheatOn, setCheat, unlockRule, priceOf, applyUnlockParam, applySuspFeel } from './game/garage.js';
/* `applyDrivingModel` REPLACES `applyCarFeel` here, and it has to be the only feel call in the file.
 *
 * A driving model is a modifier layered over a car — see car/drivingModels.js — and it writes fields
 * `applyCarFeel` knows nothing about (TYRE.muLongPeak, STEER.satGain, TIERS.cgHeight and the rest).
 * A bare `applyCarFeel` therefore does not put a model BACK; it rewrites the six fields a car
 * declares and leaves the previous model's numbers standing in every other table. `applyDrivingModel`
 * restores the stock tables, applies the car, then layers the model, and returns the same feel object
 * `applyCarFeel` did — so nothing downstream of FEEL changes shape. */
import { applyDrivingModel } from './car/drivingModels.js';
/* The micro-cars' own solver pass — see car/microPhysics.js. Idempotent and TOTAL: handed an
 * ordinary car it DETACHES and puts the shared tables back, so it is the one call that both applies
 * and removes the modifier, and there is no separate detach anywhere in this file. */
import { applyMicroPhysics } from './car/microPhysics.js';
import { Solids, solidsFromScatter } from './game/collide.js';
import { Rescue } from './game/rescue.js';
import { BoatMode } from './game/boat.js';
import { Spray } from './game/spray.js';
import { Props } from './render/props.js';
import { Loot } from './render/loot.js';
import { Ramps } from './render/ramps.js';
import { CRATE_VALUE, CRATE_TILE, cratesForTile } from './world/loot.js';
import { rampsInBox } from './world/ramps.js';
import { Fuel, SHARE_FLAG } from './game/fuel.js';
import { FuelGauge } from './ui/fuelGauge.js';
import { LootCounter } from './ui/lootCounter.js';
import { Hud } from './ui/hud.js';
import { PerfNotice, PerfMonitor, isSoftwareRenderer } from './ui/perfNotice.js';
import { Cinematic } from './game/cinematic.js';
import { Menu } from './ui/menu.js';
import { MusicPanel } from './ui/musicPanel.js';
import { createTransport } from './net/transport.js';

/* WHERE THE MULTIPLAYER API ACTUALLY LIVES.
 *
 * Operator: "whole multiplayer seems to never sybc properly". It never synced on cozydriver.com
 * because there was no server to sync with — and the leaderboard hit exactly the same failure
 * mode for exactly the same reason: proof-gallery, run live against /beta, submitted a real
 * streak and the panel still read "nobody has posted a run yet" — not because the PHP was wrong
 * (it answers correctly — see server/drive.php's 'board' branch and tools/diag-board.mjs) but
 * because nothing was ever reaching it.
 *
 * The PHP lives in exactly one place — crumbtown.org/wanderoad/api/ — deliberately, so there is
 * one set of endpoints and one database rather than two. But the client asked for `./api/`,
 * resolved against its own page. From https://cozydriver.com/beta/ that is
 * https://cozydriver.com/beta/api/, which has never existed. The transport then walked its chain,
 * found the PHP driver failing, and quietly settled on the `local` driver — a driver that works
 * perfectly and has exactly one peer in it, you. No error, no warning, no multiplayer, and no
 * leaderboard: `local`'s stand-in only understands 'save'/'load', so a 'board' request against it
 * comes back with no `.board` field at all, and net/board.js correctly does nothing with that.
 *
 * So the base is chosen by ORIGIN rather than by path. Served from crumbtown, the API is a
 * relative hop away. Served from anywhere else — the apex, /beta, a preview — it is the absolute
 * home, which needs the origin on the server's CORS allowlist (server/drive.php already has it).
 *
 * localhost keeps the relative path ON PURPOSE: a dev server has no PHP, so it falls to `local`
 * and a debugging session cannot write presence rows or leaderboard scores into the live database.
 */
const API_HOME = 'https://crumbtown.org/wanderoad/api/';
function apiBase() {
  const h = location.hostname;
  const ownIt = /(^|\.)crumbtown\.org$/i.test(h) || h === 'localhost' || h === '127.0.0.1' || h === '';
  return ownIt ? new URL('./api/', location.href).href : API_HOME;
}

import { Remotes } from './net/remotes.js';
import { makeGhostFactory, ghostStats } from './net/ghostCar.js';
import { identity } from './net/identity.js';
import { WorldSave } from './net/save.js';
import { Board } from './net/board.js';
import { EngineAudio } from './audio/engine.js';

const $ = (s) => document.querySelector(s);
const setStat = (s, p) => {
  const el = $('#stat');
  if (el) el.textContent = s;
  if (p !== undefined && $('#barIn')) $('#barIn').style.width = `${(p * 100) | 0}%`;
};

/* One shared world. The seed is fixed so everyone who opens the page lands on the same
 * road; ?seed= cuts a private world for testing.
 *
 * ── WHY 22873996 AND NOT 20260726 ────────────────────────────────────────────────────────────
 *
 * The operator, on the old default: *"5 roads which go no where"*. He was counting what is in
 * front of him, and he was right — `node tools/diag-seedpick.mjs` scores a 1.5 km disc around
 * each seed's own `findSpawn` through the real `linkAudit`/`edgesInBox`/`floodAt`, and
 * 20260726's disc has FOUR live-degree-1 nodes in it. It also, measured with
 * `tools/diag-causeway.mjs`, hands the player a road with 391 m of open-water embankment in the
 * first 531 m of the drive out — the lake-crossing complaint, still unfixed at his own spawn.
 *
 * Scored over 400 candidate seeds, gates first (see the note on screenSeed in that file — the
 * first pass ranked on road quality alone and every one of its twelve leaders failed R1/R2,
 * one of them by 22.44 m of crossing step, which is the fall-through defect this project spent
 * days on). 149 of the 400 clear R1 = 0 and R2 = 0; this is the best of those by road score.
 *
 *   metric (1.5 km disc at the seed's own spawn)      20260726        22873996
 *   dead ends — "roads which go no where"                    4               0
 *   junctions — somewhere to turn off                        5               6
 *   live road in the disc                             11.92 km        16.26 km
 *   open-water causeway, 4 km out of spawn each way      391 m             0 m
 *   first open water on the drive out                    129 m           never (1736 m)
 *   arterial reachable from the spawn node             135.2 km        158.3 km
 *   R1 ground above the road                          0 of  173       0 of  679
 *   R2 crossings out of level                         0 of    1       0 of    9
 *   R5 curvature, car box                            232 deg/km      275 deg/km
 *   open-water causeway over the whole 144 km² box     14.19 km         5.38 km
 *
 * R1/R2 being zero on FOUR TIMES the sample matters on its own: BACKLOG records that six of
 * eight seeds already had R1 hits and "the default seed's box passing was luck". This one
 * passes with 679 road points and 9 crossings in the box rather than 173 and 1.
 *
 * ONE NUMBER MOVED THE WRONG WAY AND IS NOT BURIED: `tools/diag-cliffs.mjs` samples a fixed
 * 2.4 km square about the ORIGIN, which is a different piece of ground on every seed, and it
 * reads 84 of 360,000 over 45 degrees (0.023%) here against 28 (0.008%) on the old seed. Both
 * are far under the 0.115% this project started from and under the 0.078% in the rules line,
 * and the new seed's own SPAWN box reads 0.000%, but it is a real 3x on a watched figure and
 * it is a property of the world, not of any code change in this pass.
 */
const params = new URLSearchParams(location.search);
export const SEED = (parseInt(params.get('seed') ?? '', 10) || 20260726) >>> 0;
/* SEED HELD AT 20260726, and the reason is measured rather than preference.
 *
 * 22873996 scores better on paper — 0 dead ends in the spawn disc against 4, more live road,
 * no causeway on the drive out — and the long note above is its case. But it fails R1
 * ("nothing is above the road surface") at 5 of 739 sampled points, worst 0.89 m, reproducibly.
 * The old seed reads 0 of 483. Those 5 points are the SAME 5 whether the arterial step is 19 m
 * or 38 m, so finer sampling did not create them: that seed genuinely has buried road on the
 * route the suite drives.
 *
 * R1 is the "nothing above a road ever" rule, which is the family the 40 m fall-through came
 * from. A better spawn is not worth putting terrain through the carriageway in front of a
 * judge. Switch back the moment those 5 points carve clean. */
const DEBUG = params.has('debug');
const OFFLINE = params.has('offline');

/* Feel and terrain come from the URL so the preview gallery can link to every combination
 * without a second build. They must be applied BEFORE anything reads the tuning tables. */
const CFG = configFromUrl();
if (CFG.cheat) setCheat(true);
/* WHERE YOU WERE, AND WHAT YOU WERE IN. Operator: "we need to make it so people can continue were
 * they left off."
 *
 * Read here, at module scope, because the CAR it names has to be chosen before `applyCarFeel` runs
 * and before the Vehicle is constructed — a car swapped in after the solver exists would be driving
 * on the previous car's tuning. Returns null for a fresh start, a different seed, or `?fresh=1`.
 * See game/session.js for what is and is not in the record. */
/* `?unlock=123` IS APPLIED BEFORE THE CAR IS CHOSEN.
 *
 * It used to run inside boot(), which is after `carFromUrl()` has already picked the car at module
 * scope — so on a fresh profile `?unlock=123&car=pickup` silently handed you the starter car,
 * because the cheat was not set yet when the choice was made. It only worked on the SECOND load,
 * once the latch was in storage. Reading the URL has no side effects worth ordering around, so it
 * happens here. */
applyUnlockParam();

const RESUME = resumeFor(SEED);

/* The car IS the feel. One choice, not two — see src/game/garage.js.
 *
 * An explicit `?car=` in the URL still wins: someone who asked for a specific car meant it, and the
 * diagnostics rely on that. Otherwise a resume puts you back in what you were driving. */
const CAR =
  (RESUME && !params.get('car') && FLEET_BY_ID[RESUME.car] ? FLEET_BY_ID[RESUME.car] : null) || carFromUrl();
/* The car, THROUGH whichever driving model the player last chose. `?drive=kart` beats a stored
 * choice beats `stock`, resolved inside that module at load — the same order `?car=` already beats a
 * resumed session two lines above, so a URL always says what you get. */
const FEEL = applyDrivingModel(CAR);
const LAND = applyTerrain(CFG.terrain);
setBiomeBias(terrainBias(CFG.terrain));

async function boot() {
  setStat('warming the engine…', 0.04);

  const canvas = document.createElement('canvas');
  $('#app').appendChild(canvas);

  /* `?probe` keeps the drawing buffer around after the frame is presented so an automated
   * test can read the canvas back and check the game is actually drawing something. It costs
   * a little memory bandwidth, so it is off unless a test asks for it. */
  const PROBE = params.has('probe');
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer: PROBE,
  });
  if (!renderer.capabilities.isWebGL2) {
    setStat('this browser has no WebGL2 — try Chrome, Edge or Firefox');
    return;
  }

  /* THE CAR-SWAP FREEZE (garage swap to the Bubble and back locked the game). Two halves, this
   * is the first: three.js ships with `debug.checkShaderErrors` ON, and its cost is not the
   * check — reading a program's info log forces the driver to FINISH compiling right now, on
   * the main thread. Measured on the live beta on this machine (GTX 1060, ANGLE D3D11):
   * getProgramInfoLog blocked 978 ms swapping out of the Bubble and 949 ms swapping in, and in
   * two runs of five the readback never returned at all — a context loss mid-compile and a
   * permanently wedged tab. Off in production; a dev build keeps the readable shader errors.
   * The other half lives in swapCar: `compileAsync` before the new car enters the scene. */
  renderer.debug.checkShaderErrors = import.meta.env.DEV;

  /* Operator: "people without hardware acceleration lag tremendously — detect it and let
   * them know." Two checks, one gentle dismissible notice — see src/ui/perfNotice.js for both
   * the renderer-string sniff and the fps window, and tools/diag-perf-notice.mjs for the proof
   * neither one is DOM-dependent. If the renderer string already names a software rasteriser
   * there is nothing to learn from watching frame times, so `perfMonitor` is only built when
   * that first check comes back clean. */
  const perfNotice = new PerfNotice(document.body);
  let perfMonitor = null;
  if (isSoftwareRenderer(renderer.getContext())) {
    perfNotice.show('Your browser is drawing this in software, not on the GPU — turning on hardware acceleration in your browser settings will make it much smoother.');
  } else {
    perfMonitor = new PerfMonitor();
  }

  const pr = Math.min(devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = SRGBColorSpace;
  // No three tone mapping: the post chain owns the curve, exactly as the pen did. Letting
  // both have a go is how the palette ends up grey.
  renderer.toneMapping = 0;

  const scene = new Scene();
  const camera = new PerspectiveCamera(64, innerWidth / innerHeight, 0.28, 16000);
  const post = new Post(renderer, { width: innerWidth, height: innerHeight, pixelRatio: pr });

  scene.add(createSky());

  setStat('drawing the map…', 0.14);
  const material = createTerrainMaterial();
  const water = new Water({ seed: SEED, scene });
  /* Boats: a rare, slow silhouette on genuinely large open water — see src/render/ships.js.
   * Its own rolling window around the car, like props/roads/grass below, not tied to the
   * terrain streamer's onChunk (that file's own header explains why: a sparse feature tied to
   * the quadtree gets re-decided every time a chunk's LOD changes). */
  const ships = new Ships({ seed: SEED, scene });
  /* Seagulls, and a few smaller land birds — src/render/birds.js. Same rolling lattice as the
   * boats above, for the same reason, and placed off the same "is this wet" question the
   * boats and the ambience layer both already ask. One draw call for every bird in the world;
   * the flock is re-baked into one geometry each frame rather than instanced, which is what
   * buys a wing that actually flaps without a new shader to compile. */
  const birds = new Birds({ seed: SEED, scene });
  const flora = new Flora({ seed: SEED, scene });
  const solids = new Solids();

  const streamer = new Streamer({
    seed: SEED,
    material,
    viewDistance: 6800,
    terrain: CFG.terrain,
    onChunk: (rec) => {
      if (rec.water) water.add(rec);
      if (rec.level <= SCATTER_MAX_LEVEL) {
        const s = scatterChunk({ cx: rec.cx, cz: rec.cz, level: rec.level, seed: SEED });
        flora.add(rec, s);
        // Only the finest level provides collision. Beyond ~130 m the props you can see are
        // not props you can hit before they are replaced by a finer chunk.
        if (rec.level === 0) solids.addChunk(`${rec.cx},${rec.cz}`, solidsFromScatter(s));
      }
    },
    onRelease: (rec) => {
      water.remove(rec);
      flora.remove(rec);
      if (rec.level === 0) solids.removeChunk(`${rec.cx},${rec.cz}`);
    },
  });
  scene.add(streamer.group);

  const clouds = new Clouds({ renderer, scene, seed: SEED });
  // Roads and grass live in their own rolling windows around the car rather than hanging off
  // terrain chunks: a road is a line and grass is a density, and neither wants to be cut up
  // by a quadtree.
  const roads = new Roads({ seed: SEED, scene });
  // One wind field feeds the grass, the trees and the water, so a gust crosses all three at
  // once — which is most of what sells a landscape as alive.
  /* `worldSeed` as well as `seed`, and it is a real bug fix, not tidying: Wind keeps its own
   * low-res terrain proxy so gusts accelerate over hills, and it defaults `worldSeed` to the
   * literal 20260726 (render/wind.js, whose own comment says it "must match the streamer's, or
   * the wind would accelerate over hills that are not there"). Only `seed` was ever passed, so
   * the proxy has always read the old default world — invisible while SEED happened to equal
   * that literal, already wrong under ?seed=, and it would have gone wrong for everyone the
   * moment the default seed moved above. */
  const wind = new Wind(renderer, { seed: SEED, worldSeed: SEED });
  const grass = new Grass({ seed: SEED, scene, wind });
  /* grass.js floors blade width to ~1 screen pixel so the far field can thin in density
   * without ever thinning in coverage — but its constructor default assumes a 58 deg vertical
   * fov on a 1080 px canvas, and this camera is 64 deg. On the real, current viewport a "1
   * pixel" floor was actually sub-pixel, and `setAngular` existed to correct it but was never
   * called from anywhere — so it was permanently wrong, on every viewport, not just on resize.
   * Grass aliasing at 100-300 m was reported; this is at minimum a real contributor. */
  grass.setAngular((camera.fov * DEG) / innerHeight);
  /* The SAME number to the flowers. They had no angular floor at all until B37 — at the 190 m cull
   * a flower subtended about 0.6 px and a sub-pixel white petal against green flickers rather than
   * dims, which is the speckle that crawls over far hillsides. One source for both layers means a
   * resize or a field-of-view change moves them together. */
  flora.flowers?.setAngular?.((camera.fov * DEG) / innerHeight);

  setStat('finding a road…', 0.34);
  // LAND.spawnHigh: only the alpine preset sets it — "alpine start should be in the
  // mountains". The mid-drive rescue calls to findSpawn() below deliberately DON'T pass
  // it: a rescue should hand you the nearest sane road, not march you back up a massif.
  const spawn = findSpawn(SEED, 0, 0, { highBias: LAND.spawnHigh ?? 0 });
  streamer.forceChunk(spawn.x, spawn.z);

  /* A local exact terrain sampler around the player. The streamer's height cache is only
   * as good as what has streamed in; the car must never fall through a chunk that has not
   * arrived yet, so it asks this instead. Rebuilt lazily as the player leaves its box. */
  let local = new Terrain(SEED, spawn.x - 420, spawn.z - 420, spawn.x + 420, spawn.z + 420);
  let localCX = spawn.x;
  let localCZ = spawn.z;
  const localFor = (x, z) => {
    if (Math.abs(x - localCX) > 240 || Math.abs(z - localCZ) > 240) {
      local = new Terrain(SEED, x - 420, z - 420, x + 420, z + 420);
      localCX = x;
      localCZ = z;
    }
    return local;
  };

  setStat('unloading the car…', 0.52);
  const me = identity();
  const car = new Vehicle({ tier: CAR.tier, terrain: local, preset: FEEL.assist });
  /* THE MICRO-CARS' EXTRA PASS, and the order it has to run in.
   *
   * It wraps this one Vehicle's `_step` and writes tuning fields the feel does not own, so it must
   * come AFTER the feel and after the tier is set — which it is, both having happened above. Handed
   * an ordinary fleet car it detaches instead, which is why the same single call appears here and in
   * swapCar() and nowhere else. The Tricycle is FLEET[0], so on a fresh profile this is the call that
   * makes the very first car anyone drives behave like three wheels. */
  applyMicroPhysics(car, CAR);
  /* AND THE SPRINGS BACK ON TOP, because `applyMicroPhysics` just took them off.
   *
   * Handed an ordinary fleet car that call DETACHES the micro model, and detaching restores the
   * stock `SUSPENSION` table — which runs AFTER the feel pass, so it silently overwrites whatever
   * springs the car declared. Left alone, stepping out of the Tricycle and into the Warthog would
   * hand the Warthog the coupe's 42000 N/m springs, and the one car in the fleet built around its
   * suspension would quietly stop having any. Re-asserting here is six assignments, it is
   * idempotent, and the micro cars rewrite their own tables afterwards, so the Tricycle is
   * untouched. game/garage.js's applySuspFeel has the rest of the reasoning.
   *
   * This lives here rather than in car/microPhysics.js on purpose: that file is owned by another
   * branch right now, and the fix does not need it. */
  applySuspFeel(CAR);
  /* BACK WHERE YOU LEFT IT, if the spot is still somewhere a car can be.
   *
   * A saved position can outlive what made it valid — a build that moved the water table, or a
   * player who quit while their car was somewhere the terrain no longer agrees with. Dropping
   * someone inside a hill or into the sea is a worse welcome than the spawn point, so the record is
   * checked against the live ground and water before it is trusted, and the spawn is the fallback.
   * `isDryAt` is the same test findSpawn uses on its own candidates. */
  const resumeSpot =
    RESUME && spotIsSafe(RESUME, (x, z) => local.height(x, z), (x, z) => !isDryAt(x, z, SEED)) ? RESUME : null;
  if (resumeSpot) car.placeAt(resumeSpot.x, resumeSpot.z, resumeSpot.yaw);
  else car.placeAt(spawn.x, spawn.z, spawn.heading);
  /* Real CC0 bodywork if it loads, the hand-built box if it does not. The fallback matters:
   * a network hiccup on a 180 KB GLB must not cost the player their car. */
  const carKey = CAR.id;
  let model;
  try {
    model = await loadCar({ car: carKey, paint: me.look?.paint ?? 0, base: new URL('./models/cars/', location.href).href });
  } catch (err) {
    console.error('[car] model failed to load, using the built-in body', err?.message ?? err);
    model = buildCar({ tier: CAR.tier, paint: me.look?.paint ?? 0 });
  }
  scene.add(model.group);

  const chase = new ChaseCamera(camera, { mode: 'sport' });
  const input = new Input(window);
  input.attachTouch(canvas);
  /* `recover`/`say`/`ping` are all forward references — backToRoad() is a hoisted function
   * declared further down, and hud/audio are consts assigned a few lines below this one — which
   * is safe because none of the three is actually CALLED until well after the whole boot
   * function has finished running (autopilot's own update loop, which only starts once the
   * player is driving). `recover` is the same backToRoad() the R key and the water rescue below
   * both call, so all three can never disagree about where "the road" is. */
  const auto = new Autopilot({ recover: backToRoad, say: (t, s) => hud.say(t, s), ping: () => audio.ping() });
  const streak = new Streak();
  /* Entering auto-drive banks the streak instead of freezing it — game/streak.js's
   * breakForAutoDrive() and car/autopilot.js's TOGGLE_COOLDOWN are the two halves of the fix
   * for the flip-to-auto-and-back exploit (operator, verbatim, in the general instructions for
   * this pass: "you can't just go to auto and off of auto to get an infinite streak"). There are
   * TWO places in this file that can switch auto-drive on — the Garage's own button and the
   * keyboard/pad action — and both have to go through this one function, or one of them would
   * quietly stay a free save. `!auto.on` is read BEFORE toggle() flips it, which is the only
   * way to know this call is an ENTRY rather than an exit. */
  function toggleAutoDrive() {
    if (!auto.on) streak.breakForAutoDrive();
    return auto.toggle(car);
  }
  let trail = null;
  const hud = new Hud();
  /* Retired — operator: "Rope in back of car does not look good... use the bottom blue line
   * instead." hud.js's #unlockBar is now the only streak readout; StreakTrail disables its own
   * visual output unconditionally (see src/render/trail.js's file header), so it is still
   * constructed and still wired into the frame loop below only because that is now provably
   * inert and touching every call site in this shared, concurrently-edited file was not worth
   * the risk for a purely cosmetic cleanup. */
  trail = new StreakTrail({ scene });
  const audio = new EngineAudio({ seed: SEED }); // seed: the ambience layer asks worldgen where the water and the woods are

  /* The opening cinematic. It owns the camera and NOTHING else — the loop below runs exactly
   * as it always did underneath it, input included, so the game is drivable from the first
   * frame whether or not any of this works. `local` is handed over so the road shot can follow
   * the actual centreline instead of a straight line, and `chase` so the last shot can end on
   * the gameplay camera's own rest pose. */
  const cine = new Cinematic({
    camera,
    seed: SEED,
    spawn,
    terrain: local,
    chase,
    // Same sampler the chase camera gets, so the closing shot lands on the same terrain floor.
    groundAt: (x, z) => car.terrain.height(x, z),
    hud,
    /* The veil lifts as soon as fifteen chunks are live (see `revealed` below) and the opening
     * shot then immediately flies 270 m away and looks 2.6 km out. The streamer wants ~300
     * nodes around a spawn — measured at ~14 s of single-threaded meshing — so on a two-worker
     * machine that shot spends its first five seconds over ground that does not exist yet.
     * This is the whole of the fix: while the queue is still draining the cinematic runs at a
     * quarter rate, for at most ten seconds of lost time, and never freezes. Measured in
     * tools/diag-cinematic.mjs: 94.8% -> 98.7% of the programme over built terrain at two
     * workers, 97.8% -> 99.4% at four. */
    worldReady: () => streamer.stats.queued === 0,
    onEnd: () => chase.reset(),
  });

  /* Points of interest, the petrol stations, and the floating fuel cans. `solids` is handed
   * over so the props that declare a collision radius stop the car exactly like a tree does;
   * the ones that do not (benches, flower beds, fingerposts) stay drive-through on purpose —
   * cans are never solid, by the same logic: you collect one by driving through it. */
  const props = new Props({ seed: SEED, scene, solids });
/* HOW CLOSE COUNTS AS BEING IN THE TOWN, metres. The station apron is 11.5 m either side of the
 * pumps and the town spreads out to about 55 m beyond that, so 70 m is standing among the buildings
 * rather than merely on the same road as them. Deliberately tighter than the streak-forgiveness
 * radius: that one is about not punishing you for stopping, this one is about whose town it is. */
const TOWN_HERE_M = 70;
  /* Fuel reads the stations AND the cans the props renderer has already loaded rather than
   * re-deriving the road network — the pure lookups in world/props.js cost tens of
   * milliseconds. props.update() below is called with the car's own x/z every frame, so it
   * already knows when the car is near a can; drainCollectedFuel() just asks what it found. */
  /* The money, built before anything that spends it. Suns are the whole economy now — a
   * streak mints them, a dealership takes them for a car, a pump takes them for a bigger tank
   * — so the wallet has to exist before the fuel system and the garage, both of which read it.
   * See src/game/wallet.js's own header. */
  const wallet = new Wallet();
  /* The tiler asks the wallet how big each town is. Set here rather than passed to the Props
   * constructor because Props is built before the Wallet exists — see Props.setTownLevels. */
  props.setTownLevels((stationKey) => wallet.townLevel(stationKey));

  /* The off-road dust cue. Owns one InstancedMesh and nothing else; see src/game/spray.js. */
  const spray = new Spray({ scene });
  /* The little cloud that brings you fuel — see render/helper.js. Created before the Fuel so it can
   * be handed in as the rescue hook; it decides nothing, it only shows up. */
  const helper = new FuelHelper(scene, props?.material || null);

  const fuel = new Fuel({
    onRescue: () => helper.visit(car, (x, z) => car.terrain.height(x, z)),
    /* WHERE IS THE NEAREST STATION, and it has to be right rather than merely available.
     *
     * This used to be `props.nearestStation` alone, which reports out of the tiles the renderer has
     * BAKED — and that list can hold a station from a kilometre behind you while saying nothing about
     * the forecourt you are turning onto. Everything downstream inherits that: the distance on the
     * fuel gauge, the low-fuel toast, and — the operator's own bug, reported twice — the streak
     * forgiveness, which is a radius around this answer. "Turning into gas station still kills
     * streak" was never the forgiveness rule failing; it was the rule being handed the wrong station.
     *
     * So the WORLD is asked as well. `nearestStationWorld` is pure and cannot be stale, and over a
     * small radius it is cheap (a road query over an 800 m box measured at about 1 ms). It runs on a
     * timer, and the nearer of the two answers wins — the renderer's list is still useful because it
     * includes stations already proven to sit on buildable ground. */
    findStation: (x, z) => {
      const baked = props.nearestStation(x, z);
      const truth = stationScan(x, z);
      if (!baked) return truth;
      if (!truth) return baked;
      return truth.dist < baked.dist ? truth : baked;
    },
    /* Picking up a can, with its sound. The audio hangs off THIS callback rather than off a
     * flag polled somewhere else, because this is the one function in the game that can say
     * "a can was collected on this exact frame" — game/fuel.js calls it once a tick and a
     * non-zero answer means it happened. Synthesised in the existing WebAudio graph (see
     * EngineAudio.pickup); no file is downloaded and no third-party service is involved. */
    collectCans: () => {
      const gained = props.drainCollectedFuel();
      if (gained > 0) audio.pickup();
      return gained;
    },
    // remotes is constructed a little further down (it needs the transport/identity wiring
    // above it), but this callback is not CALLED until update() runs deep inside the frame
    // loop, well after boot() has finished — the same forward-reference pattern already used
    // for auto's recover/say/ping a little earlier in this function.
    incomingShares: () => remotes.drainIncomingShares(),
    say: (t, s) => hud.say(t, s),
    resetToSpawn,
    /* Capacity belongs to the CAR, not to the player. Operator: "each car unlock = capacity
     * does not transfer from car to car. Reason to restart capacity". CAR.id is the fleet id
     * chosen in the garage, so swapping cars really does hand you a small tank again. */
    carId: CAR.id,
    /* With a wallet in hand, tank capacity is BOUGHT rather than collected — see
     * game/fuel.js's capacityLevel. */
    wallet,
  });

  /* THE TANK YOU PARKED WITH. Without this a resume hands back a full tank, which quietly undoes the
   * fuel economy — park on fumes outside a petrol station, reload, and you have been given a free
   * refill. Clamped to the tank's real capacity because that capacity is per-car and per-upgrade, and
   * the car you resume in may not be the one the number was written for. */
  if (RESUME && Number.isFinite(RESUME.fuel) && RESUME.fuel > 0) {
    fuel.seconds = Math.min(RESUME.fuel, fuel.capacity);
  }
  /* The world's own answer to "where is the nearest station", on a timer. Kept small and cached
   * because it is asked every frame by findStation above: a 900 m radius is far more than the 140 m
   * the forgiveness needs and the 26 m refuelling needs, and re-running it more than about twice a
   * second would be paying for an answer that cannot have changed. */
  let stationScanAt = -1e9;
  let stationScanNear = null;
  let stationScanX = 1e9;
  let stationScanZ = 1e9;
  const STATION_SCAN_EVERY = 0.4; // seconds
  let stationClock = 0;
  const stationScan = (x, z) => {
    const moved = Math.hypot(x - stationScanX, z - stationScanZ) > 60;
    if (!moved && stationClock - stationScanAt < STATION_SCAN_EVERY) return stationScanNear;
    stationScanAt = stationClock;
    stationScanX = x;
    stationScanZ = z;
    stationScanNear = nearestStationWorld(x, z, SEED, 900);
    return stationScanNear;
  };

  /* "Am I on a forecourt?" — the one question streak.js asks about petrol stations, answered
   * from the scan the fuel system already runs (see Fuel's `nearest`) rather than by probing
   * the world a second time every frame. Operator: "massive forgiveness area around gas
   * station". See STATION_FORGIVE_R in game/streak.js for the radius and the reasoning. */
  const nearPump = () => !!fuel.nearest && fuel.nearest.dist <= STATION_FORGIVE_R;
  /* Standing at a DEALERSHIP — close enough to do business, which is the forecourt itself and
   * not the whole forgiveness radius. `fuel.nearest` is the station scan that already runs
   * twice a second (see game/fuel.js's findStation), and a dealership IS a station with the
   * `deal` flag (world/props.js), so this costs nothing new. */
  const DEAL_RADIUS = 34;
  let dealerWas = false; // latch for the arrival line — see the frame loop
  /* The cars that open on lifetime suns rather than at a dealership, and the once-each latch for
   * announcing them. `earnedSeeded` suppresses the very first pass — see the loop for why. */
  const EARNED_CARS = FLEET.filter((c) => Number.isFinite(c.earnAt) && c.id !== FLEET[0].id);
  const earnedTold = new Set();
  let earnedSeeded = false;
  /* Which display car the forecourt prompt last named, so nosing along the row says each car once
   * instead of every frame. Cleared the moment you are not beside one. */
  let showroomTold = null;
  /** Seconds since the last 'ouch', so a crash cannot shout twice in the same second. */
  let ouchClock = 99;
  /* ON FOOT. Operator: "Walk-in showrooms seperate to gas stations (walkable mode)."
   *
   * The walker owns nothing the car owns — see game/walk.js for why it is kinematic rather than a
   * second physics body. main.js only decides WHEN you may be out of the car, which is: beside a
   * walk-in showroom, and not while flying, boating, auto-driving or in the Garage. */
  const walker = new Walker();
  let hallTold = null;
  let hallWas = false;
  /* THE CONTROLLER INTRODUCES ITSELF, ONCE.
   *
   * Operator: "KNOW how to do that and get hints at tirght times". A pad that silently starts working
   * still leaves the player guessing which button is the menu and which gets them unstuck — the two
   * things the ask is actually about. So the first frame a pad is seen, the game names them.
   *
   * Latched on the transition rather than the state, so unplugging and replugging says it again
   * (you probably swapped pads) while simply holding one does not repeat it. */
  let padWas = false;
  /* HINTS AT THE RIGHT TIME, and the right time for "here is how to get back on the road" is when
   * you have been off it long enough to be looking for a way out — not the moment a wheel touches
   * grass, which happens constantly and on purpose. Seconds of continuous off-road, and said once
   * per excursion. */
  let offRoadFor = 0;
  let offRoadTold = false;
  /* The cars a dealership actually stocks, in the order the forecourt slots are laid out. Derived
   * from `unlockRule` rather than listed here, so the line-up is exactly "the ones you cannot get by
   * collecting" and stays that way if the ladder is ever retuned. */
  const DEALER_CARS = FLEET.filter((c) => unlockRule(c).how === 'buy');

  /* AT A PUMP, close enough to do business — the same forecourt radius a dealership uses, and the
   * gate for buying a spare fuel can (operator: "make it so you can buy gas cans in the petrol
   * stations"). A dealership is not a pump: they are the same structure with a flag, and each sells
   * its own thing. */
  const atPumpShop = () => !!fuel.nearest && fuel.nearest.deal !== true && fuel.nearest.dist <= DEAL_RADIUS;

  /* AT A HARBOUR. The boat is bought here rather than granted at 50 suns — operator: "buying a boat
   * ... isn't automatic, but something you get at the harbor".
   *
   * Asked of the RENDER layer, not of the pure world function. The first version called
   * nearestHarbour() from world/props.js on a 1.5 s timer and it starved the frame: that walks a 5 km
   * lattice and probes the sea bed at every candidate, and the car dropped to 9 km/h on a road (the
   * browser suite caught it — "C4 lifting off slows you visibly: 22 -> 21 km/h"). render/props.js has
   * already done that work for every tile it baked, so asking it costs nothing. Same trade every
   * station makes: a harbour is findable once its tile has streamed in. */
  /* THE PLANE. Flown from an airfield, unlocked with sea diamonds or the pass — see game/plane.js,
   * which is a port of brihernandez/ArcadeJetFlightExample (MIT) with its licence search recorded.
   * `terrain` is a zero-arg forward reference for the same reason boat.js takes one: main.js
   * reassigns car.terrain every frame. */
  const plane = new Plane({
    wallet,
    say: (t, secs) => hud.say(t, secs),
    terrain: () => car.terrain || local,
  });

  const HARBOUR_RADIUS = 46;
  const atHarbour = () => {
    const h = props.nearestHarbour(car.x, car.z);
    return !!h && h.dist <= HARBOUR_RADIUS;
  };
  let harbourWas = false;
  /** Last frame's menu state, so the pause is applied once on each transition. */
  let pausedWas = false;
  let airfieldWas = false; // latch for the airfield line — see the frame loop
  const atDealer = () => !!fuel.nearest && fuel.nearest.deal === true && fuel.nearest.dist <= DEAL_RADIUS;

  /**
   * The nearest walk-in showroom THE TILER HAS ACTUALLY BUILT, with its distance.
   *
   * Reading `props.halls` rather than re-deriving from the seed is not fussiness — it is the exact
   * shape of the station-forgiveness bug, where a pure world function said a station was here while
   * the renderer's own list said it was not, and the rule that trusted the wrong one looked broken
   * for a week. If it is not built, you cannot walk into it, so it does not count.
   */
  const nearestBuiltHall = (x, z) => {
    const list = props && props.halls ? props.halls : null;
    if (!list || !list.length) return null;
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
  };
  const fuelGauge = new FuelGauge(hud.root);

  /* Suns along the road, gems on open water — src/render/loot.js. `wallet`
   * (src/game/wallet.js) tracks what has been collected and gates the boat unlock at
   * BOAT_UNLOCK_SUNS; `lootCounter` (src/ui/lootCounter.js) is fuelGauge's own pattern,
   * docked in the one HUD corner not already claimed — see that file's own comment. */
  const loot = new Loot({ seed: SEED, scene });

  /* THE JUMPS, DRAWN — src/render/ramps.js. The kickers themselves are ground, added inside
   * world/terrain.js's `surface()` (see world/ramps.js for why a ramp cannot be a collider), so this
   * only draws them. It has to, though: a jump you cannot see is a car launching off apparently flat
   * ground, which reads as a bug rather than a feature.
   *
   * `terrain` is handed over as a forward-reading shim rather than an object, for the same reason the
   * boat's is a little further down: `car.terrain` is REASSIGNED every frame by `localFor` as the
   * player moves between streamed patches, so capturing today's instance here would leave the ramp
   * meshes sampling a terrain the game stopped using minutes ago. */
  const ramps = new Ramps({ seed: SEED, scene, terrain: { height: (x, z) => (car.terrain || local).height(x, z) } });
  const lootCounter = new LootCounter(hud.root);

  /* Boat mode — the last unlock, src/game/boat.js. `terrain` is a zero-arg forward reference
   * to `car.terrain` for the same reason `recover`/`say`/`ping` a little further down are:
   * main.js reassigns it every frame, so a reference captured now would go stale the moment
   * the player left this box. The mesh itself is car/model.js's own idiom (buildCar() built
   * once, repositioned every frame) — `ships.material` so the one extra hull shares the
   * anchored fleet's already-compiled painted-solid program rather than paying for a second
   * one. Built now rather than deferred to the actual unlock: a handful of triangles is not
   * worth a lazy-init branch in the per-frame model-placement block below. */
  const boatMode = new BoatMode({ wallet, say: (t, s) => hud.say(t, s), terrain: () => car.terrain });
  /* The Synty hull if it loads, the hand-built one if it does not — see loadPlayerBoat. The model
   * lives only in the private repo, so the fallback is what keeps a public checkout afloat. */
  const boatMesh = await loadPlayerBoat(ships.material, new URL('./models/cars/', location.href).href);
  boatMesh.visible = false;
  /* TELL THE BOAT HOW BIG ITS HULL IS. Operator: "boat is always half flooded with water".
   *
   * Measured from whichever hull actually loaded — the Synty one or the hand-built fallback — so
   * the waterline lands a third of the way up either of them without a hardcoded number that would
   * be wrong for the other. game/boat.js does the arithmetic; this is the only place that knows
   * which mesh is on screen. */
  {
    const box = new Box3().setFromObject(boatMesh);
    if (Number.isFinite(box.min.y) && box.max.y > box.min.y) {
      boatMode.setHull({ minY: box.min.y, height: box.max.y - box.min.y });
    }
  }
  /* THE AEROPLANE, which did not exist until now — see render/plane.js. Flying used to drag the
   * CAR's mesh to the plane's x and z, ignoring its height, pitch and roll, so taking off looked
   * like nothing happening. */
  const planeMesh = buildPlane(ships.material);
  scene.add(planeMesh);
  scene.add(boatMesh);
  /* The propeller's own accumulated spin, radians — see the frame loop, `planeMesh.userData.prop`
   * and render/plane.js's buildPropDisc(). Kept out here rather than inside the frame loop's own
   * closure for no other reason than every other per-frame latch in this function already lives at
   * this level (padWas, offRoadFor, harbourWas...) — one place to look for "what does the loop
   * remember between frames", not two. */
  let propSpin = 0;
  /* Whether the plane was stalling last frame — same latch idea as propSpin above, so the HUD
   * callout below fires once on the way IN rather than every frame the wing is short of speed. */
  let planeWasStalling = false;

  /* Swapping the car keeps everything else: position, speed, streak, the lot. The model is
   * the only thing that changes, because the solver is tuned by the FEEL, not by the body. */
  let carKeyLive = carKey;
  /* ONE SWAP AT A TIME. `carKeyLive` only advances after the awaits below, so two quick presses
   * — V twice, or a garage click racing a V — used to run two loadCars over the same `model`:
   * two disposes of one rig and an orphan group left in the scene. The flag simply drops the
   * second press; the key works again the moment the first swap lands. */
  let carSwapBusy = false;
  async function swapCar(key) {
    if (!CARS[key] || key === carKeyLive) return;
    const spec = FLEET_BY_ID[key];
    if (spec && !isUnlocked(spec, Math.max(bestStreak(), streak.state.best), wallet)) {
      hud.say(`${spec.label} unlocks at ${(spec.unlockAt / 1000).toFixed(1)} km`, 3);
      return;
    }
    if (carSwapBusy) return;
    carSwapBusy = true;
    try {
      const next = await loadCar({ car: key, paint: me.look?.paint ?? 0, base: new URL('./models/cars/', location.href).href });
      /* The second half of the freeze fix: cook the new car's programs BEFORE it enters the
       * scene. `compileAsync` rides KHR_parallel_shader_compile, so the driver compiles on its
       * own threads while the OLD car keeps drawing; by the time this resolves, the first
       * painted frame has no compile left to pay for. Without it the swap frame paid the whole
       * bill at first draw — over a second of long tasks per swap, measured in
       * tools/diag-carswap-freeze.mjs. Scene and camera are passed so the variant compiled is
       * the variant rendered: lights and fog defines differ otherwise and the stall comes back. */
      await renderer.compileAsync(next.group, camera, scene);
      scene.remove(model.group);
      model.dispose?.();
      model = next;
      scene.add(model.group);
      carKeyLive = key;
      window.WANDEROAD.model = model;
      // The car owns its feel, so changing car changes how it drives.
      if (spec) {
        /* One call where there were three: `applyDrivingModel` does the feel, then `setTier` (which
         * re-reads mass, inertia and the CG offsets the Vehicle caches) and then `setPreset` (which
         * re-reads the aid rung the model may have rewritten) itself. Doing them again here would be
         * harmless but would leave two places that have to agree about the order. */
        applyDrivingModel(spec, car);
        /* ...and then the micro pass, which must be last: it writes tuning fields the feel does not
         * own and swaps the Vehicle's tier record for a private clone, both of which `setTier` above
         * has just undone. Handed an ordinary car it puts everything back, so switching AWAY from a
         * micro-car is this same line. */
        applyMicroPhysics(car, spec);
      /* AND THE SPRINGS BACK ON TOP, because `applyMicroPhysics` just took them off.
       *
       * Handed an ordinary fleet car that call DETACHES the micro model, and detaching restores the
       * stock `SUSPENSION` table — which runs AFTER the feel pass, so it silently overwrites whatever
       * springs the car declared. Left alone, stepping out of the Tricycle and into the Warthog would
       * hand the Warthog the coupe's 42000 N/m springs, and the one car in the fleet built around its
       * suspension would quietly stop having any. Re-asserting here is six assignments, it is
       * idempotent, and the micro cars rewrite their own tables afterwards, so the Tricycle is
       * untouched. game/garage.js's applySuspFeel has the rest of the reasoning.
       *
       * This lives here rather than in car/microPhysics.js on purpose: that file is owned by another
       * branch right now, and the fix does not need it. */
      applySuspFeel(spec);
        /* AND THE SPRINGS BACK ON TOP, because `applyMicroPhysics` just took them off.
         *
         * Handed an ordinary fleet car that call DETACHES the micro model, and detaching restores the
         * stock `SUSPENSION` table — which runs AFTER the feel pass, so it silently overwrites whatever
         * springs the car declared. Left alone, stepping out of the Tricycle and into the Warthog would
         * hand the Warthog the coupe's 42000 N/m springs, and the one car in the fleet built around its
         * suspension would quietly stop having any. Re-asserting here is six assignments, it is
         * idempotent, and the micro cars rewrite their own tables afterwards, so the Tricycle is
         * untouched. game/garage.js's applySuspFeel has the rest of the reasoning.
         *
         * This lives here rather than in car/microPhysics.js on purpose: that file is owned by another
         * branch right now, and the fix does not need it. */
        applySuspFeel(spec);
        /* Capacity is per car and does NOT transfer — swapping in the garage loads this car's
         * own can count and its own tank. See Fuel.setCar / START_CAPACITY_MUL. */
        fuel.setCar(spec.id);
      }
      trail.reset(car);
      hud.say(`${CARS[key].label} — ${spec ? spec.blurb : ''}`, 3.2);
    } catch (err) {
      console.error('[car] swap failed', err?.message ?? err);
      hud.say('that one would not load', 2.5);
    } finally {
      carSwapBusy = false;
    }
  }

  /* `?unlock=123` — the operator's own hack. Applied before the Garage is built so the fleet is
   * already open the first time it draws, and it opens the PLANE and the BOAT as well as the cars:
   * "unlock all" that leaves two things locked is not unlock all. See game/garage.js's UNLOCK_PASS. */
  if (cheatOn()) {
    wallet.boat = true;
    wallet.plane = true;
    wallet.save();
    hud.say('everything unlocked', 3.0);
  }

  const menu = new Menu({
    onAuto: () => toggleAutoDrive(),
    isAuto: () => auto.on,
    onCar: swapCar,
    /* THE DRIVING MODEL, put on the car that is being driven right now.
     *
     * ui/menu.js owns the button and the choosing — `setDrivingModel` has already run and has already
     * persisted the choice by the time this is called. This is the half only main.js can do, because
     * only main.js knows WHICH fleet entry is in the player's hands and which Vehicle is under it.
     * car/drivingModels.js splits the two deliberately ("a choice and an application are two
     * different events"), and this is the application.
     *
     * No reload, and nothing is re-created: `applyDrivingModel` rewrites the shared tuning tables and
     * re-reads the tier and the aid rung into the live Vehicle, and the solver reads those tables on
     * its next step. Switching mid-corner was measured as disturbing neither position, heading nor
     * speed on any of six switches — see tools/diag-driving-models.mjs. `applyMicroPhysics` follows
     * for the same reason it does in swapCar: the restore inside the model wiped its fields. */
    onDrive: () => {
      const spec = FLEET_BY_ID[carKeyLive];
      if (!spec) return;
      applyDrivingModel(spec, car);
      applyMicroPhysics(car, spec);
    },
    bestStreak: () => Math.max(bestStreak(), streak.state.best),
    /* The leaderboard panel — src/net/board.js, wired up below once `transport` exists (`board`
     * is declared with `const` further down in this same function; reading it through a closure
     * here is safe because neither getter is ever CALLED until the player opens the Garage, long
     * after that declaration has run — see the note by `const board =` for why). */
    board: () => board,
    streakBest: () => streak.best,
    /* The shop. The garage panel is where you pick a car you own; at a dealership it is also
     * where you buy one, and where a bigger tank is fitted — see ui/menu.js's `tank` group and
     * game/wallet.js's buyCar/buyTank. */
    wallet: () => wallet,
    fuel: () => fuel,
    canBuy: () => atDealer(),
    /* So the Garage can label its own buttons for whatever is in the player's hands — see _mark(). */
    device: () => input.device,
    atPump: () => atPumpShop(),
    atHarbour: () => atHarbour(),
    /* WHICH TOWN YOU ARE STANDING IN, for the Garage's town row. The same `findStation` answer the
     * fuel gauge and the streak forgiveness use — one source for "the nearest station", so the row
     * cannot disagree with the arrow pointing at it — gated on being close enough to call it being
     * THERE rather than near it. `key` is the station's own world key (`st:<edgeKey>`), which is a
     * pure function of the seed and the lattice, so the town you upgrade stays the town you
     * upgraded across reloads. */
    townHere: () => {
      const st = fuel.nearest;
      if (!st || !st.key || !(st.dist <= TOWN_HERE_M)) return null;
      return { key: st.key, x: st.x, z: st.z, name: st.name || null, dist: st.dist };
    },
    /* Make the new buildings appear while you are standing in them — see Props.rebuildAround. */
    rebuildTown: (here) => {
      if (here) props.rebuildAround(here.x, here.z, 240);
    },
    say: (t, secs) => hud.say(t, secs),
    onCheat: (on) => {
      setCheat(on);
      hud.say(on ? 'every car unlocked' : 'unlocks restored', 2.4);
    },
    onReset: () => backToRoad(),
    camera: () => chase.mode,
    cycleCam: () => chase.cycle(),
  });
  menu.setCurrent({ car: carKeyLive, feel: CFG.feel, terrain: CFG.terrain });

  /* THE ONE PERMANENT LINE ON SCREEN, and it has to be true for whoever is reading it.
   *
   * It said "ESC — garage" to everybody, including anyone holding a controller, for whom Esc is a key
   * they are not touching and the actual answer is Start. That is exactly the operator's complaint —
   * "so u can open garage w reset to road and KNOW how to do that" — and it is not solved by adding
   * the pad's bindings somewhere: it is solved by this line naming the device in your hands.
   *
   * Retitled the moment a pad is picked up or put down (see the frame loop's `padWas` latch). */
  /* ── SAVING WHERE YOU ARE ────────────────────────────────────────────────
   * Operator: "we need to make it so people can continue were they left off."
   *
   * Only the things no other module already persists — see game/session.js. The wallet, the streak,
   * the fuel upgrades and the achievements all keep saving themselves, and duplicating any of them
   * here would create a second opinion about the same number.
   *
   * The FUEL LEVEL is saved because arriving back with a full tank quietly undoes the fuel economy:
   * a player who parked on fumes next to a petrol station would reload with a free refill.
   *
   * Never saved while ON FOOT, FLYING or BOATING. All three are modes you are somewhere specific
   * for, and restoring into one of them from a cold start is how you resume 400 m up with no engine
   * note and no idea why. The car's own parked position is the honest thing to come back to. */
  const snapshot = () => ({
    seed: SEED,
    x: car.x,
    z: car.z,
    yaw: car.yaw,
    car: carKeyLive,
    fuel: fuel?.seconds,
    at: Date.now(),
  });
  const persist = () => {
    if (walker.active || plane.active || boatMode.active) return;
    if (!Number.isFinite(car.x) || !Number.isFinite(car.z)) return;
    saveSession(snapshot());
  };

  /* `pagehide` and a hidden `visibilitychange` are the two that actually fire when a tab is closed,
   * backgrounded or navigated away from, on desktop AND on mobile. `unload` is unreliable and is
   * ignored outright on iOS, which is exactly the case — someone closing the game on a phone —
   * this feature exists for. */
  addEventListener('pagehide', persist);
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
  });
  let saveClock = 0;

  const openHint = document.createElement('div');
  openHint.id = 'openMenu';
  openHint.textContent = 'ESC — garage';
  hud.root.appendChild(openHint);
  const refreshOpenHint = () => {
    const g = input.label('garage');
    const r = input.label('reset');
    openHint.textContent = `${g} — garage · ${r} — back on the road`;
  };
  refreshOpenHint();

  /* The operator's playlist, in a small closable window — see src/ui/musicPanel.js. It is
   * entirely self-contained (owns its own DOM, appended to <body>, and its own J-key listener)
   * so this one line is the whole wire-up; nothing in the frame loop below needs to touch it. */
  const musicPanel = new MusicPanel();

  /** Put the player back on the nearest road, facing along it.
   *
   * The nearest road is not automatically dry: a cutting can smooth-and-clamp its way below
   * the local water table while the land right beside it stays dry, which is invisible to
   * the raw-land-only check profileEdge() itself uses (see the header note on waterMargin()
   * in world/terrain.js). So the query result is checked with the SAME water-safe test
   * findSpawn() uses on its own candidates before it is trusted, and if it fails, this falls
   * back to findSpawn() — the one place in the game that already has to solve "find dry
   * land" — rather than a second, independently-written search living here.
   *
   * A road runs both ways, and Math.atan2(q.tx, q.tz) only ever names ONE of the two —
   * operator: "Reset to Road needs to check your cardinal direction... so you continue in
   * that direction." Read car.yaw BEFORE placeAt() overwrites it, and hand both it and the
   * raw tangent to closestHeading() (core/math.js), which keeps whichever of the tangent or
   * its exact opposite is the shorter turn — so R nudges the car onto the road without ever
   * spinning it around to face back the way it came. See tools/diag-reset-heading.mjs. */
  /* edited by AI from here — DO NOT SET THEM DOWN FACING A WALL.
   *
   * How much road there is if you set off from (x, z) on heading `h`: walked along the
   * centreline itself in 5 m steps, because roads bend and a straight ray leaves the tarmac
   * on the first corner and would report every bend as a dead end. Gives up at `limit`, so
   * the cost is at most a dozen road queries and only ever on an R press.
   *
   * This exists because of the interaction between two separately-correct changes. R now
   * keeps the direction you were already driving (closestHeading, see the note above and
   * tools/diag-reset-heading.mjs) — right, and the operator asked for it. The road network
   * also has terminuses. Put those together and R can set you down 20 m short of a closing
   * bar, pointing at it. Measured live, headless Chrome, the browser suite's own world
   * (?terrain=meadow, seed 20260726): R landed the car at (504, 337) with 20 m of road ahead
   * and 1900 m behind, and auto-drive then drove those 20 m and switched itself off saying
   * "the road ends here" — which is what fails the suite's "G engages auto-drive and it
   * drives" and, downstream of being parked at a terminus, "the road streak accumulates".
   *
   * The rule below is deliberately narrow: the heading you were driving WINS unless it has
   * almost no road left AND the other way has meaningfully more. On open road both directions
   * run past the horizon, both measure `LOOK`, and nothing flips — so every case
   * diag-reset-heading.mjs traces is untouched. */
  const RESET_LOOK = 60;
  /** Below this much road ahead, "carry on the way you were" is pointing at a closing bar. */
  const RESET_MIN_AHEAD = 40;
  function roadRunFrom(t, x, z, h, limit = RESET_LOOK) {
    let cx = x,
      cz = z,
      tx = Math.sin(h),
      tz = Math.cos(h),
      len = 0;
    for (let i = 0; i < limit / 5; i++) {
      const r = t.roads.query(cx + tx * 5, cz + tz * 5);
      if (!isFinite(r.d) || r.d > 4) break; // off the end, or off onto the verge
      let rtx = r.tx,
        rtz = r.tz;
      if (rtx * tx + rtz * tz < 0) {
        rtx = -rtx;
        rtz = -rtz;
      } // keep going the way we set off
      cx = r.qx;
      cz = r.qz;
      tx = rtx;
      tz = rtz;
      len += 5;
    }
    return len;
  }
  function backToRoad() {
    const t = car.terrain || local;
    const q = t.roads.query(car.x, car.z);
    if (isFinite(q.d) && isDryAt(q.qx, q.qz, SEED)) {
      const tangentHeading = Math.atan2(q.tx, q.tz);
      let heading = closestHeading(car.yaw, tangentHeading);
      const ahead = roadRunFrom(t, q.qx, q.qz, heading);
      if (ahead < RESET_MIN_AHEAD) {
        const behind = roadRunFrom(t, q.qx, q.qz, heading + Math.PI);
        if (behind > ahead) heading += Math.PI;
      }
      car.placeAt(q.qx, q.qz, heading);
    } else {
      const s = findSpawn(SEED, car.x, car.z);
      car.placeAt(s.x, s.z, s.heading);
    }
    chase.reset();
    trail.reset(car);
    // ...and drop any dust in flight, so a reset does not drag a comet tail of grass across the
    // map from wherever the car used to be.
    spray.reset();
    hud.say('back on the road', 2);
  }

  /** Sent home once the passing-driver mercy runs out (src/game/fuel.js, MERCY_MAX uses,
   *  then this instead of a fourth rescue) — the session's ORIGINAL spawn point, not
   *  backToRoad()'s "nearest road", because the operator asked for "restart og position"
   *  specifically. Same placeAt/chase/trail sequence backToRoad() uses so the car lands
   *  exactly as it does on every other reset in this game; no hud.say() of its own — Fuel
   *  already says its own toast right before calling this, and two messages stacked on one
   *  event would read as noise, not calm. */
  function resetToSpawn() {
    car.placeAt(spawn.x, spawn.z, spawn.heading);
    chase.reset();
    trail.reset(car);
    spray.reset();
  }

  /* The lakes have 35° banks and a flat bed you can drive along for ever, eleven metres
   * under. This notices and undoes it, using the same backToRoad() the R key does so the
   * two can never drift apart. See src/game/rescue.js for why it is depth-gated. */
  /* `skip` — src/game/boat.js's own "Rescue integration" note: once the boat exists it owns
   * the water, both while actually afloat and for the whole approach once it is unlocked, so
   * this teleport must step aside rather than fight it. See rescue.js's own constructor
   * comment for exactly what `inWater` means here (the SAME gates this class already computes
   * every update(), asked once). */
  const rescue = new Rescue({
    recover: backToRoad,
    say: (t, s) => hud.say(t, s),
    skip: (inWater) => boatMode.active || (wallet.boatUnlocked && inWater),
  });

  setStat('looking for company…', 0.7);
  const transport = createTransport({
    backend: OFFLINE ? 'none' : 'auto',
    phpBase: apiBase(),
  });
  /* The leaderboard — src/net/board.js, submit-and-fetch fused onto the same `transport` the
   * drive tick already uses. `identity` (imported above from net/identity.js) is passed as-is
   * rather than called here: Board reads it lazily on every submit/refresh, so a player who
   * renames mid-session has the new name on their NEXT submission, not whatever was captured at
   * boot. `lastBoardBest` is this file's own cheap watermark for "have I told the server about
   * this number yet" — see the streak.update() call below for why it does NOT read this off
   * streak.drain(): that queue belongs to ui/hud.js alone. */
  const board = new Board({ transport, seed: SEED, identity });
  let lastBoardBest = 0;
  /* Ghosts are now the SAME loaded GLB the driver is actually driving — src/net/ghostCar.js,
   * which has the whole story. Two separate bugs sat on top of each other here and only the
   * first was fixed:
   *
   *   1. THE WIRE. carPacket() below used to send car.tier, the Vehicle's silhouette STRING
   *      ('gt'|'sports'|'hyper'), into the server's INTEGER `tier` column; PHP casts a
   *      non-numeric string to 0 (wr_int() in server/drive.php), so every ghost came back as
   *      CAR_TIERS[0] regardless of what its driver had picked. Sending the FLEET INDEX
   *      instead (0..6, the numbering garage.js already uses) fixed that, and it stays fixed.
   *   2. THE MODEL. The correct index then went to car/model.js's buildGhostCar(), which only
   *      has three procedural shapes. So seven cars still collapsed to three bodies and none
   *      of them was the model being driven — a translucent angular sedan parked next to the
   *      other player's solid GLB hatch, which is what the last playtest photographed.
   *
   * makeGhostFactory() closes (2) by loading the real per-fleet GLB through loadedCar.js's
   * loadGhostCar(), which has existed and been imported here unused all along. It hands back a
   * handle synchronously with the procedural body as a stand-in and swaps the GLB in when it
   * arrives, because Remotes._spawn() cannot await anything. */
  const ghostFactory = makeGhostFactory({ base: new URL('./models/cars/', location.href).href });
  const remotes = new Remotes({ scene, buildGhostCar: ghostFactory });
  const save = new WorldSave({ seed: SEED, transport });
  await save.load().catch(() => {});
  /* Presence interest cells are 2048 m, rounded (not floored) so the 3x3 neighbourhood the
   * server queries is centred on you rather than on a corner. */
  const cellKey = () => `c${Math.round(car.x / 2048)}_${Math.round(car.z / 2048)}`;

  /* ── window plumbing ─────────────────────────────────────────────────── */
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight, false);
    post.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    grass.setAngular((camera.fov * DEG) / innerHeight);
  /* The SAME number to the flowers. They had no angular floor at all until B37 — at the 190 m cull
   * a flower subtended about 0.6 px and a sub-pixel white petal against green flickers rather than
   * dims, which is the speckle that crawls over far hillsides. One source for both layers means a
   * resize or a field-of-view change moves them together. */
  flora.flowers?.setAngular?.((camera.fov * DEG) / innerHeight);
  });
  addEventListener('pagehide', () => {
    streak.flush();
    wallet.flush();
    save.flush();
    transport.send({ op: 'bye', cell: cellKey(), car: carPacket() }).catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      streak.flush();
      wallet.flush();
      save.flush();
    }
  });

  let dbg = null;
  if (DEBUG) {
    dbg = document.createElement('div');
    dbg.id = 'debug';
    document.body.appendChild(dbg);
  }

  /* ── network tick ────────────────────────────────────────────────────── */
  const carPacket = () => ({
    x: car.x,
    y: car.y,
    z: car.z,
    yaw: car.yaw,
    vx: car.vx,
    vy: car.vy,
    vz: car.vz,
    yawRate: car.yawRate,
    steer: car.steer,
    throttle: car.throttle,
    brake: car.brake,
    gear: car.gear,
    // The FLEET index of the car actually being driven (0..6), not car.tier — see the note
    // above buildGhostFromFleet. Recomputed each call rather than cached against carKeyLive
    // so a car swap can never leave it stale; FLEET has 7 entries, this is not worth memoising.
    tier: Math.max(0, FLEET.findIndex((c) => c.id === carKeyLive)),
    paint: me.look?.paint ?? 0,
    // Bit 2: "I am sharing fuel with a nearby player right now" — see game/fuel.js's
    // SHARE_FLAG and src/net/remotes.js's rising-edge check on the receiving end.
    flags: (car.onGround ? 0 : 1) | (car.handbrake > 0.5 ? 2 : 0) | (fuel.sharing ? SHARE_FLAG : 0),
  });

  let netState = 'offline';
  let nextTick = 0;
  /** Consecutive failed ticks, for the backoff ladder — see the catch below. */
  let netFails = 0;
  async function netTick(now) {
    if (now < nextTick) return;
    nextTick = now + 4000; // pessimistic; the server's own `rate` replaces this
    try {
      const res = await transport.send({ op: 'tick', cell: cellKey(), car: carPacket() });
      if (!res) {
        netState = 'offline';
        return;
      }
      netState = transport.backend === 'local' ? 'solo' : 'online';
      netFails = 0; // a good tick resets the backoff ladder
      if (res.peers) remotes.ingest(res.peers, res.now);
      // The server sets the pace. 'rate' is in HERTZ, not seconds: 0.25 when you are alone in
      // a continent, 2 when someone is within 800 m. Reading it as seconds inverts the whole
      // scheme — a lone driver would poll four times a second and a crowded road once every
      // two.
      nextTick = performance.now() + 1000 / Math.max(0.05, Math.min(res.rate || 0.25, 10));
    } catch (err) {
      netState = 'offline';
      /* A BACKOFF LONGER THAN THE EXPIRY IS A DISCONNECT.
       *
       * This waited 8000 ms after any failure, and the server drops a presence row after 8.0 s. So a
       * SINGLE dropped tick — one timeout, one rate limit — guaranteed the other player lost you
       * entirely, and the rate then collapses to its lonely 0.25 Hz so it takes seconds more to
       * notice you came back. That is not a network problem, it is a backoff tuned past the cliff it
       * was meant to stay behind.
       *
       * Jittered growth from 1.2 s, capped at 5 s, so it stays inside the expiry window and a room
       * full of clients that all failed at once do not come back in lockstep. A 429 is not a dead
       * server, so honour Retry-After: the transport already attaches the status and nothing has
       * ever read it. */
      const status = err && err.status;
      netFails = status === 429 ? 1 : Math.min(netFails + 1, 4);
      const wait = status === 429 ? 1200 : Math.min(1200 * Math.pow(1.7, netFails - 1), 5000);
      nextTick = performance.now() + wait * (0.85 + Math.random() * 0.3);
    }
  }
  /* Presence must not live and die with requestAnimationFrame. Browsers pause rAF entirely for
   * a document that is not the visible tab — documented behaviour, not a tuning knob — so a
   * netTick() driven only from inside frame() lets a BACKGROUNDED window's presence row sit
   * untouched and expire 8 s later, which reads as "the other person can't see me" from
   * exactly the window that was not in front. docs/MULTIPLAYER.md's own recommended way to
   * test multiplayer solo is two windows on one machine, which guarantees one of them is
   * always in that position — this is the most likely concrete cause of "player 2 does not
   * see player 1 at all" (playtest report, two sessions ago's net-test.mjs only ever proved
   * the protocol symmetric under a script that ticks both sides in lockstep, never under two
   * independently-scheduled, differently-focused loops). netTick() already no-ops until its
   * own `nextTick` gate says a send is due, so driving it from an independent timer as well
   * costs nothing and keeps both windows live regardless of which one has focus. */
  setInterval(() => netTick(performance.now()), 250);

  /* ── the loop ────────────────────────────────────────────────────────── */
  let last = performance.now();
  let frames = 0;
  let fpsT = last;
  let fps = 0;
  let revealed = false;
  const dir = new Vector3();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    /* the fps half of the lag notice — only runs until its ~10 s window closes once, then
     * `perfMonitor` is dropped so this costs nothing for the other few thousand frames of the
     * session. `dt` is already the frame's real seconds; 1/dt is that frame's instant rate. */
    if (perfMonitor) {
      perfMonitor.sample(dt, dt > 0 ? 1 / dt : 60);
      if (perfMonitor.done) {
        if (perfMonitor.triggered) {
          perfNotice.show('This seems to be running slowly on your hardware — turning on hardware acceleration in your browser settings should help a lot.');
        }
        perfMonitor = null;
      }
    }

    /* input */
    const cmd = input.poll();

    /* THE GARAGE, AND THE PAD INSIDE IT.
     *
     * Operator: "add clear controler support and controls so u can open garage w reset to road".
     * Escape and M were bound inside ui/menu.js's own key listener, which is why a pad could never
     * open the one panel that explains the game. The binding lives in the action table now, so Start
     * reaches it by the same route every other control does — and while it is open, the pad drives
     * the panel itself (see Menu.padNav).
     *
     * Ordered BEFORE everything else in this block on purpose: whatever else is going on, the button
     * that opens the menu has to work. */
    /* Not while the cinematic is up: that press is the one that starts the game (see cine.skip
     * below), and consuming it here as well would open the Garage over the top of the first frame
     * the player ever sees. */
    if (!cine.active && input.tapped('garage')) menu.toggle();
    /* ESC = PAUSE = NO SOUND. Operator, verbatim: "esc = pause = no sound".
     *
     * Watched as a TRANSITION on `menu.open` rather than hooked onto the Escape key, because the
     * Garage has four ways in — Escape, the pad's Start, B, and the buttons that open it from a
     * showroom — and hanging the audio off one of them would leave the other three playing an
     * engine over a paused world. The world was already stopped here (`!menu.open` gates the car,
     * the boat, the fuel burn and the rest); only the sound kept going.
     *
     * The music window is told separately: the YouTube embed has its own audio path and the master
     * gain cannot reach it. */
    if (menu.open !== pausedWas) {
      pausedWas = menu.open;
      audio.setPaused(menu.open);
      musicPanel.setPaused(menu.open);
    }
    if (menu.open) menu.padNav(input.padNav());

    if (input.padLive !== padWas) {
      padWas = input.padLive;
      refreshOpenHint();
      if (input.padLive)
        hud.say(
          `controller ready — ${actionLabel('garage', 'pad')} opens the garage, ${actionLabel('reset', 'pad')} puts you back on the road`,
          5.5
        );
    }

    /* ── WALK IN, WALK OUT ───────────────────────────────────────────────────
     * The nearest hall the TILER ACTUALLY BUILT, not a re-derivation from the seed. That distinction
     * is the whole of the station-forgiveness bug: a pure world function said there was a station
     * here while the renderer's list said there was not, and the rule that read the wrong one looked
     * broken for a week. `props.halls` is what exists. */
    const hallNow = nearestBuiltHall(car.x, car.z);
    const atHall = !!hallNow && hallNow.dist < SHOWROOM_HALF_W + 26;
    if (atHall !== hallWas) {
      hallWas = atHall;
      if (atHall && !walker.active)
        hud.say(`a showroom — park up and press ${input.label('onFoot') || 'X'} to walk in`, 4.0);
    }
    if ((input.tapped('onFoot') || (input.tapped('buyHere') && !walker.active && atHall && !atDealer())) &&
        !plane.active && !boatMode.active && !auto.on && !menu.open) {
      if (walker.active) {
        // Back in the car, but only if you are standing beside it.
        if (walker.toCar <= ENTER_R) {
          walker.leave();
          hud.say('back in the car', 2.0);
        } else {
          hud.say(`your car is ${Math.round(walker.toCar)} m away`, 2.6);
        }
      } else if (atHall && Math.abs(car.speed || 0) < 3) {
        walker.enter(car, (x, z) => car.terrain.height(x, z));
        hud.say(`out of the car — walk in, ${input.label('onFoot') || 'X'} to get back in`, 4.2);
      } else if (atHall) {
        hud.say('stop the car first', 2.2);
      }
    }

    /* MANUAL GEARS. Operator: "Maual gear shift needs to eb added". The keys have existed since the
     * beginning (E/Right-Shift up, Q down) and were read by nothing; on a pad they are the shoulder
     * buttons. Asking for a gear latches the manual box — see vehicle.js. */
    if (input.tapped('shiftUp')) {
      car.wantShift = 1;
      hud.say(`gear ${Math.min(car.gear + 1, 6)} — manual`, 1.2);
    }
    if (input.tapped('shiftDown')) {
      car.wantShift = -1;
      hud.say(`gear ${Math.max(car.gear - 1, 1)} — manual`, 1.2);
    }

    if (input.tapped('camera')) hud.say(`camera: ${chase.cycle()}`, 1.6);
    if (input.tapped('reverse')) car.reverse = !car.reverse;
    if (input.tapped('nextCar')) {
      /* Cycle to the next car you can actually drive. Stepping onto a locked one and being
       * told no is not a control, it is a wall you have to press through. */
      const best = Math.max(bestStreak(), streak.state.best);
      const open = FLEET.filter((c) => isUnlocked(c, best, wallet)).map((c) => c.id);
      if (open.length < 2) {
        hud.say('one car so far — drive further to unlock more', 2.6);
      } else {
        const i = open.indexOf(carKeyLive);
        const k = open[(i + 1) % open.length];
        menu.setCurrent({ car: k });
        swapCar(k);
      }
    }
    if (input.tapped('horn')) audio.horn();
    /* N IS THE RADIO, AND THE RADIO IS THE YOUTUBE WINDOW. Operator: "radio does not work (changing
     * stations seems to do nothing) but it was never suppose to -- YT video was suppose to be that."
     *
     * It used to step a list of synthesised oscillator "stations" while the actual music came out of
     * a separate YouTube panel on J, so changing station did nothing you could hear. N now skips to
     * the next track in that window, which is what the control always meant. */
    if (input.tapped('radio')) {
      musicPanel.next();
      hud.say('next track', 1.6);
    }
    /* F: pour a spare can in. A can is a tank you carry — bought at a pump, used anywhere, which is
     * the one thing suns could not buy before and exactly what you want when the needle is on the
     * pin and the nearest station is 3 km back. */
    /* P: take off, or land. An airfield is where a plane starts from — that is what the 380 m strip
     * and the windsock are for — but the check is deliberately soft: the plane only needs somewhere
     * flat, so a long straight road works too, and refusing it there would be a rule with no reason
     * behind it. What IS enforced is the unlock: sea diamonds, or the pass. */
    /* CAN THE PLANE LEAVE THE GROUND FROM HERE? Within the strip's own half-length of an
     * airfield's centre, or with everything unlocked. AIRFIELD_HALF_LEN is the same 190 m the
     * "an airfield — P to take off" prompt already uses, so the message and the rule agree. */
    /* Is there a made surface under the wheels right now? `surface()` is the same query the car's
     * own solver reads for grip, so this cannot disagree with what the driver feels — asking a
     * second opinion about "is this tarmac" is how the road and the drivable road drifted apart
     * once already (see roadCamber's note in world/roads.js). */
    const onHardSurface = () => {
      const s = car.terrain.surface(car.x, car.z);
      if (s && s.onRoad > 0.5) return true;
      /* AN AIRSTRIP IS TARMAC TOO, and `surface()` does not know that — it answers about the ROAD
       * network, and a runway is not a road. Adding the tarmac rule for B56 therefore locked the
       * aeroplane out of the one place it is supposed to leave from, which is the opposite of what
       * that item asked for. Caught by F39's proof: ?fly=1 put the car on a strip and take-off was
       * refused with onRoad 0.00.
       *
       * The world's own airfield search rather than the renderer's baked list, for the same reason
       * ?fly=1 uses it — the baked list only knows tiles that have streamed. */
      const strip = worldNearestAirfield(car.x, car.z, SEED);
      return !!strip && Math.hypot(car.x - strip.x, car.z - strip.z) <= AIRFIELD_HALF_LEN;
    };
    const canTakeOffHere = () => {
      if (cheatOn()) return true;
      /* The WORLD's airfield search, not the renderer's baked-per-tile list. Same fault as the two
       * fixed beside this one: the baked list only knows tiles that have STREAMED, so standing on a
       * strip that has not been drawn yet — which is exactly what ?fly=1 does — read as "no airfield
       * anywhere" and refused the take-off. `worldNearestAirfield` is a pure function of position
       * and seed, so it answers the same way whether or not anything has been drawn. */
      const near = worldNearestAirfield(car.x, car.z, SEED);
      return !!near && Math.hypot(car.x - near.x, car.z - near.z) <= AIRFIELD_HALF_LEN;
    };
    if (input.tapped('fly')) {
      if (plane.active) {
        plane.stop();
        car.placeAt(plane.x, plane.z, plane.yaw);
        hud.say('back in the car', 2.4);
        planeWasStalling = false; // the next flight starts with a clean slate for the callout below
      } else if (!plane.unlocked) {
        hud.say(`the plane needs ${plane.gemsToGo} more diamond${plane.gemsToGo === 1 ? '' : 's'} away`, 3.4);
      } else if (!onHardSurface()) {
        /* AND THE WHEELS HAVE TO BE ON SOMETHING HARD. Operator: "You should also be required to
         * run this on tarmac in some way to take off. Right now I'm just running away through
         * trees in the forest and it seems to make no difference whatsoever."
         *
         * The airfield rule below is about WHERE you are; this is about WHAT IS UNDER YOU, and the
         * two are not the same — an airfield's own grass is inside the strip's radius. `?unlock=123`
         * deliberately does NOT bypass this one, unlike the airfield rule: the complaint was
         * precisely that a roll through a forest worked, and a cheat that unlocks the aeroplane is
         * not a cheat that makes soft ground hard. */
        hud.say('you need tarmac under the wheels to get airborne — find the strip or a road', 3.6);
      } else if (!canTakeOffHere()) {
        /* AN AEROPLANE LIVES AT AN AIRFIELD. Operator: "unlock /switch should require airport
         * (unless "all unlock" is on)".
         *
         * This deliberately overrides the softer rule that was here — the old comment argued the
         * plane only needs somewhere flat, so a long straight road should do. That made the 380 m
         * strip and its windsock decorative: there was never a reason to fly TO one. Now there is,
         * and the airfields become destinations rather than scenery.
         *
         * `?unlock=123` still bypasses it, because a cheat that unlocks everything and then makes
         * you drive to a runway anyway is not an unlock. */
        const far = props.nearestAirfield ? props.nearestAirfield(car.x, car.z) : null;
        hud.say(
          far ? `planes take off from airfields — nearest is ${(far.dist / 1000).toFixed(1)} km away` : 'planes take off from airfields — find one first',
          3.6
        );
      } else {
        plane.start(car, false);
        /* WHICH KEY RAISES THE NOSE. Operator: "control to point nose up unclear". Pitch is on
         * Shift and Ctrl (K and I still work — see car/input.js's KEYMAP), which nothing anywhere
         * said, so taking off consisted of holding the throttle and hoping. Said at the one moment
         * it is needed and nowhere else.
         *
         * MADE LOUDER a second time. Operator, later: "We should mention the flight controls when
         * you start flying" — asked as though the hint above did not exist, because in practice it
         * did not: six seconds of a slash-packed key legend ("Shift nose up · Ctrl nose down · A/D
         * bank") is exactly the kind of toast that is gone by the time a first-time flyer, busy
         * lining up a runway, looks down at it. Same hint, rewritten to survive a glance — full
         * words instead of a symbol legend, an opening clause that says WHAT is being explained
         * before it explains it — and left up half again as long, 9 s rather than 6, because reading
         * a sentence takes longer than skimming three key names. */
        const bank = input.device === 'pad' ? input.label('steer') : `${input.label('steerLeft')} / ${input.label('steerRight')}`;
        hud.say(
          `You're flying — ${input.label('pitchUp')} climbs, ${input.label('pitchDown')} dives, ${bank} banks left and right`,
          9.0
        );
      }
    }

    if (input.tapped('useCan')) {
      if (wallet.cans <= 0) {
        hud.say('no spare cans — buy one at a petrol station', 2.8);
      } else if (fuel.fraction > 0.92) {
        hud.say('the tank is already full', 2.2);
      } else if (wallet.useCan()) {
        fuel.fill(Math.min(1, fuel.fraction + 0.5));
        audio.pickup();
        hud.say(`can poured in — ${wallet.cans} left`, 2.8);
      }
    }
    if (input.tapped('autodrive')) hud.say(toggleAutoDrive() ? 'auto-drive on — sit back' : 'auto-drive off', 2.4);
    if (input.tapped('reset')) {
      car.manual = false; // R is the get-me-out key; it hands the automatic back too
      backToRoad();
    }
    // 'Give fuel' is not in car/input.js's KEYMAP (that file is out of scope this pass) — the
    // same raw, already-edge-triggered check the assist-preset keys just below use. KeyF:
    // free of every other binding, and reads naturally as favour/friend/fuel. See
    // game/fuel.js's tryGiveFuel() for the range check and the real transfer itself.
    if (input.pressed.has('KeyF')) fuel.tryGiveFuel(remotes.nearestDistance());
    for (const [key, name] of [
      ['Digit1', 'cruise'],
      ['Digit2', 'sport'],
      ['Digit3', 'off'],
      ['Digit4', 'hardcore'],
    ]) {
      if (input.pressed.has(key)) {
        car.setPreset(name);
        hud.say(`assists: ${name}`, 2);
      }
    }

    /* physics — frozen while the garage is open, so nobody comes back to a crashed car */
    car.terrain = localFor(car.x, car.z);
    const wasAuto = auto.on;
    const drive = auto.update(car, cmd, dt) || cmd;
    if (wasAuto && !auto.on) hud.say(auto.lastReason || 'auto-drive off', 2.2);
    /* Fuel burns first and then GATES the command, so the throttle the solver reads is
     * already limited. It goes after the autopilot on purpose — a self-driving car runs out
     * of fuel too — and it gates rather than mutating, so the autopilot's own record of what
     * it asked for stays intact. */
    /* `burn: !auto.on && !boatMode.active` — operator: auto-drive costs "no fuel"; and
     * docs/BOAT-PLAN.md: cozy sailing is free too. Only the burn is suppressed; cans, shares,
     * the station scan and the pumps all still work regardless of who (or what) has the wheel.
     * See game/fuel.js's update() for the whole reasoning. */
    if (!menu.open) fuel.update(dt, car, { burn: !auto.on && !boatMode.active });
    const gated = fuel.gate(drive);
    /* Boat mode runs INSTEAD of the car solver while active — src/game/boat.js is a small
     * arcade state machine, not a second physics engine, and it writes car.x/y/z/yaw/vx/vz
     * back itself so the camera, the net packets, the HUD speed and the trail keep working
     * without any of them knowing a boat exists. When it is NOT active, the ordinary solver
     * runs first, exactly as before, and boat.update() only has to decide whether this is the
     * frame to enter or whether the locked barrier needs to cushion the car — see that file's
     * own header for the whole state machine, including why `surf` is sampled here rather
     * than reused from a stale value. */
    const wasBoating = boatMode.active;
    // The car is PARKED while you are out of it. A car that rolls away while you are inside a
    // showroom is a bug wearing a feature's clothes.
    /* AND NOT WHILE FLYING. The plane sets `car.placeAt(plane.x, plane.z, ...)` every frame so the
     * two agree about where the player is — but the car solver was still running afterwards and
     * driving the car off on its own, so the car (and the chase camera bolted to it) stayed on the
     * runway while the aeroplane flew away. Measured: 199 m between the camera and the plane after
     * a seven-second climb. Same reasoning as `boatMode` and `walker` beside it — while another mode
     * owns the player, the car is a passenger. */
    if (!menu.open && !boatMode.active && !walker.active && !plane.active) car.update(dt, gated);
    if (!menu.open) boatMode.update(dt, car, car.terrain.surface(car.x, car.z), gated);
    if (!wasBoating && boatMode.active) audio.thump(0.4); // the splash — boat.js's own "Enter" note

    /* collisions — after the solver, before the camera, so the camera never chases a car
       that is momentarily inside a tree */
    const hit = solids.resolve(car, 1.05, dt);
    /* "OUCH" IS FOR CRASHES, NOT FOR SHRUBBERY. Operator: "i keep getting ouch when offroad -- stop
     * that happening."
     *
     * The bar was severity 0.35 at 9 km/h, which off the tarmac is simply DRIVING: the fields are
     * full of bushes and saplings and you brush one every few seconds, so the toast fired
     * continuously and the word stopped meaning anything. A real impact is both harder and faster,
     * and it also cannot happen twice in the same second — so there is a cooldown as well as a
     * higher bar. The streak still ends on the lighter hits; only the SHOUTING is gated. */
    ouchClock += dt;
    if (hit && hit.severity > 0.55 && hit.speed > 24 && ouchClock > 4) {
      ouchClock = 0;
      hud.say('ouch', 1.4);
    }
    if (hit && hit.severity > 0.35 && hit.speed > 9) {
      audio.thump(Math.min(1, (hit.severity * hit.speed) / 40));
      // A real impact ends the streak immediately — unless the car is driving itself, in which
      // case the streak is frozen and there is nothing to end. Same flag, same reasoning as the
      // scoring call below; passing it here too is what stops the two disagreeing.
      streak.update(2, car, { onRoad: 0 }, { paused: auto.on, forgive: nearPump() });
    }

    /* scoring */
    const surf = car.terrain.surface(car.x, car.z);
    /* Water. Reuses the surface record the streak has just been handed rather than sampling
     * the terrain again — the water table is a function of the same biome weights. Frozen
     * with the garage, like the physics, so nobody is rescued while they are shopping. */
    if (!menu.open) rescue.update(dt, car, surf);
    /* `paused: auto.on` — operator: auto-drive accrues "no streak". Frozen, not reset: see
     * game/streak.js's update() for why a chauffeured kilometre must not count AND must not
     * cost you the eighty you already have. */
    /* RUNNING OUT OF FUEL MUST NOT COST YOU THE RUN. Operator: "You still end your streaks when the
     * fuel tank is empty and you need to go to the gas station, it ends your driving streak."
     *
     * Nothing in streak.js was breaking on an empty tank directly — a stopped car simply stops
     * accruing. What ended the run was everything that HAPPENS when you run dry: the throttle fades
     * out, the car coasts, and a coasting car drifts off the carriageway; then you crawl onto a
     * forecourt at walking pace. Half a second off the tarmac at any point in that and eighty
     * kilometres are gone, for the crime of needing petrol.
     *
     * So the streak is FROZEN while the tank is dry and while you are actually refuelling — the same
     * freeze auto-drive uses, and for the same reason it uses it: this is not you leaving the road, so
     * it must not read as you leaving the road. It does not accrue either, so nobody can farm a
     * streak by sitting at a pump. */
    /* AND NOT WHILE FLYING. Operator: "You shouldn't show the red text when you are off-road with a
     * plane, because there isn't a road, right?" — right on both counts.
     *
     * The plane sets car.x/car.z to wherever it is in the sky (see the handover a little further
     * down), so the instant you take off `surf` above is sampled under the aeroplane rather than
     * under a car on a road — and it reads off-road almost everywhere, because there is no
     * carriageway 300 m up. Left ungated that is not merely the wrong colour on a HUD number: it is
     * streak.js's own off-road TIMER (`_off`, GRACE = 0.55 s), so a lot more than the "red text" was
     * about to break — every take-off would end the run 0.55 s later, the exact shape of bug the
     * fuel-dry freeze above already exists to prevent. Ungated it stayed only because flight came
     * after this gate was written. `hud.js`'s own red warning already reads `!s.paused` (ui/hud.js,
     * "the RED RING is a flash, not a state"), so freezing the streak here is the one change that
     * fixes the toast, the ring AND the streak-breaking bug in one place — this is not the player
     * leaving the road, it is the player leaving the road network entirely, on purpose, in a
     * vehicle that was never on one. */
    streak.update(dt, car, surf, {
      paused: auto.on || fuel.dry || fuel.refuelling || plane.active,
      forgive: nearPump(),
    });
    /* Tell the leaderboard whenever a run passes the best it already knows about. Deliberately
     * NOT hooked off streak.drain()'s 'break' event — ui/hud.js already owns that queue
     * exclusively (drain() is destructive, one shift() per call, so a second reader would
     * silently steal every other event and start dropping the HUD's own toasts). Watching the
     * plain `streak.best` number instead needs no queue and cannot collide with anything. Board's
     * own submitIfBetter() is already a no-op unless this genuinely beats the last thing it sent,
     * so `lastBoardBest` here is only a cheap guard against calling it every single frame. */
    if (streak.best > lastBoardBest) {
      lastBoardBest = streak.best;
      board.submitIfBetter(streak.best);
    }

    /* ── THE HINT THAT ARRIVES WHEN YOU NEED IT ──────────────────────────────
     * Operator: "KNOW how to do that and get hints at tirght times".
     *
     * The right time to be told how to get back on the road is when you have been off it long enough
     * to be looking for a way out. Not the instant a wheel touches grass — that happens on every
     * corner, on purpose, and a game that shouted about it would be unbearable. Not on the loading
     * screen either, which is where nobody reads anything.
     *
     * So: eight continuous seconds off the tarmac, said ONCE per excursion, naming the control on the
     * device in the player's hands. One second back on the road re-arms it, which is what makes it
     * once-per-excursion rather than once-per-session — get properly lost twice and you are told
     * twice, clip a verge twenty times and you are never told at all.
     *
     * Suppressed while auto-driving, in the air, on the water, and while the Garage is open: in every
     * one of those the player is not stuck, they are somewhere else. */
    const offNow = (surf?.onRoad ?? 1) < 0.02 && !auto.on && !plane.active && !boatMode.active && !menu.open;
    offRoadFor = offNow ? offRoadFor + dt : Math.max(0, offRoadFor - dt * 8);
    if (offRoadFor > 8 && !offRoadTold) {
      offRoadTold = true;
      hud.say(`lost? ${input.label('reset')} puts you back on the road`, 4.5);
    }
    if (offRoadFor <= 0) offRoadTold = false;
    /* THE STREAK IS THE INCOME. Operator: "Streaks = suns." One sun per 250 m of unbroken
     * run — mintStreak() is safe to call every frame and remembers what it has already paid
     * for, and it follows the distance back DOWN when a streak breaks, so a lost run is never
     * charged for and the next one starts paying from its own first metre. Verse pickups still
     * work; they are pocket change beside this, which is the right way round for a game about
     * driving. */
    const minted = wallet.mintStreak(streak.state.distance);
    if (minted > 0) audio.pickup();
    // The balance, top right, with a bump and a floating "+1" on a gain — see Hud.suns.
    hud.suns(dt, wallet, minted);

    /* Arriving at a dealership says so, once. A shop you can walk into and not notice is not a
     * shop — and ESC is the only way in, which is not something a player would guess. Latched
     * on the transition rather than the state so it cannot repeat while you are parked. */
    /* While the plane has it, the plane owns the pose and the car solver does not run — exactly the
     * arrangement game/boat.js already has. The car is parked underneath it and only moves again at
     * the handover above. */
    if (plane.active) {
      /* RAW STEER/THROTTLE, NOT THE CAR'S SCALED ONES. Shift and Ctrl now fly the aeroplane as
       * well as cruise-limiting the car (see car/input.js's KEYMAP and poll()) — cmd.steer and
       * cmd.throttle already have `fine`'s 45%-throttle cruise cap and `attack`'s 1.25x steering
       * baked in, which would mean holding Shift to climb also silently capped the climb. cmd's
       * own `steerRaw`/`throttleRaw` are the same stick BEFORE that scaling, kept for exactly this
       * handover. */
      plane.update(dt, {
        steer: cmd.steerRaw,
        pitch: cmd.pitchAxis ?? 0,
        throttle: cmd.throttleRaw,
        brake: cmd.brake,
      });
      /* ONE GENTLE LINE ON THE WAY IN, not a klaxon — this is a cozy game, not a warning system.
       * plane.state.stalling is already there for the taking; latched on planeWasStalling so it
       * says its piece once per stall entered rather than once per frame the wing is short. */
      const st = plane.state;
      if (st.stalling && !planeWasStalling) hud.say('stalling — nose down for speed', 2.6);
      planeWasStalling = st.stalling;
      car.placeAt(plane.x, plane.z, plane.yaw);
    }

    /* ARRIVING AT AN AIRFIELD. Operator: "when people drive to them (no road there) say -- 'I wonder
     * how you unlock planes'". Verbatim, because it is the whole hook: you find a runway in open
     * country with no road to it, and the game tells you there is something here you have not got yet
     * without telling you how — the answer is out at sea, which is what makes the boat worth having.
     *
     * Once you HAVE the plane it says something useful instead. Latched on the transition so it
     * cannot repeat while you are parked on the strip. */
    const airNow = props.nearestAirfield ? props.nearestAirfield(car.x, car.z) : null;
    const onStrip = !!airNow && airNow.dist <= 190;
    if (onStrip !== airfieldWas) {
      airfieldWas = onStrip;
      if (onStrip) {
        hud.say(
          plane.unlocked ? 'an airfield — P to take off' : 'I wonder how you unlock planes',
          plane.unlocked ? 3.2 : 4.2
        );
      }
    }

    stationClock += dt;
    const harbourNow = atHarbour();
    if (harbourNow !== harbourWas) {
      harbourWas = harbourNow;
      if (harbourNow) {
        hud.say(
          wallet.boat
            ? 'the harbour — B to take the boat out'
            : `harbour — ESC to buy the boat for ${BOAT_UNLOCK_SUNS} suns (you have ${wallet.suns})`,
          3.8
        );
      }
    }

    /* A CAR THAT ARRIVES ON ITS OWN HAS TO SAY SO. The first three cars open on TOTAL suns collected
     * (operator: "the first three cars be total collected") and `wallet.owns` decides that by live
     * comparison, which is robust but silent — a player would find the car only by opening the garage
     * for some other reason, which is the same as not getting it. So watch the earned tier and
     * announce the crossing once each.
     *
     * The set is seeded on the first pass rather than empty, so a returning player whose save already
     * clears the threshold is not told about three cars they have had for a week. */
    for (const c of EARNED_CARS) {
      if (earnedTold.has(c.id)) continue;
      if (!isUnlocked(c, 0, wallet)) continue;
      earnedTold.add(c.id);
      if (earnedSeeded) {
        hud.say(`${c.label} unlocked — ${c.earnAt} suns collected. ESC to drive it`, 4.2);
        audio.pickup();
      }
    }
    earnedSeeded = true;

    /* THE WALK STEP. Kinematic, over the same ground and against the same solids the car uses — see
     * game/walk.js. The car is frozen while you are out of it: it is parked, and a parked car that
     * rolls away while you are looking at a showroom is a bug, not a feature. */
    if (walker.active) {
      walker.update(dt, cmd, (x, z) => car.terrain.height(x, z), solids);
      /* A LEASH, because the world outside a showroom is 40 km wide and walking across it at 2.6 m/s
       * is not a game. Past it, the game simply walks you back — no failure state, no message that
       * blames you. */
      if (walker.toCar > LEASH) {
        walker.x = walker.carX;
        walker.z = walker.carZ;
        walker.y = car.terrain.height(walker.x, walker.z);
        hud.say('too far from the car — walked you back', 3.0);
      }

      /* BUYING INDOORS. The same act as the forecourt, at the hall's own bays: stand at a car, it
       * names itself, press the button. `hallSpots` is the one source of where those cars are — the
       * renderer draws from the same table, so the plaque you are reading and the car you buy cannot
       * be different cars. */
      const hall = hallNow && hallNow.dist < 90 ? hallNow : null;
      let near = null;
      if (hall) {
        const spots = hallSpots(hall);
        for (const sp of spots) {
          const d = Math.hypot(walker.x - sp.x, walker.z - sp.z);
          if (d <= HALL_REACH && (!near || d < near.d)) near = { d, spec: FLEET[sp.slot] };
        }
      }
      if (near && near.spec) {
        const spec = near.spec;
        const mine = isUnlocked(spec, 0, wallet);
        const price = priceOf(spec);
        const rule = unlockRule(spec);
        if (hallTold !== spec.id) {
          hallTold = spec.id;
          const key = input.label('buyHere');
          hud.say(
            mine
              ? `${spec.label} — yours. ${key} to make it your car`
              : rule.how === 'earn'
                ? `${spec.label} — opens at ${rule.at} suns collected. You have ${wallet.sunsEarned}`
                : `${spec.label} — ${price} suns. You have ${wallet.suns}. ${key} to buy`,
            4.0
          );
        }
        if (input.tapped('buyHere')) {
          if (mine) {
            hud.say(`${spec.label} it is`, 2.4);
            menu.setCurrent({ car: spec.id });
            swapCar(spec.id);
          } else if (rule.how === 'earn') {
            hud.say(`${spec.label} is not for sale — collect ${rule.at} suns`, 3.2);
          } else if (wallet.buyCar(spec.id, price)) {
            hud.say(`${spec.label} is yours — ${wallet.suns} suns left`, 3.4);
            audio.pickup();
            menu.setCurrent({ car: spec.id });
            swapCar(spec.id);
          } else {
            hud.say(`${spec.label} costs ${price} suns — you have ${wallet.suns}`, 3.2);
          }
        }
      } else {
        hallTold = null;
      }
    }

    /* The autosave. Slow on purpose — this is insurance against a crash or a flat battery, not the
     * mechanism; the real save happens on the way out. Six seconds costs nothing and bounds the
     * worst case to a few hundred metres of driving. */
    saveClock += dt;
    if (saveClock >= AUTOSAVE_S) {
      saveClock = 0;
      persist();
    }

    const dealerNow = atDealer();
    if (dealerNow !== dealerWas) {
      dealerWas = dealerNow;
      if (dealerNow) hud.say(`dealership — drive up to a car, or ${input.label('garage')} for the garage`, 3.6);
    }

    /* ── THE SHOWROOM: BUY THE CAR YOU ARE STANDING NEXT TO ──────────────────
     * Operator: "The dealership should have the other cars, you know, show room type situation where
     * they can see the different cars physically and choose them."
     *
     * The four cars are drawn on the apron at full size (render/props.js) from slots that live in
     * world/props.js, and this reads those SAME slots — so the plaque you are looking at and the car
     * you buy cannot be different cars. Nose up to one and it names itself and its price; press X and
     * it is yours and you are driving it.
     *
     * Only while stopped, deliberately: at speed the nearest slot changes every few frames and the
     * prompt would flicker through four cars as you drove past the row. */
    if (dealerNow && fuel.nearest && !plane.active && !boatMode.active) {
      const spots = showroomSpots(fuel.nearest);
      let near = null;
      for (const sp of spots) {
        const d = Math.hypot(car.x - sp.x, car.z - sp.z);
        if (d <= SHOWROOM_REACH && (!near || d < near.d)) near = { d, spec: DEALER_CARS[sp.slot] };
      }
      const slow = Math.abs(car.speed || 0) < 6;
      if (near && near.spec && slow) {
        const spec = near.spec;
        const mine = isUnlocked(spec, 0, wallet);
        const price = priceOf(spec);
        if (showroomTold !== spec.id) {
          showroomTold = spec.id;
          /* NAME THE BUTTON THE PLAYER ACTUALLY HAS. "X to buy" is a key on a keyboard and a face
           * button on a pad, and here they happen to be the same letter — but `input.label` is what
           * makes that a fact rather than a coincidence, and it is what keeps every other prompt in
           * this file honest when the two devices disagree. */
          const key = input.label('buyHere');
          hud.say(
            mine
              ? `${spec.label} — yours already. ${key} to drive it`
              : `${spec.label} — ${price} suns. You have ${wallet.suns}. ${key} to buy`,
            4.0
          );
        }
        if (input.tapped('buyHere')) {
          if (mine) {
            hud.say(`${spec.label} it is`, 2.4);
            swapCar(spec.id);
          } else if (wallet.buyCar(spec.id, price)) {
            hud.say(`${spec.label} is yours — ${wallet.suns} suns left`, 3.4);
            audio.pickup();
            menu.setCurrent({ car: spec.id });
            swapCar(spec.id);
          } else {
            hud.say(`${spec.label} costs ${price} suns — you have ${wallet.suns}`, 3.2);
          }
        }
      } else if (!near) {
        showroomTold = null;
      }
    } else if (showroomTold) {
      showroomTold = null;
    }
    helper.update(dt); // the fuel cloud's own little arc — see render/helper.js
    trail.update(dt, car, streak.state); // no-op — see the retirement note by `new StreakTrail` above
    /* Dust off the back wheels once you are off the carriageway. After the solver so it reads
     * this frame's real speed and slip, and after the collision resolve so a car that has just
     * been pushed out of a tree does not spray from where it briefly was. Frozen with the
     * physics while the garage is open, like everything else that moves.
     *
     * While boating, the SAME emitter throws a modest wake instead (playtest report: "no wake
     * at speed") — `opts.wake` switches spray.js's own formula (see that file's own note), and
     * `groundAt` switches from the lake BED (car.terrain.height, metres below the surface) to
     * the water's own surface height: car.y already IS that surface plus boat.js's own bob
     * while afloat, so a wake droplet lands on the water rather than falling through it. */
    if (!menu.open) {
      spray.update(
        dt, car, surf,
        boatMode.active ? () => car.y : (x, z) => car.terrain.height(x, z),
        boatMode.active ? { wake: true } : null
      );
    }

    /* place the model — the car, or, while boat.js has the wheel, the boat. Exactly one of
     * the two is ever visible; the other's transform is simply not touched this frame, which
     * is cheaper than hiding-and-showing an idle mesh and leaves it wherever it last was. */
    if (plane.active) {
      /* IN THE AIR THE PLANE IS THE BODY. All three angles, and the real height — which is the whole
       * of what was missing. The plane's own frame is the same forward-is-+Z convention every
       * vehicle here uses, so the yaw goes straight on. */
      model.group.visible = false;
      boatMesh.visible = false;
      planeMesh.visible = true;
      planeMesh.position.set(plane.x, plane.y, plane.z);
      /* THE MODEL AND THE FLIGHT PATH DISAGREED. Operator: "When you push k, you look up and you go
       * up, but the plane looks down. When you push i, the plane looks up and you go down" — and,
       * separately, "the plane goes left, or it looks left, but goes right".
       *
       * Both are the same mistake, made twice. The aeroplane is modelled nose along +Z, and in a
       * right-handed Y-up system a POSITIVE rotation about X carries +Z towards -Y: the nose goes
       * DOWN. The flight model means the opposite by a positive pitch — `ny = sin(pitch)`, so
       * positive pitch is climbing. Feeding one straight into the other drew an aeroplane pointing
       * at the ground while it gained height. Bank is the same story about Z.
       *
       * Yaw is left alone: the pose convention here is forward = (sin yaw, cos yaw), and rotating a
       * +Z nose about Y by that angle lands on exactly that vector, which is why the CAR — same
       * convention, same mapping — has never had this problem.
       *
       * Reasoning about handedness is how this got backwards; the signs below are now measured.
       * See the B54 note on the rotation.set line itself for the numbers that settled it. */
      /* ROLL IS NEGATED, EXACTLY LIKE PITCH — and the comment that used to argue otherwise made
       * the one mistake this line keeps inviting: it put the right wing on +X. Face along +Z in a
       * right-handed Y-up frame and your right hand is on -X (rotate +Z by -90 about Y and land on
       * (-1,0,0) — the same arithmetic that makes the car's yaw work). So a positive rotation
       * about Z, which carries +X towards +Y, lifts the LEFT wing: that is a bank to the RIGHT on
       * screen. The model means a bank to the LEFT by a positive roll — bench-plane's measured
       * convention, +roll yaws the nose left — so the mesh takes the NEGATED model roll, the same
       * way it already takes the negated pitch.
       *
       * The empirical anchor, so nobody re-argues this from handedness again. Operator, 4 Aug,
       * on the live build carrying `plane.roll` unnegated: "when i go left on the stick, the
       * plane tilts to the right instead of the left, but it goes to the left." Motion correct,
       * picture mirrored — which is precisely this line and only this line. The earlier B54 film
       * that seemed to show the opposite was shot while B78's bug still rolled the CAMERA with
       * the plane, and a camera that rolls by +phi paints the world as if the plane rolled by
       * -phi: the one instrument used to judge the sign was itself inverted. That fix landed
       * first; this sign is judged against a level horizon. tools/diag-plane-view.mjs now asserts
       * the SCREEN truth — wingtip pixels, not pose numbers — so the next argument is with a
       * photograph. */
      planeMesh.rotation.set(-plane.pitch, plane.yaw, -plane.roll, 'YXZ');
      /* THE PROPELLER, ACTUALLY TURNING. Operator: "the propeller doesn't move." render/plane.js's
       * buildPropDisc() explains the render half (a blurred disc, not a faster cross); this is the
       * per-frame half. There is no rpm anywhere in this flight model — see game/plane.js, throttle
       * is the only number there is — so the rate is a plausible one rather than a measured one:
       * fast enough at idle (6 rad/s, just under a full turn a second) that the disc is visibly
       * live the moment you take off, and fast enough at full throttle (52 rad/s, over eight turns
       * a second) that the two-lobe shading (buildPropDisc's own cosine wash) blurs into an even
       * disc rather than reading as two blades going round. `% TAU` keeps the accumulator bounded
       * across a flight that runs on for a while, rather than letting a float creep out of the
       * precision a rotation needs. */
      propSpin = (propSpin + dt * (6 + plane.throttle * 46)) % TAU;
      planeMesh.userData.prop.rotation.z = propSpin;
    } else if (boatMode.active) {
      planeMesh.visible = false;
      model.group.visible = false;
      boatMesh.visible = true;
      // car.y is already the water surface plus boat.js's own bob (see its _stepActive) — no
      // ride-height offset here, unlike the car below: a hull's local origin sits AT the
      // waterline (render/ships.js's addHull() comment), a car's does not.
      boatMesh.position.set(car.x, car.y, car.z);
      boatMesh.rotation.set(0, car.yaw, boatMode.roll);
    } else {
      planeMesh.visible = false;
      boatMesh.visible = false;
      model.group.visible = true;
      /* car.roll and car.pitch are the whole body attitude now — the ground under the four
         wheels, the springs, and a rollover — so nothing gets added on top of them here. This
         line used to add 60% of a second, oppositely-signed ground sample, which pitched the
         nose into every hill it climbed. */
      /* Ride height, not rest length. car.y is the sprung body; the springs sit car.sag
       * (~0.1 m at steady state) below their rest length under the car's own weight, and using
       * the raw restLength here is what sank the tyres into the road by exactly that much. */
      model.group.position.set(car.x, car.y - 0.36 + (car.sag || 0), car.z);
      model.group.rotation.set(0, car.yaw, 0);
      model.setBodyRoll(car.roll, car.pitch);
      model.setSteer(car.steerAngle || 0);
      model.setWheelSpin(car.wheelSpin);
      model.setBrakeGlow(car.brake);
    }

    /* camera — the cinematic borrows it, and only it. Any key, button, tap or stick ends the
       borrow; cine.skip() is idempotent, and the cinematic has its own DOM listeners so this
       line is really only here for the gamepad, which nothing else can see. */
    let sNorm = 0;
    if (cine.active) {
      /* A PAD BUTTON HAS TO SKIP IT TOO, and it did not.
       *
       * This line read the pad only through the DRIVING axes — throttle, brake, steer — so a
       * controller player who pressed the natural first button (Start, or A) sat there watching the
       * title card with nothing happening. Found by photographing the Garage from a synthetic pad and
       * getting a picture of the intro instead: the Start press had gone nowhere, because the game
       * had not begun. `padPressed` is every button, so now any of them does what the card says. */
      if (
        input.pressed.size ||
        input.padPressed.size ||
        cmd.throttle > 0.05 ||
        cmd.brake > 0.05 ||
        Math.abs(cmd.steer) > 0.05
      )
        cine.skip();
      cine.update(dt, car);
    }
    /* THE CAMERA ON FOOT.
     *
     * The chase camera takes anything with x/z/yaw/speed, so walking gets the SAME camera the car
     * uses rather than a second one to tune — it just follows a different thing. That is worth more
     * than a bespoke first-person view: the framing, the terrain-aware height and the easing are
     * already right, and a mode that looks like the rest of the game is the point.
     *
     * `EYE` is added to the target height so the camera is looking at a head rather than at a pair
     * of shoes, and the drift flag is off because a walker has no drift to show. */
    if (!cine.active) {
      const subject = walker.active
        ? { x: walker.x, z: walker.z, yaw: walker.yaw, speed: walker.speed, terrain: car.terrain }
        : car;
      if (walker.active) {
        /* ON FOOT THE CAMERA IS FIRST-PERSON, and that is not a style choice — it is the only view
         * that works indoors. The chase rig sits 8 m behind its subject and knows nothing about
         * walls, so the moment you step into a showroom it ends up outside the building or buried in
         * the floor slab. Photographed: the first interior shot was a screenful of terrain from a
         * camera under the ground.
         *
         * A head is also the right place to look at a car from. The chase camera stays exactly as it
         * is for driving; this branch simply does not use it. */
        camera.position.set(walker.x, walker.y + EYE, walker.z);
        camera.lookAt(
          walker.x + Math.sin(walker.yaw) * 10,
          walker.y + EYE - 0.8,
          walker.z + Math.cos(walker.yaw) * 10
        );
        sNorm = 0;
      } else if (plane.active) {
        /* THE AIR CAMERA IS SET DIRECTLY, not through the chase rig.
         *
         * The rig was tried first and would not take an aeroplane. Instrumented: the branch ran for
         * 436 frames while the camera sat at the spawn point 193 m behind the plane, with every
         * field it reads supplied. It carries smoothing and terrain-clamping tuned around a car that
         * never leaves the ground, and an aircraft climbing away at 22 m/s is simply not that.
         *
         * So flying gets its own three lines, the same stance walk mode takes: sit behind and above
         * the aircraft in its OWN frame — so a bank rolls the horizon, which is most of what makes
         * flying feel like flying — and look slightly ahead of it. */
        const cy = Math.cos(plane.yaw);
        const sy = Math.sin(plane.yaw);
        /* THE CAMERA FOLLOWS THE FLIGHT PATH, NOT THE COMPASS HEADING. B67, the operator: "the
         * camera also gets stuck above the airplane when going up... the plane should remain in
         * frame rather than falling out of frame."
         *
         * Two faults, and the second is the one that empties the frame. The offset was purely
         * HORIZONTAL — 24 m back along the heading, 7 m up — so a climbing aeroplane rose while
         * the camera stayed level behind it. And the look-at target used `plane.pitch * 30` as if
         * pitch were a gradient, when it is an ANGLE IN RADIANS: at the 63 degrees a held climb
         * reaches, that is 1.1 * 30 = 33 m above the aeroplane, so the camera aimed a full 33 m
         * over its own subject's head. Filmed three times at three pitch rates while trying to
         * shoot B53, and every clip is empty sky.
         *
         * So the offset now runs back along the FORWARD VECTOR, pitch included — behind and below
         * in a climb, behind and above in a dive — and the target is the aeroplane's own nose a
         * short way ahead, on the same vector. It cannot aim past its subject because the subject
         * is on the line it is aiming down. */
        const cp = Math.cos(plane.pitch);
        const sp = Math.sin(plane.pitch);
        const back = 24;
        const up = 7;
        camera.position.set(
          plane.x - sy * cp * back,
          plane.y - sp * back + up,
          plane.z - cy * cp * back,
        );
        /* THE CAMERA DOES NOT ROLL WITH THE AEROPLANE, and this line is why "left goes left but
         * looks like going right" kept coming back after the mesh signs were fixed twice.
         *
         * It used to set the camera's up vector to the aeroplane's own banked up. Do that and the
         * aircraft is drawn at the same angle as the frame, so the WING never appears to move —
         * what tilts instead is the whole world, and it tilts the OPPOSITE way, because rolling
         * the camera by +roll rotates everything in view by -roll. Filmed on the live beta holding
         * A for 3.7 s, and every number underneath was already right:
         *
         *   model roll   +75.2 deg   (positive = banked left)
         *   MESH z       +75.2 deg   (right wing up, which IS a left bank — verified against
         *                             three.js by rotating a +X wingtip and reading its world Y)
         *   heading      +17.1 deg   (positive = LEFT, the car's convention)
         *
         * — and the clip still shows an aeroplane sitting level in a sky rolled hard the other
         * way. Three fixes had gone into the mesh signs chasing a fault that was never in them.
         *
         * So the horizon stays put and the AEROPLANE banks against it, which is what a chase
         * camera in every flying game does and the only version where the wing tells the truth. */
        camera.up.copy(UP_Y);
        camera.lookAt(plane.x + sy * cp * 14, plane.y + sp * 14, plane.z + cy * cp * 14);
        sNorm = Math.min(1, Math.hypot(plane.vx, plane.vz) / 90);
      } else {
        sNorm = chase.update(subject, dt, (x, z) => car.terrain.height(x, z), { drift: auto.on });
      }
    }

    /* shared uniforms */
    U.uTime.value = now / 1000;
    U.uCamPos.value.copy(camera.position);
    camera.getWorldDirection(dir);
    U.uCull.value.set(dir.x, dir.z, Math.cos(1.15), 0);

    /* ── INSIDE A SHOWROOM, THE WORLD STOPS BEING BUILT ──────────────────────
     * F17, his own suggestion: a walk-in showroom is effectively an INTERIOR LEVEL, so the open
     * world should not go on costing frame time while you are standing in one looking at cars.
     *
     * The condition is deliberately narrow — ON FOOT and inside the hall's own footprint, not
     * merely near it. Walking the forecourt still streams normally, because from out there you can
     * see the countryside and it has to keep arriving; from INSIDE, with four walls around you, the
     * only thing the streamer and the prop tiler can do is spend milliseconds on tiles nobody can
     * see. Everything else in the frame keeps running: the grass and flora already have their own
     * distance culls, the car is parked, and pausing the RENDERER rather than the two BUILDERS
     * would freeze the picture you walked in to look at.
     *
     * It restores on the frame you step back out, and there is nothing to undo: both are pull-based
     * (`update(x, z)` decides what it wants from where you are), so a resumed streamer simply asks
     * for the tiles it wants now. That is also why this is a guard on the call rather than a paused
     * flag inside either class — no new state can get stuck on. */
    /* THE WALKER'S OWN POSITION, not the car's. `hallNow` above is measured from the CAR, which is
     * parked outside on the forecourt the whole time you are indoors — reading its distance here
     * would have paused the world while you stood at the door and never while you stood inside. */
    const insideHall = (() => {
      if (!walker.active || !hallNow) return false;
      const dx = walker.x - hallNow.x;
      const dz = walker.z - hallNow.z;
      const ca = Math.cos(hallNow.yaw || 0);
      const sa = Math.sin(hallNow.yaw || 0);
      return Math.abs(dx * ca + dz * sa) <= SHOWROOM_HALF_W && Math.abs(-dx * sa + dz * ca) <= SHOWROOM_HALF_D;
    })();
    /* world */
    if (!insideHall) streamer.update(car.x, car.z);
    roads.update(car.x, car.z);
    wind.update(dt, camera.position);
    grass.update(car.x, car.z, car.y, dt);
    clouds.update(dt, camera.position);
    water.update(dt, camera.position);
    flora.update(dt, camera.position);
    if (!insideHall) props.update(dt, car.x, car.z);
    ships.update(dt, car.x, car.z);
    /* Loot: suns along the road, gems on open water — src/render/loot.js. `boatMode.active`
     * replaces workstream B's own `const boatActive = false` placeholder now that
     * src/game/boat.js exists — see docs/BOAT-PLAN.md's deviations log (workstream B entry)
     * for why that was the honest interim behaviour rather than a fake unlock. */
    loot.update(dt, car, boatMode.active);
    ramps.update(dt, car);
    /* SALVAGE CRATES — the off-road goodies. Operator: "there should be special off-road goodies
     * that you can get." Worth CRATE_VALUE suns each rather than a currency of their own: a second
     * scoreboard for the same act of picking something up is a worse game, not a richer one, and
     * world/loot.js's own note has the sizing against the unlock rungs. Folded into the sun gain so
     * every downstream consumer — the wallet, the counter, the achievements — needs no new path. */
    const gainedCrates = loot.drainCrates();
    const gainedSuns = loot.drainSuns() + gainedCrates * CRATE_VALUE;
    if (gainedSuns) {
      wallet.addSuns(gainedSuns);
      audio.sun();
    }
    const gainedGems = loot.drainGems();
    if (gainedGems) {
      wallet.addGems(gainedGems);
      audio.gem();
      hud.say(`a diamond! ${wallet.gems}`, 1.6);
    }
    const walletEvent = wallet.drain();
    if (walletEvent && walletEvent.kind === 'boat-unlock') {
      audio.chime();
      hud.say('the boat is yours — drive into the water', 4);
    }
    wallet.update(dt);
    birds.update(dt, car.x, car.z);
    save.markVisited(car.x, car.z);

    /* net */
    // netTick() runs off its own setInterval now, not this rAF-driven loop — see the note
    // above where it is registered. remotes.update() stays here: it is the visual
    // interpolation of ghosts already ingested, which is a rendering concern and belongs
    // exactly where every other per-frame visual update lives.
    /* Date.now(), NOT the frame's `now`. The frame timestamp comes from requestAnimationFrame and
     * is measured from page load; remotes needs the same wall clock the snapshots are stamped with.
     * Passing the wrong one pinned every ghost to its oldest snapshot — see remotes.update. */
    remotes.update(dt, Date.now());

    /* audio + post cues */
    /* THE ENGINE NOTE WHILE FLYING. Operator: "There is no sound and the propeller doesn't move."
     * update(dt, car) reads car.rpm/car.spec/car.throttle, none of which move while the plane has
     * the wheel — the car's own solver is frozen the instant you take off (see car.update(dt,
     * gated)'s own guard earlier in this loop) — so the note a player heard in the air used to be
     * whatever the car was doing the moment before take-off, held there for as long as the flight
     * lasted. updateFlight() is the plane's own branch of the same synthesised graph; see
     * audio/engine.js for why it costs no new nodes. */
    if (plane.active) audio.updateFlight(dt, plane, car);
    else audio.update(dt, car);
    post.speed = sNorm;
    post.limit = car.limit;

    // THE SPEEDOMETER, WHILE FLYING. Operator: "the speedometer also is non-functioning." car.kph
    // is a held-stale number up here — the car solver is frozen the instant the plane takes the
    // wheel (see the plane.active guard earlier in this loop) — so the HUD gets the aeroplane's
    // own reading instead, and only while it is the thing actually moving.
    hud.update(dt, {
      car, streak, surface: surf, remotes, netState, myName: me.name, wallet, auto,
      flightKph: plane.active ? plane.kph : null,
    });
    fuelGauge.update(dt, fuel, car);
    lootCounter.update(dt, wallet);
    post.render(scene, camera);
    input.endFrame();

    frames++;
    if (now - fpsT > 500) {
      fps = (frames * 1000) / (now - fpsT);
      frames = 0;
      fpsT = now;
      if (dbg) {
        const s = streamer.stats;
        dbg.textContent =
          `fps ${fps.toFixed(0)}  live ${s.live}  queue ${s.queued}  built ${s.built}  wk ${s.workers}\n` +
          `pos ${car.x.toFixed(0)}, ${car.z.toFixed(0)}  ${car.kph.toFixed(0)} km/h  g${car.gear}  slip ${((car.slip * 180) / Math.PI).toFixed(0)}°  limit ${car.limit.toFixed(2)}\n` +
          `road ${surf.onRoad.toFixed(2)}  wheel ${car.onRoadMin.toFixed(2)}  grip ${surf.grip.toFixed(2)}  ${BIOME_SHORT[surf.dominant]}  solids ${solids.count}\n` +
          `calls ${renderer.info.render.calls}  tris ${(renderer.info.render.triangles / 1000) | 0}k  net ${netState}  peers ${remotes.count}`;
      }
    }

    if (!revealed && streamer.stats.live > 14) {
      revealed = true;
      setStat('go anywhere.', 1);
      setTimeout(() => {
        $('#veil').classList.add('gone');
        $('#hud').hidden = false;
        /* Start the opening here, on the same tick the veil begins its 1.4 s fade, so the
         * first shot arrives THROUGH that fade rather than cutting in behind it. The `hidden`
         * line above is untouched on purpose — the cinematic dims the HUD with opacity and
         * never touches the attribute, so the one path that makes this game playable stays
         * exactly as it was. */
        cine.begin();
        if (CFG.feel !== 'road' || CFG.terrain !== 'rolling') {
          /* CAR.label, not FEEL.label. `FEEL` is applyCarFeel()'s return value, which is
           * `car.feel` — the handling numbers (comfortG, buildRate, rearGrip, brakeMul,
           * offRoad) and nothing else. It has never had a `label`, so this toast has been
           * printing the literal string "undefined · Meadow" across the top of the screen
           * on every start that is not the default car AND default land. The name lives on
           * the fleet entry, which is what `CAR` is. */
          hud.say(`${CAR.label} · ${LAND.label}`, 4.5);
        }
      }, 500);
    }
  }
  requestAnimationFrame(frame);

  // for the console, and for tools/shoot.mjs
  window.THREE = THREE_NS; // debug/telemetry only — the game never reads it
  /* ?fly=1 — ON A RUNWAY, READY TO ROLL. Operator: "for later: make it easy to test plane".
   *
   * Testing flight used to mean earning sea diamonds or knowing the unlock URL, then finding an
   * airfield, which the 2 Aug gate made mandatory. That is a ten-minute errand before the thing
   * you actually wanted to look at.
   *
   * This does NOT bypass the gate — it satisfies it. The plane is unlocked, the car is put on the
   * nearest airfield's strip facing along it, and that is all: you still press P, the airfield
   * check still runs and passes because you are genuinely standing on a runway, and the tarmac
   * check passes because a strip is tarmac. A flag that flew you regardless would test a code path
   * no player ever takes; this one leaves the player's own path intact and just walks you to the
   * start of it. */
  if (params.get('fly')) {
    /* DEFERRED, because airfields are BAKED PER TILE and there are none at boot. The first version
     * of this ran inline and reported "no airfield found" while standing on the spawn road: props
     * had not streamed yet, so `nearestAirfield` had nothing to answer with. It polls instead, and
     * gives up out loud rather than silently doing nothing. */
    let tries = 0;
    const toStrip = () => {
      /* The WORLD's own airfield search, not the renderer's baked-tile one. The baked list only
       * knows tiles that have streamed, and at spawn there are none within its reach — the poll
       * below ran forty times against an empty list before this was noticed. world/props.js's
       * `nearestAirfield` is a pure function of position and seed with a 12 km radius, so it can
       * answer before anything has been drawn. */
      const strip = worldNearestAirfield(car.x, car.z, SEED);
      if (strip) {
        wallet.unlockPlaneWithPass(PLANE_PASS, PLANE_PASS);
        car.placeAt(strip.x, strip.z, strip.yaw ?? 0);
        car.vx = car.vy = car.vz = 0;
        car.gear = 1;
        hud.say('on the strip — hold W, then P to fly', 5);
        return;
      }
      if (++tries < 40) setTimeout(toStrip, 250);
      else hud.say('no airfield streamed in to start from', 4);
    };
    setTimeout(toStrip, 250);
  }

  window.WANDEROAD = {
    /* The seed this world was grown from. Exposed because several diagnostics have to ask the
     * PURE world functions about the same plane the page is showing — the renderer only knows
     * the tiles it has streamed, so its answer to "is there a dealership near me" is about
     * loading, not about the world. See tools/diag-suns.mjs. */
    seed: SEED,
    renderer,
    scene,
    camera,
    streamer,
    car,
    model,
    chase,
    cine,
    streak,
    auto,
    trail,
    fleet: FLEET,
    /* The kickers, for the same reason `flora` and `props` are here: "is there a jump near me, and
     * did I actually clear it" can only be answered against the ramps the world really placed, not
     * against a second opinion. tools/shot-car.mjs and the proof manifests park the car at one of
     * these before filming. Telemetry only; the game never reads window.WANDEROAD. */
    ramps,
    rampsNear: (x, z, r = 900) => rampsInBox(x - r, z - r, x + r, z + r, SEED),
    /* The salvage crates the WORLD placed, which is not the same question as which crates the
     * renderer has streamed in — a proof clip has to be able to drive to one that exists rather than
     * to one that happens to be loaded. Same read-only stance as everything else on this object. */
    cratesNear: (x, z, r = 900) => {
      const out = [];
      for (let gj = Math.floor((z - r) / CRATE_TILE); gj <= Math.floor((z + r) / CRATE_TILE); gj++)
        for (let gi = Math.floor((x - r) / CRATE_TILE); gi <= Math.floor((x + r) / CRATE_TILE); gi++) {
          const c = cratesForTile(gi, gj, SEED);
          if (c) out.push(c);
        }
      out.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
      return out;
    },
    /* The audio graph, for the same reason `flora` and `props` are here: "is the music
     * playing, and how loud" can only be answered honestly by reading the gain node that is
     * actually in the graph, not by trusting a flag. See tools/diag-radio.mjs. */
    audio,
    /* The money, for the same reason `audio` is here: "did that streak pay" can only be
     * answered by reading the wallet that the game is actually spending from. See
     * tools/diag-suns.mjs. */
    wallet,
    solids,
    // `flora` is here so a test can reconcile the colliders against the trees the renderer
    // ACTUALLY DREW rather than against a second opinion about what should be there.
    flora,
    remotes,
    transport,
    netInfo: () => netState,
    /* How many ghosts got their real GLB versus the procedural stand-in. Exposed because
     * "the ghost is the wrong car" can only be answered with a count of models that actually
     * loaded — see src/net/ghostCar.js. */
    ghostStats,
    post,
    props,
    ships,
    /* Same reasoning as `props`/`ships`/`spray` just above and below: the honest answer to
     * "how much loot exists right now" is loot.stats, live counts of what the renderer
     * actually built, not a re-derivation. */
    loot,
    wallet,
    /* `boatMode`/`boatMesh` so a browser check can read `boatMode.active` and the mesh's own
     * `.visible` directly, the same "the live renderer, not a re-derivation" reasoning as
     * `ships`/`loot`/`spray` above and below. */
    boatMode,
    boatMesh,
    /* `birds` is exposed for the same reason `flora` and `ships` are: the only honest answer
     * to "are there seagulls" is a live count of the ones the renderer ACTUALLY DREW this
     * frame, which is birds.stats.drawn — not a flag, and not the number that exist. */
    birds,
    fuel,
    /* The GAUGE as well as the tank. "Does the distance-to-pumps flash amber as the tank passes a
     * meter point" cannot be answered from `fuel` — the tank knows how much is left, and the
     * warning lives in the widget that draws it (`lastMark`, `markFlashCount`, and the `mark`
     * class on the readout). Same rule as `flora` and `spray`: ask the thing that actually did it.
     * Telemetry only; the game never reads window.WANDEROAD. */
    fuelGauge,
    /* The music window, because "N is the radio and the radio is the YouTube window" is a claim
     * about a control reaching a surface, and the only honest way to check it is to press N and
     * ask the WINDOW whether it was told to skip. See tools/diag-radio.mjs and B25. */
    musicPanel,
    /* The one water-height function this game has, so a diagnostic can ask where the SEA SURFACE is
     * at a point — `surface()` hands back the biome weights and the ground, and turning those into a
     * water height is `waterLevelAt`'s job. Exposed for the same reason `deadEnds` is: a probe that
     * has to re-derive this ends up inventing a helper that does not exist, which is exactly how the
     * first B66 clip came back empty. Telemetry only. */
    seaLevelAt: (x, z) => {
      const s = car.terrain.surface(x, z);
      return s && s.w ? waterLevelAt(s.w, s.y) : null;
    },
    /* Roads that STOP, as the world itself decides it — [{x, z, edge}], derived from the streamed
     * edge list with roads.js's own rule rather than a re-derivation. See the import note. */
    deadEnds: () => {
      const out = [];
      for (const e of car.terrain.roads.edges) {
        const dead = edgeDeadEnds(e, SEED);
        const n = e.pts.length;
        if (dead[0]) out.push({ x: e.pts[0], z: e.pts[1], into: [e.pts[2], e.pts[3]], key: e.key });
        if (dead[1]) out.push({ x: e.pts[n - 2], z: e.pts[n - 1], into: [e.pts[n - 4], e.pts[n - 3]], key: e.key });
      }
      return out;
    },
    /* The aeroplane, so a diagnostic can ask whether it is flying and how high — the same reason
     * every other live object is on this handle. */
    plane,
    /* The live plane MESH, same reasoning as `boatMesh` above: a diagnostic asking whether the
     * propeller is actually turning needs `planeMesh.userData.prop.rotation.z` off the object the
     * frame loop is really spinning, not a re-derivation from `plane.throttle`. */
    planeMesh,
    /* The walker, for the same reason `wallet` and `props` are here: the only honest answer to "am I
     * out of the car" is the object the frame loop is actually stepping. See tools/diag-walkin.mjs. */
    walker,
    /* Here so a browser check can read the off-road dust cue's own live counts (`spray.count`,
     * `spray.spawned`) at a real coordinate instead of trying to infer an emitter's existence
     * from a scene census — which is exactly how the last audit had to establish it did not
     * exist at all. Telemetry only; the game never reads window.WANDEROAD. */
    spray,
    SEED,
    stats: () => streamer.stats,
    fps: () => fps,
    // headless driving: feed the game synthetic input for N seconds
    drive: (opts) => Object.assign(window.WANDEROAD._auto || (window.WANDEROAD._auto = {}), opts),
  };
}

boot().catch((e) => {
  console.error(e);
  setStat(`boot failed: ${e.message}`);
});
