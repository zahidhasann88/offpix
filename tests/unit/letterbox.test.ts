import { describe, it, expect } from "vitest";
import {
  inputMap,
  toModelInput,
  maskToImage,
  imageToOutput,
  outputToImage,
  resizeInterleaved,
} from "../../src/engine/preprocess";

describe("letterbox mapping", () => {
  it("keeps the aspect ratio and centres the image", () => {
    expect(inputMap(1086, 1448, 1024, true)).toMatchObject({
      dw: 768,
      dh: 1024,
      ox: 128,
      oy: 0,
    });
    expect(inputMap(400, 100, 320, true)).toMatchObject({
      dw: 320,
      dh: 80,
      ox: 0,
      oy: 120,
    });
    expect(inputMap(1086, 1448, 1024, false)).toMatchObject({
      dw: 1024,
      dh: 1024,
      ox: 0,
      oy: 0,
    });
  });

  it("maps image -> model output -> image exactly", () => {
    for (const [w, h, size, out] of [
      [1086, 1448, 1024, 1024],
      [300, 200, 320, 320],
      [640, 480, 320, 160],
    ]) {
      for (const lb of [true, false]) {
        const map = inputMap(w, h, size, lb);
        for (const [x, y] of [
          [0, 0],
          [w - 1, h - 1],
          [w / 3, h / 7],
          [17.25, 3.5],
        ]) {
          const [u, v] = imageToOutput(map, out, x, y);
          const [bx, by] = outputToImage(map, out, u, v);
          expect(bx).toBeCloseTo(x, 9);
          expect(by).toBeCloseTo(y, 9);
        }
      }
    }
  });

  it("round-trips a mask: a field defined on the image survives model space and back", () => {
    const w = 90,
      h = 60,
      size = 64,
      out = 64;
    const map = inputMap(w, h, size, true);
    const f = (x: number, y: number) => 0.2 + (0.5 * x) / w + (0.2 * y) / h;
    const model = new Float32Array(out * out).fill(-5);
    for (let v = 0; v < out; v++)
      for (let u = 0; u < out; u++) {
        const [x, y] = outputToImage(map, out, u, v);
        if (x >= -0.5 && x <= w - 0.5 && y >= -0.5 && y <= h - 0.5)
          model[v * out + u] = f(x, y);
      }
    const back = maskToImage(model, out, map);
    let worst = 0;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++)
        worst = Math.max(worst, Math.abs(back[y * w + x] - f(x, y)));
    expect(worst).toBeLessThan(1e-5);
    expect(Math.min(...back)).toBeGreaterThan(0);
  });

  it("pads by replicating edge pixels", () => {
    const w = 4,
      h = 2,
      px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) px.set([i * 30, 0, 0, 255], i * 4);
    const map = inputMap(w, h, 8, true);
    const m = toModelInput(px, map);
    expect(map).toMatchObject({ dw: 8, dh: 4, oy: 2 });
    expect(m[0]).toBe(m[2 * 8 * 4]);
    expect(m[(7 * 8 + 7) * 4]).toBe(m[(5 * 8 + 7) * 4]);
  });
});

describe("resizeInterleaved", () => {
  it("area-averages when shrinking by an integer factor", () => {
    const src = Float32Array.from([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(Array.from(resizeInterleaved(src, 4, 2, 2, 1, 1))).toEqual([
      (0 + 2 + 8 + 10) / 4,
      (4 + 6 + 12 + 14) / 4,
    ]);
  });

  it("preserves the mean on non-integer shrink and constants on enlarge", () => {
    const w = 37,
      h = 23,
      src = Float32Array.from({ length: w * h }, (_, i) => (i * 7919) % 101);
    const mean = (a: Float32Array) => a.reduce((p, q) => p + q, 0) / a.length;
    expect(mean(resizeInterleaved(src, w, h, 10, 7, 1))).toBeCloseTo(
      mean(src),
      1,
    );
    const flat = resizeInterleaved(new Float32Array(12).fill(3), 2, 2, 7, 5, 3);
    expect(flat.every((v) => Math.abs(v - 3) < 1e-6)).toBe(true);
  });
});
