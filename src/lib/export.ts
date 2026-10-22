import { encode } from "fast-png";

export function cutoutRgba(
  fg: Uint8ClampedArray,
  alpha: Float32Array,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(fg.length);
  for (let i = 0; i < alpha.length; i++) {
    const q = i * 4;
    out[q] = fg[q];
    out[q + 1] = fg[q + 1];
    out[q + 2] = fg[q + 2];
    out[q + 3] = alpha[i] * 255 + 0.5;
  }
  return out;
}

export function compositeOver(
  background: Uint8ClampedArray,
  fg: Uint8ClampedArray,
  alpha: Float32Array,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(fg.length);
  for (let i = 0; i < alpha.length; i++) {
    const q = i * 4,
      a = alpha[i];
    for (let c = 0; c < 3; c++)
      out[q + c] = a * fg[q + c] + (1 - a) * background[q + c] + 0.5;
    out[q + 3] = 255;
  }
  return out;
}

export function encodePng(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
): Uint8Array<ArrayBuffer> {
  return encode({
    width: w,
    height: h,
    data: rgba,
    channels: 4,
    depth: 8,
  }) as Uint8Array<ArrayBuffer>;
}
