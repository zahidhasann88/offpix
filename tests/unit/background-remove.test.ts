import { describe, it, expect } from "vitest";
import {
  removeBackgroundMask,
  maskFromOutput,
  checkBgLimits,
  modelMask,
  sigmoidInPlace,
} from "../../src/tools/background-remove";

describe("background-remove pipeline", () => {
  it("feeds a normalised NCHW tensor and returns a full-resolution mask", async () => {
    const size = 4;
    const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
    let seen: Float32Array | null = null;
    const mask = await removeBackgroundMask(
      {
        modelInput: rgba,
        size,
        outSize: 2,
        origW: 6,
        origH: 3,
        mean: [0.5, 0.5, 0.5],
        std: [0.5, 0.5, 0.5],
      },
      async (nchw) => {
        seen = nchw;
        return new Float32Array([0, 10, 10, 20]);
      },
    );
    expect(seen!.length).toBe(3 * size * size);
    expect(seen![0]).toBeCloseTo(1);
    expect(mask.length).toBe(6 * 3);
    expect(Math.min(...mask)).toBeCloseTo(0);
    expect(Math.max(...mask)).toBeCloseTo(1);
  });

  it("mask upscaling keeps a constant mask constant and is edge-aligned", () => {
    const flat = maskFromOutput(
      new Float32Array([0.3, 0.3, 0.3, 0.9]),
      2,
      8,
      8,
    );
    expect(flat[0]).toBeCloseTo(0);
    expect(flat[63]).toBeCloseTo(1);
    const split = maskFromOutput(new Float32Array([0, 1, 0, 1]), 2, 10, 4);
    expect(split[0]).toBeCloseTo(0);
    expect(split[9]).toBeCloseTo(1);
  });

  it("with flip, averages the mask with the mirrored run, mirrored back", async () => {
    const size = 2;
    const rgba = new Uint8ClampedArray(size * size * 4);
    rgba.set([255, 255, 255, 255], 0);
    const input = {
      modelInput: rgba,
      size,
      outSize: 2,
      origW: 2,
      origH: 2,
      mean: [0, 0, 0],
      std: [1, 1, 1],
    };
    const run = async (nchw: Float32Array) =>
      Float32Array.from(nchw.subarray(0, 4), (v, i) => v + (i % 2) * 0.5);
    const plain = await modelMask(input, run);
    const both = await modelMask(input, run, true);
    expect(Array.from(plain)).toEqual(
      [1, 0.5, 0, 0.5].map((v) => expect.closeTo(v, 5)),
    );
    expect(Array.from(both)).toEqual(
      [1, 0.25, 1 / 6, 0.25].map((v) => expect.closeTo(v, 5)),
    );
  });

  it("sigmoid models: logits -> sigmoid, no min-max normalisation (BiRefNet's output handling)", async () => {
    const size = 2;
    const input = {
      modelInput: new Uint8ClampedArray(size * size * 4),
      size,
      outSize: 2,
      origW: 2,
      origH: 2,
      mean: [0, 0, 0],
      std: [1, 1, 1],
      activation: "sigmoid" as const,
    };
    const m = await modelMask(
      input,
      async () => new Float32Array([-2, 0, 1, 4]),
    );
    expect(Array.from(m)).toEqual(
      [-2, 0, 1, 4].map((v) => expect.closeTo(1 / (1 + Math.exp(-v)), 5)),
    );
  });

  it("keepLogits: returns logits (flip-averaged in logit space) for the caller to resize, then squash", async () => {
    const size = 2;
    const input = {
      modelInput: new Uint8ClampedArray(size * size * 4),
      size,
      outSize: 2,
      origW: 2,
      origH: 2,
      mean: [0, 0, 0],
      std: [1, 1, 1],
      activation: "sigmoid" as const,
      keepLogits: true,
    };
    const plain = await modelMask(
      input,
      async () => new Float32Array([-2, 0, 1, 4]),
    );
    expect(Array.from(plain)).toEqual([-2, 0, 1, 4]);
    const both = await modelMask(
      input,
      async () => new Float32Array([-2, 0, 1, 4]),
      true,
    );
    expect(Array.from(both)).toEqual([-1, -1, 2.5, 2.5]);
    expect(Array.from(sigmoidInPlace(Float32Array.from([0])))).toEqual([0.5]);
  });

  it("rejects huge images", () => {
    expect(() => checkBgLimits(10000, 10000)).toThrow(/maximum is 40 MP/);
    expect(() => checkBgLimits(4000, 3000)).not.toThrow();
  });
});
