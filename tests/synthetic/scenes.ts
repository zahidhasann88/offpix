export type Subject = "hair" | "device" | "phone" | "ring";
export type Backdrop = "white" | "gradient" | "texture" | "beige";

export interface Scene {
  name: string;
  w: number;
  h: number;
  image: Uint8ClampedArray;
  alpha: Float32Array;
  fg: Float32Array;
  bg: Float32Array;
  shadow: Float32Array;
  highlight: Uint8Array;
  corners: Uint8Array;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function backdrop(
  kind: Backdrop,
  w: number,
  h: number,
  seed: number,
): Float32Array {
  const bg = new Float32Array(w * h * 3);
  const rand = rng(seed);
  const gs = 16,
    gw = Math.ceil(w / gs) + 2,
    gh = Math.ceil(h / gs) + 2;
  const grid = Float32Array.from({ length: gw * gh * 3 }, () => rand());
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      if (kind === "white") {
        bg[o] = bg[o + 1] = bg[o + 2] = 1;
        continue;
      }
      if (kind === "gradient") {
        const t = (x / w) * 0.6 + (y / h) * 0.4;
        bg[o] = 0.95 - 0.35 * t;
        bg[o + 1] = 0.93 - 0.2 * t;
        bg[o + 2] = 0.88 + 0.1 * t;
        continue;
      }
      if (kind === "beige") {
        const v = 1 - 0.18 * Math.hypot(x / w - 0.5, y / h - 0.45) * 2;
        bg[o] = 0.86 * v;
        bg[o + 1] = 0.76 * v;
        bg[o + 2] = 0.63 * v;
        continue;
      }
      const gx = x / gs,
        gy = y / gs,
        x0 = Math.floor(gx),
        y0 = Math.floor(gy),
        dx = gx - x0,
        dy = gy - y0;
      for (let c = 0; c < 3; c++) {
        const g = (xx: number, yy: number) => grid[(yy * gw + xx) * 3 + c];
        const v =
          g(x0, y0) * (1 - dx) * (1 - dy) +
          g(x0 + 1, y0) * dx * (1 - dy) +
          g(x0, y0 + 1) * (1 - dx) * dy +
          g(x0 + 1, y0 + 1) * dx * dy;
        const stripes = 0.08 * Math.sin((x + 2 * y) * 0.21 + c);
        bg[o + c] = clamp01(0.35 + 0.45 * v + stripes);
      }
    }
  return bg;
}

function over(
  alpha: Float32Array,
  fg: Float32Array,
  i: number,
  a: number,
  col: readonly number[],
) {
  if (a <= 0) return;
  const prev = alpha[i];
  const na = a + prev * (1 - a);
  for (let c = 0; c < 3; c++)
    fg[i * 3 + c] = (col[c] * a + fg[i * 3 + c] * prev * (1 - a)) / na;
  alpha[i] = na;
}

function drawHair(
  w: number,
  h: number,
  alpha: Float32Array,
  fg: Float32Array,
  seed: number,
) {
  const rand = rng(seed);
  const cx = w * 0.5,
    cy = h * 0.62,
    rx = w * 0.24,
    ry = h * 0.3;
  const hairCol = [0.08, 0.06, 0.05],
    skin = [0.72, 0.52, 0.4];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - cx) / rx,
        ny = (y + 0.5 - cy) / ry;
      const d = (Math.hypot(nx, ny) - 1) * Math.min(rx, ry);
      const a = clamp01(0.5 - d);
      if (a > 0) over(alpha, fg, y * w + x, a, ny < -0.15 ? hairCol : skin);
    }
  const strands = Math.round(w * 0.9);
  for (let s = 0; s < strands; s++) {
    const t = Math.PI * (1.05 + rand() * 0.9);
    let x = cx + Math.cos(t) * rx * 0.97,
      y = cy + Math.sin(t) * ry * 0.97;
    let dir = t + (rand() - 0.5) * 0.6;
    const width = 0.35 + rand() * 0.6;
    const curl = (rand() < 0.5 ? -1 : 1) * (0.03 + rand() * 0.05);
    const wave = 0.08 + rand() * 0.1,
      phase = rand() * 6.28;
    const len = w * (0.1 + rand() * 0.25);
    const col = [
      hairCol[0] + rand() * 0.08,
      hairCol[1] + rand() * 0.05,
      hairCol[2] + rand() * 0.04,
    ];
    for (let k = 0; k < len; k++) {
      dir += curl + wave * Math.sin(k * 0.12 + phase) + (rand() - 0.5) * 0.08;
      const nx = x + Math.cos(dir) * 0.8,
        ny = y + Math.sin(dir) * 0.8;
      const x0 = Math.floor(Math.min(x, nx) - 2),
        x1 = Math.ceil(Math.max(x, nx) + 2);
      const y0 = Math.floor(Math.min(y, ny) - 2),
        y1 = Math.ceil(Math.max(y, ny) + 2);
      for (let py = Math.max(0, y0); py < Math.min(h, y1); py++)
        for (let px = Math.max(0, x0); px < Math.min(w, x1); px++) {
          let cov = 0;
          for (const [ox, oy] of [
            [0.25, 0.25],
            [0.75, 0.25],
            [0.25, 0.75],
            [0.75, 0.75],
          ]) {
            const qx = px + ox,
              qy = py + oy;
            const vx = nx - x,
              vy = ny - y,
              l2 = vx * vx + vy * vy;
            const u = clamp01(((qx - x) * vx + (qy - y) * vy) / l2);
            if (Math.hypot(qx - x - u * vx, qy - y - u * vy) <= width / 2)
              cov += 0.25;
          }
          if (cov) over(alpha, fg, py * w + px, cov * 0.6, col);
        }
      x = nx;
      y = ny;
      if (x < 1 || y < 1 || x > w - 2 || y > h - 2) break;
    }
  }
}

function roundRectSd(
  x: number,
  y: number,
  hw: number,
  hh: number,
  r: number,
): number {
  const qx = Math.abs(x) - hw + r,
    qy = Math.abs(y) - hh + r;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    r
  );
}

function gaussianBlur(
  src: Float32Array,
  w: number,
  h: number,
  sigma: number,
): Float32Array {
  const r = Math.ceil(sigma * 3);
  const k = Float32Array.from({ length: 2 * r + 1 }, (_, i) =>
    Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)),
  );
  const ks = k.reduce((a, b) => a + b, 0);
  const tmp = new Float32Array(src.length),
    out = new Float32Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i;
        if (xx >= 0 && xx < w) s += src[y * w + xx] * k[i + r];
      }
      tmp[y * w + x] = s / ks;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i;
        if (yy >= 0 && yy < h) s += tmp[yy * w + x] * k[i + r];
      }
      out[y * w + x] = s / ks;
    }
  return out;
}

export const REFERENCE_SEED = 7;

function drawDevice(
  w: number,
  h: number,
  alpha: Float32Array,
  fg: Float32Array,
  shadow: Float32Array,
  highlight: Uint8Array,
  blankScreen = false,
  seed = REFERENCE_SEED,
  corners?: Uint8Array,
) {
  const j = rng(seed * 31 + 5);
  const vary = seed !== REFERENCE_SEED;
  const jit = (span: number) => (vary ? (j() - 0.5) * 2 * span : 0);
  const k = 1 + jit(0.1);
  const cx = w * (0.5 + jit(0.04)),
    cy = h * (0.47 + jit(0.04)),
    hw = w * 0.2 * k,
    hh = h * 0.36 * k,
    r = w * 0.06 * k;
  const ang = ((-14 + jit(10)) * Math.PI) / 180,
    ca = Math.cos(ang),
    sa = Math.sin(ang);
  const bezel = w * 0.022;
  const shape = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx,
        dy = y + 0.5 - cy;
      const lx = dx * ca + dy * sa,
        ly = -dx * sa + dy * ca;
      const d = roundRectSd(lx, ly, hw, hh, r);
      const a = clamp01(0.5 - d);
      const i = y * w + x;
      shape[i] = a;
      if (
        corners &&
        Math.abs(lx) > hw - r &&
        Math.abs(ly) > hh - r &&
        Math.abs(d) <= 3
      )
        corners[i] = 1;
      if (!a) continue;
      let col: number[];
      if (d > -bezel) {
        const t = (d + bezel) / bezel;
        const spec = Math.exp(-(((t - 0.45) / 0.12) ** 2));
        const base = 0.62 + 0.18 * Math.sin((ly / hh) * 3);
        const v = clamp01(base + (0.985 - base) * spec);
        col = [v, v, v * 0.99 + 0.01];
        if (spec > 0.9 && a === 1) highlight[i] = 1;
      } else {
        const u = (lx + hw) / (2 * hw),
          v = (ly + hh) / (2 * hh);
        const tile = Math.floor(u * 4) + Math.floor(v * 7) * 4;
        col = blankScreen
          ? [0.985, 0.985, 0.99]
          : tile % 5 === 0
            ? [0.95, 0.45, 0.15]
            : tile % 7 === 0
              ? [0.2, 0.5, 0.95]
              : [0.96, 0.96, 0.97];
      }
      over(alpha, fg, i, a, col);
    }
  const off = new Float32Array(w * h);
  const ox = Math.round(w * 0.03),
    oy = Math.round(h * 0.04);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = x - ox,
        sy = y - oy;
      if (sx >= 0 && sy >= 0 && sx < w && sy < h)
        off[y * w + x] = shape[sy * w + sx];
    }
  const blurred = gaussianBlur(off, w, h, w * 0.025);
  for (let i = 0; i < w * h; i++) shadow[i] = 0.45 * blurred[i];
}

function drawRing(w: number, h: number, alpha: Float32Array, fg: Float32Array) {
  const cx = w * 0.5,
    cy = h * 0.5,
    ro = Math.min(w, h) * 0.36,
    ri = Math.min(w, h) * 0.2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const a = Math.min(clamp01(ro - d + 0.5), clamp01(d - ri + 0.5));
      const shade = 0.75 + 0.2 * Math.cos(Math.atan2(y - cy, x - cx) * 2);
      if (a > 0)
        over(alpha, fg, y * w + x, a, [
          0.85 * shade,
          0.65 * shade,
          0.25 * shade,
        ]);
    }
}

export function makeScene(
  subject: Subject,
  back: Backdrop,
  w = 384,
  h = 384,
  seed = 7,
): Scene {
  const n = w * h;
  const alpha = new Float32Array(n),
    fg = new Float32Array(n * 3),
    shadow = new Float32Array(n),
    highlight = new Uint8Array(n),
    corners = new Uint8Array(n);
  if (subject === "hair") drawHair(w, h, alpha, fg, seed);
  else if (subject === "ring") drawRing(w, h, alpha, fg);
  else
    drawDevice(
      w,
      h,
      alpha,
      fg,
      shadow,
      highlight,
      subject === "phone",
      seed,
      corners,
    );
  const bg = backdrop(back, w, h, seed + 1);
  const image = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const b = bg[i * 3 + c] * (1 - shadow[i]);
      image[i * 4 + c] = Math.round(
        (alpha[i] * fg[i * 3 + c] + (1 - alpha[i]) * b) * 255,
      );
    }
    image[i * 4 + 3] = 255;
  }
  return {
    name: `${subject}-${back}`,
    w,
    h,
    image,
    alpha,
    fg,
    bg,
    shadow,
    highlight,
    corners,
  };
}

export const ALL_SCENES: [Subject, Backdrop][] = [
  ["hair", "white"],
  ["hair", "gradient"],
  ["hair", "texture"],
  ["device", "white"],
  ["device", "gradient"],
  ["device", "texture"],
];
