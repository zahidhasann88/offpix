import {
  boxBlur,
  dilateBinary,
  guidedFilter,
  rankFilter,
  rgbPlanes,
} from "./filters";
import { enclosedRegions } from "./holes";

export interface TrimapParams {
  complexityWindow: number;
  incLo: number;
  incHi: number;
  eLo: number;
  eHi: number;
  narrowPerMaskPx: number;
  wide: number;
}

export const defaultTrimapParams: TrimapParams = {
  complexityWindow: 0.02,
  incLo: 0.65,
  incHi: 0.85,
  eLo: 0.02,
  eHi: 0.05,
  narrowPerMaskPx: 2,
  wide: 0.04,
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export function bandRadii(
  w: number,
  h: number,
  maskScale: number,
  p: TrimapParams = defaultTrimapParams,
) {
  const L = Math.max(w, h);
  const narrow = clamp(Math.round(p.narrowPerMaskPx * maskScale), 2, 8);
  return {
    complexity: clamp(
      Math.max(Math.round(p.complexityWindow * L), 4 * narrow),
      8,
      32,
    ),
    narrow,
    wide: clamp(Math.round(p.wide * L), 6, 48),
  };
}

export interface Trimap {
  complexity: Float32Array;
  unknown: Uint8Array;
  sure: Uint8Array;
}

const smoothstep = (lo: number, hi: number, v: number) => {
  const x = clamp((v - lo) / (hi - lo), 0, 1);
  return x * x * (3 - 2 * x);
};

export function edgeComplexityOf(
  rgba: ArrayLike<number>,
  w: number,
  h: number,
  r: number,
  p: TrimapParams = defaultTrimapParams,
  weight?: Float32Array,
): Float32Array {
  const { energy, spread } = orientationSpread(rgba, w, h, r, weight);
  const k = new Float32Array(w * h);
  for (let i = 0; i < k.length; i++)
    k[i] =
      smoothstep(p.incLo, p.incHi, spread[i]) *
      smoothstep(p.eLo, p.eHi, energy[i]);
  return k;
}

export function maskTransitions(
  c: Float32Array,
  w: number,
  h: number,
  r: number,
): Uint8Array {
  const hi = rankFilter(c, w, h, r, "max"),
    lo = rankFilter(c, w, h, r, "min");
  const t = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        a = c[i];
      if (a > 0.02 && a < 0.98 && hi[i] - lo[i] > 0.05) t[i] = 1;
      if (x + 1 < w && Math.abs(c[i + 1] - a) > 0.5) {
        t[i] = 1;
        t[i + 1] = 1;
      }
      if (y + 1 < h && Math.abs(c[i + w] - a) > 0.5) {
        t[i] = 1;
        t[i + w] = 1;
      }
    }
  return t;
}

export function buildTrimap(
  rgba: ArrayLike<number>,
  coarse: Float32Array,
  w: number,
  h: number,
  maskScale: number,
  p: TrimapParams = defaultTrimapParams,
): Trimap {
  const r = bandRadii(w, h, maskScale, p);
  const t = maskTransitions(coarse, w, h, r.narrow);
  const narrow = dilateBinary(t, w, h, r.narrow);
  const enclosed = enclosedRegions(coarse, w, h, {
    threshold: 0.9,
    minAreaFraction: 0.002,
  });
  const outsideSubject = Float32Array.from(coarse, (v, i) =>
    v < 0.9 && !enclosed[i] ? 1 : 0,
  );
  const complexity = edgeComplexityOf(
    rgba,
    w,
    h,
    r.complexity,
    p,
    outsideSubject,
  );
  const complexT = Uint8Array.from(t, (v, i) =>
    v && complexity[i] > 0.5 ? 1 : 0,
  );
  const wide = dilateBinary(complexT, w, h, r.wide);
  const unknown = Uint8Array.from(narrow, (v, i) => v | wide[i]);
  const sure = Uint8Array.from(coarse, (c) => (c >= 0.5 ? 1 : 0));
  return { complexity, unknown, sure };
}

export function solveAlpha(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  coarse: Float32Array,
  maskScale: number,
  eps: number,
  p: TrimapParams = defaultTrimapParams,
): { alpha: Float32Array; trimap: Trimap } {
  const trimap = buildTrimap(rgba, coarse, w, h, maskScale, p);
  const r = bandRadii(w, h, maskScale, p);
  const I = rgbPlanes(rgba, w * h);
  const narrow = guidedFilter(I, coarse, w, h, r.narrow, eps);
  let anyComplex = false;
  for (const k of trimap.complexity)
    if (k > 0) {
      anyComplex = true;
      break;
    }
  const wide = anyComplex ? guidedFilter(I, coarse, w, h, r.wide, eps) : narrow;
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < alpha.length; i++) {
    if (!trimap.unknown[i]) {
      alpha[i] = trimap.sure[i];
      continue;
    }
    const k = trimap.complexity[i];
    const a = coarse[i] >= 0.98 ? 1 : narrow[i];
    alpha[i] = clamp((1 - k) * a + k * wide[i], 0, 1);
  }
  return { alpha, trimap };
}

const BINS = 8;

export function orientationSpread(
  rgba: ArrayLike<number>,
  w: number,
  h: number,
  r: number,
  weight?: Float32Array,
): { energy: Float32Array; spread: Float32Array } {
  const n = w * h;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++)
    L[i] =
      (0.299 * rgba[i * 4] +
        0.587 * rgba[i * 4 + 1] +
        0.114 * rgba[i * 4 + 2]) /
      255;
  const bins = Array.from({ length: BINS }, () => new Float32Array(n));
  const sq = new Float32Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const wt = weight ? weight[i] : 1;
      if (!wt) continue;
      const gx =
        (L[y * w + Math.min(w - 1, x + 1)] - L[y * w + Math.max(0, x - 1)]) / 2;
      const gy =
        (L[Math.min(h - 1, y + 1) * w + x] - L[Math.max(0, y - 1) * w + x]) / 2;
      const m = Math.hypot(gx, gy);
      sq[i] = wt * m * m;
      if (m < 1e-6) continue;
      let t = (Math.atan2(gy, gx) / Math.PI) * BINS;
      t = ((t % BINS) + BINS) % BINS;
      const b0 = Math.floor(t),
        f = t - b0;
      bins[b0][i] += wt * m * m * (1 - f);
      bins[(b0 + 1) % BINS][i] += wt * m * m * f;
    }
  const ws = weight ? boxBlur(weight, w, h, r) : null;
  const e2 = boxBlur(sq, w, h, r);
  const hist = bins.map((b) => boxBlur(b, w, h, r));
  const energy = new Float32Array(n),
    spread = new Float32Array(n);
  const norm = Math.log(BINS);
  for (let i = 0; i < n; i++) {
    const share = ws ? ws[i] : 1;
    energy[i] = share > 1e-3 ? Math.sqrt(e2[i] / share) : 0;
    let tot = 0;
    for (let b = 0; b < BINS; b++) tot += hist[b][i];
    if (tot < 1e-6) continue;
    let H = 0;
    for (let b = 0; b < BINS; b++) {
      const q = hist[b][i] / tot;
      if (q > 0) H -= q * Math.log(q);
    }
    spread[i] = H / norm;
  }
  return { energy, spread };
}
