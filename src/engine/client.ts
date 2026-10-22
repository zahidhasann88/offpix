import * as Comlink from "comlink";
import type {
  WorkerApi,
  ImageInput,
  MaskResult,
  ResultImage,
  EngineInfo,
  CountResult,
  BgDebugResult,
} from "./workerApi";
import type { ProgressInfo } from "./types";
import { cancelledError, outOfMemoryError } from "./errors";

const CANCEL_GRACE_MS = 1500;

let worker: Worker | null = null;
let api: Comlink.Remote<WorkerApi> | null = null;
let pending: { reject: (e: Error) => void } | null = null;

function getWorker(): Comlink.Remote<WorkerApi> {
  if (!api) {
    const w = new Worker(
      new URL("../workers/inference.worker.ts", import.meta.url),
      { type: "module" },
    );

    w.addEventListener("error", (e) => {
      e.preventDefault();
      const job = pending;
      pending = null;
      if (worker === w) terminateWorker();
      job?.reject(
        outOfMemoryError(
          `The processing engine stopped unexpectedly${e.message ? ` (${e.message})` : ""}`,
        ),
      );
    });
    worker = w;
    api = Comlink.wrap<WorkerApi>(w);
    const sim = import.meta.env.DEV
      ? new URLSearchParams(location.search).get("simulateOom")
      : null;
    if (sim) void api.simulateOom(sim.split(","));
  }
  return api;
}

function terminateWorker(): void {
  worker?.terminate();
  worker = null;
  api = null;
}

function runJob<T>(
  fn: (api: Comlink.Remote<WorkerApi>) => Promise<T>,
): Promise<T> {
  const remote = getWorker();
  return new Promise<T>((resolve, reject) => {
    const job = { reject };
    pending = job;
    fn(remote)
      .then(resolve, reject)
      .finally(() => {
        if (pending === job) pending = null;
      });
  });
}

const noop = () => {};

export const engine = {
  init(): Promise<EngineInfo> {
    return getWorker().init();
  },

  loadModel(modelId: string, onProgress: (p: ProgressInfo) => void = noop) {
    return runJob((w) => w.loadModel(modelId, Comlink.proxy(onProgress)));
  },

  removeBackground(
    image: ImageInput,
    modelId: string,
    onProgress: (p: ProgressInfo) => void = noop,
    maxPixels?: number,
  ): Promise<MaskResult> {
    return runJob((w) =>
      w.removeBackground(
        Comlink.transfer({ image, modelId, maxPixels }, [image.buffer]),
        Comlink.proxy(onProgress),
      ),
    );
  },

  debugBackground(
    image: ImageInput,
    modelId: string,
    onProgress: (p: ProgressInfo) => void = noop,
  ): Promise<BgDebugResult> {
    return runJob((w) =>
      w.debugBackground(
        Comlink.transfer({ image, modelId }, [image.buffer]),
        Comlink.proxy(onProgress),
      ),
    );
  },

  upscale(
    image: ImageInput,
    opts: { modelId: string; tileSize: number; overlap: number },
    onProgress: (p: ProgressInfo) => void = noop,
    onTile: (done: number, total: number) => void = noop,
  ): Promise<ResultImage> {
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number })
      .deviceMemory;
    return runJob((w) =>
      w.upscale(
        Comlink.transfer({ image, ...opts, deviceMemory }, [image.buffer]),
        Comlink.proxy(onProgress),
        Comlink.proxy(onTile),
      ),
    );
  },

  countObjects(
    image: ImageInput,
    opts: { modelId: string; tiled: boolean },
    onProgress: (p: ProgressInfo) => void = noop,
    onRegion: (done: number, total: number) => void = noop,
  ): Promise<CountResult> {
    return runJob((w) =>
      w.countObjects(
        Comlink.transfer({ image, ...opts }, [image.buffer]),
        Comlink.proxy(onProgress),
        Comlink.proxy(onRegion),
      ),
    );
  },

  cancel(): void {
    const job = pending;
    if (!job) return;
    void api?.cancel();
    setTimeout(() => {
      if (pending !== job) return;
      pending = null;
      terminateWorker();
      job.reject(cancelledError());
    }, CANCEL_GRACE_MS);
  },

  setGpuEnabled: (enabled: boolean) => getWorker().setGpuEnabled(enabled),
  modelStatus: () => getWorker().modelStatus(),
  clearCache: () => getWorker().clearCache(),
  cacheInfo: () => getWorker().cacheInfo(),
};
