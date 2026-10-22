import { describe, it, expect } from "vitest";
import {
  buildTrimap,
  bandRadii,
  solveAlpha,
  maskTransitions,
  orientationSpread,
  defaultTrimapParams,
} from "../../src/tools/trimap";
import { boxBlur, rankFilter } from "../../src/tools/filters";
import { makeScene } from "../synthetic/scenes";

const modelLike = (a: Float32Array, w: number, h: number, r = 2) =>
  boxBlur(boxBlur(a, w, h, r), w, h, r);
const count = (
  m: ArrayLike<number>,
  pred: (v: number, i: number) => boolean = (v) => v > 0,
) => {
  let n = 0;
  for (let i = 0; i < m.length; i++) if (pred(m[i], i)) n++;
  return n;
};

describe("unknown band rule", () => {
  it("flat regions: no transitions, so no band and zero complexity", () => {
    const w = 64,
      h = 48;
    for (const v of [0, 1]) {
      const t = buildTrimap(
        new Uint8ClampedArray(w * h * 4).fill(200),
        new Float32Array(w * h).fill(v),
        w,
        h,
        1,
      );
      expect(count(t.unknown)).toBe(0);
      expect(Math.max(...t.complexity)).toBe(0);
      expect(t.sure.every((s) => s === v)).toBe(true);
    }
  });

  it("straight edge: complexity 0, band exactly the soft zone plus the narrow radius each side", () => {
    const w = 200,
      h = 60,
      edge = 100;
    const c = Float32Array.from({ length: w * h }, (_, i) =>
      Math.min(1, Math.max(0, (edge + 1.5 - (i % w)) / 4)),
    );
    const photo = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++)
      photo.fill(Math.round(40 + 200 * (1 - c[i])), i * 4, i * 4 + 4);
    const t = buildTrimap(photo, c, w, h, 1);
    const { narrow } = bandRadii(w, h, 1);
    expect(Math.max(...t.complexity)).toBe(0);
    const row = 30 * w;
    const banded: number[] = [];
    for (let x = 0; x < w; x++) if (t.unknown[row + x]) banded.push(x);
    const soft: number[] = [];
    for (let x = 0; x < w; x++)
      if (c[row + x] > 0.02 && c[row + x] < 0.98) soft.push(x);
    expect(banded[0]).toBe(soft[0] - narrow);
    expect(banded.at(-1)).toBe(soft.at(-1)! + narrow);
  });

  it("hair-like region: high complexity, a wide band that covers the strands", () => {
    const s = makeScene("hair", "white", 384, 384);
    const head = Float32Array.from(s.alpha, (a) => (a > 0.02 ? 1 : 0));
    const c = modelLike(
      rankFilter(boxBlur(head, s.w, s.h, 6), s.w, s.h, 2, "max").map((v) =>
        v > 0.3 ? 1 : 0,
      ),
      s.w,
      s.h,
      3,
    );
    const t = buildTrimap(s.image, c, s.w, s.h, 1.2);
    const fringeRows = (i: number) => Math.floor(i / s.w) < s.h * 0.55;
    const tBoundary = maskTransitions(
      c,
      s.w,
      s.h,
      bandRadii(s.w, s.h, 1.2).narrow,
    );
    const onBoundary = count(tBoundary, (v, i) => v > 0 && fringeRows(i));
    expect(onBoundary).toBeGreaterThan(500);
    expect(
      count(
        t.complexity,
        (k, i) => tBoundary[i] > 0 && fringeRows(i) && k > 0.5,
      ) / onBoundary,
    ).toBeGreaterThan(0.7);
    const strand = (i: number) =>
      s.alpha[i] > 0.05 && s.alpha[i] < 0.95 && fringeRows(i);
    const strands = count(s.alpha, (_, i) => strand(i));
    expect(
      count(t.unknown, (u, i) => strand(i) && u > 0) / strands,
    ).toBeGreaterThan(0.85);
  });

  it("device outline: low complexity along the smooth edge, so the band stays narrow", () => {
    const s = makeScene("device", "white", 384, 384);
    const t = buildTrimap(
      s.image,
      modelLike(s.alpha, s.w, s.h, 1),
      s.w,
      s.h,
      1.2,
    );
    const edgePx = count(s.alpha, (a) => a > 0.02 && a < 0.98);
    expect(
      count(
        t.complexity,
        (k, i) => k > 0.5 && s.alpha[i] > 0.02 && s.alpha[i] < 0.98,
      ) / edgePx,
    ).toBeLessThan(0.05);
    expect(count(t.unknown) / (s.w * s.h)).toBeLessThan(0.08);
  });

  it("flat but fractional regions (a model unsure about a whole screen) are not band", () => {
    const w = 120,
      h = 120;
    for (const v of [0.05, 0.7]) {
      const c = new Float32Array(w * h);
      for (let y = 20; y < 100; y++)
        for (let x = 20; x < 100; x++)
          c[y * w + x] = y < 30 || y >= 90 || x < 30 || x >= 90 ? 1 : v;
      const t = buildTrimap(
        new Uint8ClampedArray(w * h * 4).fill(250),
        c,
        w,
        h,
        1,
      );
      expect(t.unknown[60 * w + 60]).toBe(0);
      expect(t.complexity[60 * w + 60]).toBe(0);
      expect(
        solveAlpha(new Uint8ClampedArray(w * h * 4).fill(255), w, h, c, 1, 1e-4)
          .alpha[60 * w + 60],
      ).toBe(v >= 0.5 ? 1 : 0);
    }
  });

  it("band width limits hold for tiny and huge images", () => {
    expect(bandRadii(50, 50, 0.1)).toEqual({
      complexity: 8,
      narrow: 2,
      wide: 6,
    });
    expect(bandRadii(8000, 6000, 20)).toEqual({
      complexity: 32,
      narrow: 8,
      wide: 48,
    });
  });
});

describe("solveAlpha", () => {
  it("keeps the confident core at exactly 1 and the far background at exactly 0", () => {
    const s = makeScene("device", "white", 384, 384);
    const c = modelLike(s.alpha, s.w, s.h, 1);
    const { alpha, trimap } = solveAlpha(s.image, s.w, s.h, c, 1, 1e-4);
    for (let i = 0; i < alpha.length; i++) {
      if (trimap.unknown[i]) continue;
      expect(alpha[i]).toBe(c[i] >= 0.5 ? 1 : 0);
    }
    let lo = 1;
    for (let i = 0; i < alpha.length; i++)
      if (s.highlight[i]) lo = Math.min(lo, alpha[i]);
    expect(lo).toBeGreaterThan(0.5);
  }, 30_000);
});

describe("orientation spread", () => {
  const w = 64,
    h = 64;
  const img = (f: (x: number, y: number) => boolean | number) => {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        px.fill(f(x, y) ? 230 : 30, (y * w + x) * 4, (y * w + x) * 4 + 3);
    return px;
  };
  const at = (a: Float32Array) => a[32 * w + 32];
  it("is ~0 for a straight edge and parallel edges, mid for a tile corner, high for many orientations", () => {
    expect(
      at(
        orientationSpread(
          img((x) => x > 32),
          w,
          h,
          8,
        ).spread,
      ),
    ).toBeLessThan(0.1);
    expect(
      at(
        orientationSpread(
          img((x) => (x >> 2) % 2),
          w,
          h,
          8,
        ).spread,
      ),
    ).toBeLessThan(0.1);
    const corner = at(
      orientationSpread(
        img((x, y) => x > 32 !== y > 32),
        w,
        h,
        8,
      ).spread,
    );
    expect(corner).toBeGreaterThan(0.2);
    expect(corner).toBeLessThan(defaultTrimapParams.incLo);
    const hair = makeScene("hair", "white", 384, 384);
    const sp = orientationSpread(hair.image, hair.w, hair.h, 8).spread;
    const vals: number[] = [];
    for (let i = 0; i < sp.length; i++)
      if (
        hair.alpha[i] > 0.05 &&
        hair.alpha[i] < 0.95 &&
        Math.floor(i / hair.w) < hair.h * 0.5
      )
        vals.push(sp[i]);
    vals.sort((p, q) => p - q);
    expect(vals[vals.length >> 1]).toBeGreaterThan(defaultTrimapParams.incHi);
  });
});
