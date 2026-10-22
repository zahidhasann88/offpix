import type { ModelManifestEntry, ModelFile } from "./types";

export type RunBackend = "wasm" | "webgpu";

export function verifiedBackends(
  entry: ModelManifestEntry,
  file: ModelFile,
): RunBackend[] {
  if (file.verified) return file.verified;
  const backends: RunBackend[] = ["wasm"];
  if (entry.webgpu !== false && file.dtype !== "fp16") backends.push("webgpu");
  return backends;
}

export function selectFile(
  entry: ModelManifestEntry,
  backend: RunBackend,
): ModelFile | null {
  const main: ModelFile = {
    url: entry.url,
    size: entry.size,
    sha256: entry.sha256,
    dtype: entry.dtype,
    verified: entry.verified,
  };
  const order =
    backend === "webgpu" ? [entry.webgpuFile, main] : [main, entry.webgpuFile];
  for (const f of order)
    if (f && verifiedBackends(entry, f).includes(backend)) return f;
  return null;
}
