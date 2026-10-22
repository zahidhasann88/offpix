import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadModel } from "../../src/engine/loader";
import { cacheClear, cacheHas, cachePut } from "../../src/engine/cache";
import { sha256Buffer } from "../../src/lib/hash";
import type { ModelManifestEntry, ProgressInfo } from "../../src/engine/types";
import { installMemCaches } from "../helpers/memCache";

installMemCaches();

const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
const URL_ = "http://x/models/m.onnx";

async function entry(sha?: string): Promise<ModelManifestEntry> {
  return {
    id: "m",
    tool: "upscale",
    variant: "x",
    name: "Test model",
    url: URL_,
    size: bytes.length,
    sha256: sha ?? (await sha256Buffer(bytes.buffer)),
    license: "MIT",
    source: "",
    input: { name: "input", shape: [], layout: "NCHW", dtype: "float32" },
    output: { name: "output", shape: [], layout: "NCHW", dtype: "float32" },
  };
}

function streamingFetch(afterChunk?: (i: number) => void, status = 200) {
  return vi.fn(async () => {
    let i = 0;
    const chunk = 16_384;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i * chunk >= bytes.length) return controller.close();
        controller.enqueue(bytes.slice(i * chunk, (i + 1) * chunk));
        afterChunk?.(i);
        i++;
      },
    });
    return new Response(body, {
      status,
      headers: { "content-length": String(bytes.length) },
    });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("loadModel", () => {
  beforeEach(async () => {
    await cacheClear();
  });

  it("downloads with progress on a miss, then hits the cache", async () => {
    const e = await entry();
    const fetchImpl = streamingFetch();
    const progress: ProgressInfo[] = [];
    const first = await loadModel(e, {
      fetchImpl,
      onProgress: (p) => progress.push(p),
    });
    expect(first.fromCache).toBe(false);
    expect(new Uint8Array(first.buffer)).toEqual(bytes);
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)!.percent).toBe(100);
    expect(await cacheHas(URL_, e.sha256)).toBe(true);

    const second = await loadModel(e, { fetchImpl });
    expect(second.fromCache).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a sha256 mismatch and caches nothing", async () => {
    const e = await entry("0".repeat(64));
    await expect(
      loadModel(e, { fetchImpl: streamingFetch() }),
    ).rejects.toMatchObject({ name: "ModelIntegrityError" });
    expect(await cacheHas(URL_)).toBe(false);
  });

  it("reports HTTP failures as download errors", async () => {
    const e = await entry();
    await expect(
      loadModel(e, { fetchImpl: streamingFetch(undefined, 404) }),
    ).rejects.toMatchObject({ name: "ModelDownloadError" });
  });

  it("re-downloads when the cached copy has a different hash", async () => {
    const e = await entry();
    await cachePut(URL_, new ArrayBuffer(4), "stale");
    const fetchImpl = streamingFetch();
    const res = await loadModel(e, { fetchImpl });
    expect(res.fromCache).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("cancels mid-download", async () => {
    const e = await entry();
    const ac = new AbortController();
    const fetchImpl = streamingFetch((i) => {
      if (i === 1) ac.abort();
    });
    await expect(
      loadModel(e, { fetchImpl, signal: ac.signal }),
    ).rejects.toMatchObject({ name: "CancelledError" });
    expect(await cacheHas(URL_)).toBe(false);
  });
});
