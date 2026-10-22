import { describe, it, expect } from "vitest";
import {
  oklab,
  oklabDist,
  oklabToRgb,
  estimateBackdrop,
  removeFringe,
  clampToHairRange,
} from "../../src/tools/decontam";
import {
  subjectPreset,
  sameRefine,
  DEFAULT_PORTRAIT_FRINGE,
} from "../../src/tools/presets";
import { makeScene } from "../synthetic/scenes";

describe("oklab", () => {
  it("maps white and black to L 1 and 0", () => {
    expect(oklab(1, 1, 1)[0]).toBeCloseTo(1, 3);
    expect(oklab(0, 0, 0)[0]).toBeCloseTo(0, 6);
    expect(oklabDist(oklab(1, 0, 0), oklab(1, 0, 0))).toBe(0);
  });
});

describe("oklabToRgb", () => {
  it("inverts oklab", () => {
    for (const c of [
      [0.2, 0.1, 0.05],
      [0.9, 0.8, 0.7],
      [0.1, 0.3, 0.9],
    ]) {
      const back = oklabToRgb(...oklab(c[0], c[1], c[2]));
      back.forEach((v, k) => expect(v).toBeCloseTo(c[k], 4));
    }
  });
});

describe("clampToHairRange", () => {
  it("pulls a bluish overshoot back to the warm dark-hair range, inside the gamut", () => {
    const range = Float32Array.from([0.25, 0.03, 0.02, 0.022, 0.03, 0.005]);
    const out = clampToHairRange([0.05, 0.12, 0.35], range, 0);
    const [L, a, b] = oklab(out[0], out[1], out[2]);
    expect(out.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(L).toBeLessThanOrEqual(0.25 + 2 * 0.03 + 0.02 + 1e-3);
    expect(Math.hypot(a, b)).toBeLessThanOrEqual(
      0.03 + 2 * 0.005 + 0.01 + 1e-3,
    );
    const u = [0.02 / Math.hypot(0.02, 0.022), 0.022 / Math.hypot(0.02, 0.022)],
      along = a * u[0] + b * u[1];
    expect(along).toBeGreaterThan(-0.01 - 1e-3);
    expect(Math.hypot(a - along * u[0], b - along * u[1])).toBeLessThanOrEqual(
      0.5 * (0.03 + 2 * 0.005 + 0.01) + 1e-3,
    );
  });

  it("leaves a colour already in range unchanged", () => {
    const F = [0.2, 0.15, 0.12];
    const [L, a, b] = oklab(F[0], F[1], F[2]);
    const r2 = Float32Array.from([L, 0.03, a, b, Math.hypot(a, b), 0.005]);
    clampToHairRange(F, r2, 0).forEach((v, k) =>
      expect(v).toBeCloseTo(F[k], 3),
    );
  });
});

describe("estimateBackdrop", () => {
  it("recovers a smooth gradient from the border, ignoring an object in the middle", () => {
    const w = 64,
      h = 48,
      rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4,
          inside = x > 20 && x < 44 && y > 12 && y < 36;
        rgba[i] = inside ? 10 : 200 + Math.round((40 * x) / w);
        rgba[i + 1] = inside ? 10 : 180;
        rgba[i + 2] = inside ? 10 : 150;
        rgba[i + 3] = 255;
      }
    const B = estimateBackdrop(rgba, null, w, h);
    const c = (32 * w + 32) * 3;
    expect(B[c] * 255).toBeCloseTo(220, -1);
    expect(B[c + 1] * 255).toBeCloseTo(180, -1);
  });
});

describe("removeFringe", () => {
  it("does nothing at strength 0", () => {
    const s = makeScene("hair", "beige", 96, 96, 1);
    const alpha = s.alpha.slice(),
      fg = new Uint8ClampedArray(s.image);
    expect(removeFringe(s.image, alpha, fg, s.w, s.h, 1, 0)).toEqual({
      recoloured: 0,
      alphaReduced: 0,
    });
    expect(alpha).toEqual(s.alpha);
  });

  it("on hair over beige, never raises alpha, leaves the core alone and removes backdrop colour", () => {
    const s = makeScene("hair", "beige", 160, 160, 2);
    const alpha = Float32Array.from(s.alpha, (a) =>
      a > 0.05 && a < 0.95 ? Math.min(0.97, a + 0.3) : a,
    );
    const before = alpha.slice();
    const fg = new Uint8ClampedArray(s.image);
    const st = removeFringe(s.image, alpha, fg, s.w, s.h, 1, 1);
    expect(st.alphaReduced).toBeGreaterThan(0);
    let errBefore = 0,
      errAfter = 0;
    for (let i = 0; i < alpha.length; i++) {
      expect(alpha[i]).toBeLessThanOrEqual(before[i] + 1e-6);
      if (before[i] >= 0.98 || before[i] <= 0.02)
        expect(alpha[i]).toBe(before[i]);
      errBefore += Math.abs(before[i] - s.alpha[i]);
      errAfter += Math.abs(alpha[i] - s.alpha[i]);
    }
    expect(errAfter).toBeLessThan(errBefore);
  });
});

describe("presets", () => {
  it("Portrait enables fringe removal; General and Product do not", () => {
    expect(subjectPreset("portrait").fringe).toBe(DEFAULT_PORTRAIT_FRINGE);
    expect(subjectPreset("general").fringe ?? 0).toBe(0);
    expect(subjectPreset("product").fringe ?? 0).toBe(0);
    expect(
      sameRefine(subjectPreset("portrait"), {
        ...subjectPreset("portrait"),
        fringe: 0,
      }),
    ).toBe(false);
  });
});
