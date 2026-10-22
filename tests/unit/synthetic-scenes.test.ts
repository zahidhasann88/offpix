import { describe, it, expect } from "vitest";
import { ALL_SCENES, makeScene } from "../synthetic/scenes";
import {
  unknownBand,
  sad,
  mse,
  gradientError,
  connectivityError,
  reconstructionError,
  alphaOver,
  shadowRegion,
} from "../synthetic/metrics";

describe("synthetic ground-truth scenes", () => {
  for (const [subject, back] of ALL_SCENES) {
    it(`${subject}-${back}: composite matches C = aF + (1-a)B' and has the expected structure`, () => {
      const s = makeScene(subject, back, 160, 160);
      const band = unknownBand(s.alpha, s.w, s.h, 3);
      const shadowed = Float32Array.from(
        s.bg,
        (v, k) => v * (1 - s.shadow[Math.floor(k / 3)]),
      );
      expect(
        reconstructionError(s.image, s.alpha, s.fg, shadowed, band).max,
      ).toBeLessThan(0.5 / 255 + 1e-6);
      let partial = 0;
      for (const a of s.alpha) if (a > 0.02 && a < 0.98) partial++;
      expect(partial).toBeGreaterThan(subject === "hair" ? 500 : 100);
      if (subject === "device") {
        expect(alphaOver(s.alpha, s.highlight)).toMatchObject({ min: 1 });
        expect(alphaOver(s.alpha, s.highlight).pixels).toBeGreaterThan(50);
        let lo = 1;
        for (let i = 0; i < s.alpha.length; i++)
          if (s.highlight[i])
            lo = Math.min(lo, s.fg[i * 3], s.fg[i * 3 + 1], s.fg[i * 3 + 2]);
        expect(lo).toBeGreaterThan(0.9);
        expect(
          shadowRegion(s.alpha, s.shadow).reduce((p, q) => p + q, 0),
        ).toBeGreaterThan(200);
      }
    });
  }

  it("is deterministic", () => {
    expect(makeScene("hair", "texture", 64, 64).image).toEqual(
      makeScene("hair", "texture", 64, 64).image,
    );
  });
});

describe("matting metrics", () => {
  const s = makeScene("hair", "white", 96, 96);
  const band = unknownBand(s.alpha, s.w, s.h, 3);

  it("are zero for a perfect prediction", () => {
    expect(sad(s.alpha, s.alpha, band)).toBe(0);
    expect(mse(s.alpha, s.alpha, band)).toBe(0);
    expect(gradientError(s.alpha, s.alpha, s.w, s.h, band)).toBe(0);
    expect(connectivityError(s.alpha, s.alpha, s.w, s.h, band)).toBe(0);
  });

  it("grow when the prediction is blurred or binarised", () => {
    const bin = Float32Array.from(s.alpha, (a) => (a >= 0.5 ? 1 : 0));
    const half = Float32Array.from(s.alpha, (a) => a * 0.5);
    expect(sad(bin, s.alpha, band)).toBeGreaterThan(0);
    expect(gradientError(bin, s.alpha, s.w, s.h, band)).toBeGreaterThan(0);
    expect(connectivityError(half, s.alpha, s.w, s.h, band)).toBeGreaterThan(0);
  });
});
