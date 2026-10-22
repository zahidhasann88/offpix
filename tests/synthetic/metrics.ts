export function unknownBand(
  gt: Float32Array,
  w: number,
  h: number,
  r: number,
): Uint8Array {
  const n = w * h;
  const seed = new Uint8Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        a = gt[i];
      if (a > 0.02 && a < 0.98) {
        seed[i] = 1;
        continue;
      }
      if (x + 1 < w && Math.abs(gt[i + 1] - a) > 0.5) seed[i] = 1;
      if (y + 1 < h && Math.abs(gt[i + w] - a) > 0.5) seed[i] = 1;
    }
  return dilate(seed, w, h, r);
}

export function dilate(
  m: Uint8Array,
  w: number,
  h: number,
  r: number,
): Uint8Array {
  const tmp = new Uint8Array(m.length),
    out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    let last = -Infinity;
    for (let x = 0; x < w + r; x++) {
      if (x < w && m[y * w + x]) last = x;
      const t = x - r;
      if (t >= 0) tmp[y * w + t] = x - last <= 2 * r ? 1 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h + r; y++) {
      if (y < h && tmp[y * w + x]) last = y;
      const t = y - r;
      if (t >= 0) out[t * w + x] = y - last <= 2 * r ? 1 : 0;
    }
  }
  return out;
}

export function sad(
  a: Float32Array,
  gt: Float32Array,
  band: Uint8Array,
): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) if (band[i]) s += Math.abs(a[i] - gt[i]);
  return s / 1000;
}

export function mse(
  a: Float32Array,
  gt: Float32Array,
  band: Uint8Array,
): number {
  let s = 0,
    n = 0;
  for (let i = 0; i < a.length; i++)
    if (band[i]) {
      const d = a[i] - gt[i];
      s += d * d;
      n++;
    }
  return n ? s / n : 0;
}

function gradMag(a: Float32Array, w: number, h: number): Float32Array {
  const sigma = 1.4,
    r = Math.ceil(3 * sigma);
  const g = Float32Array.from({ length: 2 * r + 1 }, (_, i) =>
    Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)),
  );
  const dg = Float32Array.from(
    { length: 2 * r + 1 },
    (_, i) => (-(i - r) / (sigma * sigma)) * g[i],
  );
  const gs = g.reduce((p, q) => p + q, 0);
  const dgs = dg.reduce((p, q, i) => p + Math.abs(q * (i - r)), 0);
  const conv = (
    src: Float32Array,
    k: Float32Array,
    ks: number,
    horiz: boolean,
  ) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let j = -r; j <= r; j++) {
          const xx = horiz ? Math.min(w - 1, Math.max(0, x + j)) : x;
          const yy = horiz ? y : Math.min(h - 1, Math.max(0, y + j));
          s += src[yy * w + xx] * k[j + r];
        }
        out[y * w + x] = s / ks;
      }
    return out;
  };
  const gx = conv(conv(a, dg, dgs, true), g, gs, false);
  const gy = conv(conv(a, g, gs, true), dg, dgs, false);
  return Float32Array.from(gx, (v, i) => Math.hypot(v, gy[i]));
}

export function gradientError(
  a: Float32Array,
  gt: Float32Array,
  w: number,
  h: number,
  band: Uint8Array,
): number {
  const ga = gradMag(a, w, h),
    gg = gradMag(gt, w, h);
  let s = 0;
  for (let i = 0; i < a.length; i++) if (band[i]) s += (ga[i] - gg[i]) ** 2;
  return s / 1000;
}

function largestComponent(m: Uint8Array, w: number, _h: number): Uint8Array {
  const label = new Int32Array(m.length);
  let best = 0,
    bestSize = 0,
    next = 0;
  const stack: number[] = [];
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || label[s]) continue;
    next++;
    let size = 0;
    label[s] = next;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!,
        x = i % w;
      size++;
      for (const j of [
        x > 0 ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
        i - w,
        i + w,
      ]) {
        if (j >= 0 && j < m.length && m[j] && !label[j]) {
          label[j] = next;
          stack.push(j);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  return Uint8Array.from(label, (l) => (l === best && best ? 1 : 0));
}

export function connectivityError(
  a: Float32Array,
  gt: Float32Array,
  w: number,
  h: number,
  band: Uint8Array,
  step = 0.1,
): number {
  const n = a.length;
  const l = new Float32Array(n).fill(-1);
  for (let t = step; t <= 1 + 1e-9; t += step) {
    const both = new Uint8Array(n);
    for (let i = 0; i < n; i++) both[i] = a[i] >= t && gt[i] >= t ? 1 : 0;
    const omega = largestComponent(both, w, h);
    for (let i = 0; i < n; i++) if (l[i] === -1 && !omega[i]) l[i] = t - step;
  }
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (!band[i]) continue;
    const li = l[i] === -1 ? 1 : l[i];
    const da = a[i] - li,
      dg = gt[i] - li;
    const pa = 1 - (da >= 0.15 ? da : 0),
      pg = 1 - (dg >= 0.15 ? dg : 0);
    s += Math.abs(pa - pg);
  }
  return s / 1000;
}

const lum = (r: number, g: number, b: number) =>
  0.299 * r + 0.587 * g + 0.114 * b;

export function haloOverBlack(
  out: Uint8ClampedArray | Uint8Array,
  gtAlpha: Float32Array,
  gtFg: Float32Array,
  band: Uint8Array,
) {
  let o = 0,
    g = 0,
    n = 0;
  for (let i = 0; i < gtAlpha.length; i++) {
    if (!band[i]) continue;
    const a = out[i * 4 + 3] / 255;
    if (a < 0.01 && gtAlpha[i] < 0.01) continue;
    o += a * lum(out[i * 4] / 255, out[i * 4 + 1] / 255, out[i * 4 + 2] / 255);
    g += gtAlpha[i] * lum(gtFg[i * 3], gtFg[i * 3 + 1], gtFg[i * 3 + 2]);
    n++;
  }
  return { output: n ? o / n : 0, truth: n ? g / n : 0, pixels: n };
}

export function alphaOver(alpha: Float32Array, mask: Uint8Array) {
  let min = 1,
    sum = 0,
    n = 0;
  for (let i = 0; i < alpha.length; i++)
    if (mask[i]) {
      min = Math.min(min, alpha[i]);
      sum += alpha[i];
      n++;
    }
  return { min, mean: n ? sum / n : 1, pixels: n };
}

export function shadowRegion(
  gtAlpha: Float32Array,
  shadow: Float32Array,
  minShadow = 0.05,
): Uint8Array {
  return Uint8Array.from(gtAlpha, (a, i) =>
    a < 0.02 && shadow[i] >= minShadow ? 1 : 0,
  );
}

export function reconstructionError(
  image: Uint8ClampedArray,
  alpha: Float32Array,
  fg: Float32Array,
  bg: Float32Array,
  band: Uint8Array,
) {
  let max = 0,
    sum = 0,
    n = 0;
  for (let i = 0; i < alpha.length; i++) {
    if (!band[i]) continue;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(
        image[i * 4 + c] / 255 -
          (alpha[i] * fg[i * 3 + c] + (1 - alpha[i]) * bg[i * 3 + c]),
      );
      max = Math.max(max, d);
      sum += d;
      n++;
    }
  }
  return { max, mean: n ? sum / n : 0 };
}
