import { describe, it, expect, beforeEach } from "vitest";
import { loadModel } from "../../src/engine/loader";
import { cacheClear, cacheHas } from "../../src/engine/cache";
import { sha256Buffer } from "../../src/lib/hash";
import {
  partsManifestUrl,
  partUrl,
  partRanges,
  validatePartsManifest,
  type PartsManifest,
} from "../../src/engine/parts";
import type { ModelManifestEntry } from "../../src/engine/types";
import { installMemCaches } from "../helpers/memCache";

installMemCaches();

const PART = 40_000;
const file = new Uint8Array(130_000).map((_, i) => (i * 7) % 251);
const URL_ = "http://app/models/big.onnx";

async function setup() {
  const sha = await sha256Buffer(file.buffer);
  const entry: ModelManifestEntry = {
    id: "big",
    tool: "background-remove",
    variant: "x",
    name: "Big model",
    url: URL_,
    size: file.length,
    sha256: sha,
    license: "MIT",
    source: "",
    input: { name: "i", shape: [], layout: "NCHW", dtype: "float32" },
    output: { name: "o", shape: [], layout: "NCHW", dtype: "float32" },
  };
  const parts = await Promise.all(
    partRanges(file.length, PART).map(async ([a, b], k) => ({
      url: partUrl(URL_, k),
      size: b - a,
      sha256: await sha256Buffer(file.slice(a, b).buffer),
    })),
  );
  const pm: PartsManifest = { size: file.length, sha256: sha, parts };
  return { entry, pm };
}

function server(
  pm: PartsManifest,
  opts: { corrupt?: number; failOnce?: number; offline?: boolean } = {},
) {
  const requests: string[] = [];
  let failed = false;
  const fetchImpl = (async (url: string) => {
    requests.push(url);
    if (opts.offline) throw new TypeError("Failed to fetch (offline)");
    if (url === partsManifestUrl(URL_)) return new Response(JSON.stringify(pm));
    const k = pm.parts.findIndex((p) => p.url === url);
    if (k < 0) return new Response("not found", { status: 404 });
    if (opts.failOnce === k && !failed) {
      failed = true;
      throw new TypeError("network dropped");
    }
    const [a, b] = partRanges(file.length, PART)[k];
    const body = file.slice(a, b);
    if (opts.corrupt === k) body[10] ^= 0xff;
    return new Response(body);
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

describe("chunked model loading", () => {
  beforeEach(async () => {
    await cacheClear();
  });

  it("fetches every part, verifies, assembles, caches the whole file and drops the parts", async () => {
    const { entry, pm } = await setup();
    expect(validatePartsManifest({ ...pm, parts: pm.parts }, entry)).toBeNull();
    const s = server(pm);
    const r = await loadModel(entry, { chunked: true, fetchImpl: s.fetchImpl });
    expect(new Uint8Array(r.buffer)).toEqual(file);
    expect(r.fromCache).toBe(false);
    expect(await cacheHas(URL_, entry.sha256)).toBe(true);
    for (const p of pm.parts) expect(await cacheHas(p.url)).toBe(false);
    expect(s.requests.every((u) => u.startsWith("http://app/models/"))).toBe(
      true,
    );
  });

  it("a corrupted part fails the integrity check and is not cached; good parts are kept", async () => {
    const { entry, pm } = await setup();
    const s = server(pm, { corrupt: 2 });
    await expect(
      loadModel(entry, { chunked: true, fetchImpl: s.fetchImpl }),
    ).rejects.toMatchObject({
      name: "ModelIntegrityError",
      message: expect.stringMatching(/part 3 of 4/),
    });
    expect(await cacheHas(pm.parts[0].url, pm.parts[0].sha256)).toBe(true);
    expect(await cacheHas(pm.parts[2].url)).toBe(false);
    expect(await cacheHas(URL_)).toBe(false);
  });

  it("an interrupted download resumes: only the missing parts are fetched again", async () => {
    const { entry, pm } = await setup();
    const s = server(pm, { failOnce: 2 });
    await expect(
      loadModel(entry, { chunked: true, fetchImpl: s.fetchImpl }),
    ).rejects.toMatchObject({ name: "ModelDownloadError" });
    s.requests.length = 0;
    const r = await loadModel(entry, { chunked: true, fetchImpl: s.fetchImpl });
    expect(new Uint8Array(r.buffer)).toEqual(file);
    expect(s.requests).toEqual([
      partsManifestUrl(URL_),
      pm.parts[2].url,
      pm.parts[3].url,
    ]);
  });

  it("offline after a successful load: served from the cache with no request at all", async () => {
    const { entry, pm } = await setup();
    await loadModel(entry, { chunked: true, fetchImpl: server(pm).fetchImpl });
    const off = server(pm, { offline: true });
    const r = await loadModel(entry, {
      chunked: true,
      fetchImpl: off.fetchImpl,
    });
    expect(r.fromCache).toBe(true);
    expect(new Uint8Array(r.buffer)).toEqual(file);
    expect(off.requests).toEqual([]);
  });

  it("rejects a parts list that does not describe the model in the app manifest", async () => {
    const { entry, pm } = await setup();
    const wrong = { ...pm, sha256: "0".repeat(64) };
    await expect(
      loadModel(entry, { chunked: true, fetchImpl: server(wrong).fetchImpl }),
    ).rejects.toMatchObject({ name: "ModelIntegrityError" });
  });

  it("parts that assemble to the wrong file are rejected and their cache dropped", async () => {
    const { entry, pm } = await setup();
    const other = Uint8Array.from(file, (v) => v ^ 1);
    const parts = await Promise.all(
      partRanges(other.length, PART).map(async ([a, b], k) => ({
        url: partUrl(URL_, k),
        size: b - a,
        sha256: await sha256Buffer(other.slice(a, b).buffer),
      })),
    );
    const fetchImpl = (async (url: string) => {
      if (url === partsManifestUrl(URL_))
        return new Response(JSON.stringify({ ...pm, parts }));
      const k = parts.findIndex((p) => p.url === url);
      const [a, b] = partRanges(other.length, PART)[k];
      return new Response(other.slice(a, b));
    }) as unknown as typeof fetch;
    await expect(
      loadModel(entry, { chunked: true, fetchImpl }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/after assembly/),
    });
    for (const p of parts) expect(await cacheHas(p.url)).toBe(false);
  });
});
