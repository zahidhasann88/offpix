import type { Backend } from "../engine/types";
import { planTiles, blendTileInto } from "../engine/tiling";
import { bilinearResize } from "../engine/preprocess";
import { imageTooLargeError, throwIfAborted } from "../engine/errors";

export type RunTile = (
  chw: Float32Array,
  w: number,
  h: number,
) => Promise<Float32Array>;

export interface UpscaleOptions {
  scale: number;
  tileSize: number;
  overlap: number;
  pad?: number;
  inputMultiple?: number;
  signal?: AbortSignal;
  onTile?: (done: number, total: number) => void;
}

/** Matches Real-ESRGAN's own tile_pad default. */
const DEFAULT_TILE_PAD = 10;
const MAX_INPUT_MEGAPIXELS = 16;
const MAX_OUTPUT_DIMENSION = 16384;

function maxOutputMegapixels(deviceMemory?: number): number {
  if (deviceMemory != null && deviceMemory <= 4) return 16;
  return 64;
}

export function checkUpscaleLimits(
  w: number,
  h: number,
  scale: number,
  deviceMemory?: number,
): void {
  const inMp = (w * h) / 1e6;
  if (inMp > MAX_INPUT_MEGAPIXELS) {
    throw imageTooLargeError(
      `Input is ${inMp.toFixed(1)} MP; the maximum is ${MAX_INPUT_MEGAPIXELS} MP. Downscale it first.`,
    );
  }
  const ow = w * scale,
    oh = h * scale;
  if (Math.max(ow, oh) > MAX_OUTPUT_DIMENSION) {
    throw imageTooLargeError(
      `Output would be ${ow}×${oh}; the maximum side is ${MAX_OUTPUT_DIMENSION}px. Try 2x or a smaller image.`,
    );
  }
  const limit = maxOutputMegapixels(deviceMemory);
  const outMp = (ow * oh) / 1e6;
  if (outMp > limit) {
    throw imageTooLargeError(
      `Output would be ${outMp.toFixed(1)} MP; this device allows ${limit} MP. Try 2x or a smaller image.`,
    );
  }
}

export function defaultTileSize(
  backend: Backend,
  deviceMemory?: number,
): number {
  let size = backend === "webgpu" ? 256 : 128;
  if (deviceMemory != null && deviceMemory <= 4) size = Math.min(size, 128);
  return size;
}

function extractTile(
  rgba: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  pw: number,
  ph: number,
): Float32Array {
  const plane = pw * ph;
  const out = new Float32Array(3 * plane);
  for (let y = 0; y < ph; y++) {
    const sy = y0 + Math.min(y, h - 1);
    for (let x = 0; x < pw; x++) {
      const si = (sy * width + x0 + Math.min(x, w - 1)) * 4;
      const di = y * pw + x;
      out[di] = rgba[si] / 255;
      out[plane + di] = rgba[si + 1] / 255;
      out[2 * plane + di] = rgba[si + 2] / 255;
    }
  }
  return out;
}

function cropPlanar(
  src: Float32Array,
  pw: number,
  ph: number,
  ox: number,
  oy: number,
  w: number,
  h: number,
): Float32Array {
  if (pw === w && ph === h) return src;
  const out = new Float32Array(3 * w * h);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      const s = c * pw * ph + (oy + y) * pw + ox;
      out.set(src.subarray(s, s + w), c * w * h + y * w);
    }
  }
  return out;
}

export async function upscaleImage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  run: RunTile,
  opts: UpscaleOptions,
): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const { scale, overlap, signal, onTile } = opts;
  const pad = opts.pad ?? DEFAULT_TILE_PAD;
  const m = opts.inputMultiple ?? 1;
  const tileSize = Math.max(m, opts.tileSize - (opts.tileSize % m));
  const outW = width * scale;
  const outH = height * scale;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const tiles = planTiles(width, height, tileSize, overlap);

  for (let i = 0; i < tiles.length; i++) {
    throwIfAborted(signal);
    const t = tiles[i];
    const ex0 = Math.max(0, t.x0 - pad),
      ey0 = Math.max(0, t.y0 - pad);
    const ew = Math.min(width, t.x0 + t.w + pad) - ex0;
    const eh = Math.min(height, t.y0 + t.h + pad) - ey0;
    const pw = Math.ceil(ew / m) * m;
    const ph = Math.ceil(eh / m) * m;
    const input = extractTile(rgba, width, ex0, ey0, ew, eh, pw, ph);
    const result = await run(input, pw, ph);
    throwIfAborted(signal);
    const tile = cropPlanar(
      result,
      pw * scale,
      ph * scale,
      (t.x0 - ex0) * scale,
      (t.y0 - ey0) * scale,
      t.w * scale,
      t.h * scale,
    );
    blendTileInto(
      out,
      outW,
      tile,
      t.w * scale,
      t.h * scale,
      t.x0 * scale,
      t.y0 * scale,
      t.overlapLeft * scale,
      t.overlapTop * scale,
    );
    onTile?.(i + 1, tiles.length);
  }

  writeAlpha(rgba, width, height, out, outW, outH);
  return { width: outW, height: outH, data: out };
}

function writeAlpha(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  out: Uint8ClampedArray,
  outW: number,
  outH: number,
): void {
  let hasAlpha = false;
  for (let i = 3; i < rgba.length; i += 4)
    if (rgba[i] < 255) {
      hasAlpha = true;
      break;
    }
  if (!hasAlpha) {
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    return;
  }
  const a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = rgba[i * 4 + 3];
  const up = bilinearResize(a, w, h, outW, outH);
  for (let i = 0; i < up.length; i++) out[i * 4 + 3] = up[i];
}
