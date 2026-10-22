import { describe, it, expect } from "vitest";
import { planTiles, ramp } from "../../src/engine/tiling";
import {
  upscaleImage,
  checkUpscaleLimits,
  defaultTileSize,
  type RunTile,
} from "../../src/tools/upscale";

describe("planTiles", () => {
  it("covers the source with full-size tiles and at least the requested overlap", () => {
    const W = 100,
      H = 80,
      T = 32,
      O = 8;
    const tiles = planTiles(W, H, T, O);
    const cov = new Uint8Array(W * H);
    for (const t of tiles) {
      expect(t.w).toBe(T);
      expect(t.h).toBe(T);
      expect(t.x0 + t.w).toBeLessThanOrEqual(W);
      expect(t.y0 + t.h).toBeLessThanOrEqual(H);
      if (t.x0 > 0) expect(t.overlapLeft).toBeGreaterThanOrEqual(O);
      if (t.y0 > 0) expect(t.overlapTop).toBeGreaterThanOrEqual(O);
      for (let y = 0; y < t.h; y++)
        for (let x = 0; x < t.w; x++) cov[(t.y0 + y) * W + t.x0 + x] = 1;
    }
    expect(cov.every((v) => v === 1)).toBe(true);
  });

  it("uses one tile when the image is smaller than a tile", () => {
    expect(planTiles(20, 10, 64, 8)).toEqual([
      { x0: 0, y0: 0, w: 20, h: 10, overlapLeft: 0, overlapTop: 0 },
    ]);
  });

  it("ramps from 0 to 1 across the overlap", () => {
    expect(ramp(0, 8)).toBeGreaterThan(0);
    expect(ramp(7, 8)).toBe(1);
    expect(ramp(3, 0)).toBe(1);
  });
});

const identityRun: RunTile = async (chw) => chw;

function gradient(w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[i] = Math.round((x / (w - 1)) * 255);
      px[i + 1] = Math.round((y / (h - 1)) * 255);
      px[i + 2] = 200;
      px[i + 3] = 255;
    }
  return px;
}

describe("seam blending", () => {
  it("a gradient image comes out seamless", async () => {
    const W = 97,
      H = 53;
    const src = gradient(W, H);
    const out = await upscaleImage(src, W, H, identityRun, {
      scale: 1,
      tileSize: 24,
      overlap: 6,
    });
    let maxErr = 0;
    for (let i = 0; i < src.length; i++)
      maxErr = Math.max(maxErr, Math.abs(out.data[i] - src[i]));
    expect(maxErr).toBeLessThanOrEqual(1);
  });

  it("pads tiles to the input multiple and crops the result", async () => {
    const seen: [number, number][] = [];
    const run: RunTile = async (chw, w, h) => {
      seen.push([w, h]);
      return chw;
    };
    const out = await upscaleImage(gradient(15, 9), 15, 9, run, {
      scale: 1,
      tileSize: 64,
      overlap: 8,
      inputMultiple: 2,
    });
    expect(seen).toEqual([[16, 10]]);
    expect([out.width, out.height]).toEqual([15, 9]);
  });

  it("upscales alpha when the source has transparency", async () => {
    const src = gradient(4, 4);
    src.fill(0, 3, 4);
    const run: RunTile = async (chw, w, h) => {
      const out = new Float32Array(3 * w * 2 * h * 2);
      return out;
    };
    const out = await upscaleImage(src, 4, 4, run, {
      scale: 2,
      tileSize: 64,
      overlap: 0,
    });
    expect(out.data[3]).toBe(0);
    expect(out.data[out.data.length - 1]).toBe(255);
  });
});

describe("limits and defaults", () => {
  it("rejects oversized inputs and outputs with a clear error", () => {
    expect(() => checkUpscaleLimits(5000, 5000, 2)).toThrow(/maximum is 16 MP/);
    expect(() => checkUpscaleLimits(4500, 3000, 4)).toThrow(/maximum side/);
    expect(() => checkUpscaleLimits(2000, 2000, 4, 4)).toThrow(
      /this device allows 16 MP/,
    );
    expect(() => checkUpscaleLimits(1000, 1000, 4)).not.toThrow();
  });

  it("picks smaller tiles on WASM and low-memory devices", () => {
    expect(defaultTileSize("webgpu")).toBe(256);
    expect(defaultTileSize("wasm")).toBe(128);
    expect(defaultTileSize("webgpu", 2)).toBe(128);
  });
});
