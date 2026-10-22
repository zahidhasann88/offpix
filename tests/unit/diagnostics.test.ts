import { describe, it, expect } from "vitest";
import {
  aspectMapping,
  alphaStats,
  borderColour,
  enclosedHoles,
  premultipliedGridShare,
  transitionWidth,
  ridgeStats,
  edgeSpill,
} from "../../src/debug/diagnostics";

describe("diagnostics", () => {
  it("reports stretch distortion for non-square images", () => {
    expect(aspectMapping(1086, 1448, 1024).distortion).toBeCloseTo(
      1448 / 1086,
      5,
    );
    expect(aspectMapping(500, 500, 320).distortion).toBe(1);
  });

  it("counts partial alpha", () => {
    const s = alphaStats(Uint8ClampedArray.from([0, 0, 128, 255]));
    expect(s.zero).toBe(0.5);
    expect(s.partial).toBe(0.25);
    expect(s.partialLevels).toBe(1);
  });

  it("uses the median border colour, so a subject touching one edge does not shift it", () => {
    const w = 20,
      h = 20,
      px = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let x = 0; x < w; x++)
      for (let y = 16; y < h; y++)
        px.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
    const b = borderColour(px, w, h);
    expect(b.mean).toEqual([1, 1, 1]);
    expect(b.uniformShare).toBeLessThan(1);
  });

  it("finds holes not connected to the border", () => {
    const w = 5,
      h = 5;
    const a = new Float32Array(w * h).fill(1);
    a[0] = 0;
    a[12] = 0;
    const holes = enclosedHoles(a, w, h);
    expect(holes[12]).toBe(1);
    expect(holes[0]).toBe(0);
  });

  it("recognises premultiplied-quantised colours", () => {
    const quantised = Uint8ClampedArray.from([255, 128, 0, 2, 0, 255, 128, 2]);
    expect(premultipliedGridShare(quantised).share).toBe(1);
    const free = Uint8ClampedArray.from([200, 90, 33, 2, 17, 61, 140, 2]);
    expect(premultipliedGridShare(free).share).toBe(0);
  });

  it("measures transition width of a linear ramp", () => {
    const w = 64,
      h = 8,
      a = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        a[y * w + x] = Math.min(1, Math.max(0, (x - 16) / 20));
    expect(transitionWidth(a, w, h)).toBeCloseTo(16, 0);
  });

  it("counts a thin strand as ridges", () => {
    const w = 16,
      h = 16,
      a = new Float32Array(w * h);
    for (let y = 0; y < h; y++) a[y * w + 8] = 0.6;
    expect(ridgeStats(a, w, h).count).toBe(h - 4);
  });

  it("edge spill: 0 for clean foreground colour, 1 when edge pixels are the background colour", () => {
    const w = 32,
      h = 8,
      n = w * h;
    const alpha = new Float32Array(n),
      clean = new Uint8ClampedArray(n * 4),
      dirty = new Uint8ClampedArray(n * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        alpha[i] = x < 12 ? 1 : x < 20 ? 0.5 : 0;
        clean.set([20, 20, 20, 255], i * 4);
        dirty.set(
          x >= 12 && x < 20 ? [255, 255, 255, 255] : [20, 20, 20, 255],
          i * 4,
        );
      }
    expect(edgeSpill(clean, alpha, w, h, [1, 1, 1], 8).spill).toBeCloseTo(0, 5);
    const d = edgeSpill(dirty, alpha, w, h, [1, 1, 1], 8);
    expect(d.spill).toBeCloseTo(1, 5);
    expect(d.haloOverBlack).toBeGreaterThan(0.4);
  });
});
