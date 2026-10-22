import { describe, it, expect } from "vitest";
import manifest from "../../src/models/manifest.json";
import { selectFile, verifiedBackends } from "../../src/engine/modelFiles";
import type { ModelManifestEntry } from "../../src/engine/types";

const models = manifest.models as ModelManifestEntry[];
const birefnet = models.filter((m) => m.id.startsWith("birefnet"));
const files = (m: ModelManifestEntry) => [
  { ...m, dtype: m.dtype, verified: m.verified },
  ...(m.webgpuFile ? [m.webgpuFile] : []),
];
const base = models.find((m) => m.id === "birefnet-lite-512")!;

describe("fp16 + WebGPU lock", () => {
  it("BiRefNet: the file chosen for WebGPU is never fp16 (shipped manifest)", () => {
    expect(birefnet.length).toBeGreaterThanOrEqual(2);
    for (const m of birefnet) {
      const f = selectFile(m, "webgpu");
      if (f) expect(f.dtype, m.id).not.toBe("fp16");
    }
  });

  it("BiRefNet: no file in the manifest is marked verified for fp16 on WebGPU", () => {
    for (const m of birefnet)
      for (const f of files(m)) {
        if (f.dtype === "fp16")
          expect(verifiedBackends(m, f), `${m.id} ${f.url}`).not.toContain(
            "webgpu",
          );
        expect(
          f.dtype,
          `${m.id} ${f.url}: BiRefNet files must state their dtype`,
        ).toMatch(/^fp(16|32)$/);
      }
  });

  it("an fp16-only model can never be selected for WebGPU, whatever else the entry says", () => {
    const fp16Only = {
      ...base,
      dtype: "fp16",
      verified: undefined,
      webgpu: true,
      webgpuFile: {
        url: "/models/x16.onnx",
        size: 1,
        sha256: "a",
        dtype: "fp16",
      },
    } as ModelManifestEntry;
    expect(selectFile(fp16Only, "webgpu")).toBeNull();
    expect(selectFile(fp16Only, "wasm")?.dtype).toBe("fp16");
  });

  it("an unlisted fp16 file never gets WebGPU implicitly; only an explicit verified list can allow it", () => {
    const e = {
      ...base,
      dtype: "fp16",
      verified: undefined,
      webgpuFile: undefined,
    } as ModelManifestEntry;
    expect(
      verifiedBackends(e, { url: e.url, size: 1, sha256: "a", dtype: "fp16" }),
    ).toEqual(["wasm"]);
    expect(
      verifiedBackends(e, {
        url: e.url,
        size: 1,
        sha256: "a",
        dtype: "fp16",
        verified: ["wasm", "webgpu"],
      }),
    ).toContain("webgpu");
  });

  it("the 512 default: fp16 on WASM, fp32 on WebGPU", () => {
    expect(selectFile(base, "wasm")).toMatchObject({
      dtype: "fp16",
      url: base.url,
    });
    expect(selectFile(base, "webgpu")).toMatchObject({
      dtype: "fp32",
      url: base.webgpuFile!.url,
    });
  });

  it("models without lists keep the old rule (webgpu: false -> WASM only)", () => {
    const isnet = models.find((m) => m.id === "isnet-general-use")!;
    expect(selectFile(isnet, "webgpu")).toBeNull();
    expect(selectFile(isnet, "wasm")?.url).toBe(isnet.url);
  });
});
