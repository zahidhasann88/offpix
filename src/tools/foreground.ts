export interface ForegroundOptions {
  regularization?: number;
  smallIterations?: number;
  bigIterations?: number;
  smallSize?: number;
  gradientWeight?: number;
}

function nearest(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  ch: number,
): Float32Array {
  const out = new Float32Array(dw * dh * ch);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      const s = (sy * sw + sx) * ch,
        o = (y * dw + x) * ch;
      for (let c = 0; c < ch; c++) out[o + c] = src[s + c];
    }
  }
  return out;
}

export function estimateForeground(
  image: ArrayLike<number>,
  alpha: Float32Array,
  w: number,
  h: number,
  stride = 4,
  opts: ForegroundOptions = {},
): { F: Float32Array; B: Float32Array } {
  const reg = opts.regularization ?? 1e-5;
  const smallIt = opts.smallIterations ?? 10,
    bigIt = opts.bigIterations ?? 2;
  const smallSize = opts.smallSize ?? 32,
    gw = opts.gradientWeight ?? 1;
  const n = w * h;
  const img = new Float32Array(n * 3);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) img[i * 3 + c] = image[i * stride + c] / 255;

  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) mean[c] += img[i * 3 + c] / n;
  let F: Float32Array = Float32Array.from(mean),
    B: Float32Array = Float32Array.from(mean);
  let pw = 1,
    ph = 1;
  const levels = Math.ceil(Math.log2(Math.max(w, h)));
  for (let lvl = 0; lvl <= levels; lvl++) {
    const lw = levels ? Math.round(w ** (lvl / levels)) : w;
    const lh = levels ? Math.round(h ** (lvl / levels)) : h;
    const I = lw === w && lh === h ? img : nearest(img, w, h, lw, lh, 3);
    const A = lw === w && lh === h ? alpha : nearest(alpha, w, h, lw, lh, 1);
    F = nearest(F, pw, ph, lw, lh, 3);
    B = nearest(B, pw, ph, lw, lh, 3);
    const iters = lw <= smallSize && lh <= smallSize ? smallIt : bigIt;
    for (let it = 0; it < iters; it++) {
      for (let y = 0; y < lh; y++) {
        for (let x = 0; x < lw; x++) {
          const i = y * lw + x;
          const a0 = A[i],
            a1 = 1 - a0;
          let a00 = a0 * a0,
            a11 = a1 * a1;
          const a01 = a0 * a1;
          let f0 = I[i * 3] * a0,
            f1 = I[i * 3 + 1] * a0,
            f2 = I[i * 3 + 2] * a0;
          let b0 = I[i * 3] * a1,
            b1 = I[i * 3 + 1] * a1,
            b2 = I[i * 3 + 2] * a1;
          for (let k = 0; k < 4; k++) {
            const nx =
              k === 0
                ? Math.max(0, x - 1)
                : k === 1
                  ? Math.min(lw - 1, x + 1)
                  : x;
            const ny =
              k === 2
                ? Math.max(0, y - 1)
                : k === 3
                  ? Math.min(lh - 1, y + 1)
                  : y;
            const j = ny * lw + nx;
            const da = reg + gw * Math.abs(a0 - A[j]);
            a00 += da;
            a11 += da;
            f0 += da * F[j * 3];
            f1 += da * F[j * 3 + 1];
            f2 += da * F[j * 3 + 2];
            b0 += da * B[j * 3];
            b1 += da * B[j * 3 + 1];
            b2 += da * B[j * 3 + 2];
          }
          const inv = 1 / (a00 * a11 - a01 * a01);
          const m00 = inv * a11,
            m01 = -inv * a01,
            m11 = inv * a00;
          const c = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
          F[i * 3] = c(m00 * f0 + m01 * b0);
          F[i * 3 + 1] = c(m00 * f1 + m01 * b1);
          F[i * 3 + 2] = c(m00 * f2 + m01 * b2);
          B[i * 3] = c(m01 * f0 + m11 * b0);
          B[i * 3 + 1] = c(m01 * f1 + m11 * b1);
          B[i * 3 + 2] = c(m01 * f2 + m11 * b2);
        }
      }
    }
    pw = lw;
    ph = lh;
  }
  return { F, B };
}

export function foregroundRgba(
  F: Float32Array,
  n: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = F[i * 3] * 255 + 0.5;
    out[i * 4 + 1] = F[i * 3 + 1] * 255 + 0.5;
    out[i * 4 + 2] = F[i * 3 + 2] * 255 + 0.5;
    out[i * 4 + 3] = 255;
  }
  return out;
}
