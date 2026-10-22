export function boxBlur(
  src: Float32Array,
  w: number,
  h: number,
  r: number,
): Float32Array {
  const out = new Float32Array(src.length);
  if (r < 1) {
    out.set(src);
    return out;
  }
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) sum += src[row + x];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1);
      if (x + r + 1 < w) sum += src[row + x + r + 1];
      if (x - r >= 0) sum -= src[row + x - r];
    }
  }
  const col = new Float64Array(w);
  for (let y = 0; y <= Math.min(r, h - 1); y++)
    for (let x = 0; x < w; x++) col[x] += tmp[y * w + x];
  for (let y = 0; y < h; y++) {
    const n = Math.min(h - 1, y + r) - Math.max(0, y - r) + 1;
    const row = y * w;
    for (let x = 0; x < w; x++) out[row + x] = col[x] / n;
    if (y + r + 1 < h) {
      const add = (y + r + 1) * w;
      for (let x = 0; x < w; x++) col[x] += tmp[add + x];
    }
    if (y - r >= 0) {
      const sub = (y - r) * w;
      for (let x = 0; x < w; x++) col[x] -= tmp[sub + x];
    }
  }
  return out;
}

export function dilateBinary(
  m: Uint8Array,
  w: number,
  h: number,
  r: number,
): Uint8Array {
  if (r <= 0) return m.slice();
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

export function rankFilter(
  src: Float32Array,
  w: number,
  h: number,
  r: number,
  mode: "max" | "min",
): Float32Array {
  const pick = mode === "max" ? Math.max : Math.min;
  const tmp = new Float32Array(src.length),
    out = new Float32Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = src[y * w + x];
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++)
        v = pick(v, src[y * w + k]);
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++)
        v = pick(v, tmp[k * w + x]);
      out[y * w + x] = v;
    }
  return out;
}

export function rgbPlanes(
  rgba: ArrayLike<number>,
  n: number,
): [Float32Array, Float32Array, Float32Array] {
  const r = new Float32Array(n),
    g = new Float32Array(n),
    b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = rgba[i * 4] / 255;
    g[i] = rgba[i * 4 + 1] / 255;
    b[i] = rgba[i * 4 + 2] / 255;
  }
  return [r, g, b];
}

export function guidedFilter(
  I: [Float32Array, Float32Array, Float32Array],
  p: Float32Array,
  w: number,
  h: number,
  r: number,
  eps: number,
): Float32Array {
  const n = w * h;
  const [R, G, B] = I;
  const box = (a: Float32Array) => boxBlur(a, w, h, r);
  const prod = (a: Float32Array, b: Float32Array) => {
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = a[i] * b[i];
    return o;
  };
  const mR = box(R),
    mG = box(G),
    mB = box(B),
    mP = box(p);
  const mRP = box(prod(R, p)),
    mGP = box(prod(G, p)),
    mBP = box(prod(B, p));
  const vRR = box(prod(R, R)),
    vRG = box(prod(R, G)),
    vRB = box(prod(R, B));
  const vGG = box(prod(G, G)),
    vGB = box(prod(G, B)),
    vBB = box(prod(B, B));
  const aR = new Float32Array(n),
    aG = new Float32Array(n),
    aB = new Float32Array(n),
    b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const mr = mR[i],
      mg = mG[i],
      mb = mB[i],
      mp = mP[i];
    const rr = vRR[i] - mr * mr + eps,
      rg = vRG[i] - mr * mg,
      rb = vRB[i] - mr * mb;
    const gg = vGG[i] - mg * mg + eps,
      gb = vGB[i] - mg * mb,
      bb = vBB[i] - mb * mb + eps;
    const cr = mRP[i] - mr * mp,
      cg = mGP[i] - mg * mp,
      cb = mBP[i] - mb * mp;
    const i00 = gg * bb - gb * gb,
      i01 = rb * gb - rg * bb,
      i02 = rg * gb - rb * gg;
    const i11 = rr * bb - rb * rb,
      i12 = rb * rg - rr * gb,
      i22 = rr * gg - rg * rg;
    const det = rr * i00 + rg * i01 + rb * i02;
    const ar = (i00 * cr + i01 * cg + i02 * cb) / det;
    const ag = (i01 * cr + i11 * cg + i12 * cb) / det;
    const ab = (i02 * cr + i12 * cg + i22 * cb) / det;
    aR[i] = ar;
    aG[i] = ag;
    aB[i] = ab;
    b[i] = mp - ar * mr - ag * mg - ab * mb;
  }
  const mAR = box(aR),
    mAG = box(aG),
    mAB = box(aB),
    mb = box(b);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++)
    q[i] = mAR[i] * R[i] + mAG[i] * G[i] + mAB[i] * B[i] + mb[i];
  return q;
}
