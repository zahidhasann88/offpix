import { describe, it, expect, beforeAll } from "vitest";
import * as ort from "onnxruntime-web";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createSessionWithFallback,
  FallbackSession,
  type CreateSession,
} from "../../src/engine/session";
import { upscaleImage, type RunTile } from "../../src/tools/upscale";

const modelPath = (name: string) => path.resolve("tests/fixtures/models", name);
const load = (name: string) => new Uint8Array(fs.readFileSync(modelPath(name)));
const wasmCreate: CreateSession = (model, options) =>
  ort.InferenceSession.create(model, options);

function runner(session: ort.InferenceSession): RunTile {
  return async (chw, w, h) => {
    const out = await session.run({
      input: new ort.Tensor("float32", chw, [1, 3, h, w]),
    });
    return out.output.data as Float32Array;
  };
}

function gradient(w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[i] = Math.round((x / (w - 1)) * 255);
      px[i + 1] = Math.round((y / (h - 1)) * 255);
      px[i + 2] = 128;
      px[i + 3] = 255;
    }
  return px;
}

beforeAll(() => {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = pathToFileURL(
    path.resolve("node_modules/onnxruntime-web/dist") + "/",
  ).href;
});

describe("session factory", () => {
  it("creates a WASM session from a dummy model and runs it", async () => {
    const { session, backend, fallbackReason } =
      await createSessionWithFallback(load("identity.onnx"), {
        create: wasmCreate,
        webgpuAvailable: false,
        wasmThreads: 1,
      });
    expect(backend).toBe("wasm-single");
    expect(fallbackReason).toMatch(/not available/);
    expect(session.inputNames).toEqual(["input"]);
    const res = await session.run({
      input: new ort.Tensor(
        "float32",
        new Float32Array(3 * 8 * 8).fill(0.5),
        [1, 3, 8, 8],
      ),
    });
    expect(res.output.dims).toEqual([1, 3, 8, 8]);
  });

  it("falls back from WebGPU to WASM when the WebGPU session fails", async () => {
    const attempts: string[] = [];
    const create: CreateSession = async (model, options) => {
      const ep = String(options.executionProviders?.[0]);
      attempts.push(ep);
      if (ep === "webgpu") throw new Error("no adapter");
      return wasmCreate(model, options);
    };
    const res = await createSessionWithFallback(load("identity.onnx"), {
      create,
      webgpuAvailable: true,
      wasmThreads: 4,
    });
    expect(attempts).toEqual(["webgpu", "wasm"]);
    expect(res.backend).toBe("wasm");
    expect(res.fallbackReason).toMatch(/no adapter/);
  });

  it("uses WebGPU when it succeeds", async () => {
    const create: CreateSession = (model) =>
      wasmCreate(model, { executionProviders: ["wasm"] });
    const res = await createSessionWithFallback(load("identity.onnx"), {
      create,
      webgpuAvailable: true,
      wasmThreads: 1,
    });
    expect(res.backend).toBe("webgpu");
    expect(res.fallbackReason).toBeUndefined();
  });

  it("reports a model load error when no backend can load the model", async () => {
    await expect(
      createSessionWithFallback(new Uint8Array([1, 2, 3]), {
        create: wasmCreate,
        webgpuAvailable: false,
        wasmThreads: 1,
      }),
    ).rejects.toMatchObject({ name: "ModelLoadError" });
  });
});

describe("run-time WebGPU fallback", () => {
  const CEIL_MODE =
    "ceil_mode output-shape is computed, but ceil_mode kernel execution (padding) is not yet implemented in the WebGPU MaxPool kernel";
  const input = () =>
    new ort.Tensor(
      "float32",
      new Float32Array(3 * 4 * 4).fill(0.25),
      [1, 3, 4, 4],
    );

  async function webgpuThatFailsAtRun() {
    const real = await wasmCreate(load("identity.onnx"), {
      executionProviders: ["wasm"],
    });
    const failing = Object.create(real) as ort.InferenceSession;
    failing.run = async () => {
      throw new Error(CEIL_MODE);
    };
    failing.release = async () => {};
    return { session: failing, backend: "webgpu" as const };
  }

  it("rebuilds on WASM and retries when a WebGPU kernel fails while running", async () => {
    let reloads = 0;
    const fs = new FallbackSession(
      await webgpuThatFailsAtRun(),
      async () => {
        reloads++;
        return load("identity.onnx");
      },
      { create: wasmCreate, webgpuAvailable: true, wasmThreads: 1 },
    );
    const out = await fs.run((sess) => sess.run({ input: input() }));
    expect(out.output.dims).toEqual([1, 3, 4, 4]);
    expect(fs.backend).toBe("wasm-single");
    expect(fs.fallbackReason).toContain("ceil_mode");
    expect(reloads).toBe(1);
    await fs.run((sess) => sess.run({ input: input() }));
    expect(reloads).toBe(1);
  });

  it("does not retry failures on WASM or cancellations", async () => {
    const wasm = await createSessionWithFallback(load("identity.onnx"), {
      create: wasmCreate,
      webgpuAvailable: false,
      wasmThreads: 1,
    });
    const reload = async () => {
      throw new Error("should not reload");
    };
    const onWasm = new FallbackSession(wasm, reload, {
      create: wasmCreate,
      webgpuAvailable: false,
      wasmThreads: 1,
    });
    await expect(
      onWasm.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const onGpu = new FallbackSession(await webgpuThatFailsAtRun(), reload, {
      create: wasmCreate,
      webgpuAvailable: true,
      wasmThreads: 1,
    });
    const cancelled = Object.assign(new Error("Cancelled"), {
      name: "CancelledError",
    });
    await expect(
      onGpu.run(async () => {
        throw cancelled;
      }),
    ).rejects.toMatchObject({ name: "CancelledError" });
    expect(onGpu.backend).toBe("webgpu");
  });
});

describe("tiled upscale with a real (dummy) x2 model", () => {
  it("matches a whole-image nearest x2 upscale exactly across tile seams", async () => {
    const { session } = await createSessionWithFallback(
      load("nearest-x2.onnx"),
      { create: wasmCreate, webgpuAvailable: false, wasmThreads: 1 },
    );
    const w = 45,
      h = 31;
    const src = gradient(w, h);
    const out = await upscaleImage(src, w, h, runner(session), {
      scale: 2,
      tileSize: 16,
      overlap: 4,
      inputMultiple: 2,
    });
    expect(out.width).toBe(90);
    expect(out.height).toBe(62);
    let maxErr = 0;
    for (let y = 0; y < out.height; y++)
      for (let x = 0; x < out.width; x++) {
        const s = ((y >> 1) * w + (x >> 1)) * 4;
        const d = (y * out.width + x) * 4;
        for (let c = 0; c < 4; c++)
          maxErr = Math.max(maxErr, Math.abs(out.data[d + c] - src[s + c]));
      }
    expect(maxErr).toBeLessThanOrEqual(1);
  });

  it("cancels between tiles", async () => {
    const { session } = await createSessionWithFallback(
      load("nearest-x2.onnx"),
      { create: wasmCreate, webgpuAvailable: false, wasmThreads: 1 },
    );
    const ac = new AbortController();
    let tilesDone = 0;
    const run = upscaleImage(gradient(64, 64), 64, 64, runner(session), {
      scale: 2,
      tileSize: 16,
      overlap: 4,
      signal: ac.signal,
      onTile: (done) => {
        tilesDone = done;
        if (done === 2) ac.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: "CancelledError" });
    expect(tilesDone).toBe(2);
  });
});
