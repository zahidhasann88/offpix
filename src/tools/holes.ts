import { boxBlur } from "./filters";

export interface FillOptions {
  threshold?: number;
  minAreaFraction?: number;
}

export interface FillStats {
  regions: number;
  pixels: number;
}

export function enclosedRegions(
  alpha: Float32Array,
  w: number,
  h: number,
  opts: FillOptions = {},
  stats?: FillStats,
): Uint8Array {
  const t = opts.threshold ?? 0.5;
  const minArea = Math.max(1, (opts.minAreaFraction ?? 0.0005) * w * h);
  const n = w * h;
  const state = new Uint8Array(n);
  for (let i = 0; i < n; i++) state[i] = alpha[i] < t ? 1 : 0;
  const stack: number[] = [];
  const flood = (seed: number, mark: number, visit?: (i: number) => void) => {
    state[seed] = mark;
    stack.push(seed);
    while (stack.length) {
      const i = stack.pop()!,
        x = i % w;
      visit?.(i);
      if (x > 0 && state[i - 1] === 1) {
        state[i - 1] = mark;
        stack.push(i - 1);
      }
      if (x < w - 1 && state[i + 1] === 1) {
        state[i + 1] = mark;
        stack.push(i + 1);
      }
      if (i >= w && state[i - w] === 1) {
        state[i - w] = mark;
        stack.push(i - w);
      }
      if (i < n - w && state[i + w] === 1) {
        state[i + w] = mark;
        stack.push(i + w);
      }
    }
  };
  for (let x = 0; x < w; x++)
    for (const i of [x, (h - 1) * w + x]) if (state[i] === 1) flood(i, 2);
  for (let y = 0; y < h; y++)
    for (const i of [y * w, y * w + w - 1]) if (state[i] === 1) flood(i, 2);
  const fill = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (state[s] !== 1) continue;
    const members: number[] = [];
    flood(s, 3, (i) => members.push(i));
    if (members.length < minArea) continue;
    for (const i of members) fill[i] = 1;
    if (stats) {
      stats.regions++;
      stats.pixels += members.length;
    }
  }
  return fill;
}

export function fillEnclosed(
  alpha: Float32Array,
  w: number,
  h: number,
  opts: FillOptions & { rim?: number } = {},
  stats?: FillStats,
): Float32Array {
  const fill = enclosedRegions(alpha, w, h, opts, stats);
  const out = alpha.slice();
  const rim = Math.max(1, Math.round(opts.rim ?? 2));
  const ramp = boxBlur(Float32Array.from(fill), w, h, rim);
  for (let i = 0; i < out.length; i++) {
    if (fill[i]) out[i] = 1;
    else if (ramp[i] > 0) out[i] = Math.max(out[i], Math.min(1, 2 * ramp[i]));
  }
  return out;
}
