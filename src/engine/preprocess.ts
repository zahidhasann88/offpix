export function bilinearResize(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  const dst = new Float32Array(dstW * dstH);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(srcH - 1, Math.max(0, (y + 0.5) * yRatio - 0.5));
    const y0 = Math.floor(srcY);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const dy = srcY - y0;
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(srcW - 1, Math.max(0, (x + 0.5) * xRatio - 0.5));
      const x0 = Math.floor(srcX);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const dx = srcX - x0;
      const v00 = src[y0 * srcW + x0];
      const v10 = src[y0 * srcW + x1];
      const v01 = src[y1 * srcW + x0];
      const v11 = src[y1 * srcW + x1];
      dst[y * dstW + x] =
        v00 * (1 - dx) * (1 - dy) +
        v10 * dx * (1 - dy) +
        v01 * (1 - dx) * dy +
        v11 * dx * dy;
    }
  }
  return dst;
}

export function rgbaToNCHW(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  mean: readonly number[] = [0, 0, 0],
  std: readonly number[] = [1, 1, 1],
  channels: "RGB" | "BGR" = "RGB",
): Float32Array {
  const plane = w * h;
  const out = new Float32Array(3 * plane);
  const src = channels === "RGB" ? [0, 1, 2] : [2, 1, 0];
  for (let c = 0; c < 3; c++) {
    const o = c * plane,
      s = src[c],
      m = mean[c],
      d = std[c];
    for (let i = 0; i < plane; i++)
      out[o + i] = (rgba[i * 4 + s] / 255 - m) / d;
  }
  return out;
}

export function normalizeMask(
  data: Float32Array,
  always = false,
): Float32Array {
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }
  const out = new Float32Array(data.length);
  if (always || max > 1 || min < 0) {
    const range = max - min || 1;
    for (let i = 0; i < data.length; i++) out[i] = (data[i] - min) / range;
  } else {
    for (let i = 0; i < data.length; i++) out[i] = data[i];
  }
  return out;
}

function axisTaps(
  src: number,
  dst: number,
): { idx: Int32Array; wgt: Float32Array; start: Int32Array } {
  const scale = src / dst;
  const idx: number[] = [],
    wgt: number[] = [],
    start: number[] = [];
  for (let o = 0; o < dst; o++) {
    start.push(idx.length);
    if (scale > 1) {
      const a = o * scale,
        b = a + scale;
      for (let s = Math.floor(a); s < Math.min(src, Math.ceil(b)); s++) {
        idx.push(s);
        wgt.push((Math.min(b, s + 1) - Math.max(a, s)) / scale);
      }
    } else {
      const c = Math.min(src - 1, Math.max(0, (o + 0.5) * scale - 0.5));
      const s0 = Math.floor(c),
        s1 = Math.min(s0 + 1, src - 1),
        d = c - s0;
      idx.push(s0);
      wgt.push(1 - d);
      if (s1 !== s0) {
        idx.push(s1);
        wgt.push(d);
      }
    }
  }
  start.push(idx.length);
  return {
    idx: Int32Array.from(idx),
    wgt: Float32Array.from(wgt),
    start: Int32Array.from(start),
  };
}

export function resizeInterleaved(
  src: ArrayLike<number>,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  ch: number,
): Float32Array {
  const tx = axisTaps(sw, dw),
    ty = axisTaps(sh, dh);
  const tmp = new Float32Array(dw * sh * ch);
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < dw; x++) {
      const o = (y * dw + x) * ch;
      for (let k = tx.start[x]; k < tx.start[x + 1]; k++) {
        const s = (y * sw + tx.idx[k]) * ch,
          wv = tx.wgt[k];
        for (let c = 0; c < ch; c++) tmp[o + c] += src[s + c] * wv;
      }
    }
  const out = new Float32Array(dw * dh * ch);
  for (let y = 0; y < dh; y++)
    for (let k = ty.start[y]; k < ty.start[y + 1]; k++) {
      const sRow = ty.idx[k] * dw * ch,
        oRow = y * dw * ch,
        wv = ty.wgt[k];
      for (let i = 0; i < dw * ch; i++) out[oRow + i] += tmp[sRow + i] * wv;
    }
  return out;
}

export interface InputMap {
  w: number;
  h: number;
  size: number;
  dw: number;
  dh: number;
  ox: number;
  oy: number;
}

export function inputMap(
  w: number,
  h: number,
  size: number,
  letterbox: boolean,
): InputMap {
  if (!letterbox) return { w, h, size, dw: size, dh: size, ox: 0, oy: 0 };
  const s = size / Math.max(w, h);
  const dw = Math.max(1, Math.min(size, Math.round(w * s))),
    dh = Math.max(1, Math.min(size, Math.round(h * s)));
  return {
    w,
    h,
    size,
    dw,
    dh,
    ox: Math.floor((size - dw) / 2),
    oy: Math.floor((size - dh) / 2),
  };
}

export function toModelInput(
  rgba: ArrayLike<number>,
  map: InputMap,
): Uint8ClampedArray {
  const { size, dw, dh, ox, oy } = map;
  const small = resizeInterleaved(rgba, map.w, map.h, dw, dh, 4);
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(dh - 1, Math.max(0, y - oy));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(dw - 1, Math.max(0, x - ox));
      const s = (sy * dw + sx) * 4,
        o = (y * size + x) * 4;
      out[o] = small[s];
      out[o + 1] = small[s + 1];
      out[o + 2] = small[s + 2];
      out[o + 3] = 255;
    }
  }
  return out;
}

export function imageToOutput(
  map: InputMap,
  outSize: number,
  x: number,
  y: number,
): [number, number] {
  const k = outSize / map.size;
  return [
    (map.ox + ((x + 0.5) * map.dw) / map.w) * k - 0.5,
    (map.oy + ((y + 0.5) * map.dh) / map.h) * k - 0.5,
  ];
}

export function outputToImage(
  map: InputMap,
  outSize: number,
  u: number,
  v: number,
): [number, number] {
  const k = outSize / map.size;
  return [
    (((u + 0.5) / k - map.ox) * map.w) / map.dw - 0.5,
    (((v + 0.5) / k - map.oy) * map.h) / map.dh - 0.5,
  ];
}

export function maskToImage(
  mask: Float32Array,
  outSize: number,
  map: InputMap,
): Float32Array {
  const { w, h } = map;
  const k = outSize / map.size;
  const first = (o: number) =>
    Math.min(outSize - 1, Math.max(0, Math.ceil(o * k - 0.5)));
  const last = (o: number, d: number) =>
    Math.max(first(o), Math.min(outSize - 1, Math.ceil((o + d) * k - 0.5) - 1));
  const uMin = first(map.ox),
    vMin = first(map.oy),
    uMax = last(map.ox, map.dw),
    vMax = last(map.oy, map.dh);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const v = Math.min(
      vMax,
      Math.max(vMin, imageToOutput(map, outSize, 0, y)[1]),
    );
    const y0 = Math.floor(v),
      y1 = Math.min(y0 + 1, outSize - 1),
      dy = v - y0;
    for (let x = 0; x < w; x++) {
      const u = Math.min(
        uMax,
        Math.max(uMin, imageToOutput(map, outSize, x, 0)[0]),
      );
      const x0 = Math.floor(u),
        x1 = Math.min(x0 + 1, outSize - 1),
        dx = u - x0;
      out[y * w + x] =
        mask[y0 * outSize + x0] * (1 - dx) * (1 - dy) +
        mask[y0 * outSize + x1] * dx * (1 - dy) +
        mask[y1 * outSize + x0] * (1 - dx) * dy +
        mask[y1 * outSize + x1] * dx * dy;
    }
  }
  return out;
}
