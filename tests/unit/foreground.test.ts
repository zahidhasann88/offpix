import { describe, it, expect } from "vitest";
import { estimateForeground } from "../../src/tools/foreground";
import { makeScene } from "../synthetic/scenes";
import { unknownBand, reconstructionError } from "../synthetic/metrics";

describe("estimateForeground (multi-level, Germer et al.)", () => {
  it("a constant image gives that colour as F and B", () => {
    const w = 9,
      h = 7,
      img = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) img.set([51, 102, 204, 255], i * 4);
    const { F, B } = estimateForeground(
      img,
      new Float32Array(w * h).fill(0.5),
      w,
      h,
    );
    for (let i = 0; i < w * h * 3; i += 3) {
      expect(F[i]).toBeCloseTo(0.2, 2);
      expect(F[i + 2]).toBeCloseTo(0.8, 2);
      expect(B[i + 1]).toBeCloseTo(0.4, 2);
    }
  });

  for (const back of ["white", "gradient", "texture"] as const) {
    it(`hair on ${back}: recovers the true strand colour and satisfies C = aF + (1-a)B`, () => {
      const s = makeScene("hair", back, 160, 160);
      const { F, B } = estimateForeground(s.image, s.alpha, s.w, s.h);
      const band = unknownBand(s.alpha, s.w, s.h, 2);
      expect(
        reconstructionError(s.image, s.alpha, F, B, band).mean,
      ).toBeLessThan(3 / 255);
      let errF = 0,
        errC = 0,
        n = 0;
      for (let i = 0; i < s.alpha.length; i++) {
        const a = s.alpha[i];
        if (a < 0.2 || a > 0.8) continue;
        for (let c = 0; c < 3; c++) {
          errF += Math.abs(F[i * 3 + c] - s.fg[i * 3 + c]);
          errC += Math.abs(s.image[i * 4 + c] / 255 - s.fg[i * 3 + c]);
        }
        n++;
      }
      expect(n).toBeGreaterThan(200);
      expect(errF / n).toBeLessThan((errC / n) * 0.5);
    });
  }

  it("over black, an edge composited with the estimated F has no white fringe", () => {
    const s = makeScene("hair", "white", 160, 160);
    const { F } = estimateForeground(s.image, s.alpha, s.w, s.h);
    let est = 0,
      photo = 0,
      truth = 0,
      n = 0;
    const lum = (r: number, g: number, b: number) =>
      0.299 * r + 0.587 * g + 0.114 * b;
    for (let i = 0; i < s.alpha.length; i++) {
      const a = s.alpha[i];
      if (a <= 0.02 || a >= 0.98) continue;
      est += a * lum(F[i * 3], F[i * 3 + 1], F[i * 3 + 2]);
      photo +=
        a *
        lum(
          s.image[i * 4] / 255,
          s.image[i * 4 + 1] / 255,
          s.image[i * 4 + 2] / 255,
        );
      truth += a * lum(s.fg[i * 3], s.fg[i * 3 + 1], s.fg[i * 3 + 2]);
      n++;
    }
    expect(Math.abs(est - truth) / n).toBeLessThan(0.02);
    expect((photo - truth) / n).toBeGreaterThan(0.1);
  });
});
