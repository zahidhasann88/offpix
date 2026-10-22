import { describe, it, expect } from "vitest";
import {
  decodeYolox,
  nms,
  mergeRegions,
  detectionRegions,
  detectObjects,
  countByClass,
  toCsv,
  letterboxRatio,
  checkCountLimits,
  type Detection,
} from "../../src/tools/object-count";
import { rgbaToNCHW } from "../../src/engine/preprocess";

const SIZE = 64;
const CLASSES = 3;
const ANCHORS = 84;

function rawOutput(
  set: {
    anchor: number;
    dx: number;
    dy: number;
    logW: number;
    logH: number;
    obj: number;
    probs: number[];
  }[],
) {
  const raw = new Float32Array(ANCHORS * (5 + CLASSES));
  for (const a of set)
    raw.set(
      [a.dx, a.dy, a.logW, a.logH, a.obj, ...a.probs],
      a.anchor * (5 + CLASSES),
    );
  return raw;
}

const det = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  score: number,
  classId = 0,
): Detection => ({ x1, y1, x2, y2, score, classId });

describe("YOLOX decode", () => {
  it("decodes grid offsets, strides and exp sizes into original-image boxes", () => {
    const raw = rawOutput([
      {
        anchor: 9,
        dx: 0.5,
        dy: 0.5,
        logW: Math.log(2),
        logH: Math.log(4),
        obj: 0.9,
        probs: [0.1, 0.8, 0.1],
      },
      {
        anchor: 64,
        dx: 0,
        dy: 0,
        logW: 0,
        logH: 0,
        obj: 0.05,
        probs: [1, 0, 0],
      }, // below MIN_SCORE
    ]);
    const ratio = 0.5;
    const [d, ...rest] = decodeYolox(raw, SIZE, CLASSES, ratio, {
      x: 100,
      y: 10,
      w: 128,
      h: 128,
    });
    expect(rest).toEqual([]);
    expect(d.classId).toBe(1);
    expect(d.score).toBeCloseTo(0.72);
    expect([d.x1, d.y1, d.x2, d.y2].map((v) => +v.toFixed(3))).toEqual([
      100 + 8,
      10 - 8,
      100 + 40,
      10 + 56,
    ]);
  });

  it("builds BGR, raw 0..255 input when std is 1/255", () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255]);
    expect(
      Array.from(
        rgbaToNCHW(rgba, 1, 1, [0, 0, 0], [1 / 255, 1 / 255, 1 / 255], "BGR"),
      ).map((v) => Math.round(v)),
    ).toEqual([30, 20, 10]);
  });

  it("letterbox ratio fits the longer side", () => {
    expect(letterboxRatio(960, 720, 416)).toBeCloseTo(416 / 960);
    expect(letterboxRatio(300, 600, 416)).toBeCloseTo(416 / 600);
  });
});

describe("NMS and merging", () => {
  it("suppresses overlapping boxes regardless of class, keeping the best", () => {
    const kept = nms([
      det(0, 0, 10, 10, 0.5, 0),
      det(1, 1, 11, 11, 0.9, 2),
      det(50, 50, 60, 60, 0.4, 0),
    ]);
    expect(kept.map((d) => d.score)).toEqual([0.9, 0.4]);
  });

  it("merges an object cut by a tile edge with its full detection from another region", () => {
    const full = det(100, 100, 200, 300, 0.8);
    const cutByTile = det(100, 100, 140, 300, 0.6);
    expect(mergeRegions([[full], [cutByTile]])).toEqual([full]);
    expect(mergeRegions([[full, cutByTile]])).toHaveLength(2);
  });

  it("plans the whole image plus overlapping tiles only when tiled and large", () => {
    expect(detectionRegions(960, 720, 416, false)).toEqual([
      { x: 0, y: 0, w: 960, h: 720 },
    ]);
    expect(detectionRegions(500, 400, 416, true)).toHaveLength(1);
    const r = detectionRegions(2000, 1000, 416, true);
    expect(r[0]).toEqual({ x: 0, y: 0, w: 2000, h: 1000 });
    expect(r.length).toBeGreaterThan(3);
    for (const t of r.slice(1)) {
      expect(t.x + t.w).toBeLessThanOrEqual(2000);
      expect(t.y + t.h).toBeLessThanOrEqual(1000);
    }
  });
});

describe("detectObjects", () => {
  it("runs every region, reports progress and clips boxes to the image", async () => {
    const raw = rawOutput([
      {
        anchor: 0,
        dx: 0,
        dy: 0,
        logW: Math.log(8),
        logH: Math.log(8),
        obj: 1,
        probs: [1, 0, 0],
      },
    ]);
    const progress: number[] = [];
    const dets = await detectObjects({
      width: 64,
      height: 64,
      size: SIZE,
      numClasses: CLASSES,
      tiled: false,
      prepare: () => ({ input: new Float32Array(3 * SIZE * SIZE), ratio: 1 }),
      run: async () => raw,
      onRegion: (done) => progress.push(done),
    });
    expect(progress).toEqual([1]);
    expect(dets).toHaveLength(1);
    expect(dets[0].x1).toBe(0);
  });

  it("can be cancelled between regions", async () => {
    const ac = new AbortController();
    const run = detectObjects({
      width: 2000,
      height: 1000,
      size: SIZE,
      numClasses: CLASSES,
      tiled: true,
      signal: ac.signal,
      prepare: () => ({ input: new Float32Array(1), ratio: 1 }),
      run: async () => {
        ac.abort();
        return new Float32Array(ANCHORS * (5 + CLASSES));
      },
    });
    await expect(run).rejects.toMatchObject({ name: "CancelledError" });
  });
});

describe("summaries", () => {
  it("counts per class, most frequent first", () => {
    expect(
      countByClass([
        det(0, 0, 1, 1, 1, 2),
        det(0, 0, 1, 1, 1, 0),
        det(0, 0, 1, 1, 1, 2),
      ]),
    ).toEqual([
      [2, 2],
      [0, 1],
    ]);
  });

  it("writes CSV with escaping and manual rows", () => {
    const csv = toCsv([
      {
        label: "person",
        score: 0.9123,
        box: [1.4, 2.6, 10, 20],
        status: "counted",
      },
      {
        label: 'added, by "hand"',
        score: null,
        box: [5, 5, 5, 5],
        status: "manual",
      },
    ]);
    expect(csv).toBe(
      'id,label,score,x1,y1,x2,y2,status\n1,person,0.912,1,3,10,20,counted\n2,"added, by ""hand""",,5,5,5,5,manual\n',
    );
  });

  it("rejects huge images", () => {
    expect(() => checkCountLimits(10000, 10000)).toThrow(/maximum is 40 MP/);
  });
});
