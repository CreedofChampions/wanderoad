<!-- created by AI -->
# Wanderoad — module contracts

Read this before writing any module. Everything below already exists and is verified; treat
it as fixed API. If you think one of these needs to change, say so in your report instead of
changing it — another module is depending on it right now.

Repo root: `D:/Github-Projects/wanderoad`. ES modules, Vite, `three@0.180`.
Dev server: `npm run dev` (port 5173). Build: `npm run build` → `dist/`.
Headless verification: `node tools/shoot.mjs <url> <out.png> [--wait ms] [--pos x,z] [--yaw deg]`
— it drives a real headless Chrome, prints telemetry JSON, writes a PNG, and exits non-zero on
any page error. **Use it. A screenshot you have not looked at is not evidence.**

---

## `src/core/math.js`
```
TAU DEG RAD2DEG
clamp(x,a,b) clamp01(x) lerp(a,b,t) invLerp(a,b,x) mix
smoothstep(e0,e1,x) smootherstep(e0,e1,x)
angleDelta(a,b) damp(cur,tgt,rate,dt) dampAngle(...) spring(v,vel,tgt,k,c,dt)->[v,vel]
hashInt(x) hash2i(x,y,seed) hash3i(x,y,z,seed) rand2 rand3
rng(seed)->()=>[0,1)   chunkRng(cx,cz,seed,salt)
len2(x,y) segDist(px,pz,ax,az,bx,bz)->{d,t,x,z}
catmull1(p0,p1,p2,p3,t) hermite(p0,m0,p1,m1,t) wrap(v,m) chunkOf(v,size) chunkKey(cx,cz)
```

## `src/core/noise.js`
```
valueNoise2(x,y,seed) noise2(x,y,seed) noise3(x,y,z,seed)
fbm2(x,y,oct,seed,lac,gain) ridged(...) billow(...) warpedFbm2(x,y,oct,seed,warp)
worley2(x,y,seed)->{d,cx,cz,id}
```
All deterministic, integer-hash seeded. **Never** use `Math.random` anywhere under `src/world/`.

## `src/core/palette.js`
```
P     // hex strings, ~110 keys (see the file)
LIN   // THREE.Color, linear
C     // GLSL 'vec3(r,g,b)' literals, same keys  →  use as `${C.tLit}` inside a shader
RGB   // [r,g,b] linear arrays
glslPalette()      // the `const vec3 K_* = ...;` block every shader opens with
BIOME_TINT         // 5 entries: {ground,rock,foliage,haze,hazeMul,dryness,snow,wet}
biomeTintArrays()  // {ground,rock,foliage,haze,scal,count} as Float32Arrays
```

## `src/core/glsl.js`
Ported verbatim from the Hoshi-no-Tani pen. GLSL 3.00 es.
```
VHEAD GL_SAFE FHEAD GL_HASH GL_NOISE GL_UNI GL_SKY GL_SHADOW GL_LIGHT DEPTH_FS
glCloudField({cshSpan, cloudDeck})
fragHead(...chunks)  // FHEAD + GL_UNI + glslPalette() + chunks
vertHead(...chunks)  // VHEAD + GL_UNI + chunks
```
Key GLSL API inside `GL_LIGHT`:
```glsl
struct Surf { vec3 N,V,P; vec3 shade,mid,lit; float soft,jit,shadow,trans; vec3 transCol;
              float rim,ao,ambient; };
vec3 paint(Surf s);                       // the whole shading model — use it, do not reinvent
vec3 aerial(vec3 col,float dist,vec3 V,float worldY);  // writes global gFogAmt
float gFogAmt;                            // 0..1, goes in the alpha channel
vec3 ramp3(float t, vec3 shade, vec3 mid, vec3 lit, float soft, float jit);
```
`GL_SHADOW`: `float sunShadow(vec3 wp,float ndl)`, `float sunShadowFast(...)`.
`GL_SKY`: `vec3 skyDome(vec3 d[, out float sunMask])`, `vec3 skyDomeLite(vec3 d)`.
`glCloudField(...)`: `float cloudField(vec2 q)`, `float cloudShadow(vec3 wp)`.

**Reserved words that will not compile:** `patch`, `sample`, `filter`, `active`, `common`,
`partition`, `resource`, `input`, `output`. Do not name a variable any of these.

## `src/render/uniforms.js`
```
U                  // the SHARED uniform object — every material points at the same entries
sharedUniforms(overrides?)
sunDirection(elevDeg=13.5, azDeg=118)
SUN_ELEVATION SUN_AZIMUTH blankTexture()
```
`U` keys match `GL_UNI` exactly: uTime uSunDir uCamPos uWindOrigin uCloudDrift uWindTex
uShadowMap uCloudSh uCloudShOrigin uShadowC uCull uWindLag uLightMat uShadowTexel
uCloudAmount uFogMul uFogNear uFogFar.
`main.js` already writes uTime, uCamPos, uCloudDrift, uCull every frame.

## `src/world/biomes.js`
```
BIOME = {MEADOW:0, STEPPE:1, HIGHLAND:2, DUNES:3, WETLAND:4}
BIOME_COUNT = 5
BIOME_NAMES  // ['Hoshi Meadow','Amber Steppe','Cobalt Highlands','Bara Dunes','Kiri Wetland']
BIOME_SHORT  // ['Meadow','Steppe','Highlands','Dunes','Wetland']
climateAt(x,z,seed)->{e,t,m}   climateUniform(x,z,seed)->{ue,ut,ua,e,t,m}
biomeWeights(x,z,seed,out?)->{w:Float32Array(5), dominant, ...}
biomeWeightsFromClimate(u,out?)
biomeRelief(x,z,seed,i)
BIOME_TERRAIN[i] = {amp,base,rough,wave,drive,water}
BIOME_SCATTER[i] = {trees,rocks,bushes,reeds,posts,grass,kinds:[...]}   // counts per 100x100 m
BIOME_ROAD[i]    = {surface,grip,rough,width,lines}
waterLevelAt(weights, groundY) -> waterY | null
blendScalar(weights, table, key)
```
Measured world share: Meadow 18%, Steppe 22%, Highlands 24%, Dunes 13%, Wetland 23%.

## `src/world/roads.js`
```
TIERS = [{cell:1800,...arterial}, {cell:620,...local}]
edgesInBox(x0,z0,x1,z1,seed,pad)
class RoadField(x0,z0,x1,z1,seed,landHeight,pad)
  .edges                       // [{tier,pts:Float32Array,y:Float32Array,width,verge,...}]
  .query(x,z)  -> {d,y,width,tier,tx,tz,edge}
  .carve(x,z,out?) -> {mask,edge,d,y,tier,tx,tz,width}
roadDistance(x,z,seed,landHeight)
```

## `src/world/terrain.js`
```
landHeight(x,z,seed)      // raw land, NO roads — the road network samples this
landFn(seed)
class Terrain(seed, x0,z0,x1,z1, pad=80)
  .weights(x,z,out?)   .land(x,z)   .height(x,z)   .normal(x,z,e?,out?)
  .surface(x,z,out?) -> { y,nx,ny,nz, w:Float32Array(5), dominant,
                          onRoad, roadDist, roadTier, roadTx, roadTz,
                          grip, rough, surfaceKind }
  .roads               // the RoadField
heightAt(x,z,seed)   findSpawn(seed,hintX,hintZ)->{x,y,z,heading}
```
`Terrain` caches a climate grid + local road edges for the box you give it. Build ONE per
region and reuse it; ~13 µs per `surface()` call.

## `src/world/chunk.js`
```
LEAF = 64        // finest node, metres
LEVELS = 8       // biggest node = 8192 m
GRID = 65        // finest grid
gridFor(level)   // 65 for level<=2, else 33
nodeSize(level)
buildChunk({cx,cz,level,seed}) -> {cx,cz,level,size,ox,oz,step,grid,minY,maxY,vertCount,
    position:Float32Array, normal:Float32Array, biome:Uint8Array(4/vert),
    road:Uint8Array(2/vert), index, heights|null, water:{level,minY,maxY}|null}
chunkTransferables(c)
```
Worker-safe: no three.js, no DOM. Build cost 7–70 ms per node.

## `src/world/streamer.js`
```
class Streamer({seed, material, viewDistance=7000, workers=0, onChunk})
  .group            // THREE.Object3D — add to the scene
  .update(camX,camZ)
  .live             // Map key -> {mesh,level,cx,cz,size,ox,oz,step,grid,minY,maxY,heights,water}
  .stats            // {built,queued,live,workers,lastMs}
  .sampleHeight(x,z) -> number | null
  .forceChunk(x,z)  // synchronous level-0 build, used to unblock spawn
  .dispose()
onChunk(rec, raw)   // called when a chunk goes live — hook scatter/water/grass here
```
Quadtree LOD, skirts for cracks, `SPLIT_FACTOR = 1.7`. Verified: 60 fps, 0.39 ms render,
~560 k triangles, 93 draw calls, 260 live nodes, 6 workers.

## Vertex attributes on every terrain chunk
```
position vec3   // LOCAL to the node; node world position lives in the mesh's modelMatrix
normal   vec3
aBiome   vec4   // normalised u8 — weights for biomes 0..3; biome 4 = 1 - sum
aRoad    vec2   // normalised u8 — x = carve mask, y = carriageway (1 on the tarmac)
```

## `src/main.js`
Exposes `window.WANDEROAD = { renderer, scene, camera, streamer, cam, SEED, stats(), fps() }`.
`?debug` shows the overlay. `?seed=N` cuts a private world.

---

## House style
- Comments explain **why**, never what. If a number is load-bearing, say where it came from.
- No `console.log` left in shipped code paths; errors go through `console.error` with context.
- No dead code, no commented-out blocks, no "TODO" without an owner.
- Match the surrounding density: these files are heavily but purposefully commented.
- Never use `Math.random()` in `src/world/`. Never introduce a second source of truth for a
  number that already exists in `biomes.js`, `palette.js` or `tuning.js`.
