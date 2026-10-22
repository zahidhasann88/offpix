import { describe, it, expect } from "vitest";
import {
  shiftEdge,
  featherEdge,
  applyEdgeRefine,
  shiftUnit,
} from "../../src/tools/edges";
import { makeScene } from "../synthetic/scenes";
import { ridgeStats } from "../../src/debug/diagnostics";

function cores(a: Float32Array, w: number, h: number, d: number) {
  const fg = new Uint8Array(w * h),
    bg = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const isFg = a[y * w + x] >= 0.98,
        isBg = a[y * w + x] <= 0.02;
      if (!isFg && !isBg) continue;
      let pure = true;
      for (
        let yy = Math.max(0, y - d);
        yy <= Math.min(h - 1, y + d) && pure;
        yy++
      )
        for (let xx = Math.max(0, x - d); xx <= Math.min(w - 1, x + d); xx++) {
          const v = a[yy * w + xx];
          if (isFg ? v < 0.98 : v > 0.02) {
            pure = false;
            break;
          }
        }
      if (pure) (isFg ? fg : bg)[y * w + x] = 1;
    }
  return { fg, bg };
}

function stepEdge(w: number, h: number, edge: number) {
  return Float32Array.from({ length: w * h }, (_, i) =>
    Math.min(1, Math.max(0, (edge + 2 - (i % w)) / 4)),
  );
}
const crossing = (a: Float32Array, w: number, y: number) => {
  for (let x = 1; x < w; x++)
    if (a[y * w + x - 1] >= 0.5 && a[y * w + x] < 0.5)
      return (
        x - 1 + (a[y * w + x - 1] - 0.5) / (a[y * w + x - 1] - a[y * w + x])
      );
  return NaN;
};

describe("shiftEdge", () => {
  for (const name of ["hair", "device"] as const) {
    it(`${name}: +1 and -1 never change alpha in the confident cores`, () => {
      const s = makeScene(name, "white", 160, 160);
      const { fg, bg } = cores(s.alpha, s.w, s.h, 3);
      let coreFg = 0,
        coreBg = 0;
      for (const px of [1, -1]) {
        const out = shiftEdge(s.alpha, s.w, s.h, px);
        for (let i = 0; i < out.length; i++) {
          if (fg[i]) {
            expect(out[i]).toBe(s.alpha[i]);
            coreFg++;
          }
          if (bg[i]) {
            expect(out[i]).toBe(s.alpha[i]);
            coreBg++;
          }
        }
      }
      expect(coreFg).toBeGreaterThan(1000);
      expect(coreBg).toBeGreaterThan(1000);
    });
  }

  it("moves the boundary by the requested amount", () => {
    const w = 40,
      h = 4,
      a = stepEdge(w, h, 20);
    const c0 = crossing(a, w, 2);
    expect(crossing(shiftEdge(a, w, h, 1), w, 2)).toBeCloseTo(c0 + 1, 5);
    expect(crossing(shiftEdge(a, w, h, -1), w, 2)).toBeCloseTo(c0 - 1, 5);
    expect(crossing(shiftEdge(a, w, h, 3), w, 2)).toBeCloseTo(c0 + 3, 5);
  });

  it("does not put a veil over the background (the old version added 0.1 per step)", () => {
    const w = 40,
      h = 4,
      a = stepEdge(w, h, 20);
    const out = applyEdgeRefine(a, w, h, 0, 5);
    expect(out[w - 1]).toBe(0);
    expect(applyEdgeRefine(a, w, h, 0, -5)[0]).toBe(1);
  });

  it("scales slider steps with image size", () => {
    expect(shiftUnit(800, 600)).toBe(1);
    expect(shiftUnit(4000, 3000)).toBe(4);
  });
});

describe("featherEdge", () => {
  it("softens a smooth outline but leaves cores untouched", () => {
    const w = 60,
      h = 10,
      a = stepEdge(w, h, 30);
    const out = featherEdge(a, w, h, 3);
    const row = 5 * w;
    expect(a[row + 33]).toBe(0);
    expect(out[row + 33]).toBeGreaterThan(0.01);
    expect(out[row + 27]).toBeLessThan(0.99);
    expect(out[row]).toBe(1);
    expect(out[row + w - 1]).toBe(0);
  });

  it("keeps hair strands: far fewer ridges lost than a whole-mask blur", () => {
    const s = makeScene("hair", "white", 192, 192);
    const before = ridgeStats(s.alpha, s.w, s.h).count;
    const banded = ridgeStats(
      featherEdge(s.alpha, s.w, s.h, 1),
      s.w,
      s.h,
    ).count;
    const box = new Float32Array(s.alpha.length);
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        let sum = 0,
          n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const yy = Math.min(s.h - 1, Math.max(0, y + dy)),
              xx = Math.min(s.w - 1, Math.max(0, x + dx));
            sum += s.alpha[yy * s.w + xx];
            n++;
          }
        box[y * s.w + x] = sum / n;
      }
    const boxed = ridgeStats(box, s.w, s.h).count;
    expect(banded / before).toBeGreaterThan(0.85);
    expect(boxed / before).toBeLessThan(banded / before - 0.2);
  });
});
