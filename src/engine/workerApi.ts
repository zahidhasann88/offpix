import type { Backend, ProgressInfo } from "./types";
import type { Detection } from "../tools/object-count";
import type { InputMap } from "./preprocess";
import type { AdapterCaps } from "./session";

export interface ImageInput {
  buffer: ArrayBuffer;
  mimeType: string;
}

export interface EngineInfo {
  crossOriginIsolated: boolean;
  webgpu: boolean;
  webgpuInBuild: boolean;
  threads: number;
  adapter: AdapterCaps | null;
}

export interface BackendInfo {
  backend: Backend;
  fallbackReason?: string;
}

export interface BgRemoveParams {
  image: ImageInput;
  modelId: string;
  maxPixels?: number;
}

export interface UpscaleParams {
  image: ImageInput;
  modelId: string;
  tileSize: number;
  overlap: number;
  deviceMemory?: number;
}

export interface CountParams {
  image: ImageInput;
  modelId: string;
  tiled: boolean;
}

export interface CountResult extends BackendInfo {
  width: number;
  height: number;
  detections: Detection[];
}

export interface MaskResult extends BackendInfo {
  width: number;
  height: number;
  lowMask: Float32Array;
  outSize: number;
  map: InputMap;
  logits?: boolean;
}

export interface BgDebugResult extends MaskResult {
  modelId: string;
  size: number;
  modelInput: Uint8ClampedArray;
  tensor: { mean: number[]; min: number[]; max: number[] };
  rembgDiff: number;
  resamplePsnr: number;
  rawRange: [number, number];
  original: Uint8ClampedArray;
  timings: Record<string, number>;
}

export interface ResultImage extends BackendInfo {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface WorkerApi {
  init(): Promise<EngineInfo>;
  loadModel(
    modelId: string,
    onProgress?: (p: ProgressInfo) => void,
  ): Promise<BackendInfo & { fromCache: boolean }>;
  modelStatus(): Promise<Record<string, boolean>>;
  removeBackground(
    params: BgRemoveParams,
    onProgress?: (p: ProgressInfo) => void,
  ): Promise<MaskResult>;
  debugBackground(
    params: BgRemoveParams,
    onProgress?: (p: ProgressInfo) => void,
  ): Promise<BgDebugResult>;
  upscale(
    params: UpscaleParams,
    onProgress?: (p: ProgressInfo) => void,
    onTile?: (done: number, total: number) => void,
  ): Promise<ResultImage>;
  countObjects(
    params: CountParams,
    onProgress?: (p: ProgressInfo) => void,
    onRegion?: (done: number, total: number) => void,
  ): Promise<CountResult>;
  setGpuEnabled(enabled: boolean): Promise<void>;
  cancel(): void;
  simulateOom(ids: string[]): void;
  clearCache(): Promise<void>;
  cacheInfo(): Promise<{
    items: { url: string; size: number }[];
    total: number;
  }>;
}
