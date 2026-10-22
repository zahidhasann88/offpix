import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { engine } from "../engine/client";
import type { BackendInfo } from "../engine/workerApi";
import { countByClass, toCsv, type Detection } from "../tools/object-count";
import { COCO_CLASSES } from "../tools/cocoClasses";
import { models } from "../models";
import { loadSetting, saveSetting } from "../lib/settings";
import {
  decodeImageFile,
  fileToImageInput,
  partitionFiles,
} from "../lib/image";
import { baseName, downloadBlob } from "../lib/download";
import {
  canvasToBlob,
  createCanvas,
  fitSize,
  type Ctx2D,
} from "../lib/composite";
import {
  Download,
  FileSpreadsheet,
  MousePointerClick,
  RotateCcw,
  ScanSearch,
  X,
} from "lucide-react";
import { formatBytes } from "./format";
import { ModelSelector } from "./ModelSelector";
import { describeError } from "./errors";
import { modelProgressText } from "./format";
import { usePasteFiles } from "./usePasteFiles";
import {
  Button,
  Checkbox,
  Disclosure,
  DropZone,
  ProcessingOverlay,
  Section,
  SegmentedControl,
  Slider,
  StageAnnouncer,
  StatusText,
  Workspace,
  useFitSize,
  type Activity,
} from "./kit";

const countModels = models.filter((m) => m.tool === "object-count");
const PREVIEW_MAX_SIDE = 1600;
const PALETTE = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#65a30d",
];
const MARKER_COLOR = "#f59e0b";

const colorFor = (classId: number) => PALETTE[classId % PALETTE.length];
const labelFor = (classId: number) =>
  COCO_CLASSES[classId] ?? `class ${classId}`;

interface Marker {
  x: number;
  y: number;
}
interface Result {
  width: number;
  height: number;
  detections: Detection[];
}
interface Shown {
  d: Detection;
  i: number;
  counted: boolean;
}

interface Props {
  cached: Record<string, boolean>;
  onModelsChanged: () => void;
  onBackend: (b: BackendInfo) => void;
}

function drawAnnotated(
  ctx: Ctx2D,
  bitmap: ImageBitmap,
  w: number,
  h: number,
  shown: Shown[],
  markers: Marker[],
) {
  const k = w / bitmap.width;
  const line = Math.max(2, Math.round(Math.max(w, h) / 500));
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  ctx.font = `600 ${Math.max(11, line * 5)}px system-ui, sans-serif`;
  ctx.textBaseline = "top";
  let n = 0;
  for (const { d, counted } of shown) {
    const x = d.x1 * k,
      y = d.y1 * k,
      bw = (d.x2 - d.x1) * k,
      bh = (d.y2 - d.y1) * k;
    ctx.lineWidth = line;
    ctx.setLineDash(counted ? [] : [line * 3, line * 2]);
    ctx.strokeStyle = counted ? colorFor(d.classId) : "rgba(140,140,140,0.9)";
    ctx.strokeRect(x, y, bw, bh);
    if (!counted) continue;
    const tag = String(++n);
    const tw = ctx.measureText(tag).width + line * 3;
    const th = Math.max(11, line * 5) + line * 2;
    ctx.fillStyle = colorFor(d.classId);
    ctx.fillRect(x, y - th > 0 ? y - th : y, tw, th);
    ctx.fillStyle = "#fff";
    ctx.fillText(tag, x + line * 1.5, (y - th > 0 ? y - th : y) + line);
  }
  ctx.setLineDash([]);
  const r = Math.max(7, line * 4);
  for (const m of markers) {
    ctx.beginPath();
    ctx.arc(m.x * k, m.y * k, r, 0, Math.PI * 2);
    ctx.fillStyle = MARKER_COLOR;
    ctx.fill();
    ctx.lineWidth = Math.max(2, line / 1.5);
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(m.x * k - r / 2, m.y * k);
    ctx.lineTo(m.x * k + r / 2, m.y * k);
    ctx.moveTo(m.x * k, m.y * k - r / 2);
    ctx.lineTo(m.x * k, m.y * k + r / 2);
    ctx.stroke();
  }
}

export function ObjectCounter({ cached, onModelsChanged, onBackend }: Props) {
  const [modelId, setModelId] = useState(() => {
    const saved = loadSetting("countModel", countModels[0]?.id ?? "");
    return countModels.some((m) => m.id === saved)
      ? saved
      : (countModels[0]?.id ?? "");
  });
  const [tiled, setTiled] = useState(() => loadSetting("countTiled", true));
  const [threshold, setThreshold] = useState(() =>
    loadSetting("countThreshold", 0.3),
  );
  const [file, setFile] = useState<File | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [classFilter, setClassFilter] = useState<number | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set());
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [addMode, setAddMode] = useState(false);
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    saveSetting("countModel", modelId);
  }, [modelId]);
  useEffect(() => {
    saveSetting("countTiled", tiled);
  }, [tiled]);
  useEffect(() => {
    saveSetting("countThreshold", threshold);
  }, [threshold]);

  const resetCorrections = () => {
    setExcluded(new Set());
    setMarkers([]);
  };

  const handleFiles = useCallback(async (files: File[]) => {
    const { accepted, rejectedMessage } = partitionFiles(files);
    setStatus(rejectedMessage ?? "");
    const f = accepted[0];
    if (!f) return;
    try {
      const bm = await decodeImageFile(f);
      setFile(f);
      setBitmap((prev) => {
        prev?.close();
        return bm;
      });
      setResult(null);
      setClassFilter(null);
      setExcluded(new Set());
      setMarkers([]);
      setAddMode(false);
    } catch (e) {
      setStatus(describeError(e));
    }
  }, []);
  usePasteFiles(handleFiles);

  const run = async () => {
    if (!file) return;
    setRunning(true);
    setStatus("Loading model…");
    setError(null);
    const startedAt = performance.now();
    setActivity({ stage: "prepare", startedAt });
    // Progress arrives over separate message ports and can trail the result; drop late ones.
    let settled = false;
    try {
      const res = await engine.countObjects(
        await fileToImageInput(file),
        { modelId, tiled },
        (p) => {
          if (settled) return;
          setStatus(modelProgressText(p, "Looking for objects…"));
          setActivity(
            p.percent < 100
              ? {
                  stage: "download",
                  percent: p.percent,
                  detail: `${formatBytes(p.loaded)} of ${formatBytes(p.total)}`,
                  startedAt,
                }
              : { stage: "run", startedAt },
          );
        },
        (done, total) => {
          if (settled || total <= 1) return;
          setStatus(`Scanning tiles… ${done}/${total}`);
          setActivity({
            stage: "tiles",
            percent: (done / total) * 100,
            detail: `Tiles ${done}/${total}`,
            startedAt,
          });
        },
      );
      settled = true;
      onBackend(res);
      setResult({
        width: res.width,
        height: res.height,
        detections: res.detections,
      });
      setExcluded(new Set());
      setMarkers([]);
      setClassFilter((c) =>
        c != null && res.detections.some((d) => d.classId === c) ? c : null,
      );
      setStatus("Done");
    } catch (e) {
      settled = true;
      const msg = describeError(e);
      if (msg.startsWith("Error")) {
        setError(msg);
        setStatus("");
      } else setStatus(msg);
    } finally {
      setRunning(false);
      setActivity(null);
    }
    onModelsChanged();
  };

  const shown: Shown[] = useMemo(() => {
    if (!result) return [];
    return result.detections
      .map((d, i) => ({ d, i, counted: !excluded.has(i) }))
      .filter(
        ({ d }) =>
          d.score >= threshold &&
          (classFilter == null || d.classId === classFilter),
      );
  }, [result, threshold, classFilter, excluded]);

  const classCounts = useMemo(
    () =>
      result
        ? countByClass(
            result.detections.filter(
              (d, i) => d.score >= threshold && !excluded.has(i),
            ),
          )
        : [],
    [result, threshold, excluded],
  );
  const countedCount = shown.filter((s) => s.counted).length;
  const total = countedCount + markers.length;
  const excludedCount = shown.length - countedCount;

  const previewRef = useRef<HTMLCanvasElement>(null);
  const fit = useFitSize(bitmap ? bitmap.width / bitmap.height : null);
  const previewSize = useMemo(
    () =>
      bitmap ? fitSize(bitmap.width, bitmap.height, PREVIEW_MAX_SIDE) : null,
    [bitmap],
  );
  useEffect(() => {
    const c = previewRef.current;
    if (!c || !bitmap || !previewSize) return;
    c.width = previewSize.w;
    c.height = previewSize.h;
    drawAnnotated(
      c.getContext("2d")!,
      bitmap,
      previewSize.w,
      previewSize.h,
      shown,
      markers,
    );
  }, [bitmap, previewSize, shown, markers]);

  const toggle = (i: number) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!bitmap || !result) return;
    const r = e.currentTarget.getBoundingClientRect();
    const scale = bitmap.width / r.width;
    const x = (e.clientX - r.left) * scale;
    const y = (e.clientY - r.top) * scale;
    if (addMode) {
      const hit = markers.findIndex(
        (m) => Math.hypot(m.x - x, m.y - y) < 14 * scale,
      );
      setMarkers(
        hit >= 0 ? markers.filter((_, j) => j !== hit) : [...markers, { x, y }],
      );
      return;
    }
    const hits = shown.filter(
      ({ d }) => x >= d.x1 && x <= d.x2 && y >= d.y1 && y <= d.y2,
    );
    if (!hits.length) return;
    const smallest = hits.reduce((a, b) =>
      (a.d.x2 - a.d.x1) * (a.d.y2 - a.d.y1) <=
      (b.d.x2 - b.d.x1) * (b.d.y2 - b.d.y1)
        ? a
        : b,
    );
    toggle(smallest.i);
  };

  const exportName = (ext: string) =>
    `${baseName(file?.name || "image")}-count.${ext}`;

  const downloadImage = async () => {
    if (!bitmap) return;
    const { canvas, ctx } = createCanvas(bitmap.width, bitmap.height);
    drawAnnotated(ctx, bitmap, bitmap.width, bitmap.height, shown, markers);
    downloadBlob(await canvasToBlob(canvas, "image/png"), exportName("png"));
  };

  const downloadCsv = () => {
    const rows = [
      ...shown.map(({ d, counted }) => ({
        label: labelFor(d.classId),
        score: d.score,
        box: [d.x1, d.y1, d.x2, d.y2] as [number, number, number, number],
        status: counted ? "counted" : "excluded",
      })),
      ...markers.map((m) => ({
        label: "added",
        score: null,
        box: [m.x, m.y, m.x, m.y] as [number, number, number, number],
        status: "manual",
      })),
    ];
    downloadBlob(
      new Blob([toCsv(rows)], { type: "text/csv" }),
      exportName("csv"),
    );
  };

  const what =
    classFilter == null
      ? total === 1
        ? "object"
        : "objects"
      : labelFor(classFilter);

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      <StageAnnouncer activity={activity} />
      <div
        className={
          bitmap ? "shrink-0" : "flex flex-1 flex-col justify-center gap-3"
        }
      >
        <DropZone
          onFiles={handleFiles}
          multiple={false}
          compact={!!bitmap}
          label={
            bitmap
              ? "Replace image: drop, paste or choose a file"
              : "Drop a photo to count the objects in it"
          }
          hint="People, cars, animals and 77 other everyday object types. PNG, JPEG or WebP."
        />
        {!bitmap && <StatusText text={status} />}
      </div>
      {bitmap && (
        <Workspace
          preview={
            <div
              ref={fit.ref}
              className="absolute inset-0 flex items-center justify-center"
            >
              <canvas
                ref={previewRef}
                onClick={onCanvasClick}
                style={{ width: fit.size?.w ?? 0, height: fit.size?.h ?? 0 }}
                className={`block rounded-lg border border-border transition-opacity duration-200 ${running ? "opacity-60" : ""} ${result ? (addMode ? "cursor-crosshair" : "cursor-pointer") : ""}`}
                aria-label={
                  result
                    ? `Photo with ${total} counted ${what}. Click boxes to exclude them; use the detection list for keyboard access.`
                    : "Photo to count"
                }
              />
              <ProcessingOverlay
                activity={activity}
                onCancel={running ? () => engine.cancel() : undefined}
                error={running ? null : error}
                onDismiss={() => setError(null)}
                box={fit.size}
              />
            </div>
          }
          caption={`${bitmap.width}×${bitmap.height}`}
          actions={
            <>
              <Button
                variant={result ? "secondary" : "primary"}
                icon={ScanSearch}
                onClick={run}
                disabled={running}
                loading={running}
                block
              >
                Count objects
              </Button>
              {result && (
                <Button
                  variant="primary"
                  icon={Download}
                  onClick={downloadImage}
                  disabled={running}
                  block
                >
                  Download image
                </Button>
              )}
            </>
          }
        >
          <Section id="count-model-h" title="Model">
            <ModelSelector
              models={countModels}
              value={modelId}
              onChange={setModelId}
              cached={cached}
            />
            <Checkbox
              checked={tiled}
              onChange={setTiled}
              label="Find small objects"
              hint="Scans the photo in tiles. Slower; best for large photos and crowds."
            />
            {!running && <StatusText text={status} />}
          </Section>

          {result && (
            <>
              <Section id="count-h" title="Count">
                <p
                  aria-live="polite"
                  aria-atomic="true"
                  className="flex items-baseline gap-2"
                >
                  <span
                    className="text-4xl font-semibold tracking-tight tabular-nums"
                    data-testid="count-total"
                  >
                    {total}
                  </span>
                  <span className="text-lg text-muted">{what}</span>
                </p>
                <SegmentedControl
                  label="What to count"
                  size="sm"
                  value={classFilter ?? -1}
                  onChange={(v) => setClassFilter(v === -1 ? null : v)}
                  options={[
                    {
                      value: -1,
                      label: `All ${classCounts.reduce((a, [, n]) => a + n, 0)}`,
                    },
                    ...classCounts.map(([id, n]) => ({
                      value: id,
                      label: `${labelFor(id)} ${n}`,
                    })),
                  ]}
                />
                <Slider
                  id="count-threshold"
                  label="Confidence"
                  value={threshold}
                  min={0.1}
                  max={0.9}
                  step={0.05}
                  onChange={setThreshold}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
                {result.detections.length === 0 && (
                  <p className="text-sm text-muted">
                    Nothing recognised. Try “Find small objects”, the quality
                    model, or a lower confidence.
                  </p>
                )}
              </Section>

              <Section id="fix-h" title="Correct the count">
                <p className="text-xs text-muted">
                  Click a box to exclude or include it. Use “Add missed” to mark
                  objects the model missed.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    icon={MousePointerClick}
                    onClick={() => setAddMode((m) => !m)}
                    aria-pressed={addMode}
                    className={addMode ? "border-accent text-accent-text" : ""}
                  >
                    {addMode ? "Adding: click the image" : "Add missed"}
                  </Button>
                  <Button
                    size="sm"
                    icon={RotateCcw}
                    onClick={resetCorrections}
                    disabled={!excluded.size && !markers.length}
                  >
                    Reset
                  </Button>
                </div>
                {(excludedCount > 0 || markers.length > 0) && (
                  <p className="text-xs text-muted">
                    {excludedCount} excluded, {markers.length} added by hand.
                  </p>
                )}
                <Disclosure
                  id="count-detections"
                  summary={`Detections (${shown.length})`}
                >
                  <ul className="space-y-1 overflow-auto text-sm max-h-56">
                    {shown.map(({ d, i, counted }) => (
                      <li key={i}>
                        <label className="flex items-center gap-2 min-h-8">
                          <input
                            type="checkbox"
                            checked={counted}
                            onChange={() => toggle(i)}
                            className="w-4 h-4"
                          />
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-sm"
                            style={{ background: colorFor(d.classId) }}
                            aria-hidden
                          />
                          {labelFor(d.classId)}{" "}
                          <span className="tabular-nums text-muted">
                            {Math.round(d.score * 100)}%
                          </span>
                        </label>
                      </li>
                    ))}
                    {markers.map((_, j) => (
                      <li
                        key={`m${j}`}
                        className="flex items-center gap-2 min-h-8"
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ background: MARKER_COLOR }}
                          aria-hidden
                        />
                        Added by hand
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          icon={X}
                          label={`Remove added object ${j + 1}`}
                          onClick={() =>
                            setMarkers(markers.filter((_, k) => k !== j))
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              </Section>

              <Section id="count-export-h" title="Export">
                <Button icon={FileSpreadsheet} onClick={downloadCsv}>
                  Download CSV
                </Button>
              </Section>
            </>
          )}
        </Workspace>
      )}
    </div>
  );
}
