import type { ModelManifestEntry, ProgressInfo } from "./types";
import { cacheGet, cachePut, cacheDelete } from "./cache";
import {
  partsManifestUrl,
  validatePartsManifest,
  type PartsManifest,
} from "./parts";
import { sha256Buffer } from "../lib/hash";
import {
  cancelledError,
  modelDownloadError,
  modelIntegrityError,
  throwIfAborted,
} from "./errors";

export interface LoadModelOptions {
  onProgress?: (p: ProgressInfo) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  chunked?: boolean;
}

export interface LoadedModel {
  buffer: ArrayBuffer;
  fromCache: boolean;
}

// Manifest URLs are root-relative; the site may be served from a sub-path.
const withBase = (url: string) =>
  url.startsWith("/") ? `${import.meta.env.BASE_URL}${url.slice(1)}` : url;

export async function loadModel(
  entry: ModelManifestEntry,
  opts: LoadModelOptions = {},
): Promise<LoadedModel> {
  const { onProgress, signal, fetchImpl = fetch } = opts;
  throwIfAborted(signal);

  const cached = await cacheGet(entry.url, entry.sha256);
  if (cached) {
    onProgress?.({
      loaded: cached.byteLength,
      total: cached.byteLength,
      percent: 100,
    });
    return { buffer: cached, fromCache: true };
  }

  if (opts.chunked) return loadChunked(entry, onProgress, signal, fetchImpl);

  let res: Response;
  try {
    res = await fetchImpl(withBase(entry.url), { signal });
  } catch (e) {
    if (signal?.aborted) throw cancelledError();
    throw modelDownloadError(
      `Could not download ${entry.name}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!res.ok || !res.body)
    throw modelDownloadError(
      `Could not download ${entry.name}: HTTP ${res.status}`,
    );

  const total = Number(res.headers.get("content-length")) || entry.size;
  const buffer = await readStream(res.body, total, signal, (loaded) =>
    onProgress?.({
      loaded,
      total,
      percent: Math.min(100, (loaded / total) * 100),
    }),
  );

  const actual = await sha256Buffer(buffer);
  if (actual !== entry.sha256.toLowerCase()) {
    throw modelIntegrityError(
      `${entry.name} failed its integrity check (sha256 ${actual}, expected ${entry.sha256})`,
    );
  }
  await cachePut(entry.url, buffer, entry.sha256);
  return { buffer, fromCache: false };
}

async function readStream(
  body: ReadableStream<Uint8Array>,
  expected: number,
  signal: AbortSignal | undefined,
  onChunk: (loaded: number) => void,
): Promise<ArrayBuffer> {
  const reader = body.getReader();
  // Preallocate when the size is known so large models aren't held twice during download.
  let buf = new Uint8Array(expected);
  let loaded = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw cancelledError();
      const { done, value } = await reader.read();
      if (done) break;
      if (loaded + value.length > buf.length) {
        const grown = new Uint8Array(
          Math.max(buf.length * 2, loaded + value.length),
        );
        grown.set(buf.subarray(0, loaded));
        buf = grown;
      }
      buf.set(value, loaded);
      loaded += value.length;
      onChunk(loaded);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    if (signal?.aborted) throw cancelledError();
    throw e;
  }
  return loaded === buf.length ? buf.buffer : buf.slice(0, loaded).buffer;
}

async function fetchBytes(
  url: string,
  name: string,
  expected: number,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
  onChunk: (loaded: number) => void,
): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetchImpl(withBase(url), { signal });
  } catch (e) {
    if (signal?.aborted) throw cancelledError();
    throw modelDownloadError(
      `Could not download ${name}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!res.ok || !res.body)
    throw modelDownloadError(`Could not download ${name}: HTTP ${res.status}`);
  return readStream(res.body, expected, signal, onChunk);
}

async function loadChunked(
  entry: ModelManifestEntry,
  onProgress: LoadModelOptions["onProgress"],
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<LoadedModel> {
  const raw = await fetchBytes(
    partsManifestUrl(entry.url),
    `${entry.name} (parts list)`,
    0,
    signal,
    fetchImpl,
    () => {},
  );
  let pm: PartsManifest;
  try {
    pm = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw modelDownloadError(`${entry.name}: the parts list is not valid JSON`);
  }
  const problem = validatePartsManifest(pm, entry);
  if (problem) throw modelIntegrityError(`${entry.name}: ${problem}`);
  const whole = new Uint8Array(pm.size);
  let offset = 0,
    done = 0;
  const report = (extra: number) =>
    onProgress?.({
      loaded: done + extra,
      total: pm.size,
      percent: Math.min(100, ((done + extra) / pm.size) * 100),
    });
  for (const [k, part] of pm.parts.entries()) {
    throwIfAborted(signal);
    let bytes = await cacheGet(part.url, part.sha256);
    if (!bytes) {
      bytes = await fetchBytes(
        part.url,
        `${entry.name} (part ${k + 1} of ${pm.parts.length})`,
        part.size,
        signal,
        fetchImpl,
        report,
      );
      const actual = await sha256Buffer(bytes);
      if (
        actual !== part.sha256.toLowerCase() ||
        bytes.byteLength !== part.size
      ) {
        throw modelIntegrityError(
          `${entry.name}: part ${k + 1} of ${pm.parts.length} failed its integrity check (sha256 ${actual})`,
        );
      }
      await cachePut(part.url, bytes, part.sha256);
    }
    whole.set(new Uint8Array(bytes), offset);
    offset += bytes.byteLength;
    done += bytes.byteLength;
    report(0);
  }
  const actual = await sha256Buffer(whole.buffer);
  if (actual !== entry.sha256.toLowerCase()) {
    for (const p of pm.parts) await cacheDelete(p.url);
    throw modelIntegrityError(
      `${entry.name} failed its integrity check after assembly (sha256 ${actual}, expected ${entry.sha256})`,
    );
  }
  await cachePut(entry.url, whole.buffer, entry.sha256);
  for (const p of pm.parts) await cacheDelete(p.url);
  return { buffer: whole.buffer, fromCache: false };
}
