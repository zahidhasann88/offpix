import { describe, it, expect } from "vitest";
import {
  maxProcessingPixels,
  processingSize,
  CAP_MP,
} from "../../src/engine/limits";

describe("processing cap", () => {
  it("budget by reported device memory (Chromium only; unknown elsewhere)", () => {
    expect(maxProcessingPixels(8)).toBe(CAP_MP.default * 1e6);
    expect(maxProcessingPixels(4)).toBe(CAP_MP.lowMemory * 1e6);
    expect(maxProcessingPixels(2)).toBe(CAP_MP.lowMemory * 1e6);
    expect(maxProcessingPixels(undefined)).toBe(CAP_MP.unknown * 1e6);
  });

  it("below the cap: original size, not capped", () => {
    expect(processingSize(6000, 4000, 24e6)).toEqual({
      w: 6000,
      h: 4000,
      capped: false,
    });
  });

  it("above the cap: aspect ratio kept, never over budget", () => {
    for (const [w, h, max] of [
      [6000, 4000, 12e6],
      [7000, 5000, 24e6],
      [4103, 4103, 16e6],
      [9000, 2000, 12e6],
    ]) {
      const r = processingSize(w, h, max);
      expect(r.capped).toBe(true);
      expect(r.w * r.h).toBeLessThanOrEqual(max);
      expect(r.w * r.h).toBeGreaterThan(max * 0.995);
      expect(Math.abs(r.w / r.h - w / h)).toBeLessThan(0.01);
    }
  });
});
