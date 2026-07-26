/* Wanderoad — chunk generation worker.
 *
 * One job in, one transferable payload out. No shared state between jobs, which is what
 * lets the pool scale to however many cores the machine admits to having.
 */

import { buildChunk, chunkTransferables } from './chunk.js';
import { applyTerrain, terrainBias } from '../game/presets.js';
import { setBiomeBias } from './biomes.js';

/* The preview presets mutate the biome tables, and a Web Worker has its OWN module graph —
 * it never sees a mutation the main thread made. Without this the worker meshes one world
 * while the physics and the camera use another: the ground is drawn tens of metres from
 * where the car actually stands, which looks exactly like the camera has fallen through the
 * floor. The preset therefore travels with every job. */
let appliedPreset = null;
function ensurePreset(name) {
  if (name === appliedPreset) return;
  appliedPreset = name;
  applyTerrain(name);
  setBiomeBias(terrainBias(name));
}

self.onmessage = (ev) => {
  const req = ev.data;
  if (req.type === 'ping') {
    self.postMessage({ type: 'pong' });
    return;
  }
  try {
    ensurePreset(req.terrain || 'rolling');
    const c = buildChunk(req);
    c.type = 'chunk';
    c.jobId = req.jobId;
    self.postMessage(c, chunkTransferables(c));
  } catch (err) {
    self.postMessage({ type: 'error', jobId: req.jobId, message: String(err && err.stack ? err.stack : err) });
  }
};
