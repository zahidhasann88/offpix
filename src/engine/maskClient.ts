import * as Comlink from "comlink";
import type { MaskWorkerApi, RefineResult } from "../workers/mask.worker";
import type { Stroke } from "../lib/maskEdit";
import type { InputMap } from "./preprocess";
import type { RefineOptions } from "../tools/bg-pipeline";

let api: Comlink.Remote<MaskWorkerApi> | null = null;

function getMaskWorker(): Comlink.Remote<MaskWorkerApi> {
  api ??= Comlink.wrap<MaskWorkerApi>(
    new Worker(new URL("../workers/mask.worker.ts", import.meta.url), {
      type: "module",
    }),
  );
  return api;
}

export function refineMask(
  key: string,
  image: Blob,
  lowMask: Float32Array,
  outSize: number,
  map: InputMap,
  opts: RefineOptions,
  debug = false,
  logits = false,
): Promise<RefineResult> {
  return getMaskWorker().refine(
    key,
    image,
    lowMask,
    outSize,
    map,
    opts,
    debug,
    logits,
  );
}

export function forgetImage(key: string): void {
  void getMaskWorker().forget(key);
}

export function buildMask(
  mask8: Uint8ClampedArray,
  w: number,
  h: number,
  feather: number,
  shift: number,
  strokes: Stroke[],
): Promise<Float32Array> {
  return getMaskWorker().build(mask8, w, h, feather, shift, strokes);
}
