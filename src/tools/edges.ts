import { boxBlur, dilateBinary, rankFilter } from "./filters";

const LO = 0.02,
  HI = 0.98;

function transitionPixels(
  alpha: Float32Array,
  w: number,
  h: number,
): Uint8Array {
  const t = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        a = alpha[i];
      if (a > LO && a < HI) {
        t[i] = 1;
        continue;
      }
      if (x + 1 < w && Math.abs(alpha[i + 1] - a) > 0.5) {
        t[i] = 1;
        t[i + 1] = 1;
      }
      if (y + 1 < h && Math.abs(alpha[i + w] - a) > 0.5) {
        t[i] = 1;
        t[i + w] = 1;
      }
    }
  return t;
}

function boundaryBand(
  alpha: Float32Array,
  w: number,
  h: number,
  r: number,
): Uint8Array {
  return dilateBinary(transitionPixels(alpha, w, h), w, h, r);
}

export function shiftUnit(w: number, h: number): number {
  return Math.max(1, Math.round(Math.max(w, h) / 1000));
}

export function shiftEdge(
  alpha: Float32Array,
  w: number,
  h: number,
  px: number,
): Float32Array {
  const r = Math.round(Math.abs(px));
  if (!r) return alpha.slice();
  const moved = rankFilter(alpha, w, h, r, px > 0 ? "max" : "min");
  const band = boundaryBand(alpha, w, h, r + 1);
  const out = alpha.slice();
  for (let i = 0; i < out.length; i++) if (band[i]) out[i] = moved[i];
  return out;
}

function edgeComplexity(
  alpha: Float32Array,
  w: number,
  h: number,
  r: number,
): Float32Array {
  const density = boxBlur(
    Float32Array.from(transitionPixels(alpha, w, h)),
    w,
    h,
    r,
  );
  for (let i = 0; i < density.length; i++) {
    const x = Math.min(1, Math.max(0, (density[i] - 0.25) / 0.35));
    density[i] = x * x * (3 - 2 * x);
  }
  return density;
}

export function featherEdge(
  alpha: Float32Array,
  w: number,
  h: number,
  radius: number,
): Float32Array {
  const r = Math.round(radius);
  if (r <= 0) return alpha.slice();
  const blurred = boxBlur(boxBlur(alpha, w, h, r), w, h, r);
  const band = boundaryBand(alpha, w, h, 2 * r);
  const detail = edgeComplexity(alpha, w, h, Math.max(4, 2 * r));
  const out = alpha.slice();
  for (let i = 0; i < out.length; i++)
    if (band[i]) out[i] += (1 - detail[i]) * (blurred[i] - alpha[i]);
  return out;
}

export function applyEdgeRefine(
  alpha: Float32Array,
  w: number,
  h: number,
  feather: number,
  shift: number,
): Float32Array {
  return featherEdge(
    shiftEdge(alpha, w, h, shift * shiftUnit(w, h)),
    w,
    h,
    feather,
  );
}
