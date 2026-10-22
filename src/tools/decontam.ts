// Fringe removal for hair: semi-transparent pixels inside hair keep part of the backdrop's
// colour (a beige studio backdrop shows as a brownish tint between curls over black). Applied
// only in the unknown band (0.02 < alpha < 0.98), never the confident core, and weighted by
// hair-like texture (orientation spread), so smooth outlines (a phone's bezel) are untouched.
//   1. Backdrop colour B: robust quadratic fit to the image border (vignette, gradient),
//      replaced locally by the mean of confident background pixels where there are any
//      (textured backdrops).
//   2. Local hair colour H: multi-scale mean of confident foreground pixels that are NOT
//      backdrop-coloured, so gap pixels cannot inherit the backdrop.
//   3. Where the estimated foreground colour is closer to B than to H (OKLab), it is moved to H;
//      where the observed colour is closer to B than to H, alpha is reduced to the known-colour
//      unmixing alpha = ((C - B) . (H - B)) / |H - B|^2 (never increased).
// `strength` (0..1, the "Fringe removal" slider) scales both steps.
import { boxBlur } from "./filters";
import { edgeComplexityOf, bandRadii } from "./trimap";
import { enclosedRegions } from "./holes";

const LO = 0.02,
  HI = 0.98;

export function oklab(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const lin = (c: number) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const R = lin(r),
    G = lin(g),
    B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb(
  L: number,
  a: number,
  b: number,
): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const enc = (c: number) =>
    c <= 0.0031308
      ? 12.92 * c
      : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055;
  return [
    enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function oklabToRgbInGamut(
  L: number,
  a: number,
  b: number,
): [number, number, number] {
  const inside = (c: number[]) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  let rgb = oklabToRgb(L, a, b);
  if (!inside(rgb)) {
    let lo = 0,
      hi = 1;
    for (let it = 0; it < 12; it++) {
      const mid = (lo + hi) / 2;
      if (inside(oklabToRgb(L, a * mid, b * mid))) lo = mid;
      else hi = mid;
    }
    rgb = oklabToRgb(L, a * lo, b * lo);
  }
  return rgb.map((v) => Math.min(1, Math.max(0, v))) as [
    number,
    number,
    number,
  ];
}

export function oklabDist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Backdrop colour per pixel (RGB 0..1, interleaved): a robust (IRLS, Huber) quadratic fit
 * c(x, y) per channel to a border strip, replaced by the local mean of confident background
 * pixels (alpha < 0.02) where a window contains enough of them.
 */
export function estimateBackdrop(
  rgba: ArrayLike<number>,
  alpha: Float32Array | null,
  w: number,
  h: number,
): Float32Array {
  const depth = Math.max(2, Math.round(Math.min(w, h) * 0.01));
  const pts: number[] = [];
  for (let y = 0; y < h; y += 2)
    for (let x = 0; x < w; x += 2) {
      if (x >= depth && x < w - depth && y >= depth && y < h - depth) continue;
      if (alpha && alpha[y * w + x] > LO) continue;
      pts.push(x, y);
    }
  const basis = (x: number, y: number) => {
    const u = x / w - 0.5,
      v = y / h - 0.5;
    return [1, u, v, u * u, u * v, v * v];
  };
  const coef: number[][] = [];
  for (let c = 0; c < 3; c++) {
    let beta = [0, 0, 0, 0, 0, 0];
    for (let it = 0; it < 6; it++) {
      const A = Array.from({ length: 6 }, () => new Array(7).fill(0));
      for (let k = 0; k < pts.length; k += 2) {
        const x = pts[k],
          y = pts[k + 1],
          f = basis(x, y),
          v = rgba[(y * w + x) * 4 + c] / 255;
        const res = v - f.reduce((s, fi, i) => s + fi * beta[i], 0);
        const wt =
          it === 0 ? 1 : Math.abs(res) <= 0.04 ? 1 : 0.04 / Math.abs(res); // Huber
        for (let i = 0; i < 6; i++) {
          for (let j = 0; j < 6; j++) A[i][j] += wt * f[i] * f[j];
          A[i][6] += wt * f[i] * v;
        }
      }
      for (let i = 0; i < 6; i++) A[i][i] += 1e-6;
      for (let col = 0; col < 6; col++) {
        let piv = col;
        for (let r = col + 1; r < 6; r++)
          if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
        [A[col], A[piv]] = [A[piv], A[col]];
        for (let r = 0; r < 6; r++)
          if (r !== col) {
            const f = A[r][col] / A[col][col];
            for (let j = col; j < 7; j++) A[r][j] -= f * A[col][j];
          }
      }
      beta = A.map((row, i) => row[6] / row[i]);
    }
    coef.push(beta);
  }
  const n = w * h,
    out = new Float32Array(n * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const f = basis(x, y),
        i = y * w + x;
      for (let c = 0; c < 3; c++)
        out[i * 3 + c] = Math.min(
          1,
          Math.max(
            0,
            f.reduce((s, fi, k) => s + fi * coef[c][k], 0),
          ),
        );
    }
  if (!alpha) return out;
  const r = Math.max(8, Math.round(Math.max(w, h) * 0.03));
  const wt = Float32Array.from(alpha, (a) => (a < LO ? 1 : 0));
  const ws = boxBlur(wt, w, h, r);
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = (wt[i] * rgba[i * 4 + c]) / 255;
    const m = boxBlur(ch, w, h, r);
    for (let i = 0; i < n; i++)
      if (ws[i] > 0.15) {
        const t = Math.min(1, (ws[i] - 0.15) / 0.2);
        out[i * 3 + c] = (1 - t) * out[i * 3 + c] + t * (m[i] / ws[i]);
      }
  }
  return out;
}

function localForeground(
  rgba: ArrayLike<number>,
  alpha: Float32Array,
  backdrop: Float32Array,
  w: number,
  h: number,
  radii: number[],
  minDist = 0.12,
): { colour: Float32Array; valid: Uint8Array; range: Float32Array } {
  const n = w * h;
  const wt = new Float32Array(n);
  const feats = Array.from({ length: 6 }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    if (alpha[i] < 0.95) continue;
    const C = oklab(
      rgba[i * 4] / 255,
      rgba[i * 4 + 1] / 255,
      rgba[i * 4 + 2] / 255,
    );
    const B = oklab(backdrop[i * 3], backdrop[i * 3 + 1], backdrop[i * 3 + 2]);
    if (oklabDist(C, B) < minDist) continue;
    wt[i] = 1;
    const c = Math.hypot(C[1], C[2]);
    feats[0][i] = C[0];
    feats[1][i] = C[0] * C[0];
    feats[2][i] = C[1];
    feats[3][i] = C[2];
    feats[4][i] = c;
    feats[5][i] = c * c;
  }
  const colour = new Float32Array(n * 3),
    valid = new Uint8Array(n),
    range = new Float32Array(n * 6);
  for (const r of radii) {
    const ws = boxBlur(wt, w, h, r);
    const means = [0, 1, 2].map((c) => {
      const ch = new Float32Array(n);
      for (let i = 0; i < n; i++) ch[i] = (wt[i] * rgba[i * 4 + c]) / 255;
      return boxBlur(ch, w, h, r);
    });
    const fm = feats.map((f) => boxBlur(f, w, h, r));
    for (let i = 0; i < n; i++) {
      if (valid[i] || ws[i] < 1e-3) continue;
      for (let c = 0; c < 3; c++) colour[i * 3 + c] = means[c][i] / ws[i];
      const m = fm.map((f) => f[i] / ws[i]);
      range.set(
        [
          m[0],
          Math.sqrt(Math.max(0, m[1] - m[0] * m[0])),
          m[2],
          m[3],
          m[4],
          Math.sqrt(Math.max(0, m[5] - m[4] * m[4])),
        ],
        i * 6,
      );
      valid[i] = 1;
    }
  }
  return { colour, valid, range };
}

const FRINGE_RANGE_K = 2;
export function clampToHairRange(
  F: number[],
  range: Float32Array,
  i: number,
  k = FRINGE_RANGE_K,
): [number, number, number] {
  const [mL, sL, ma, mb, mC, sC] = range.subarray(i * 6, i * 6 + 6);
  let [L, a, b] = oklab(F[0], F[1], F[2]);
  L = Math.min(mL + k * sL + 0.02, Math.max(mL - k * sL - 0.02, L));
  const limit = mC + k * sC + 0.01;
  const hn = Math.hypot(ma, mb);
  if (hn > 1e-4) {
    const ux = ma / hn,
      uy = mb / hn;
    const along = Math.min(limit, Math.max(-0.01, a * ux + b * uy));
    let px = a - (a * ux + b * uy) * ux,
      py = b - (a * ux + b * uy) * uy;
    const pn = Math.hypot(px, py),
      pl = 0.5 * limit;
    if (pn > pl) {
      px *= pl / pn;
      py *= pl / pn;
    }
    a = along * ux + px;
    b = along * uy + py;
  } else {
    const c = Math.hypot(a, b);
    if (c > limit) {
      a *= limit / c;
      b *= limit / c;
    }
  }
  return oklabToRgbInGamut(L, a, b);
}

export function removeFringe(
  rgba: Uint8ClampedArray,
  alpha: Float32Array,
  fg: Uint8ClampedArray,
  w: number,
  h: number,
  maskScale: number,
  strength: number,
) {
  const stats = { recoloured: 0, alphaReduced: 0 };
  if (strength <= 0) return stats;
  const n = w * h;
  const backdrop = estimateBackdrop(rgba, alpha, w, h);
  const r = bandRadii(w, h, maskScale);
  const {
    colour: H,
    valid,
    range,
  } = localForeground(rgba, alpha, backdrop, w, h, [
    r.complexity,
    3 * r.complexity,
    9 * r.complexity,
  ]);
  const enclosed = enclosedRegions(alpha, w, h, {
    threshold: 0.9,
    minAreaFraction: 0.002,
  });
  const outside = Float32Array.from(alpha, (a, i) =>
    a < 0.9 && !enclosed[i] ? 1 : 0,
  );
  const cx = edgeComplexityOf(rgba, w, h, r.complexity, undefined, outside);
  const kappa = Float32Array.from(cx, (v) =>
    Math.min(1, Math.max(0, (v - 0.4) / 0.2)),
  );
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    if (a <= LO || a >= HI || !valid[i]) continue;
    const s = strength * kappa[i];
    if (s <= 0) continue;
    const Hc = [H[i * 3], H[i * 3 + 1], H[i * 3 + 2]],
      Bc = [backdrop[i * 3], backdrop[i * 3 + 1], backdrop[i * 3 + 2]];
    const Hl = oklab(Hc[0], Hc[1], Hc[2]),
      Bl = oklab(Bc[0], Bc[1], Bc[2]);
    const F = [fg[i * 4] / 255, fg[i * 4 + 1] / 255, fg[i * 4 + 2] / 255],
      Fl = oklab(F[0], F[1], F[2]);
    if (oklabDist(Fl, Bl) < oklabDist(Fl, Hl)) {
      const Fc = clampToHairRange(
        F.map((v, c) => v + s * (Hc[c] - v)),
        range,
        i,
      );
      for (let c = 0; c < 3; c++) fg[i * 4 + c] = Math.round(255 * Fc[c]);
      stats.recoloured++;
    }
    const C = [rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255];
    const d = [Hc[0] - Bc[0], Hc[1] - Bc[1], Hc[2] - Bc[2]],
      dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    if (dd < 0.04) continue;
    const t =
      ((C[0] - Bc[0]) * d[0] + (C[1] - Bc[1]) * d[1] + (C[2] - Bc[2]) * d[2]) /
      dd;
    let off = 0;
    for (let c = 0; c < 3; c++) off += (C[c] - Bc[c] - t * d[c]) ** 2;
    if (off > 0.0625 * dd) continue;
    const au = Math.min(1, Math.max(0, t));
    if (au >= a) continue;
    const na = a + s * (au - a);
    alpha[i] = na;
    stats.alphaReduced++;
    // Foreground from the full unmix (C = au F + (1 - au) B), at any strength: the slider only
    // trades how much alpha is given back, never reintroduces backdrop colour.
    // Written as H plus the off-line residual (the strand's own deviation from H), amplified at
    // most 3x so faint pixels do not overshoot into the backdrop's complementary colour.
    const fa = Math.max(au, 1 / 3);
    const Fc = clampToHairRange(
      [0, 1, 2].map((c) => Hc[c] + (C[c] - Bc[c] - t * d[c]) / fa),
      range,
      i,
    );
    for (let c = 0; c < 3; c++) fg[i * 4 + c] = Math.round(255 * Fc[c]);
  }
  return stats;
}
