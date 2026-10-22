import { describe, it, expect } from "vitest";
import {
  availableModels,
  bestModel,
  gpuShortfall,
} from "../../src/engine/tiers";
import type { ModelManifestEntry } from "../../src/engine/types";

const m = (id: string, extra: Partial<ModelManifestEntry> = {}) =>
  ({ id, name: id, ...extra }) as unknown as ModelManifestEntry;
const models = [
  m("u2netp"),
  m("isnet", { tier: 3 }),
  m("birefnet", { wasm: false, tier: 1 }),
  m("birefnet-512", { heavy: true, tier: 2 }),
];
const caps = { webgpu: true, gpuEnabled: true, ready: true, deviceMemory: 8 };

describe("capability tiers", () => {
  it("GPU-capable device with memory: everything offered, tier 1 is best", () => {
    const a = availableModels(models, caps, {});
    expect(a.hidden).toEqual([]);
    expect(bestModel(a.usable)?.id).toBe("birefnet");
  });

  it("no WebGPU: tier 2 (CPU) is best", () => {
    const a = availableModels(models, { ...caps, webgpu: false }, {});
    expect(a.hidden.map((h) => h.model.id)).toEqual(["birefnet"]);
    expect(a.hidden[0].reason).toMatch(/needs WebGPU/);
    expect(bestModel(a.usable)?.id).toBe("birefnet-512");
  });

  it("low memory (deviceMemory <= 4): the heavy CPU model is hidden, ISNet is best", () => {
    const a = availableModels(
      models,
      { ...caps, webgpu: false, deviceMemory: 4 },
      {},
    );
    expect(a.hidden.find((h) => h.model.id === "birefnet-512")?.reason).toMatch(
      /more memory than this device reports \(4 GB\)/,
    );
    expect(bestModel(a.usable)?.id).toBe("isnet");
  });

  it("a model that failed on this device is hidden with the reason", () => {
    const a = availableModels(models, caps, {
      birefnet: "GatherND shader",
      "birefnet-512": "out of memory: std::bad_alloc",
    });
    expect(a.hidden.map((h) => h.reason)).toEqual([
      "could not run on this device (GatherND shader)",
      "could not run on this device (out of memory: std::bad_alloc)",
    ]);
    expect(bestModel(a.usable)?.id).toBe("isnet");
  });

  it("GPU turned off", () => {
    expect(
      availableModels(models, { ...caps, gpuEnabled: false }, {}).hidden[0]
        .reason,
    ).toMatch(/turned off/);
  });
});

describe("opt-in GPU model (gpuRequirements)", () => {
  const max = m("max", {
    wasm: false,
    optIn: true,
    gpuRequirements: {
      minMaxBufferSize: 2 ** 31,
      minStorageBuffersPerShaderStage: 8,
      minDeviceMemoryGB: 8,
    },
  });
  const adapter = {
    vendor: "intel",
    architecture: "gen-9",
    shaderF16: true,
    maxStorageBuffersPerShaderStage: 16,
    maxBufferSize: 2 ** 31,
    maxStorageBufferBindingSize: 2 ** 31 - 4,
  };
  const c = {
    webgpu: true,
    gpuEnabled: true,
    ready: true,
    deviceMemory: 8,
    adapter,
  };

  it("offered when the adapter meets the thresholds, but never the automatic default", () => {
    const a = availableModels([...models, max], c, {});
    expect(a.usable.map((x) => x.id)).toContain("max");
    expect(bestModel(a.usable)?.id).not.toBe("max");
  });

  it("hidden with the reason when it does not", () => {
    expect(
      gpuShortfall(max, {
        ...c,
        adapter: { ...adapter, maxBufferSize: 2 ** 30 },
      }),
    ).toMatch(/buffers of 2 GB \(this GPU: 1 GB\)/);
    expect(
      gpuShortfall(max, {
        ...c,
        adapter: { ...adapter, maxStorageBuffersPerShaderStage: 4 },
      }),
    ).toMatch(/8 storage buffers/);
    expect(gpuShortfall(max, { ...c, deviceMemory: 4 })).toMatch(
      /needs 8 GB of memory/,
    );
    expect(gpuShortfall(max, { ...c, deviceMemory: undefined })).toMatch(
      /memory \(this device: unknown\)/,
    );
    expect(
      availableModels([max], { ...c, adapter: null }, {}).hidden[0].reason,
    ).toMatch(/adapter details/);
  });
});
