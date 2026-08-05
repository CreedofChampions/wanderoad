/* HOW BLUE IS THE GROUND? — measure a screenshot instead of arguing about it.
 *
 * Operator, with a photograph: "ground is blue here in highlands". That is a claim about pixels, and
 * the first two attempts to answer it were wrong in ways a number would have caught immediately: the
 * first shot was of the title card's white wash, and the second blamed the snow blend when the ground
 * at that height is only 7% snow. So: decode the PNG and average a region.
 *
 * The region defaults to the lower-left of the frame. That is not arbitrary — the chase camera keeps
 * the car centre-bottom, so the lower-left corner is near ground on every shot, never sky and never
 * the HUD (the HUD's own text sits centre and right).
 *
 * `bMinusR` is the number that matters: mean blue minus mean red, in 0-255. Ground lit by a warm sun
 * should be NEGATIVE. Positive means the ground is literally bluer than it is red, which is the
 * complaint, stated as a measurement.
 *
 *   node tools/shot-stats.mjs shot.png [x0 y0 x1 y1 as 0..1 fractions]
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

/** Minimal PNG reader: 8-bit, non-interlaced, colour type 2 (RGB) or 6 (RGBA) — what Chrome emits.
 *
 *  EXPORTED, and the script below is guarded, so tools/diag-waterlive.mjs can measure the
 *  difference between two screenshots without a second copy of this decoder living in the
 *  repo. One source of truth for "how do we read a Chrome PNG"; nothing else about this tool
 *  changes, and running it from the command line behaves exactly as it always has. */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let p = 8, w = 0, h = 0, ct = 0, bd = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8 || (ct !== 2 && ct !== 6)) throw new Error(`unsupported png: depth ${bd} type ${ct}`);
  const ch = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  // Undo the per-scanline filters. Each row is prefixed with its filter byte.
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prv = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prv ? prv[i] : 0;
      const c = prv && i >= ch ? prv[i - ch] : 0;
      let v = src[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
  }
  return { w, h, ch, px: out };
}

/* Only when RUN, never when imported — see the note on decodePng above. */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const file = process.argv[2];
  const [fx0, fy0, fx1, fy1] = [3, 4, 5, 6].map((i, k) => Number(process.argv[i] ?? [0.02, 0.55, 0.34, 0.95][k]));
  const { w, h, ch, px } = decodePng(readFileSync(file));
  const [x0, y0, x1, y1] = [Math.floor(fx0 * w), Math.floor(fy0 * h), Math.floor(fx1 * w), Math.floor(fy1 * h)];
  let r = 0, g = 0, b = 0, n = 0, sat = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * w * ch + x * ch;
      const R = px[i], G = px[i + 1], B = px[i + 2];
      r += R; g += G; b += B;
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      sat += mx ? (mx - mn) / mx : 0;
      n++;
    }
  const mean = [r / n, g / n, b / n].map((v) => +v.toFixed(1));
  console.log(JSON.stringify({
    file: file.split(/[\/]/).pop(), region: [x0, y0, x1, y1], px: n,
    mean: { r: mean[0], g: mean[1], b: mean[2] },
    bMinusR: +(mean[2] - mean[0]).toFixed(1),
    saturation: +(sat / n).toFixed(3),
  }));
}
