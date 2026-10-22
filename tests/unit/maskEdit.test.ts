import { describe, it, expect } from "vitest";
import {
  StrokePainter,
  replayStrokes,
  brushWeight,
  pushStroke,
  undo,
  redo,
  emptyHistory,
  type Stroke,
} from "../../src/lib/maskEdit";

const W = 40,
  H = 30;

function paint(
  mask: Float32Array,
  stroke: Omit<Stroke, "points">,
  pts: number[],
): Stroke {
  const p = new StrokePainter(mask, W, H, stroke);
  for (let i = 0; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
  p.finish();
  return { ...stroke, points: p.points };
}

describe("brush", () => {
  it("weight is 1 in the core and 0 at the radius", () => {
    expect(brushWeight(0, 10, 0.5)).toBe(1);
    expect(brushWeight(5, 10, 0.5)).toBe(1);
    expect(brushWeight(7.5, 10, 0.5)).toBeCloseTo(0.5);
    expect(brushWeight(10, 10, 0.5)).toBe(0);
  });

  it("restores and erases with a hard brush", () => {
    const m = new Float32Array(W * H).fill(0.5);
    paint(m, { mode: "restore", radius: 4, softness: 0 }, [10, 10]);
    expect(m[10 * W + 10]).toBe(1);
    expect(m[0]).toBe(0.5);
    paint(m, { mode: "erase", radius: 4, softness: 0 }, [10, 10]);
    expect(m[10 * W + 10]).toBe(0);
  });

  it("does not harden soft edges where stamps overlap within one stroke", () => {
    const once = new Float32Array(W * H);
    const many = new Float32Array(W * H);
    const brush = { mode: "restore" as const, radius: 8, softness: 1 };
    paint(once, brush, [20, 15]);
    paint(many, brush, [20, 15, 20, 15, 20, 15, 20, 15]);
    for (let i = 0; i < once.length; i++)
      expect(many[i]).toBeCloseTo(once[i], 5);
  });

  it("fills the gaps between distant pointer samples", () => {
    const m = new Float32Array(W * H);
    paint(m, { mode: "restore", radius: 2, softness: 0 }, [2, 15, 37, 15]);
    for (let x = 2; x <= 37; x++) expect(m[15 * W + x]).toBe(1);
  });

  it("replaying recorded strokes reproduces the live result exactly", () => {
    const live = new Float32Array(W * H).fill(0.3);
    const strokes = [
      paint(
        live,
        { mode: "restore", radius: 6, softness: 0.7 },
        [5, 5, 30, 20, 35, 25],
      ),
      paint(live, { mode: "erase", radius: 3, softness: 0.2 }, [10, 25, 20, 2]),
    ];
    const replayed = new Float32Array(W * H).fill(0.3);
    replayStrokes(replayed, W, H, strokes);
    expect(replayed).toEqual(live);
  });
});

describe("history", () => {
  const s = (n: number): Stroke => ({
    mode: "restore",
    radius: n,
    softness: 0,
    points: [],
  });
  it("undo/redo and a new stroke clears redo", () => {
    let h = pushStroke(pushStroke(emptyHistory, s(1)), s(2));
    h = undo(h);
    expect(h.done.map((x) => x.radius)).toEqual([1]);
    h = redo(h);
    expect(h.done.map((x) => x.radius)).toEqual([1, 2]);
    h = pushStroke(undo(h), s(3));
    expect(h.done.map((x) => x.radius)).toEqual([1, 3]);
    expect(redo(h)).toBe(h);
    expect(undo(emptyHistory)).toBe(emptyHistory);
  });
});
