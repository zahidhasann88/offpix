import { boxBlur } from "../tools/filters";

const lum = (r: number, g: number, b: number) =>
  0.299 * r + 0.587 * g + 0.114 * b;

export function aspectMapping(w: number, h: number, size: number) {
  const sx = size / w,
    sy = size / h;
  return {
    scaleX: sx,
    scaleY: sy,
    distortion: Math.max(sx, sy) / Math.min(sx, sy),
  };
}

export function tensorStats(nchw: Float32Array, plane: number) {
  const mean: number[] = [],
    min: number[] = [],
    max: number[] = [];
  for (let c = 0; c < 3; c++) {
    let s = 0,
      lo = Infinity,
      hi = -Infinity;
    for (let i = c * plane; i < (c + 1) * plane; i++) {
      const v = nchw[i];
      s += v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    mean.push(s / plane);
    min.push(lo);
    max.push(hi);
  }
  return { mean, min, max };
}

export function rembgTensorDiff(
  rgba: Uint8ClampedArray,
  ours: Float32Array,
  mean: readonly number[],
  std: readonly number[],
): number {
  const plane = rgba.length / 4;
  let mx = 0;
  for (let i = 0; i < plane; i++)
    for (let c = 0; c < 3; c++) mx = Math.max(mx, rgba[i * 4 + c]);
  mx = Math.max(mx, 1e-6);
  let d = 0;
  for (let c = 0; c < 3; c++)
    for (let i = 0; i < plane; i++) {
      d = Math.max(
        d,
        Math.abs(
          (rgba[i * 4 + c] / mx - mean[c]) / std[c] - ours[c * plane + i],
        ),
      );
    }
  return d;
}

export function areaResizeRgba(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  const out = new Float32Array(dw * dh * 4);
  const fx = sw / dw,
    fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = y * fy,
      y1 = y0 + fy;
    for (let x = 0; x < dw; x++) {
      const x0 = x * fx,
        x1 = x0 + fx;
      let wsum = 0;
      const acc = [0, 0, 0, 0];
      for (let yy = Math.floor(y0); yy < Math.min(sh, Math.ceil(y1)); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.min(sw, Math.ceil(x1)); xx++) {
          const wgt = wy * (Math.min(x1, xx + 1) - Math.max(x0, xx));
          const q = (yy * sw + xx) * 4;
          for (let c = 0; c < 4; c++) acc[c] += src[q + c] * wgt;
          wsum += wgt;
        }
      }
      for (let c = 0; c < 4; c++) out[(y * dw + x) * 4 + c] = acc[c] / wsum;
    }
  }
  return out;
}

export function psnrRgb(a: Uint8ClampedArray, ref: Float32Array): number {
  let se = 0,
    n = 0;
  for (let i = 0; i < a.length; i += 4)
    for (let c = 0; c < 3; c++) {
      const d = a[i + c] - ref[i + c];
      se += d * d;
      n++;
    }
  return 10 * Math.log10((255 * 255) / Math.max(se / n, 1e-12));
}

export function alphaStats(alpha: Uint8ClampedArray | Uint8Array) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < alpha.length; i++) hist[alpha[i]]++;
  const n = alpha.length;
  const partial = n - hist[0] - hist[255];
  let levels = 0;
  for (let v = 1; v < 255; v++) if (hist[v]) levels++;
  const bins = Array.from({ length: 8 }, (_, b) => {
    let s = 0;
    for (let v = Math.max(1, b * 32); v < Math.min(255, (b + 1) * 32); v++)
      s += hist[v];
    return partial ? s / partial : 0;
  });
  return {
    zero: hist[0] / n,
    one: hist[255] / n,
    partial: partial / n,
    partialPixels: partial,
    partialLevels: levels,
    bins,
  };
}

export function transitionWidth(
  alpha: Float32Array,
  w: number,
  h: number,
): number {
  const widths: number[] = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x,
        a = alpha[i];
      if (a <= 0.1 || a >= 0.9) continue;
      const gx = (alpha[i + 1] - alpha[i - 1]) / 2,
        gy = (alpha[i + w] - alpha[i - w]) / 2;
      const g = Math.hypot(gx, gy);
      if (g > 1e-4) widths.push(0.8 / g);
    }
  if (!widths.length) return 0;
  widths.sort((p, q) => p - q);
  return widths[widths.length >> 1];
}

export function ridgeStats(alpha: Float32Array, w: number, h: number) {
  let count = 0,
    height = 0;
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x,
        a = alpha[i];
      if (a < 0.15) continue;
      const hx = a - Math.max(alpha[i - 2], alpha[i + 2]);
      const hy = a - Math.max(alpha[i - 2 * w], alpha[i + 2 * w]);
      const r = Math.max(hx, hy);
      if (r > 0.05) {
        count++;
        height += r;
      }
    }
  return { count, meanHeight: count ? height / count : 0 };
}

export function borderColour(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  depth = 4,
  tol = 0.06,
) {
  const hist = [
    new Uint32Array(256),
    new Uint32Array(256),
    new Uint32Array(256),
  ];
  const idx: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (x >= depth && x < w - depth && y >= depth && y < h - depth) continue;
      const q = (y * w + x) * 4;
      idx.push(q);
      for (let c = 0; c < 3; c++) hist[c][rgba[q + c]]++;
    }
  const mean = hist.map((hc) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hc[v];
      if (acc * 2 >= idx.length) return v / 255;
    }
    return 1;
  });
  let near = 0;
  for (const q of idx) {
    if (
      Math.max(
        Math.abs(rgba[q] / 255 - mean[0]),
        Math.abs(rgba[q + 1] / 255 - mean[1]),
        Math.abs(rgba[q + 2] / 255 - mean[2]),
      ) <= tol
    )
      near++;
  }
  return { mean, uniformShare: near / idx.length };
}

export function edgeSpill(
  fg: Uint8ClampedArray,
  alpha: Float32Array,
  w: number,
  h: number,
  bg: number[],
  radius: number,
) {
  const n = w * h;
  const core = new Float32Array(n);
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    if (alpha[i] > 0.98) {
      core[i] = 1;
      for (let c = 0; c < 3; c++) ch[c][i] = fg[i * 4 + c] / 255;
    }
  }
  const wsum = boxBlur(core, w, h, radius);
  const cs = ch.map((c) => boxBlur(c, w, h, radius));
  let spill = 0,
    halo = 0,
    cnt = 0;
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    if (a <= 0.05 || a >= 0.95 || wsum[i] < 1e-3) continue;
    const F = [fg[i * 4] / 255, fg[i * 4 + 1] / 255, fg[i * 4 + 2] / 255];
    const Fc = cs.map((c) => c[i] / wsum[i]);
    const d = [bg[0] - Fc[0], bg[1] - Fc[1], bg[2] - Fc[2]];
    const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    if (dd < 0.01) continue;
    spill +=
      ((F[0] - Fc[0]) * d[0] + (F[1] - Fc[1]) * d[1] + (F[2] - Fc[2]) * d[2]) /
      dd;
    halo += a * (lum(F[0], F[1], F[2]) - lum(Fc[0], Fc[1], Fc[2]));
    cnt++;
  }
  return {
    pixels: cnt,
    spill: cnt ? spill / cnt : 0,
    haloOverBlack: cnt ? halo / cnt : 0,
  };
}

export function premultipliedGridShare(
  rgba: Uint8ClampedArray | Uint8Array,
  maxAlpha = 16,
) {
  const grids: Set<number>[] = [];
  for (let a = 1; a <= maxAlpha; a++) {
    const s = new Set<number>();
    for (let k = 0; k <= a; k++) {
      s.add(Math.min(255, Math.round((k * 255) / a)));
      s.add(Math.min(255, Math.floor((k * 255) / a)));
    }
    grids[a] = s;
  }
  let on = 0,
    total = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a < 1 || a > maxAlpha) continue;
    for (let c = 0; c < 3; c++) {
      total++;
      if (grids[a].has(rgba[i + c])) on++;
    }
  }
  return { share: total ? on / total : 0, samples: total };
}

export function lowAlphaColourError(
  exported: Uint8ClampedArray | Uint8Array,
  exact: Uint8ClampedArray,
  maxAlpha = 16,
) {
  let e = 0,
    n = 0;
  for (let i = 0; i < exact.length; i += 4) {
    const a = exact[i + 3];
    if (a < 1 || a > maxAlpha) continue;
    for (let c = 0; c < 3; c++) {
      e += Math.abs(exported[i + c] - exact[i + c]);
      n++;
    }
  }
  return { meanAbs: n ? e / n : 0, samples: n };
}

export function enclosedHoles(
  alpha: Float32Array,
  w: number,
  h: number,
): Uint8Array {
  const n = w * h;
  const outside = new Uint8Array(n);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!outside[i] && alpha[i] < 0.5) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!,
      x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < n - w) push(i + w);
  }
  const holes = new Uint8Array(n);
  for (let i = 0; i < n; i++) holes[i] = alpha[i] < 0.5 && !outside[i] ? 1 : 0;
  return holes;
}

export function highlightLoss(
  rgba: Uint8ClampedArray,
  alpha: Float32Array,
  w: number,
  h: number,
  bg: number[],
  tol = 0.12,
) {
  const holes = enclosedHoles(alpha, w, h);
  let holePx = 0,
    bgLikeInside = 0,
    bgLikeLost = 0;
  for (let i = 0; i < w * h; i++) {
    const inside = holes[i] || alpha[i] >= 0.5;
    if (holes[i]) holePx++;
    if (!inside) continue;
    const q = i * 4;
    const d = Math.max(
      Math.abs(rgba[q] / 255 - bg[0]),
      Math.abs(rgba[q + 1] / 255 - bg[1]),
      Math.abs(rgba[q + 2] / 255 - bg[2]),
    );
    if (d > tol) continue;
    bgLikeInside++;
    if (alpha[i] < 0.99) bgLikeLost++;
  }
  return {
    holePixels: holePx,
    bgLikeInside,
    bgLikeLost,
    lostShare: bgLikeInside ? bgLikeLost / bgLikeInside : 0,
    holes,
  };
}

export function shadowKept(
  rgba: Uint8ClampedArray,
  alpha: Float32Array,
  w: number,
  h: number,
  bg: number[],
) {
  const map = new Uint8Array(w * h);
  let shadowPx = 0,
    kept = 0,
    partial = 0,
    alphaSum = 0;
  const bl = lum(bg[0], bg[1], bg[2]);
  for (let i = 0; i < w * h; i++) {
    const q = i * 4;
    const C = [rgba[q] / 255, rgba[q + 1] / 255, rgba[q + 2] / 255];
    const k = lum(C[0], C[1], C[2]) / Math.max(bl, 1e-3);
    if (k <= 0.55 || k >= 0.97) continue;
    const res = Math.max(
      Math.abs(C[0] - k * bg[0]),
      Math.abs(C[1] - k * bg[1]),
      Math.abs(C[2] - k * bg[2]),
    );
    if (res > 0.03) continue;
    if (alpha[i] > 0.98) continue;
    map[i] = 1;
    shadowPx++;
    alphaSum += alpha[i];
    if (alpha[i] > 0.5) kept++;
    else if (alpha[i] > 0.02) partial++;
  }
  return {
    shadowPixels: shadowPx,
    keptOver50: kept,
    partial2to50: partial,
    meanAlpha: shadowPx ? alphaSum / shadowPx : 0,
    map,
  };
}

export function changeAwayFromEdges(before: Float32Array, after: Float32Array) {
  let bgMax = 0,
    fgMax = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i] < 0.001) bgMax = Math.max(bgMax, after[i]);
    else if (before[i] > 0.999) fgMax = Math.max(fgMax, 1 - after[i]);
  }
  return { bgGainedAlpha: bgMax, fgLostAlpha: fgMax };
}
