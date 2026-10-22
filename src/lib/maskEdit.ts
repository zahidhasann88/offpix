export type BrushMode = "restore" | "erase";

export interface Brush {
  mode: BrushMode;
  radius: number;
  softness: number;
}

export interface Stroke extends Brush {
  points: number[];
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

export function brushWeight(
  d: number,
  radius: number,
  softness: number,
): number {
  if (d >= radius) return 0;
  const inner = radius * (1 - Math.min(1, Math.max(0, softness)));
  if (d <= inner) return 1;
  const t = (d - inner) / (radius - inner);
  return 1 - t * t * (3 - 2 * t);
}

export class StrokePainter {
  readonly points: number[] = [];
  private bounds: Rect | null = null;
  readonly brush: Brush;
  private readonly target: number;
  private readonly mask: Float32Array;
  private readonly w: number;
  private readonly h: number;
  private readonly coverage: Uint8Array;

  constructor(
    mask: Float32Array,
    w: number,
    h: number,
    brush: Brush,
    coverage: Uint8Array = new Uint8Array(w * h),
  ) {
    this.mask = mask;
    this.w = w;
    this.h = h;
    this.brush = brush;
    this.coverage = coverage;
    this.target = brush.mode === "restore" ? 1 : 0;
  }

  lineTo(x: number, y: number): Rect | null {
    const n = this.points.length;
    this.points.push(x, y);
    if (n === 0) return this.stamp(x, y);
    const px = this.points[n - 2],
      py = this.points[n - 1];
    const len = Math.hypot(x - px, y - py);
    const steps = Math.max(
      1,
      Math.ceil(len / Math.max(1, this.brush.radius * 0.25)),
    );
    let dirty: Rect | null = null;
    for (let i = 1; i <= steps; i++) {
      dirty = unionRect(
        dirty,
        this.stamp(px + ((x - px) * i) / steps, py + ((y - py) * i) / steps),
      );
    }
    return dirty;
  }

  finish(): void {
    const b = this.bounds;
    if (!b) return;
    for (let y = b.y0; y < b.y1; y++)
      this.coverage.fill(0, y * this.w + b.x0, y * this.w + b.x1);
  }

  private stamp(cx: number, cy: number): Rect | null {
    const r = this.brush.radius;
    const x0 = Math.max(0, Math.floor(cx - r)),
      x1 = Math.min(this.w, Math.ceil(cx + r) + 1);
    const y0 = Math.max(0, Math.floor(cy - r)),
      y1 = Math.min(this.h, Math.ceil(cy + r) + 1);
    if (x0 >= x1 || y0 >= y1) return null;
    const { mask, coverage, target } = this;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const c = Math.round(
          brushWeight(Math.hypot(x - cx, y - cy), r, this.brush.softness) * 255,
        );
        const i = y * this.w + x;
        const old = coverage[i];
        if (c <= old) continue;
        mask[i] = target + (mask[i] - target) * ((255 - c) / (255 - old));
        coverage[i] = c;
      }
    }
    const rect = { x0, y0, x1, y1 };
    this.bounds = unionRect(this.bounds, rect);
    return rect;
  }
}

export function replayStrokes(
  mask: Float32Array,
  w: number,
  h: number,
  strokes: readonly Stroke[],
): void {
  if (!strokes.length) return;
  const coverage = new Uint8Array(w * h);
  for (const s of strokes) {
    const painter = new StrokePainter(mask, w, h, s, coverage);
    for (let i = 0; i < s.points.length; i += 2)
      painter.lineTo(s.points[i], s.points[i + 1]);
    painter.finish();
  }
}

export interface History {
  done: Stroke[];
  undone: Stroke[];
}

export const emptyHistory: History = { done: [], undone: [] };

export function pushStroke(h: History, s: Stroke): History {
  return { done: [...h.done, s], undone: [] };
}

export function undo(h: History): History {
  if (!h.done.length) return h;
  return {
    done: h.done.slice(0, -1),
    undone: [...h.undone, h.done[h.done.length - 1]],
  };
}

export function redo(h: History): History {
  if (!h.undone.length) return h;
  return {
    done: [...h.done, h.undone[h.undone.length - 1]],
    undone: h.undone.slice(0, -1),
  };
}
