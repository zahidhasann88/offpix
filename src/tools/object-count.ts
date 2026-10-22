import { planTiles } from "../engine/tiling";
import { imageTooLargeError, throwIfAborted } from "../engine/errors";

export interface Detection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
  classId: number;
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

const STRIDES = [8, 16, 32];
export const MIN_SCORE = 0.1;
const NMS_IOU = 0.45;
const MERGE_IOS = 0.7;
const MAX_COUNT_MEGAPIXELS = 40;

export function checkCountLimits(w: number, h: number): void {
  const mp = (w * h) / 1e6;
  if (mp > MAX_COUNT_MEGAPIXELS) {
    throw imageTooLargeError(
      `Image is ${mp.toFixed(1)} MP; the maximum is ${MAX_COUNT_MEGAPIXELS} MP. Downscale it first.`,
    );
  }
}

export function letterboxRatio(w: number, h: number, size: number): number {
  return Math.min(size / w, size / h);
}

export function detectionRegions(
  width: number,
  height: number,
  size: number,
  tiled: boolean,
): Region[] {
  const regions: Region[] = [{ x: 0, y: 0, w: width, h: height }];
  const tile = Math.round(size * 1.5);
  if (!tiled || (width <= tile && height <= tile)) return regions;
  for (const t of planTiles(width, height, tile, Math.round(tile * 0.2)))
    regions.push({ x: t.x0, y: t.y0, w: t.w, h: t.h });
  return regions;
}

export function decodeYolox(
  raw: Float32Array,
  size: number,
  numClasses: number,
  ratio: number,
  region: Region,
  minScore = MIN_SCORE,
): Detection[] {
  const stride = 5 + numClasses;
  const out: Detection[] = [];
  let anchor = 0;
  for (const s of STRIDES) {
    const cells = size / s;
    for (let gy = 0; gy < cells; gy++) {
      for (let gx = 0; gx < cells; gx++, anchor++) {
        const o = anchor * stride;
        const obj = raw[o + 4];
        if (obj < minScore) continue;
        let best = 0;
        let bestProb = raw[o + 5];
        for (let c = 1; c < numClasses; c++) {
          const p = raw[o + 5 + c];
          if (p > bestProb) {
            bestProb = p;
            best = c;
          }
        }
        const score = obj * bestProb;
        if (score <= minScore) continue;
        const cx = (raw[o] + gx) * s;
        const cy = (raw[o + 1] + gy) * s;
        const w = Math.exp(raw[o + 2]) * s;
        const h = Math.exp(raw[o + 3]) * s;
        out.push({
          x1: (cx - w / 2) / ratio + region.x,
          y1: (cy - h / 2) / ratio + region.y,
          x2: (cx + w / 2) / ratio + region.x,
          y2: (cy + h / 2) / ratio + region.y,
          score,
          classId: best,
        });
      }
    }
  }
  return out;
}

// Pixel-inclusive box geometry (+1), matching the YOLOX reference NMS.
const area = (d: Detection) => (d.x2 - d.x1 + 1) * (d.y2 - d.y1 + 1);
function intersection(a: Detection, b: Detection): number {
  const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) + 1);
  const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) + 1);
  return w * h;
}
export function iou(a: Detection, b: Detection): number {
  const inter = intersection(a, b);
  return inter / (area(a) + area(b) - inter);
}

export function nms(dets: Detection[], iouThr = NMS_IOU): Detection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const keep: Detection[] = [];
  for (const d of sorted)
    if (keep.every((k) => iou(k, d) <= iouThr)) keep.push(d);
  return keep;
}

export function mergeRegions(
  perRegion: Detection[][],
  iouThr = NMS_IOU,
  iosThr = MERGE_IOS,
): Detection[] {
  const all = perRegion
    .flatMap((dets, region) => dets.map((d) => ({ d, region })))
    .sort((a, b) => b.d.score - a.d.score);
  const keep: typeof all = [];
  for (const c of all) {
    const duplicate = keep.some((k) => {
      if (iou(k.d, c.d) > iouThr) return true;
      if (k.region === c.region || k.d.classId !== c.d.classId) return false;
      return intersection(k.d, c.d) / Math.min(area(k.d), area(c.d)) > iosThr;
    });
    if (!duplicate) keep.push(c);
  }
  return keep.map((k) => k.d);
}

export interface CountOptions {
  width: number;
  height: number;
  size: number;
  numClasses: number;
  tiled: boolean;
  prepare: (
    region: Region,
  ) =>
    | Promise<{ input: Float32Array; ratio: number }>
    | { input: Float32Array; ratio: number };
  run: (input: Float32Array) => Promise<Float32Array>;
  signal?: AbortSignal;
  onRegion?: (done: number, total: number) => void;
}

export async function detectObjects(opts: CountOptions): Promise<Detection[]> {
  const regions = detectionRegions(
    opts.width,
    opts.height,
    opts.size,
    opts.tiled,
  );
  const perRegion: Detection[][] = [];
  for (const [i, region] of regions.entries()) {
    throwIfAborted(opts.signal);
    const { input, ratio } = await opts.prepare(region);
    const raw = await opts.run(input);
    throwIfAborted(opts.signal);
    perRegion.push(
      nms(
        clip(
          decodeYolox(raw, opts.size, opts.numClasses, ratio, region),
          opts.width,
          opts.height,
        ),
      ),
    );
    opts.onRegion?.(i + 1, regions.length);
  }
  return perRegion.length === 1 ? perRegion[0] : mergeRegions(perRegion);
}

function clip(dets: Detection[], w: number, h: number): Detection[] {
  return dets.map((d) => ({
    ...d,
    x1: Math.max(0, d.x1),
    y1: Math.max(0, d.y1),
    x2: Math.min(w, d.x2),
    y2: Math.min(h, d.y2),
  }));
}

export function countByClass(
  dets: Detection[],
): [classId: number, count: number][] {
  const m = new Map<number, number>();
  for (const d of dets) m.set(d.classId, (m.get(d.classId) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
}

export interface CsvRow {
  label: string;
  score: number | null;
  box: [number, number, number, number];
  status: string;
}

export function toCsv(rows: CsvRow[]): string {
  const esc = (s: string) =>
    /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const lines = rows.map((r, i) =>
    [
      i + 1,
      esc(r.label),
      r.score == null ? "" : r.score.toFixed(3),
      ...r.box.map((v) => Math.round(v)),
      r.status,
    ].join(","),
  );
  return ["id,label,score,x1,y1,x2,y2,status", ...lines].join("\n") + "\n";
}
