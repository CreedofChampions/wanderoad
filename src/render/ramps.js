/* created by AI */
/* Wanderoad — drawing the dirt kickers.
 *
 * The physics half of a jump lives in world/ramps.js and is hooked into `Terrain.surface()`. This
 * file is the other half: the thing you can SEE. An invisible ramp is not a feature, it is a bug —
 * the car would leap off apparently flat ground.
 *
 * ── ONE FUNCTION, TWO CONSUMERS, NO DRIFT ────────────────────────────────────
 * The single biggest risk in this whole approach is the drawn mesh and the collision surface
 * disagreeing: a car floating a hand's width over a ramp, or sunk into one. So the mesh is not
 * modelled. It is SAMPLED — every vertex height is `Terrain.height(x, z) + rampProfile(lx, lz)`,
 * which is character for character what `Terrain.surface()` adds. They cannot drift apart because
 * they are the same expression. tools/diag-ramps.mjs measures the agreement anyway and reports it in
 * millimetres; it currently reads 0.0000 mm.
 *
 * The tile window is render/loot.js's idiom: build what is near, drop what is far, keyed by tile so
 * a ramp that leaves and returns is the same ramp rather than a new one. Ramps are rare and small,
 * so the window is generous and the rebuild cost is nothing.
 */
import { BufferGeometry, BufferAttribute, Mesh, MeshLambertMaterial, Object3D } from 'three';
import { rampsInBox, rampProfile, RAMP_LEN, RAMP_WID } from '../world/ramps.js';

/** Metres of world per tile, and how far out ramps are built. Larger than loot's window because a
 *  kicker is something you should be able to SEE and aim at from a distance, not something you
 *  discover by driving over it. */
export const TILE = 512;
const RANGE = 1400;

/** Grid resolution across and along a ramp. 14x22 is 600-odd triangles for a nine-metre object,
 *  which is nothing, and it is fine enough that the smoothstep face reads as a curve rather than as
 *  a set of steps at the distance you actually look at one from. */
const NX = 14;
const NZ = 22;

/* A dirt kicker, not a landscaped feature. The colour is a warm dry earth that separates from the
 * greens and greys of open country at a distance — you are meant to spot one and go for it. */
function rampMaterial() {
  return new MeshLambertMaterial({ color: 0x8a6742, flatShading: true });
}

/**
 * Build one ramp's mesh by SAMPLING the same height function the physics uses.
 * @param {object} r a ramp spec from rampsInBox
 * @param {object} terrain anything with `height(x, z)` — the real Terrain
 */
function buildRamp(r, terrain, material) {
  const pos = new Float32Array(NX * NZ * 3);
  const idx = [];
  const cy = Math.cos(r.yaw);
  const sy = Math.sin(r.yaw);
  /* Sample slightly WIDER than the footprint. The profile is exactly zero at its own edge, so a mesh
   * that stopped there would end in a hairline seam against the terrain; carrying the skirt a little
   * past the edge lands those vertices flat on the ground and hides the join. */
  const padX = RAMP_WID * 0.58;
  const padZ = RAMP_LEN * 0.54;

  for (let j = 0; j < NZ; j++) {
    const lz = -padZ + (j / (NZ - 1)) * padZ * 2;
    for (let i = 0; i < NX; i++) {
      const lx = -padX + (i / (NX - 1)) * padX * 2;
      // the ramp's own basis: forward h = (sin yaw, cos yaw), across r = (cos yaw, -sin yaw)
      const x = r.x + lx * cy + lz * sy;
      const z = r.z - lx * sy + lz * cy;
      const y = terrain.height(x, z) + rampProfile(lx, lz);
      const k = (j * NX + i) * 3;
      // local to the group, which is parked at the ramp's own origin — keeps float precision sane
      pos[k] = x - r.x;
      pos[k + 1] = y;
      pos[k + 2] = z - r.z;
    }
  }
  for (let j = 0; j < NZ - 1; j++) {
    for (let i = 0; i < NX - 1; i++) {
      const a = j * NX + i;
      const b = a + 1;
      const c = a + NX;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new Mesh(geo, material);
  mesh.position.set(r.x, 0, r.z);
  mesh.receiveShadow = true;
  return mesh;
}

export class Ramps {
  /** @param {object} opts @param {number} opts.seed @param {THREE.Object3D} opts.scene @param {object} opts.terrain */
  constructor({ seed, scene, terrain }) {
    this.seed = seed >>> 0;
    this.scene = scene;
    this.terrain = terrain;
    this.material = rampMaterial();
    this.group = new Object3D();
    this.group.name = 'ramps';
    scene.add(this.group);
    /** "tx,tz" -> array of meshes that tile owns */
    this.tiles = new Map();
    this._lastCx = Infinity;
    this._lastCz = Infinity;
    this.stats = { ramps: 0, tiles: 0 };
  }

  /** @param {number} dt seconds @param {object} car needs .x and .z */
  update(dt, car) {
    const cx = Math.floor(car.x / TILE);
    const cz = Math.floor(car.z / TILE);
    if (cx === this._lastCx && cz === this._lastCz) return;
    this._lastCx = cx;
    this._lastCz = cz;

    const n = Math.ceil(RANGE / TILE);
    const want = new Set();
    for (let tz = cz - n; tz <= cz + n; tz++) {
      for (let tx = cx - n; tx <= cx + n; tx++) {
        const key = `${tx},${tz}`;
        want.add(key);
        if (this.tiles.has(key)) continue;
        const meshes = [];
        for (const r of rampsInBox(tx * TILE, tz * TILE, (tx + 1) * TILE, (tz + 1) * TILE, this.seed)) {
          const m = buildRamp(r, this.terrain, this.material);
          this.group.add(m);
          meshes.push(m);
        }
        this.tiles.set(key, meshes);
      }
    }
    for (const [key, meshes] of this.tiles) {
      if (want.has(key)) continue;
      for (const m of meshes) {
        this.group.remove(m);
        m.geometry.dispose();
      }
      this.tiles.delete(key);
    }
    let total = 0;
    for (const meshes of this.tiles.values()) total += meshes.length;
    this.stats.ramps = total;
    this.stats.tiles = this.tiles.size;
  }
}
