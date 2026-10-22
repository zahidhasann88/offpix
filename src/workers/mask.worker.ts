import * as Comlink from "comlink";
import { maskToImage, type InputMap } from "../engine/preprocess";
import { applyEdgeRefine } from "../tools/edges";
import {
  dequantizeMask,
  quantizeMask,
  sigmoidInPlace,
} from "../tools/background-remove";
import { refineCutout, type RefineOptions } from "../tools/bg-pipeline";
import type { FillStats } from "../tools/holes";
import { replayStrokes, type Stroke } from "../lib/maskEdit";

const decoded = new Map<
  string,
  { rgba: Uint8ClampedArray; w: number; h: number }
>();
const MAX_DECODED = 2;

async function photo(key: string, image: Blob, w: number, h: number) {
  const hit = decoded.get(key);
  if (hit && hit.w === w && hit.h === h) {
    decoded.delete(key);
    decoded.set(key, hit);
    return hit;
  }
  const bm = await createImageBitmap(image, { imageOrientation: "from-image" });
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bm, 0, 0, w, h);
  const entry = { rgba: ctx.getImageData(0, 0, w, h).data, w, h };
  bm.close();
  decoded.set(key, entry);
  while (decoded.size > MAX_DECODED)
    decoded.delete(decoded.keys().next().value!);
  return entry;
}

export interface RefineResult {
  mask: Uint8ClampedArray;
  fg: Uint8ClampedArray;
  filled: FillStats | null;
  coarse?: Uint8ClampedArray;
}

const api = {
  async refine(
    key: string,
    image: Blob,
    lowMask: Float32Array,
    outSize: number,
    map: InputMap,
    opts: RefineOptions,
    debug = false,
    logits = false,
  ): Promise<RefineResult> {
    const { rgba, w, h } = await photo(key, image, map.w, map.h);
    // Logits (sigmoid models) are resized first, then squashed: crisper edges than resizing probabilities.
    const coarse = maskToImage(lowMask, outSize, map);
    if (logits) sigmoidInPlace(coarse);
    const maskScale = Math.max(w / map.dw, h / map.dh) * (map.size / outSize);
    const { alpha, fg, filled } = refineCutout(
      rgba,
      w,
      h,
      coarse,
      maskScale,
      opts,
    );
    const result: RefineResult = {
      mask: quantizeMask(alpha),
      fg,
      filled,
      coarse: debug ? quantizeMask(coarse) : undefined,
    };
    return Comlink.transfer(result, [
      result.mask.buffer,
      fg.buffer,
      ...(result.coarse ? [result.coarse.buffer] : []),
    ]);
  },

  forget(key: string) {
    decoded.delete(key);
  },

  build(
    mask8: Uint8ClampedArray,
    w: number,
    h: number,
    feather: number,
    shift: number,
    strokes: Stroke[],
  ): Float32Array {
    const mask = applyEdgeRefine(dequantizeMask(mask8), w, h, feather, shift);
    replayStrokes(mask, w, h, strokes);
    return Comlink.transfer(mask, [mask.buffer]);
  },
};

export type MaskWorkerApi = typeof api;

Comlink.expose(api);
