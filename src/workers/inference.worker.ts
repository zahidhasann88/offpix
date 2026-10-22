import * as Comlink from "comlink";
import * as ort from "onnxruntime-web";
import { models } from "../models";
import { WEBGPU_IN_BUILD, PROFILE, PAGES_FILE_LIMIT } from "../buildProfile";
import type { ModelManifestEntry, ProgressInfo } from "../engine/types";
import { cacheHas, cacheClear, cacheList } from "../engine/cache";
import { selectFile } from "../engine/modelFiles";
import { processingSize } from "../engine/limits";
import { loadModel } from "../engine/loader";
import {
  createSessionWithFallback,
  detectAdapter,
  detectWebGPU,
  FallbackSession,
  type CreateSessionOptions,
} from "../engine/session";
import {
  classifyError,
  unsupportedFileError,
  throwIfAborted,
} from "../engine/errors";
import { modelMask, checkBgLimits } from "../tools/background-remove";
import { upscaleImage, checkUpscaleLimits } from "../tools/upscale";
import {
  detectObjects,
  checkCountLimits,
  letterboxRatio,
  type Region,
} from "../tools/object-count";
import { COCO_CLASSES } from "../tools/cocoClasses";
import { rgbaToNCHW, inputMap, toModelInput } from "../engine/preprocess";
import type {
  WorkerApi,
  ImageInput,
  EngineInfo,
  BgRemoveParams,
  BgDebugResult,
} from "../engine/workerApi";
import {
  tensorStats,
  rembgTensorDiff,
  psnrRgb,
  areaResizeRgba,
} from "../debug/diagnostics";

const SUPPORTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_LIVE_SESSIONS = 2;
const FLIP_TTA_MAX_SIZE = 512;
const LETTERBOX = false;

ort.env.wasm.wasmPaths = new URL(
  `${import.meta.env.BASE_URL}ort/`,
  self.location.origin,
).href;
const threads = self.crossOriginIsolated
  ? Math.min(4, navigator.hardwareConcurrency || 1)
  : 1;
ort.env.wasm.numThreads = threads;

const sessions = new Map<string, FallbackSession>();
let simulateOom: string[] = [];
let webgpuProbe: Promise<boolean> | null = null;
let gpuEnabled = true;
const retired: FallbackSession[] = [];
let activeJobs = 0;
let job: AbortController | null = null;

function getEntry(id: string): ModelManifestEntry {
  const e = models.find((m) => m.id === id);
  if (!e) throw new Error(`Unknown model ${id}`);
  return e;
}

function startJob(): AbortSignal {
  job?.abort();
  job = new AbortController();
  return job.signal;
}

async function sessionOptions(
  entry: ModelManifestEntry,
): Promise<CreateSessionOptions> {
  webgpuProbe ??= WEBGPU_IN_BUILD ? detectWebGPU() : Promise.resolve(false);
  const gpu = await webgpuProbe;
  return {
    create: (model, options) => ort.InferenceSession.create(model, options),
    webgpuAvailable:
      gpu &&
      gpuEnabled &&
      entry.webgpu !== false &&
      selectFile(entry, "webgpu") !== null,
    wasmThreads: threads,
    gpuOnly: entry.wasm === false,
    unavailableReason: !WEBGPU_IN_BUILD
      ? "This build runs on the CPU (WASM) only"
      : !gpu
        ? undefined
        : !gpuEnabled
          ? 'GPU turned off ("Use GPU" in the header)'
          : "This model uses operations WebGPU cannot run yet, so it runs on the CPU",
  };
}

async function getSession(
  entry: ModelManifestEntry,
  signal: AbortSignal,
  onProgress?: (p: ProgressInfo) => void,
) {
  const live = sessions.get(entry.id);
  if (live) {
    onProgress?.({ loaded: entry.size, total: entry.size, percent: 100 });
    return { session: live, fromCache: true };
  }
  if (import.meta.env.DEV && simulateOom.includes(entry.id))
    throw new Error(`std::bad_alloc (simulated for ${entry.id})`);
  const opts = await sessionOptions(entry);
  const pick = (b: "webgpu" | "wasm") => {
    const f = selectFile(entry, b);
    return f ? { ...entry, ...f } : entry;
  };
  const file = pick(opts.webgpuAvailable ? "webgpu" : "wasm");
  const chunked = (f: { size: number }) =>
    PROFILE === "pages" && f.size > PAGES_FILE_LIMIT;
  const { buffer, fromCache } = await loadModel(file, {
    onProgress,
    signal,
    chunked: chunked(file),
  });
  const session = new FallbackSession(
    await createSessionWithFallback(new Uint8Array(buffer), opts),
    async () => {
      const f = pick("wasm");
      return new Uint8Array(
        (await loadModel(f, { chunked: chunked(f) })).buffer,
      );
    },
    opts,
  );
  // Keep GPU/heap memory bounded: drop the least recently created sessions.
  while (sessions.size >= MAX_LIVE_SESSIONS) {
    const [oldId, old] = sessions.entries().next().value!;
    sessions.delete(oldId);
    await old.release();
  }
  sessions.set(entry.id, session);
  return { session, fromCache };
}

async function decode(img: ImageInput): Promise<ImageBitmap> {
  if (!SUPPORTED_TYPES.includes(img.mimeType)) {
    throw unsupportedFileError(
      `${img.mimeType || "This file type"} is not supported. Use PNG, JPEG or WebP.`,
    );
  }
  try {
    return await createImageBitmap(
      new Blob([img.buffer], { type: img.mimeType }),
      { imageOrientation: "from-image" },
    );
  } catch {
    throw unsupportedFileError(
      "The image could not be decoded. It may be corrupt or in an unsupported format.",
    );
  }
}

function pixels(bm: ImageBitmap, w: number, h: number): Uint8ClampedArray {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bm, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

function letterbox(
  bm: ImageBitmap,
  region: Region,
  size: number,
): { rgba: Uint8ClampedArray; ratio: number } {
  const ratio = letterboxRatio(region.w, region.h, size);
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(
    bm,
    region.x,
    region.y,
    region.w,
    region.h,
    0,
    0,
    Math.floor(region.w * ratio),
    Math.floor(region.h * ratio),
  );
  return { rgba: ctx.getImageData(0, 0, size, size).data, ratio };
}

async function runSingle(
  session: ort.InferenceSession,
  inputName: string,
  outputName: string,
  data: Float32Array,
  dims: number[],
): Promise<Float32Array> {
  const input = new ort.Tensor("float32", data, dims);
  // Fetch only the output we need: some models (ISNet, U2-Net) expose many side outputs.
  const results = await session.run({ [inputName]: input }, [outputName]);
  const out = results[outputName];
  const values = (await out.getData()) as Float32Array;
  out.dispose();
  return values;
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  activeJobs++;
  try {
    return await fn();
  } catch (e) {
    throw classifyError(e);
  } finally {
    activeJobs--;
    if (activeJobs === 0) await releaseRetired();
  }
}

async function releaseRetired(): Promise<void> {
  for (const s of retired.splice(0)) await s.release();
}

async function runBackground(
  params: BgRemoveParams,
  signal: AbortSignal,
  onProgress?: (p: ProgressInfo) => void,
  debug = false,
) {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const entry = getEntry(params.modelId);
  const bm = await decode(params.image);
  checkBgLimits(bm.width, bm.height);
  const { session } = await getSession(entry, signal, onProgress);
  timings.load = performance.now() - t0;
  const size = entry.input.shape[2] as number;
  const outSize = entry.output.shape[2] as number;
  const mean = entry.input.mean ?? [0, 0, 0],
    std = entry.input.std ?? [1, 1, 1];
  const { w, h } = params.maxPixels
    ? processingSize(bm.width, bm.height, params.maxPixels)
    : { w: bm.width, h: bm.height };
  const rgba = pixels(bm, w, h);
  bm.close();
  const map = inputMap(w, h, size, LETTERBOX);
  const modelInput = toModelInput(rgba, map);
  let rawMin = Infinity,
    rawMax = -Infinity;
  const t1 = performance.now();
  const low = await modelMask(
    {
      modelInput,
      size,
      outSize,
      origW: w,
      origH: h,
      mean,
      std,
      activation: entry.output.activation,
      keepLogits: entry.output.activation === "sigmoid",
      signal,
    },
    async (nchw, s) => {
      const out = await session.run((sess) =>
        runSingle(sess, entry.input.name, entry.output.name, nchw, [
          1,
          3,
          s,
          s,
        ]),
      );
      if (debug)
        for (let i = 0; i < outSize * outSize; i++) {
          if (out[i] < rawMin) rawMin = out[i];
          if (out[i] > rawMax) rawMax = out[i];
        }
      return out;
    },
    size <= FLIP_TTA_MAX_SIZE,
  );
  timings.inference = performance.now() - t1;
  throwIfAborted(signal);
  const base = {
    w,
    h,
    low,
    outSize,
    map,
    logits: entry.output.activation === "sigmoid",
    backend: session.backend,
    fallbackReason: session.fallbackReason,
  };
  if (!debug) return { ...base, debug: null };
  const tensor = rgbaToNCHW(
    modelInput,
    size,
    size,
    mean,
    std,
    entry.input.channels,
  );
  return {
    ...base,
    debug: {
      size,
      modelInput,
      original: rgba,
      timings,
      rawRange: [rawMin, rawMax] as [number, number],
      tensor: tensorStats(tensor, size * size),
      rembgDiff: rembgTensorDiff(modelInput, tensor, mean, std),
      resamplePsnr: psnrRgb(modelInput, areaResizeRgba(rgba, w, h, size, size)),
    },
  };
}

const api: WorkerApi = {
  async init(): Promise<EngineInfo> {
    webgpuProbe ??= WEBGPU_IN_BUILD ? detectWebGPU() : Promise.resolve(false);
    const adapter = WEBGPU_IN_BUILD ? await detectAdapter() : null;
    return {
      crossOriginIsolated: self.crossOriginIsolated,
      webgpu: await webgpuProbe,
      webgpuInBuild: WEBGPU_IN_BUILD,
      threads,
      adapter,
    };
  },

  loadModel(modelId, onProgress) {
    return guarded(async () => {
      const signal = startJob();
      const { session, fromCache } = await getSession(
        getEntry(modelId),
        signal,
        onProgress,
      );
      return {
        backend: session.backend,
        fallbackReason: session.fallbackReason,
        fromCache,
      };
    });
  },

  async modelStatus() {
    const out: Record<string, boolean> = {};
    for (const m of models)
      out[m.id] =
        (await cacheHas(m.url, m.sha256)) ||
        (!!m.webgpuFile &&
          (await cacheHas(m.webgpuFile.url, m.webgpuFile.sha256)));
    return out;
  },

  removeBackground(params, onProgress) {
    return guarded(async () => {
      const r = await runBackground(params, startJob(), onProgress);
      const result = {
        width: r.w,
        height: r.h,
        lowMask: r.low,
        outSize: r.outSize,
        map: r.map,
        logits: r.logits,
        backend: r.backend,
        fallbackReason: r.fallbackReason,
      };
      return Comlink.transfer(result, [r.low.buffer]);
    });
  },

  debugBackground(params, onProgress) {
    return guarded(async () => {
      const r = await runBackground(params, startJob(), onProgress, true);
      const d = r.debug!;
      const result: BgDebugResult = {
        modelId: params.modelId,
        width: r.w,
        height: r.h,
        size: d.size,
        outSize: r.outSize,
        map: r.map,
        logits: r.logits,
        modelInput: d.modelInput,
        tensor: d.tensor,
        rembgDiff: d.rembgDiff,
        resamplePsnr: d.resamplePsnr,
        rawRange: d.rawRange,
        lowMask: r.low,
        original: d.original,
        timings: d.timings,
        backend: r.backend,
        fallbackReason: r.fallbackReason,
      };
      return Comlink.transfer(result, [
        d.modelInput.buffer,
        r.low.buffer,
        d.original.buffer,
      ]);
    });
  },

  upscale(params, onProgress, onTile) {
    return guarded(async () => {
      const signal = startJob();
      const entry = getEntry(params.modelId);
      const scale = entry.scale ?? 4;
      const bm = await decode(params.image);
      checkUpscaleLimits(bm.width, bm.height, scale, params.deviceMemory);
      const { session } = await getSession(entry, signal, onProgress);
      const rgba = pixels(bm, bm.width, bm.height);
      const out = await upscaleImage(
        rgba,
        bm.width,
        bm.height,
        (chw, w, h) =>
          session.run((sess) =>
            runSingle(sess, entry.input.name, entry.output.name, chw, [
              1,
              3,
              h,
              w,
            ]),
          ),
        {
          scale,
          tileSize: params.tileSize,
          overlap: params.overlap,
          inputMultiple: entry.inputMultiple,
          signal,
          onTile,
        },
      );
      bm.close();
      return Comlink.transfer(
        {
          ...out,
          backend: session.backend,
          fallbackReason: session.fallbackReason,
        },
        [out.data.buffer],
      );
    });
  },

  countObjects(params, onProgress, onRegion) {
    return guarded(async () => {
      const signal = startJob();
      const entry = getEntry(params.modelId);
      const bm = await decode(params.image);
      checkCountLimits(bm.width, bm.height);
      const { session } = await getSession(entry, signal, onProgress);
      const size = entry.input.shape[2] as number;
      const detections = await detectObjects({
        width: bm.width,
        height: bm.height,
        size,
        numClasses: COCO_CLASSES.length,
        tiled: params.tiled,
        prepare: (region) => {
          const { rgba, ratio } = letterbox(bm, region, size);
          return {
            input: rgbaToNCHW(
              rgba,
              size,
              size,
              entry.input.mean,
              entry.input.std,
              entry.input.channels,
            ),
            ratio,
          };
        },
        run: (input) =>
          session.run((sess) =>
            runSingle(sess, entry.input.name, entry.output.name, input, [
              1,
              3,
              size,
              size,
            ]),
          ),
        signal,
        onRegion,
      });
      const result = {
        width: bm.width,
        height: bm.height,
        detections,
        backend: session.backend,
        fallbackReason: session.fallbackReason,
      };
      bm.close();
      return result;
    });
  },

  async setGpuEnabled(enabled) {
    if (enabled === gpuEnabled) return;
    gpuEnabled = enabled;
    retired.push(...sessions.values());
    sessions.clear();
    if (activeJobs === 0) await releaseRetired();
  },

  cancel() {
    job?.abort();
  },

  simulateOom(ids) {
    if (import.meta.env.DEV) simulateOom = ids;
  },

  async clearCache() {
    for (const s of sessions.values()) await s.release();
    sessions.clear();
    await cacheClear();
  },

  async cacheInfo() {
    const items = await cacheList();
    return { items, total: items.reduce((a, b) => a + b.size, 0) };
  },
};

Comlink.expose(api);
