import { describe, it, expect } from "vitest";
import {
  fitView,
  clampView,
  zoomAt,
  panBy,
  visibleRegion,
  scaleLimits,
} from "../../src/lib/viewport";

const img = { w: 2000, h: 1000 };
const vp = { w: 500, h: 400 };

describe("viewport", () => {
  it("fits the image and centres it", () => {
    expect(fitView(img, vp)).toEqual({ scale: 0.25, cx: 1000, cy: 500 });
    const r = visibleRegion(fitView(img, vp), img, vp);
    expect(r).toMatchObject({
      sx: 0,
      sy: 0,
      sw: 2000,
      sh: 1000,
      dx: 0,
      dw: 500,
      dh: 250,
    });
    expect(r.dy).toBe(75);
  });

  it("limits zoom between fit (or 1:1) and 8x", () => {
    expect(scaleLimits(img, vp)).toEqual({ min: 0.25, max: 8 });
    expect(clampView({ scale: 100, cx: 1000, cy: 500 }, img, vp).scale).toBe(8);
    expect(clampView({ scale: 0.01, cx: 1000, cy: 500 }, img, vp).scale).toBe(
      0.25,
    );
  });

  it("zooming keeps the point under the cursor fixed", () => {
    const v0 = { scale: 1, cx: 1000, cy: 500 };
    const v1 = zoomAt(v0, 2, 400, 300, img, vp);
    const under = (v: typeof v0) => [
      v.cx + (400 - vp.w / 2) / v.scale,
      v.cy + (300 - vp.h / 2) / v.scale,
    ];
    expect(under(v1)[0]).toBeCloseTo(under(v0)[0]);
    expect(under(v1)[1]).toBeCloseTo(under(v0)[1]);
    expect(v1.scale).toBe(2);
  });

  it("panning stops at the image edges", () => {
    const v = panBy({ scale: 1, cx: 1000, cy: 500 }, 100000, 0, img, vp);
    expect(v.cx).toBe(250);
    const r = visibleRegion(v, img, vp);
    expect(r.sx).toBe(0);
    expect(r.dx).toBe(0);
  });
});
