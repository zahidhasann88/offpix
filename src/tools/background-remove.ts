import {
  rgbaToNCHW,
  normalizeMask,
  bilinearResize,
} from "../engine/preprocess";
import { imageTooLargeError, throwIfAborted } from "../engine/errors";

export type RunMask = (
  nchw: Float32Array,
  size: number,
) => Promise<Float32Array>;

export interface RemoveBackgroundInput {
  modelInput: Uint8ClampedArray;
  size: number;
  outSize: number;
  origW: number;
  origH: number;
  mean: readonly number[];
  std: readonly number[];
  activation?: "sigmoid";
  keepLogits?: boolean;
  signal?: AbortSignal;
}

function toMask(raw: Float32Array, activation?: "sigmoid"): Float32Array {
  if (activation !== "sigmoid") return normalizeMask(raw, true);
  return Float32Array.from(raw, (v) => 1 / (1 + Math.exp(-v)));
}

const MAX_BG_MEGAPIXELS = 40;

export function checkBgLimits(w: number, h: number): void {
  const mp = (w * h) / 1e6;
  if (mp > MAX_BG_MEGAPIXELS) {
    throw imageTooLargeError(
      `Image is ${mp.toFixed(1)} MP; the maximum is ${MAX_BG_MEGAPIXELS} MP. Downscale it first.`,
    );
  }
}

export function maskFromOutput(
  raw: Float32Array,
  outSize: number,
  origW: number,
  origH: number,
): Float32Array {
  return bilinearResize(
    normalizeMask(raw, true),
    outSize,
    outSize,
    origW,
    origH,
  );
}

function flipRows(data: Float32Array, w: number): Float32Array {
  for (let o = 0; o < data.length; o += w) data.subarray(o, o + w).reverse();
  return data;
}

export function sigmoidInPlace(v: Float32Array): Float32Array {
  for (let i = 0; i < v.length; i++) v[i] = 1 / (1 + Math.exp(-v[i]));
  return v;
}

export async function modelMask(
  input: RemoveBackgroundInput,
  run: RunMask,
  flip = false,
): Promise<Float32Array> {
  throwIfAborted(input.signal);
  const { size, outSize } = input;
  const tensor = rgbaToNCHW(
    input.modelInput,
    size,
    size,
    input.mean,
    input.std,
  );
  const act = input.keepLogits ? undefined : input.activation;
  const post = (v: Float32Array) =>
    input.keepLogits && input.activation === "sigmoid" ? v : toMask(v, act);
  const raw = post((await run(tensor, size)).slice(0, outSize * outSize));
  throwIfAborted(input.signal);
  if (!flip) return raw;
  const mirrored = flipRows(
    post((await run(flipRows(tensor, size), size)).slice(0, outSize * outSize)),
    outSize,
  );
  throwIfAborted(input.signal);
  for (let i = 0; i < raw.length; i++) raw[i] = (raw[i] + mirrored[i]) / 2;
  return raw;
}

export async function removeBackgroundMask(
  input: RemoveBackgroundInput,
  run: RunMask,
): Promise<Float32Array> {
  const mask = await modelMask(input, run);
  return bilinearResize(
    mask,
    input.outSize,
    input.outSize,
    input.origW,
    input.origH,
  );
}

export function quantizeMask(mask: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] * 255;
  return out;
}

export function dequantizeMask(mask: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] / 255;
  return out;
}
