import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  coverRect,
  fitSize,
  blurRadiusPx,
  maskToRgba,
} from "../../src/lib/composite";
import { uniqueName, baseName, zipFiles } from "../../src/lib/download";

describe("composite geometry", () => {
  it("cover crops the overflowing axis, centred", () => {
    expect(coverRect(200, 100, 100, 100)).toEqual({
      sx: 50,
      sy: 0,
      sw: 100,
      sh: 100,
    });
    expect(coverRect(100, 400, 200, 200)).toEqual({
      sx: 0,
      sy: 150,
      sw: 100,
      sh: 100,
    });
  });
  it("fits without upscaling", () => {
    expect(fitSize(4000, 2000, 1000)).toEqual({ w: 1000, h: 500 });
    expect(fitSize(300, 200, 1000)).toEqual({ w: 300, h: 200 });
  });
  it("blur scales with output size so preview matches export", () => {
    expect(
      blurRadiusPx(10, 4000, 3000) / blurRadiusPx(10, 1000, 750),
    ).toBeCloseTo(4);
  });
  it("writes mask into alpha for a sub-rect", () => {
    const mask = new Float32Array([0, 0.5, 1, 0.25]);
    const out = new Uint8ClampedArray(2 * 4);
    maskToRgba(mask, 2, { x0: 0, y0: 1, x1: 2, y1: 2 }, out);
    expect([out[3], out[7]]).toEqual([255, 64]);
  });
});

describe("zip export", () => {
  it("names are de-duplicated and stems kept", () => {
    const taken = new Set<string>();
    expect(uniqueName("a.png", taken)).toBe("a.png");
    expect(uniqueName("a.png", taken)).toBe("a (2).png");
    expect(uniqueName("a.png", taken)).toBe("a (3).png");
    expect(baseName("my.photo.jpg")).toBe("my.photo");
    expect(baseName(".hidden")).toBe(".hidden");
  });
  it("zips files that unzip back intact", async () => {
    const blob = await zipFiles([
      { name: "x.png", data: new TextEncoder().encode("one") },
      { name: "x.png", data: new TextEncoder().encode("two") },
    ]);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["x (2).png", "x.png"]);
    expect(strFromU8(files["x (2).png"])).toBe("two");
  });
});
