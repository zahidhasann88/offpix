import { describe, it, expect } from "vitest";
import { bilinearResize, normalizeMask } from "../../src/engine/preprocess";

describe("bilinearResize", () => {
  it("upscales constant", () => {
    const src = new Float32Array([5]);
    const dst = bilinearResize(src, 1, 1, 2, 2);
    expect(Array.from(dst)).toEqual([5, 5, 5, 5]);
  });
  it("interpolates gradient", () => {
    const src = new Float32Array([0, 10]);
    const dst = bilinearResize(src, 2, 1, 4, 1);
    expect(dst[0]).toBeCloseTo(0, 5);
    expect(dst[3]).toBeCloseTo(10, 5);
  });
});

describe("normalizeMask", () => {
  it("normalizes range", () => {
    const m = new Float32Array([-1, 2]);
    const out = normalizeMask(m);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(1);
  });
  it("passes through 0..1", () => {
    const m = new Float32Array([0.2, 0.8]);
    const out = normalizeMask(m);
    expect(out[0]).toBeCloseTo(0.2);
    expect(out[1]).toBeCloseTo(0.8);
  });
});
