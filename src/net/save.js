/* Wanderoad — the map save.
 *
 * The world is infinite and generated, so there is nothing to save about it: the seed
 * regenerates every hill, road and tree byte for byte. What cannot be regenerated is what
 * the player did to it and where they have been. So a save is three small things:
 *
 *   seed     — which world this is. Without it the rest is meaningless.
 *   visited  — a bitset over 4096 m regions. One bit per region, 256 regions per block,
 *              32 bytes per block. Driving from one end of a continent to the other costs
 *              a few hundred bytes, not a list of coordinates.
 *   ops      — an append-only delta log: everything the player changed or found. Small,
 *              ordered, and replayable on top of a freshly generated world.
 *
 * Durability has two speeds on purpose. IndexedDB is written through immediately, because
 * a browser tab can die at any moment and losing the last 20 seconds of a road trip is a
 * bad enough experience to be worth a synchronous-ish write. The backend is written on a
 * 20 s debounce, because it is a shared server and a save is not urgent — the local copy
 * is already safe.
 *
 * Uploads are chunked to fit the 8 KB body cap: `flush()` sends batches back to back until
 * there is nothing left or it has sent six, so a long session drains over a few debounce
 * periods instead of failing on one oversized body.
 */

const REGION = 4096; // metres per visited-bit
const BLOCK = 16; // regions per side in one bitset block -> 256 bits -> 32 bytes
const BLOCK_BYTES = (BLOCK * BLOCK) / 8;
const DEBOUNCE_MS = 20000;
/** Leave headroom under the transport's 8192 B cap for the envelope (secret, cell, car). */
const UPLOAD_BUDGET = 5800;
/** Hard ceiling on the op log held in memory. Old ops have already been uploaded. */
const MAX_OPS = 4000;

const DB_NAME = 'wanderoad';
const STORE = 'save';

export class WorldSave {
  /**
   * @param {object} opts
   * @param {number} opts.seed
   * @param {{send(payload:object):Promise<object>}} opts.transport
   */
  constructor({ seed, transport }) {
    this.seed = seed >>> 0;
    this.transport = transport;

    /** blockKey -> Uint8Array(32) */
    this.visited = new Map();
    /** blockKeys whose bits have changed since the last successful upload */
    this.dirtyBlocks = new Set();
    /** ops not yet accepted by the backend */
    this.pending = [];
    /** every op this session, for replay by whoever owns the world state */
    this.ops = [];

    this._seq = 0;
    this._timer = null;
    this._inflight = null;
    this._db = null;
    this._stats = { uploads: 0, uploadErrors: 0, lastUpload: 0, lastLocal: 0 };

    // Seed is the first op of any save, so a backend row is never ambiguous about which
    // world it belongs to.
    this.pending.push({ k: 'seed', v: this.seed });
  }

  /* ── visited regions ─────────────────────────────────────────────────────*/

  /** Mark the 4096 m region containing (x,z) as seen. Cheap enough to call every frame. */
  markVisited(x, z) {
    const rx = Math.floor(x / REGION);
    const rz = Math.floor(z / REGION);
    const bx = Math.floor(rx / BLOCK);
    const bz = Math.floor(rz / BLOCK);
    const key = `${bx},${bz}`;
    let bits = this.visited.get(key);
    if (!bits) {
      bits = new Uint8Array(BLOCK_BYTES);
      this.visited.set(key, bits);
    }
    // Positive modulo: rx can be negative and the world has no origin corner.
    const ix = ((rx % BLOCK) + BLOCK) % BLOCK;
    const iz = ((rz % BLOCK) + BLOCK) % BLOCK;
    const bit = iz * BLOCK + ix;
    const mask = 1 << (bit & 7);
    const byte = bit >> 3;
    if (bits[byte] & mask) return false; // already known — no write, no upload
    bits[byte] |= mask;
    this.dirtyBlocks.add(key);
    this._touch();
    return true;
  }

  /** Has this region been visited? Used by the map screen to grey out unknown ground. */
  isVisited(x, z) {
    const rx = Math.floor(x / REGION);
    const rz = Math.floor(z / REGION);
    const bits = this.visited.get(`${Math.floor(rx / BLOCK)},${Math.floor(rz / BLOCK)}`);
    if (!bits) return false;
    const ix = ((rx % BLOCK) + BLOCK) % BLOCK;
    const iz = ((rz % BLOCK) + BLOCK) % BLOCK;
    const bit = iz * BLOCK + ix;
    return (bits[bit >> 3] & (1 << (bit & 7))) !== 0;
  }

  /* ── delta ops ───────────────────────────────────────────────────────────*/

  /**
   * Record one change or discovery. `op` is any small JSON object; `k` names the kind.
   * A sequence number and timestamp are stamped on so the log stays ordered across
   * sessions and devices.
   */
  note(op) {
    if (!op || typeof op !== 'object') throw new Error('[save] note() needs an object');
    const stamped = { ...op, n: ++this._seq, t: Date.now() };
    this.ops.push(stamped);
    this.pending.push(stamped);
    if (this.ops.length > MAX_OPS) this.ops.splice(0, this.ops.length - MAX_OPS);
    this._touch();
    return stamped;
  }

  /* ── persistence ─────────────────────────────────────────────────────────*/

  /** Local write now, remote write on the debounce. */
  _touch() {
    this._writeLocal();
    if (this._timer === null && typeof setTimeout === 'function') {
      this._timer = setTimeout(() => {
        this._timer = null;
        this.flush().catch(() => {
          /* flush() already logged; a failed upload is retried on the next change */
        });
      }, DEBOUNCE_MS);
    }
  }

  /**
   * Push everything pending to the backend, in 8 KB-safe batches.
   * Safe to call at any time; concurrent calls share one in-flight request.
   */
  flush() {
    if (this._inflight) return this._inflight;
    this._inflight = this._flushOnce().finally(() => {
      this._inflight = null;
    });
    return this._inflight;
  }

  async _flushOnce() {
    if (!this.transport) return { sent: 0, more: false };
    let sent = 0;
    // Bounded: a very long session drains over several ticks instead of hammering the
    // server in one unbounded loop.
    for (let round = 0; round < 6; round++) {
      const batch = this._takeBatch();
      if (batch.ops.length === 0) break;
      try {
        await this.transport.send({ op: 'save', seed: this.seed, ops: batch.ops });
      } catch (err) {
        this._stats.uploadErrors++;
        console.error('[save] upload failed, keeping the local copy', err?.message ?? err);
        throw err;
      }
      this._stats.uploads++;
      this._stats.lastUpload = Date.now();
      for (const key of batch.blocks) this.dirtyBlocks.delete(key);
      this.pending.splice(0, batch.opCount);
      sent += batch.ops.length;
    }
    return { sent, more: this.pending.length + this.dirtyBlocks.size > 0 };
  }

  /**
   * Build the largest batch that fits the budget: dirty bitset blocks first (they are
   * bounded and cheap), then pending ops in order.
   */
  _takeBatch() {
    const ops = [];
    const blocks = [];
    let bytes = 0;

    for (const key of this.dirtyBlocks) {
      const op = { k: 'visited', b: key, d: bytesToBase64(this.visited.get(key)) };
      const size = JSON.stringify(op).length + 1;
      if (bytes + size > UPLOAD_BUDGET) break;
      ops.push(op);
      blocks.push(key);
      bytes += size;
    }

    let opCount = 0;
    for (const op of this.pending) {
      const size = JSON.stringify(op).length + 1;
      if (bytes + size > UPLOAD_BUDGET) break;
      ops.push(op);
      bytes += size;
      opCount++;
    }
    return { ops, blocks, opCount };
  }

  /**
   * Read the save back: IndexedDB first (it is authoritative and instant), then the
   * backend, merged in. Visited bits union; ops are merged by sequence number so a save
   * made on another device does not duplicate what is already local.
   */
  async load() {
    const local = await this._readLocal();
    if (local) this._absorb(local);

    if (this.transport) {
      try {
        const res = await this.transport.send({ op: 'load', seed: this.seed });
        if (res?.save) this._absorb(res.save);
      } catch (err) {
        console.error('[save] remote load failed, using the local copy', err?.message ?? err);
      }
    }
    return { seed: this.seed, visited: this.visited.size, ops: this.ops.length };
  }

  /** Merge a stored blob into the live state. Union for bits, sequence-deduped for ops. */
  _absorb(blob) {
    if (!blob || typeof blob !== 'object') return;
    if (Number.isFinite(blob.seed) && (blob.seed >>> 0) !== this.seed) {
      // A save from a different world would place ops on terrain that does not exist.
      console.error(`[save] ignoring a save for seed ${blob.seed >>> 0}, this world is ${this.seed}`);
      return;
    }
    for (const entry of blob.visited ?? []) {
      const incoming = base64ToBytes(entry.d);
      if (!incoming) continue;
      const cur = this.visited.get(entry.b);
      if (!cur) {
        this.visited.set(entry.b, incoming);
      } else {
        for (let i = 0; i < cur.length && i < incoming.length; i++) cur[i] |= incoming[i];
      }
    }
    const seen = new Set(this.ops.map((o) => o.n));
    for (const op of blob.ops ?? []) {
      if (!op || seen.has(op.n)) continue;
      this.ops.push(op);
      seen.add(op.n);
      if (op.n > this._seq) this._seq = op.n;
    }
    this.ops.sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
  }

  /** Everything the HUD and the debug overlay want to know. */
  stats() {
    let regions = 0;
    for (const bits of this.visited.values()) {
      for (let i = 0; i < bits.length; i++) regions += popcount(bits[i]);
    }
    return {
      seed: this.seed,
      regions,
      blocks: this.visited.size,
      ops: this.ops.length,
      pending: this.pending.length + this.dirtyBlocks.size,
      bytes: this.visited.size * BLOCK_BYTES + JSON.stringify(this.ops).length,
      uploads: this._stats.uploads,
      uploadErrors: this._stats.uploadErrors,
      lastUpload: this._stats.lastUpload,
      lastLocal: this._stats.lastLocal,
    };
  }

  /** Stop the debounce timer. Call from the page's unload path after a final flush(). */
  dispose() {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /* ── IndexedDB ───────────────────────────────────────────────────────────
   * One record per seed. IndexedDB is absent under Node and can be blocked by privacy
   * settings, so every path here degrades to "no local copy" rather than throwing.
   */

  _openDb() {
    if (this._db) return this._db;
    const idb = globalThis.indexedDB;
    if (!idb) {
      this._db = Promise.resolve(null);
      return this._db;
    }
    this._db = new Promise((resolve) => {
      let req;
      try {
        req = idb.open(DB_NAME, 1);
      } catch {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return this._db;
  }

  async _writeLocal() {
    const db = await this._openDb();
    if (!db) return;
    const blob = this._serialise();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, `seed:${this.seed}`);
      tx.oncomplete = () => {
        this._stats.lastLocal = Date.now();
      };
      tx.onerror = () => console.error('[save] IndexedDB write failed');
    } catch (err) {
      console.error('[save] IndexedDB transaction failed', err?.message ?? err);
    }
  }

  async _readLocal() {
    const db = await this._openDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(`seed:${this.seed}`);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  /** The on-disk and on-wire shape. Kept identical so a blob can move either way. */
  _serialise() {
    const visited = [];
    for (const [b, bits] of this.visited) visited.push({ b, d: bytesToBase64(bits) });
    return { seed: this.seed, visited, ops: this.ops };
  }
}

/* ── helpers ───────────────────────────────────────────────────────────────*/

function popcount(v) {
  v = v - ((v >> 1) & 0x55);
  v = (v & 0x33) + ((v >> 2) & 0x33);
  return (v + (v >> 4)) & 0x0f;
}

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64) {
  if (typeof b64 !== 'string') return null;
  let raw;
  try {
    raw = atob(b64);
  } catch {
    return null; // corrupt row — better to lose a block of fog-of-war than to throw
  }
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
