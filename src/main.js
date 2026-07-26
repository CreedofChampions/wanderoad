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

import { WebGLRenderer, Scene, PerspectiveCamera, Vector3, SRGBColorSpace } from 'three';
import * as THREE_NS from 'three';
import { createSky } from './render/sky.js';
import { createTerrainMaterial } from './render/terrainMaterial.js';
import { Post } from './render/post.js';
import { Water } from './render/water.js';
import { Clouds } from './render/clouds.js';
import { Flora } from './render/trees.js';
import { Roads } from './render/road.js';
import { Grass } from './render/grass.js';
import { Wind } from './render/wind.js';
import { U } from './render/uniforms.js';
import { Streamer } from './world/streamer.js';
import { findSpawn, Terrain } from './world/terrain.js';
import { scatterChunk, SCATTER_MAX_LEVEL } from './world/scatter.js';
import { BIOME_SHORT, setBiomeBias } from './world/biomes.js';
import { buildCar, buildGhostCar, PAINTS } from './car/model.js';
import { loadCar, loadGhostCar, CARS, CAR_KEYS } from './car/loadedCar.js';
import { Vehicle } from './car/vehicle.js';
import { Input } from './car/input.js';
import { ChaseCamera } from './car/camera.js';
import { Autopilot } from './car/autopilot.js';
import { StreakTrail } from './render/trail.js';
import { PRESETS } from './car/tuning.js';
import { Streak } from './game/streak.js';
import { configFromUrl, applyTerrain, terrainBias } from './game/presets.js';
import { FLEET, FLEET_BY_ID, applyCarFeel, carFromUrl, isUnlocked, bestStreak, cheatOn, setCheat } from './game/garage.js';
import { Solids, solidsFromScatter } from './game/collide.js';
import { Hud } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { createTransport } from './net/transport.js';
import { Remotes } from './net/remotes.js';
import { identity } from './net/identity.js';
import { WorldSave } from './net/save.js';
import { EngineAudio } from './audio/engine.js';

const $ = (s) => document.querySelector(s);
const setStat = (s, p) => {
  const el = $('#stat');
  if (el) el.textContent = s;
  if (p !== undefined && $('#barIn')) $('#barIn').style.width = `${(p * 100) | 0}%`;
};

/* One shared world. The seed is fixed so everyone who opens the page lands on the same
 * road; ?seed= cuts a private world for testing. */
const params = new URLSearchParams(location.search);
export const SEED = (parseInt(params.get('seed') ?? '', 10) || 20260726) >>> 0;
const DEBUG = params.has('debug');
const OFFLINE = params.has('offline');

/* Feel and terrain come from the URL so the preview gallery can link to every combination
 * without a second build. They must be applied BEFORE anything reads the tuning tables. */
const CFG = configFromUrl();
if (CFG.cheat) setCheat(true);
/* The car IS the feel. One choice, not two — see src/game/garage.js. */
const CAR = carFromUrl();
const FEEL = applyCarFeel(CAR);
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
  const wind = new Wind(renderer, { seed: SEED });
  const grass = new Grass({ seed: SEED, scene, wind });

  setStat('finding a road…', 0.34);
  const spawn = findSpawn(SEED);
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
  car.placeAt(spawn.x, spawn.z, spawn.heading);
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
  const auto = new Autopilot();
  const streak = new Streak();
  let trail = null;
  const hud = new Hud();
  trail = new StreakTrail({ scene });
  const audio = new EngineAudio();

  /* Swapping the car keeps everything else: position, speed, streak, the lot. The model is
   * the only thing that changes, because the solver is tuned by the FEEL, not by the body. */
  let carKeyLive = carKey;
  async function swapCar(key) {
    if (!CARS[key] || key === carKeyLive) return;
    const spec = FLEET_BY_ID[key];
    if (spec && !isUnlocked(spec, Math.max(bestStreak(), streak.state.best))) {
      hud.say(`${spec.label} unlocks at ${(spec.unlockAt / 1000).toFixed(1)} km`, 3);
      return;
    }
    try {
      const next = await loadCar({ car: key, paint: me.look?.paint ?? 0, base: new URL('./models/cars/', location.href).href });
      scene.remove(model.group);
      model.dispose?.();
      model = next;
      scene.add(model.group);
      carKeyLive = key;
      window.WANDEROAD.model = model;
      // The car owns its feel, so changing car changes how it drives.
      if (spec) {
        const f = applyCarFeel(spec);
        car.setTier(spec.tier);
        car.setPreset(f.assist);
      }
      trail.reset(car);
      hud.say(`${CARS[key].label} — ${spec ? spec.blurb : ''}`, 3.2);
    } catch (err) {
      console.error('[car] swap failed', err?.message ?? err);
      hud.say('that one would not load', 2.5);
    }
  }

  const menu = new Menu({
    onAuto: () => auto.toggle(car),
    isAuto: () => auto.on,
    onCar: swapCar,
    bestStreak: () => Math.max(bestStreak(), streak.state.best),
    onCheat: (on) => {
      setCheat(on);
      hud.say(on ? 'every car unlocked' : 'unlocks restored', 2.4);
    },
    onReset: () => backToRoad(),
    camera: () => chase.mode,
    cycleCam: () => chase.cycle(),
  });
  menu.setCurrent({ car: carKeyLive, feel: CFG.feel, terrain: CFG.terrain });

  const openHint = document.createElement('div');
  openHint.id = 'openMenu';
  openHint.textContent = 'ESC — garage';
  hud.root.appendChild(openHint);

  /** Put the player back on the nearest road, facing along it. */
  function backToRoad() {
    const t = car.terrain || local;
    const q = t.roads.query(car.x, car.z);
    if (isFinite(q.d)) {
      car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
    } else {
      const s = findSpawn(SEED, car.x, car.z);
      car.placeAt(s.x, s.z, s.heading);
    }
    chase.reset();
    trail.reset(car);
    hud.say('back on the road', 2);
  }

  setStat('looking for company…', 0.7);
  const transport = createTransport({
    backend: OFFLINE ? 'none' : 'auto',
    phpBase: new URL('./api/', location.href).href,
  });
  const remotes = new Remotes({ scene, buildGhostCar });
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
  });
  addEventListener('pagehide', () => {
    streak.flush();
    save.flush();
    transport.send({ op: 'bye', cell: cellKey(), car: carPacket() }).catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      streak.flush();
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
    tier: car.tier,
    paint: me.look?.paint ?? 0,
    flags: (car.onGround ? 0 : 1) | (car.handbrake > 0.5 ? 2 : 0),
  });

  let netState = 'offline';
  let nextTick = 0;
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
      if (res.peers) remotes.ingest(res.peers, res.now);
      // The server sets the pace. 'rate' is in HERTZ, not seconds: 0.25 when you are alone in
      // a continent, 2 when someone is within 800 m. Reading it as seconds inverts the whole
      // scheme — a lone driver would poll four times a second and a crowded road once every
      // two.
      nextTick = performance.now() + 1000 / Math.max(0.05, Math.min(res.rate || 0.25, 10));
    } catch {
      netState = 'offline';
      nextTick = performance.now() + 8000;
    }
  }

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

    /* input */
    const cmd = input.poll();
    if (input.tapped('camera')) hud.say(`camera: ${chase.cycle()}`, 1.6);
    if (input.tapped('reverse')) car.reverse = !car.reverse;
    if (input.tapped('nextCar')) {
      /* Cycle to the next car you can actually drive. Stepping onto a locked one and being
       * told no is not a control, it is a wall you have to press through. */
      const best = Math.max(bestStreak(), streak.state.best);
      const open = FLEET.filter((c) => isUnlocked(c, best)).map((c) => c.id);
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
    if (input.tapped('radio')) hud.say(audio.nextStation(), 2.4);
    if (input.tapped('autodrive')) hud.say(auto.toggle(car) ? 'auto-drive on — sit back' : 'auto-drive off', 2.4);
    if (input.tapped('reset')) backToRoad();
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
    if (!menu.open) car.update(dt, drive);

    /* collisions — after the solver, before the camera, so the camera never chases a car
       that is momentarily inside a tree */
    const hit = solids.resolve(car, 1.05, dt);
    if (hit && hit.severity > 0.35 && hit.speed > 9) {
      audio.thump(Math.min(1, (hit.severity * hit.speed) / 40));
      streak.update(2, car, { onRoad: 0 }); // a real impact ends the streak immediately
      hud.say('ouch', 1.4);
    }

    /* scoring */
    const surf = car.terrain.surface(car.x, car.z);
    streak.update(dt, car, surf);
    trail.update(dt, car, streak.state);

    /* place the model */
    const tilt = car.groundTilt();
    model.group.position.set(car.x, car.y - 0.36, car.z);
    model.group.rotation.set(0, car.yaw, 0);
    model.setBodyRoll(car.roll * 1.3 + tilt.roll * 0.6, car.pitch + tilt.pitch * 0.6);
    model.setSteer(car.steerAngle || 0);
    model.setWheelSpin(car.wheelSpin);
    model.setBrakeGlow(car.brake);

    /* camera */
    const sNorm = chase.update(car, dt, (x, z) => car.terrain.height(x, z));

    /* shared uniforms */
    U.uTime.value = now / 1000;
    U.uCamPos.value.copy(camera.position);
    camera.getWorldDirection(dir);
    U.uCull.value.set(dir.x, dir.z, Math.cos(1.15), 0);

    /* world */
    streamer.update(car.x, car.z);
    roads.update(car.x, car.z);
    wind.update(dt, camera.position);
    grass.update(car.x, car.z, car.y, dt);
    clouds.update(dt, camera.position);
    water.update(dt, camera.position);
    flora.update(dt, camera.position);
    save.markVisited(car.x, car.z);

    /* net */
    remotes.update(dt, now);
    netTick(now);

    /* audio + post cues */
    audio.update(dt, car);
    post.speed = sNorm;
    post.limit = car.limit;

    hud.update(dt, { car, streak, surface: surf, remotes, netState });
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
          `road ${surf.onRoad.toFixed(2)}  grip ${surf.grip.toFixed(2)}  ${BIOME_SHORT[surf.dominant]}  solids ${solids.count}\n` +
          `calls ${renderer.info.render.calls}  tris ${(renderer.info.render.triangles / 1000) | 0}k  net ${netState}  peers ${remotes.count}`;
      }
    }

    if (!revealed && streamer.stats.live > 14) {
      revealed = true;
      setStat('go anywhere.', 1);
      setTimeout(() => {
        $('#veil').classList.add('gone');
        $('#hud').hidden = false;
        if (CFG.feel !== 'road' || CFG.terrain !== 'rolling') {
          hud.say(`${FEEL.label} · ${LAND.label}`, 4.5);
        }
      }, 500);
    }
  }
  requestAnimationFrame(frame);

  // for the console, and for tools/shoot.mjs
  window.THREE = THREE_NS; // debug/telemetry only — the game never reads it
  window.WANDEROAD = {
    renderer,
    scene,
    camera,
    streamer,
    car,
    model,
    chase,
    streak,
    auto,
    trail,
    fleet: FLEET,
    solids,
    remotes,
    post,
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
