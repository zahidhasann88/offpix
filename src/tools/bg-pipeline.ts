import { guidedFilter, rgbPlanes } from "./filters";
import { solveAlpha, defaultTrimapParams, type TrimapParams } from "./trimap";
import { estimateForeground, foregroundRgba } from "./foreground";
import { fillEnclosed, type FillStats } from "./holes";
import { removeFringe } from "./decontam";

export interface RefineOptions {
  eps: number;
  fillHoles: boolean;
  fillMinArea: number;
  fringe?: number;
  adaptiveBand?: boolean;
  trimap?: TrimapParams;
}

export const DEFAULT_FILL_MIN_AREA = 0.0005;

export const defaultRefineOptions: RefineOptions = {
  eps: 1e-4,
  fillHoles: false,
  fillMinArea: DEFAULT_FILL_MIN_AREA,
};

export interface Cutout {
  alpha: Float32Array;
  fg: Uint8ClampedArray<ArrayBuffer>;
  filled: FillStats | null;
}

function guidedRadius(maskScale: number): number {
  return Math.max(2, Math.round(2 * maskScale));
}

export function refineCutout(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  coarse: Float32Array,
  maskScale: number,
  opts: RefineOptions = defaultRefineOptions,
): Cutout {
  const n = w * h;
  let alpha: Float32Array;
  if (opts.adaptiveBand || opts.trimap) {
    alpha = solveAlpha(
      rgba,
      w,
      h,
      coarse,
      maskScale,
      opts.eps,
      opts.trimap ?? defaultTrimapParams,
    ).alpha;
  } else {
    alpha = guidedFilter(
      rgbPlanes(rgba, n),
      coarse,
      w,
      h,
      guidedRadius(maskScale),
      opts.eps,
    );
    for (let i = 0; i < n; i++)
      alpha[i] = alpha[i] < 0 ? 0 : alpha[i] > 1 ? 1 : alpha[i];
  }
  const filled = opts.fillHoles ? { regions: 0, pixels: 0 } : null;
  if (filled)
    alpha = fillEnclosed(
      alpha,
      w,
      h,
      { rim: guidedRadius(maskScale), minAreaFraction: opts.fillMinArea },
      filled,
    );
  const fg = foregroundRgba(estimateForeground(rgba, alpha, w, h).F, n);
  if (opts.fringe) removeFringe(rgba, alpha, fg, w, h, maskScale, opts.fringe);
  return { alpha, fg, filled };
}
