import type { ModelManifestEntry } from "./types";
import type { AdapterCaps } from "./session";
import { loadSetting, saveSetting } from "../lib/settings";

export interface DeviceCaps {
  webgpu: boolean;
  gpuEnabled: boolean;
  ready: boolean;
  deviceMemory?: number;
  adapter?: AdapterCaps | null;
}

export function gpuShortfall(
  m: ModelManifestEntry,
  caps: DeviceCaps,
): string | null {
  const r = m.gpuRequirements;
  if (!r) return null;
  const a = caps.adapter;
  if (!a)
    return "needs WebGPU adapter details, which this browser does not provide";
  if (r.shaderF16 && !a.shaderF16)
    return "needs a GPU with 16-bit float shaders (shader-f16)";
  if (
    r.minStorageBuffersPerShaderStage &&
    a.maxStorageBuffersPerShaderStage < r.minStorageBuffersPerShaderStage
  )
    return `needs ${r.minStorageBuffersPerShaderStage} storage buffers per shader stage (this GPU: ${a.maxStorageBuffersPerShaderStage})`;
  if (r.minMaxBufferSize && a.maxBufferSize < r.minMaxBufferSize)
    return `needs GPU buffers of ${Math.round(r.minMaxBufferSize / 2 ** 30)} GB (this GPU: ${Math.round(a.maxBufferSize / 2 ** 30)} GB)`;
  if (
    r.minDeviceMemoryGB &&
    (caps.deviceMemory === undefined || caps.deviceMemory < r.minDeviceMemoryGB)
  )
    return `needs ${r.minDeviceMemoryGB} GB of memory (this device: ${caps.deviceMemory ?? "unknown"})`;
  if (r.excludeArchitectures?.includes(a.architecture))
    return `not supported on ${a.vendor} ${a.architecture} GPUs (fails in testing)`;
  return null;
}

export interface Availability {
  usable: ModelManifestEntry[];
  hidden: { model: ModelManifestEntry; reason: string }[];
}

const LOW_MEMORY_GB = 4;

const FAILED_KEY = "modelFailedOnDevice";

function failedOnDevice(): Record<string, string> {
  return loadSetting<Record<string, string>>(FAILED_KEY, {});
}

export function rememberFailure(id: string, reason: string): void {
  saveSetting(FAILED_KEY, { ...failedOnDevice(), [id]: reason });
}

export function availableModels(
  models: ModelManifestEntry[],
  caps: DeviceCaps,
  failed: Record<string, string> = failedOnDevice(),
): Availability {
  const out: Availability = { usable: [], hidden: [] };
  for (const m of models) {
    const reason = failed[m.id]
      ? `could not run on this device (${failed[m.id]})`
      : m.wasm === false && !caps.webgpu
        ? "needs WebGPU, which this browser or device does not provide"
        : m.wasm === false && !caps.gpuEnabled
          ? 'needs the GPU, which is turned off ("Use GPU" in the header)'
          : m.heavy &&
              caps.deviceMemory !== undefined &&
              caps.deviceMemory <= LOW_MEMORY_GB
            ? `needs more memory than this device reports (${caps.deviceMemory} GB)`
            : m.optIn && (m.wasm === false || m.gpuRequirements)
              ? gpuShortfall(m, caps)
              : null;
    if (reason) out.hidden.push({ model: m, reason });
    else out.usable.push(m);
  }
  return out;
}

export function bestModel(
  usable: ModelManifestEntry[],
): ModelManifestEntry | undefined {
  return [...usable]
    .filter((m) => !m.optIn)
    .sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9))[0];
}
