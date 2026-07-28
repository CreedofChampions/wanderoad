<!-- created by AI -->
# Sea Types — 10 real, working references for Wanderoad's water

Researched 2026-07-27. Each entry is a real repo/demo you can open and run today, chosen
for the Ghibli/Zelda painted look, ordered from "closest to Wanderoad's style" to
"contrast options". Wanderoad's own water lives in `src/render/water.js` (Three.js
RawShaderMaterial, GLSL 300 es, analytic noise — no textures); the "Port" line on each
entry says what would carry over.

---

## 1. Wind Waker cel sea — flat blue + drifting foam scribbles
- **Repo:** https://github.com/Robpayot/zelda-project-public (191★)
- **Live:** https://wind-waker-threejs.com/
- **Look:** THE Zelda sea. One flat blue plate, white hand-drawn foam lines slowly
  drifting, cel-shaded islands. Three.js.
- **Port:** foam-line pass would drop into our FS as an extra band keyed off `pn2` —
  we already have the scallop/foam machinery, this is a whole-surface version of it.

## 2. Same sea, modern TSL/WebGPU code
- **Repo:** https://github.com/Robpayot/tslda
- **Live:** https://wind-waker-js.vercel.app/
- **Look:** identical to #1 but rewritten in TSL (Three.js Shading Language), WebGPU.
- **Port:** cleaner code to read than #1 if we ever move off RawShaderMaterial; the
  wave/wind logic is easier to lift from TSL than from the old bundle.

## 3. Voronoi toon lagoon — bright tropical cel water
- **Demo + source:** https://a-toon-ocean.glitch.me/ (Glitch exposes full source)
- **Write-up:** https://samsunginternet.github.io/generating-a-water-effect-part-1-svg-and-canvas/
- **Look:** Moana/Ghibli lagoon — bright aqua, Voronoi cells as sun sparkle. A-Frame
  (Three.js under the hood), 3-part tutorial explains every line.
- **Port:** Voronoi sparkle could replace our quantised glitter for shallow bays.

## 4. Cartoon shallows with animated foam edge (R3F)
- **Repo:** https://github.com/thaslle/stylized-water
- **Look:** cartoon water plate + chunky animated shore foam, performance-tuned,
  React Three Fiber. Closest published thing to our depth-keyed foam contour.
- **Port:** compare their foam falloff vs our `edge`/`scallop` — theirs is bolder,
  more Ghibli-poster.

## 5. Stylized Gerstner swell — big painterly rollers
- **Write-up:** https://blog.farazshaikh.com/stories/generating-a-stylized-ocean/
- **Repo (lib):** https://github.com/FarazzShaikh/glNoise (`gln_GerstnerWave`)
- **Look:** 4 Gerstner waves summed FBM-style — real rolling swell that still reads
  painted. Our water is a FLAT plane today; this is the "the sea actually moves" option.
- **Port:** vertex displacement in `WATER_VS`; wdat/depth logic unchanged.

## 6. Classic trochoidal open ocean + floating objects
- **Tutorial + repo:** https://sbcode.net/threejs/gerstnerwater/ (Sean-Bradley's three.js fork, `webgl_shaders_ocean_gerstner.html`)
- **Look:** proper deep-sea trochoid swell; the demo floats objects on the wave field —
  exactly what a car on a ferry/causeway would need.
- **Port:** the CPU-side `getWaveInfo()` mirror of the vertex wave is the pattern for
  making the car bob if it ever drives onto water.

## 7. Calm mirror sea — realistic contrast option
- **Repo:** https://github.com/jbouny/ocean
- **Look:** the classic three.js reflective plane (same family as
  https://threejs.org/examples/webgl_shaders_ocean.html). Not painted — useful as the
  "what we are deliberately NOT doing" reference, and for a dawn mirror-flat preset.
- **Port:** nothing directly; steal the sun-path glare numbers.

## 8. Storm sea — FFT whitecaps
- **Repo:** https://github.com/jbouny/fft-ocean
- **Look:** WebGL FFT (Tessendorf) heavy swell with whitecaps, wind-driven. The
  "storm weather" sea type if weather ever reaches the coast.
- **Port:** too heavy to run as-is in our streamer; the whitecap-from-jacobian trick
  can be faked with our gust field instead.

## 9. Painterly horizon sea — mobile-cheap gradient ocean
- **Repo:** https://github.com/Nugget8/Three.js-Ocean-Scene
- **Look:** procedural skybox + soft gradient sea built for mobile GPUs — reads like a
  watercolour wash to the horizon. Closest to our "distant water is a plate of colour"
  philosophy, at a fraction of our shader cost.
- **Port:** benchmark reference for the far-LOD water we cut at `MAX_WATER_LEVEL`.

## 10. No-texture Wind Waker water — pure procedural GLSL
- **Shader:** https://godotshaders.com/shader/wind-waker-water-no-textures-needed/
- **Look:** Wind Waker foam rings from noise alone, zero textures. Godot shader
  language ≈ GLSL; ports almost line-for-line onto our `pn2`/`fbm2` helpers.
- **Port:** the most copy-pasteable of the ten — same no-texture constraint we
  already live under.

---

### Background reading (underpins #1/#2/#10)
- Nathan Gordon, "The Ocean — Wind Waker Graphics Analysis":
  https://medium.com/@gordonnl/the-ocean-170fdfd659f1

### How these map onto Wanderoad
Wanderoad's water already does: depth-graded colour plates, shore foam contour,
flow ribbons, quantised glitter, openness-calmed chop. What it does NOT do yet:
whole-surface foam drawings (#1/#2/#10), vertex-displaced swell (#5/#6), Voronoi
sparkle (#3). Those three are the genuinely new sea types; the rest are tuning
references.
