import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { engine } from "../engine/client";
import type { BackendInfo } from "../engine/workerApi";
import { isCancelled, isGpuOnlyFailure, isOutOfMemory } from "../engine/errors";
import {
  availableModels,
  bestModel,
  rememberFailure,
  type DeviceCaps,
} from "../engine/tiers";
import { maxProcessingPixels } from "../engine/limits";
import { buildMask, refineMask, forgetImage } from "../engine/maskClient";
import type { InputMap } from "../engine/preprocess";
import type { RefineOptions } from "../tools/bg-pipeline";
import {
  SUBJECTS,
  FILL_AREAS,
  subjectPreset,
  sameRefine,
  type Subject,
} from "../tools/presets";
import { DEFAULT_FILL_MIN_AREA } from "../tools/bg-pipeline";
import type { FillStats } from "../tools/holes";
import { shiftUnit } from "../tools/edges";
import { models } from "../models";
import { loadSetting, saveSetting } from "../lib/settings";
import {
  decodeImageFile,
  fileToImageInput,
  partitionFiles,
} from "../lib/image";
import {
  StrokePainter,
  pushStroke,
  undo,
  redo,
  emptyHistory,
  unionRect,
  type BrushMode,
  type History,
  type Rect,
} from "../lib/maskEdit";
import {
  createCanvas,
  updateMaskCanvas,
  renderComposite,
  exportCutout,
  fitSize,
  defaultBgSettings,
  type BgSettings,
  type BgMode,
  type Ctx2D,
  type ExportFormat,
} from "../lib/composite";
import { baseName, downloadBlob, zipFiles } from "../lib/download";
import {
  Brush,
  Columns2,
  Download,
  Eraser,
  FolderArchive,
  PenLine,
  Redo2,
  Scissors,
  Undo2,
} from "lucide-react";
import { ModelSelector } from "./ModelSelector";
import { CompareSlider } from "./CompareSlider";
import { describeError } from "./errors";
import { usePasteFiles } from "./usePasteFiles";
import {
  Button,
  Checkbox,
  Disclosure,
  DropZone,
  Notice,
  ProcessingOverlay,
  Section,
  SegmentedControl,
  Select,
  Slider,
  StageAnnouncer,
  StatusText,
  Workspace,
  useFitSize,
  type Activity,
} from "./kit";
import { PreviewBgPicker, previewBgProps, type PreviewBg } from "./PreviewBg";
import { ImageStrip, type ItemStatus } from "./ImageStrip";
import { formatBytes, modelProgressText } from "./format";

const allBgModels = models.filter((m) => m.tool === "background-remove");
const BRUSH_COLOR: Record<BrushMode, string> = {
  erase: "#ef4444",
  restore: "#22c55e",
};
const BRUSH_ACTION: Record<BrushMode, string> = {
  erase: "erase (remove)",
  restore: "restore (bring back)",
};
const PREVIEW_MAX_SIDE = 1600;
const BG_MODES: { mode: BgMode; label: string }[] = [
  { mode: "transparent", label: "Transparent" },
  { mode: "color", label: "Colour" },
  { mode: "gradient", label: "Gradient" },
  { mode: "blur", label: "Blur" },
  { mode: "image", label: "Image" },
];

interface Item {
  id: string;
  file: File;
  thumb: string;
  status: ItemStatus;
  error?: string;
  width?: number;
  height?: number;
  model?: {
    lowMask: Float32Array;
    outSize: number;
    map: InputMap;
    logits?: boolean;
  };
  refined?: RefineOptions;
  mask?: Uint8ClampedArray;
  fg?: Uint8ClampedArray;
  filled?: FillStats | null;
  foreground?: ImageBitmap;
  rev: number;
  history: History;
}

interface WorkMask {
  itemId: string;
  rev: number;
  feather: number;
  shift: number;
  done: History["done"];
  w: number;
  h: number;
  mask: Float32Array;
  coverage: Uint8Array;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: Ctx2D;
}

interface Props {
  caps: DeviceCaps;
  cached: Record<string, boolean>;
  onModelsChanged: () => void;
  onBackend: (b: BackendInfo) => void;
}

let nextId = 0;
const newId = () => `img-${++nextId}`;

async function refineItem(
  item: Item,
  opts: RefineOptions,
): Promise<{
  refined: RefineOptions;
  mask: Uint8ClampedArray;
  fg: Uint8ClampedArray;
  filled: FillStats | null;
  foreground: ImageBitmap;
}> {
  const m = item.model!;
  const r = await refineMask(
    item.id,
    item.file,
    m.lowMask,
    m.outSize,
    m.map,
    opts,
    false,
    m.logits,
  );
  const foreground = await createImageBitmap(
    new ImageData(new Uint8ClampedArray(r.fg), m.map.w, m.map.h),
  );
  return {
    refined: opts,
    mask: r.mask,
    fg: r.fg,
    filled: r.filled,
    foreground,
  };
}

function buildMaskFor(
  item: Item,
  feather: number,
  shift: number,
): Promise<Float32Array> {
  return buildMask(
    item.mask!,
    item.width!,
    item.height!,
    feather,
    shift,
    item.history.done,
  );
}

export function BackgroundRemover({
  caps,
  cached,
  onModelsChanged,
  onBackend,
}: Props) {
  const [failVersion, setFailVersion] = useState(0);
  const { webgpu, gpuEnabled, ready, deviceMemory, adapter } = caps;
  const avail = useMemo(
    () => (
      void failVersion,
      availableModels(allBgModels, {
        webgpu,
        gpuEnabled,
        ready,
        deviceMemory,
        adapter,
      })
    ),
    [webgpu, gpuEnabled, ready, deviceMemory, adapter, failVersion],
  );
  const bgModels = avail.usable;
  const qualityModel = bgModels.find((m) => m.variant === "quality");
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const [modelId, setModelId] = useState(() =>
    loadSetting("bgModelChoice", ""),
  );
  const bestUsable = bestModel(bgModels)?.id ?? "";
  useEffect(() => {
    // Wait for the engine to report its capabilities, or a saved GPU model is dropped too early.
    if (ready && !bgModels.some((m) => m.id === modelId))
      setModelId(bestUsable);
    else if (!ready && !modelId)
      setModelId(
        bestModel(allBgModels.filter((m) => m.wasm !== false))?.id ?? "",
      );
  }, [ready, bgModels, modelId, bestUsable]);
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const cancelRequested = useRef(false);

  const [bgSettings, setBgSettings] = useState<BgSettings>(() => ({
    ...defaultBgSettings,
    ...loadSetting<Partial<BgSettings>>("bgSettings", {}),
  }));
  const [bgImage, setBgImage] = useState<ImageBitmap | null>(null);
  // New keys: Feather and Shift changed meaning (boundary-only), so old saved values do not carry over.
  const [feather, setFeather] = useState(() => loadSetting("featherPx", 0));
  const [shift, setShift] = useState(() => loadSetting("shiftSteps", 0));
  const [brushMode, setBrushMode] = useState<BrushMode>("erase");
  const [brushSize, setBrushSize] = useState(() =>
    loadSetting("brushSize", 40),
  );
  const [brushSoftness, setBrushSoftness] = useState(() =>
    loadSetting("brushSoftness", 0.5),
  );
  const [format, setFormat] = useState<ExportFormat>(() =>
    loadSetting<ExportFormat>("bgFormat", "png"),
  );
  const [quality, setQuality] = useState(() => loadSetting("bgQuality", 0.9));
  const [view, setView] = useState<"edit" | "compare">("edit");
  const [subject, setSubject] = useState<Subject>(() =>
    loadSetting<Subject>("bgSubject", "general"),
  );
  const [fillHoles, setFillHoles] = useState(
    () => subjectPreset(loadSetting<Subject>("bgSubject", "general")).fillHoles,
  );
  const [fillArea, setFillArea] = useState(() => {
    const i = FILL_AREAS.indexOf(
      loadSetting("fillMinArea", DEFAULT_FILL_MIN_AREA),
    );
    return i >= 0 ? i : FILL_AREAS.indexOf(DEFAULT_FILL_MIN_AREA);
  });
  const [fringe, setFringe] = useState(() =>
    Math.round(
      (subjectPreset(loadSetting<Subject>("bgSubject", "general")).fringe ??
        0) * 10,
    ),
  );
  const refineOpts = useMemo<RefineOptions>(
    () => ({
      ...subjectPreset(subject),
      fillHoles,
      fillMinArea: FILL_AREAS[fillArea],
      fringe: fringe / 10,
    }),
    [subject, fillHoles, fillArea, fringe],
  );
  const [refining, setRefining] = useState(false);
  const chooseSubject = (s: Subject) => {
    setSubject(s);
    setFillHoles(subjectPreset(s).fillHoles);
    setFringe(Math.round((subjectPreset(s).fringe ?? 0) * 10));
  };
  const [previewBg, setPreviewBg] = useState<PreviewBg>(() =>
    loadSetting<PreviewBg>("previewBg", "checker"),
  );
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    saveSetting("bgSettings", bgSettings);
  }, [bgSettings]);
  useEffect(() => {
    saveSetting("featherPx", feather);
  }, [feather]);
  useEffect(() => {
    saveSetting("shiftSteps", shift);
  }, [shift]);
  useEffect(() => {
    saveSetting("brushSize", brushSize);
  }, [brushSize]);
  useEffect(() => {
    saveSetting("brushSoftness", brushSoftness);
  }, [brushSoftness]);
  useEffect(() => {
    saveSetting("bgFormat", format);
  }, [format]);
  useEffect(() => {
    saveSetting("bgQuality", quality);
  }, [quality]);
  useEffect(() => {
    saveSetting("previewBg", previewBg);
  }, [previewBg]);
  useEffect(() => {
    saveSetting("bgSubject", subject);
  }, [subject]);
  useEffect(() => {
    saveSetting("fillMinArea", FILL_AREAS[fillArea]);
  }, [fillArea]);

  const updateItem = useCallback(
    (id: string, patch: Partial<Item> | ((i: Item) => Partial<Item>)) => {
      setItems((prev) =>
        prev.map((i) =>
          i.id === id
            ? { ...i, ...(typeof patch === "function" ? patch(i) : patch) }
            : i,
        ),
      );
    },
    [],
  );

  const addFiles = useCallback((files: File[]) => {
    const { accepted, rejectedMessage } = partitionFiles(files);
    setNotice(rejectedMessage);
    if (!accepted.length) return;
    const added: Item[] = accepted.map((file) => ({
      id: newId(),
      file,
      thumb: URL.createObjectURL(file),
      status: "pending",
      rev: 0,
      history: emptyHistory,
    }));
    setItems((prev) => [...prev, ...added]);
    setSelectedId((cur) => cur ?? added[0].id);
    setStatus("");
  }, []);
  usePasteFiles(addFiles);

  const removeItem = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item || item.status === "processing") return;
    URL.revokeObjectURL(item.thumb);
    item.foreground?.close();
    forgetImage(item.id);
    const rest = items.filter((i) => i.id !== id);
    setItems(rest);
    if (selectedId === id) setSelectedId(rest[0]?.id ?? null);
  };

  const clearAll = () => {
    if (running) return;
    items.forEach((i) => {
      URL.revokeObjectURL(i.thumb);
      i.foreground?.close();
      forgetImage(i.id);
    });
    setItems([]);
    setSelectedId(null);
    setStatus("");
  };

  const process = async () => {
    let targets = itemsRef.current.filter(
      (i) => i.status === "pending" || i.status === "error",
    );
    if (!targets.length && selected) targets = [selected];
    if (!targets.length) return;
    setRunning(true);
    cancelRequested.current = false;
    const startedAt = performance.now();
    let ok = 0;
    let failed = 0;
    let lastError = "";
    for (const [n, t] of targets.entries()) {
      if (cancelRequested.current) break;
      const prefix =
        targets.length > 1 ? `Image ${n + 1} of ${targets.length}: ` : "";
      updateItem(t.id, { status: "processing", error: undefined });
      setStatus(`${prefix}Loading model…`);
      const detail =
        targets.length > 1 ? `Image ${n + 1} of ${targets.length}` : undefined;
      setActivity({ stage: "prepare", startedAt, detail });
      // Progress arrives over a separate message port and can trail the result; drop late ones.
      let settled = false;
      try {
        const input = await fileToImageInput(t.file);
        if (cancelRequested.current) {
          updateItem(t.id, (i) => ({ status: i.mask ? "done" : "pending" }));
          break;
        }
        const res = await engine.removeBackground(
          input,
          modelId,
          (p) => {
            if (settled) return;
            setStatus(prefix + modelProgressText(p, "Removing background…"));
            setActivity(
              p.percent < 100
                ? {
                    stage: "download",
                    percent: p.percent,
                    detail: `${formatBytes(p.loaded)} of ${formatBytes(p.total)}${detail ? ` · ${detail}` : ""}`,
                    startedAt,
                  }
                : { stage: "run", detail, startedAt },
            );
          },
          maxProcessingPixels(caps.deviceMemory),
        );
        settled = true;
        onBackend(res);
        setStatus(`${prefix}Refining edges…`);
        setActivity({ stage: "refine", detail, startedAt });
        const model = {
          lowMask: res.lowMask,
          outSize: res.outSize,
          map: res.map,
          logits: res.logits,
        };
        const refined = await refineItem({ ...t, model }, refineOpts);
        if (cancelRequested.current) {
          refined.foreground.close();
          updateItem(t.id, (i) => ({ status: i.mask ? "done" : "pending" }));
          break;
        }
        updateItem(t.id, (i) => {
          i.foreground?.close();
          return {
            status: "done",
            model,
            ...refined,
            width: res.width,
            height: res.height,
            rev: i.rev + 1,
            history: emptyHistory,
          };
        });
        ok++;
      } catch (e) {
        settled = true;
        if (isCancelled(e)) {
          updateItem(t.id, (i) => ({ status: i.mask ? "done" : "pending" }));
          break;
        }
        const entry = allBgModels.find((m) => m.id === modelId);
        if (
          isGpuOnlyFailure(e) ||
          (isOutOfMemory(e) && (entry?.heavy || entry?.wasm === false))
        ) {
          const reason =
            (isOutOfMemory(e) ? "out of memory: " : "") +
            (e as Error).message.slice(0, 160);
          rememberFailure(modelId, reason);
          setFailVersion((v) => v + 1);
          setNotice(
            `${entry?.name} could not run on this device, so it is no longer offered here. Switched to the next best model; run again. (${reason})`,
          );
          updateItem(t.id, { status: "pending" });
          break;
        }
        failed++;
        lastError = describeError(e);
        updateItem(t.id, { status: "error", error: lastError });
      }
    }
    setRunning(false);
    setActivity(null);
    setDismissedError(null);
    onModelsChanged();
    if (cancelRequested.current) setStatus("Cancelled.");
    else if (targets.length === 1) setStatus(failed ? lastError : "Done");
    else
      setStatus(
        failed
          ? `Done: ${ok} processed, ${failed} failed. ${lastError}`
          : `Done: ${ok} images processed`,
      );
  };

  const cancel = () => {
    cancelRequested.current = true;
    engine.cancel();
  };

  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const selectedFile = selected?.file ?? null;
  useEffect(() => {
    if (!selectedFile) {
      setBitmap(null);
      return;
    }
    let alive = true;
    decodeImageFile(selectedFile).then(
      (bm) => {
        if (alive) setBitmap(bm);
        else bm.close();
      },
      (e) => {
        if (alive) setNotice(describeError(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [selectedFile]);

  useEffect(() => {
    if (
      !selected?.model ||
      selected.status !== "done" ||
      sameRefine(selected.refined, refineOpts)
    )
      return;
    const item = selected;
    let stale = false;
    const t = setTimeout(async () => {
      setRefining(true);
      try {
        const r = await refineItem(item, refineOpts);
        if (stale) {
          r.foreground.close();
          return;
        }
        updateItem(item.id, (i) => {
          i.foreground?.close();
          return { ...r, rev: i.rev + 1 };
        });
      } catch (e) {
        if (!stale) setNotice(describeError(e));
      } finally {
        if (!stale) setRefining(false);
      }
    }, 100);
    return () => {
      stale = true;
      clearTimeout(t);
      setRefining(false);
    };
  }, [selected, refineOpts, updateItem]);

  const work = useRef<WorkMask | null>(null);
  const rebuilding = useRef(false);
  const [maskVersion, setMaskVersion] = useState(0);

  useEffect(() => {
    // The mask is at the processed size, which is smaller than the bitmap above the processing
    // cap (engine/limits.ts); the preview scales it. Only require the same aspect ratio, so a
    // mask from another image never pairs with this bitmap.
    const sameShape =
      !!selected?.width &&
      !!bitmap &&
      Math.abs(
        selected.width / selected.height! - bitmap.width / bitmap.height,
      ) < 0.01;
    if (!bitmap || !selected?.mask || !sameShape) {
      if (work.current && work.current.itemId !== selected?.id) {
        work.current = null;
        setMaskVersion((v) => v + 1);
      }
      return;
    }
    const cur = work.current;
    if (
      cur &&
      cur.itemId === selected.id &&
      cur.rev === selected.rev &&
      cur.feather === feather &&
      cur.shift === shift &&
      cur.done === selected.history.done
    )
      return;
    const item = selected;
    const delay =
      cur && cur.itemId === item.id && cur.rev === item.rev ? 150 : 0;
    let stale = false;
    const t = setTimeout(async () => {
      const w = item.width!,
        h = item.height!;
      // Painting is paused while the worker rebuilds, so no stroke is lost when the new mask lands.
      rebuilding.current = true;
      try {
        const mask = await buildMaskFor(item, feather, shift);
        if (stale) return;
        const prev = work.current;
        const reuse = prev && prev.w === w && prev.h === h;
        const { canvas, ctx } = reuse ? prev : createCanvas(w, h);
        updateMaskCanvas(ctx, mask, w, h);
        work.current = {
          itemId: item.id,
          rev: item.rev,
          feather,
          shift,
          done: item.history.done,
          w,
          h,
          mask,
          coverage: reuse ? prev.coverage : new Uint8Array(w * h),
          canvas,
          ctx,
        };
        setMaskVersion((v) => v + 1);
      } catch (e) {
        if (!stale) setNotice(describeError(e));
      } finally {
        if (!stale) rebuilding.current = false;
      }
    }, delay);
    return () => {
      stale = true;
      rebuilding.current = false;
      clearTimeout(t);
    };
  }, [bitmap, selected, feather, shift]);

  const previewRef = useRef<HTMLCanvasElement>(null);
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const previewSize = useMemo(
    () =>
      bitmap ? fitSize(bitmap.width, bitmap.height, PREVIEW_MAX_SIDE) : null,
    [bitmap],
  );
  const hasResult = !!work.current && work.current.itemId === selected?.id;

  const renderPreview = useCallback(() => {
    const canvas = previewRef.current;
    if (!canvas || !bitmap || !previewSize) return;
    const { w, h } = previewSize;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d")!;
    const wm = work.current;
    if (!wm || wm.itemId !== selected?.id) {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      return;
    }
    renderComposite(
      ctx,
      w,
      h,
      bitmap,
      wm.canvas,
      bgSettings,
      bgImage,
      selected.foreground,
    );
  }, [
    bitmap,
    previewSize,
    bgSettings,
    bgImage,
    selected?.id,
    selected?.foreground,
  ]);

  useEffect(() => {
    renderPreview();
  }, [renderPreview, maskVersion, view]);

  useEffect(() => {
    const c = beforeRef.current;
    if (view !== "compare" || !c || !bitmap || !previewSize) return;
    c.width = previewSize.w;
    c.height = previewSize.h;
    c.getContext("2d")!.drawImage(bitmap, 0, 0, previewSize.w, previewSize.h);
  }, [view, bitmap, previewSize, maskVersion]);

  const painter = useRef<StrokePainter | null>(null);
  const dirty = useRef<Rect | null>(null);
  const raf = useRef(0);
  const cursorRef = useRef<HTMLDivElement>(null);
  const canEdit = hasResult && view === "edit" && !running;

  const flush = useCallback(() => {
    raf.current = 0;
    const wm = work.current;
    if (!wm || !dirty.current) return;
    updateMaskCanvas(wm.ctx, wm.mask, wm.w, wm.h, dirty.current);
    dirty.current = null;
    renderPreview();
  }, [renderPreview]);

  const toImage = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const wm = work.current!;
    return {
      x: ((e.clientX - r.left) * wm.w) / r.width,
      y: ((e.clientY - r.top) * wm.h) / r.height,
      scale: wm.w / r.width,
    };
  };

  const paintAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toImage(e);
    dirty.current = unionRect(dirty.current, painter.current!.lineTo(x, y));
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  };

  const moveCursor = (
    e: React.PointerEvent<HTMLCanvasElement>,
    visible: boolean,
  ) => {
    const el = cursorRef.current;
    if (!el) return;
    const r = (el.offsetParent ?? e.currentTarget).getBoundingClientRect();
    el.style.display =
      visible && canEdit && e.pointerType !== "touch" ? "block" : "none";
    el.style.transform = `translate(${e.clientX - r.left - brushSize / 2}px, ${e.clientY - r.top - brushSize / 2}px)`;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canEdit || rebuilding.current || e.button !== 0) return;
    const wm = work.current!;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { scale } = toImage(e);
    painter.current = new StrokePainter(
      wm.mask,
      wm.w,
      wm.h,
      {
        mode: brushMode,
        radius: (brushSize / 2) * scale,
        softness: brushSoftness,
      },
      wm.coverage,
    );
    paintAt(e);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    moveCursor(e, true);
    if (painter.current) paintAt(e);
  };

  const endStroke = () => {
    const p = painter.current;
    const wm = work.current;
    painter.current = null;
    if (!p || !wm || !selected) return;
    p.finish();
    if (raf.current) cancelAnimationFrame(raf.current);
    flush();
    const history = pushStroke(selected.history, {
      ...p.brush,
      points: p.points,
    });
    wm.done = history.done;
    updateItem(selected.id, { history });
  };

  const doUndo = useCallback(() => {
    if (selectedId && !painter.current)
      updateItem(selectedId, (i) => ({ history: undo(i.history) }));
  }, [selectedId, updateItem]);
  const doRedo = useCallback(() => {
    if (selectedId && !painter.current)
      updateItem(selectedId, (i) => ({ history: redo(i.history) }));
  }, [selectedId, updateItem]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (
        tag === "TEXTAREA" ||
        (tag === "INPUT" && (e.target as HTMLInputElement).type === "text")
      )
        return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doRedo();
      } else if (!mod && e.key.toLowerCase() === "x")
        setBrushMode((m) => (m === "erase" ? "restore" : "erase"));
      else if (!mod && e.key === "[") setBrushSize((s) => Math.max(4, s - 4));
      else if (!mod && e.key === "]") setBrushSize((s) => Math.min(200, s + 4));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  const exportItem = async (item: Item): Promise<Blob> => {
    if (!sameRefine(item.refined, refineOpts)) {
      const r = await refineItem(item, refineOpts);
      r.foreground.close();
      item = { ...item, ...r };
    }
    const wm = work.current;
    const live =
      wm &&
      bitmap &&
      wm.itemId === item.id &&
      wm.rev === item.rev &&
      wm.feather === feather &&
      wm.shift === shift &&
      wm.done === item.history.done;
    if (live)
      return exportCutout(
        bitmap,
        item.fg!,
        wm.mask,
        item.width!,
        item.height!,
        bgSettings,
        bgImage,
        format,
        quality,
      );
    const bm = await decodeImageFile(item.file);
    try {
      return await exportCutout(
        bm,
        item.fg!,
        await buildMaskFor(item, feather, shift),
        item.width!,
        item.height!,
        bgSettings,
        bgImage,
        format,
        quality,
      );
    } finally {
      bm.close();
    }
  };

  const outName = (item: Item) =>
    `${baseName(item.file.name || "image")}-nobg.${format}`;

  const exportCancelled = useRef(false);
  const downloadSelected = async () => {
    if (!selected?.mask) return;
    setExporting(true);
    exportCancelled.current = false;
    setActivity({
      stage: "encode",
      detail: format.toUpperCase(),
      startedAt: performance.now(),
    });
    try {
      const blob = await exportItem(selected);
      if (!exportCancelled.current) downloadBlob(blob, outName(selected));
    } catch (e) {
      setNotice(describeError(e));
    } finally {
      setExporting(false);
      setActivity(null);
    }
  };

  const doneItems = items.filter((i) => i.status === "done" && i.mask);

  const downloadZip = async () => {
    setExporting(true);
    exportCancelled.current = false;
    const startedAt = performance.now();
    try {
      const files: { name: string; data: Uint8Array }[] = [];
      for (const [n, item] of doneItems.entries()) {
        if (exportCancelled.current) {
          setStatus("Cancelled.");
          return;
        }
        setActivity({
          stage: "encode",
          percent: (n / doneItems.length) * 100,
          detail: `ZIP: image ${n + 1} of ${doneItems.length}`,
          startedAt,
        });
        setStatus(`Preparing ZIP… ${n + 1} / ${doneItems.length}`);
        files.push({
          name: outName(item),
          data: new Uint8Array(await (await exportItem(item)).arrayBuffer()),
        });
      }
      if (exportCancelled.current) {
        setStatus("Cancelled.");
        return;
      }
      downloadBlob(await zipFiles(files), "offpix-nobg.zip");
      setStatus(`Saved ${files.length} images as ZIP`);
    } catch (e) {
      setNotice(describeError(e));
    } finally {
      setExporting(false);
      setActivity(null);
    }
  };

  const setBackgroundImage = async (files: File[]) => {
    const { accepted, rejectedMessage } = partitionFiles(files);
    setNotice(rejectedMessage);
    if (!accepted[0]) return;
    try {
      const bm = await decodeImageFile(accepted[0]);
      setBgImage((prev) => {
        prev?.close();
        return bm;
      });
      setBgSettings((s) => ({ ...s, mode: "image" }));
    } catch (e) {
      setNotice(describeError(e));
    }
  };

  const pendingCount = items.filter(
    (i) => i.status === "pending" || i.status === "error",
  ).length;
  const transparentPreview = hasResult && bgSettings.mode === "transparent";
  const pbg = transparentPreview
    ? previewBgProps(previewBg)
    : { className: "" };

  const presetFringe = Math.round((subjectPreset(subject).fringe ?? 0) * 10);
  const runIsPrimary = !hasResult || pendingCount > 0;
  const processingSelected = running && selected?.status === "processing";
  const overlayError =
    !running &&
    selected?.status === "error" &&
    selected.error !== dismissedError
      ? selected.error
      : null;
  const stopActivity = () => {
    if (exporting) exportCancelled.current = true;
    else cancel();
  };

  const fit = useFitSize(
    bitmap ? bitmap.width / bitmap.height : null,
    hasResult && view === "compare" ? 36 : 0,
  );

  const ghostRef = useRef<HTMLCanvasElement>(null);
  const hadResult = useRef(false);
  useEffect(() => {
    const was = hadResult.current;
    hadResult.current = hasResult;
    const g = ghostRef.current;
    if (!g || !bitmap || !previewSize || was || !hasResult) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    g.width = previewSize.w;
    g.height = previewSize.h;
    g.getContext("2d")!.drawImage(bitmap, 0, 0, previewSize.w, previewSize.h);
    g.style.transition = "none";
    g.style.opacity = "1";
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        g.style.transition = "opacity 320ms ease-out";
        g.style.opacity = "0";
      }),
    );
  }, [hasResult, bitmap, previewSize]);

  const toolbar = hasResult && (
    <>
      <SegmentedControl
        label="View"
        size="sm"
        nowrap
        value={view}
        onChange={setView}
        options={[
          {
            value: "edit",
            title: "Edit",
            label: <span className="sr-only lg:not-sr-only">Edit</span>,
            icon: PenLine,
          },
          {
            value: "compare",
            title: "Compare",
            label: <span className="sr-only lg:not-sr-only">Compare</span>,
            icon: Columns2,
          },
        ]}
      />
      {transparentPreview && (
        <PreviewBgPicker value={previewBg} onChange={setPreviewBg} />
      )}
    </>
  );

  const preview = (
    <div
      ref={fit.ref}
      className="absolute inset-0 flex items-center justify-center"
    >
      {bitmap ? (
        <div
          className={`relative transition-opacity duration-200 ${processingSelected ? "opacity-60" : ""}`}
          style={{
            width: fit.size?.w ?? 0,
            height:
              hasResult && view === "compare" ? undefined : (fit.size?.h ?? 0),
          }}
        >
          {hasResult && view === "compare" ? (
            <CompareSlider
              before={
                <canvas
                  ref={beforeRef}
                  className="block w-full h-auto"
                  aria-label="Original image"
                />
              }
              after={
                <canvas
                  ref={previewRef}
                  className={`block h-auto w-full ${pbg.className}`}
                  style={pbg.style}
                  aria-label="Result"
                />
              }
              className="overflow-hidden border rounded-lg border-border"
            />
          ) : (
            <div
              className="relative w-full h-full overflow-hidden border rounded-lg border-border"
              data-testid="preview-box"
            >
              <canvas
                ref={previewRef}
                className={`block h-full w-full ${pbg.className} ${canEdit ? "cursor-none" : ""}`}
                style={{ ...pbg.style, touchAction: canEdit ? "none" : "auto" }}
                aria-label={
                  hasResult
                    ? `Result: drag to ${BRUSH_ACTION[brushMode]} parts of the cut-out`
                    : "Original image"
                }
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endStroke}
                onPointerCancel={endStroke}
                onPointerLeave={(e) => moveCursor(e, false)}
              />
              <canvas
                ref={ghostRef}
                aria-hidden
                className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
              />
              <div
                ref={cursorRef}
                aria-hidden
                className="absolute top-0 left-0 hidden rounded-full pointer-events-none"
                style={{
                  width: brushSize,
                  height: brushSize,
                  border: `2px solid ${BRUSH_COLOR[brushMode]}`,
                  boxShadow: "0 0 0 1px rgba(255,255,255,0.9)",
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="w-full h-full rounded-lg animate-pulse bg-surface-3 motion-reduce:animate-none" />
      )}
      <ProcessingOverlay
        activity={activity}
        onCancel={stopActivity}
        error={overlayError}
        onDismiss={() => setDismissedError(selected?.error ?? null)}
        box={bitmap ? fit.size : null}
      />
    </div>
  );

  const actions = (
    <>
      <Button
        variant={runIsPrimary ? "primary" : "secondary"}
        icon={Scissors}
        onClick={process}
        disabled={running || exporting}
        loading={running}
        block
      >
        Remove background
      </Button>
      {hasResult && (
        <Button
          variant={runIsPrimary ? "secondary" : "primary"}
          icon={Download}
          onClick={downloadSelected}
          disabled={running}
          loading={exporting}
          block
        >
          Download {format.toUpperCase()}
        </Button>
      )}
    </>
  );

  const panelStatus = status && status !== selected?.error ? status : "";

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      <StageAnnouncer activity={activity} />
      <div
        className={
          items.length ? "shrink-0" : "flex flex-1 flex-col justify-center"
        }
      >
        <DropZone
          onFiles={addFiles}
          compact={items.length > 0}
          label={
            items.length
              ? "Add more images: drop, paste or choose files"
              : "Drop images to remove their background"
          }
          hint="Or paste them, or choose files. PNG, JPEG or WebP; add several for a batch."
        />
      </div>
      {notice && (
        <Notice tone="warning" role="alert" className="shrink-0">
          {notice}
        </Notice>
      )}

      {items.length > 1 && (
        <ImageStrip
          items={items.map((i) => ({
            id: i.id,
            name: i.file.name,
            thumb: i.thumb,
            status: i.status,
            error: i.error,
          }))}
          selectedId={selectedId}
          busy={running}
          progress={activity?.percent}
          onSelect={setSelectedId}
          onRemove={removeItem}
          onClear={clearAll}
        />
      )}

      {selected && (
        <Workspace
          toolbar={toolbar}
          preview={preview}
          caption={
            <>
              {bitmap && `${bitmap.width}×${bitmap.height}`}
              {canEdit &&
                ` · Drag to ${BRUSH_ACTION[brushMode]}. X switches Erase/Restore, [ and ] change the brush size.`}
            </>
          }
          actions={actions}
        >
          <Section id="bg-model-h" title="Model">
            <ModelSelector
              models={bgModels}
              value={modelId}
              onChange={(id) => {
                setModelId(id);
                saveSetting("bgModelChoice", id);
              }}
              cached={cached}
            >
              {ready && avail.hidden.length > 0 && (
                <p role="note" className="text-xs text-muted">
                  Not available on this device:{" "}
                  {avail.hidden
                    .map((h) => `${h.model.name}: ${h.reason}`)
                    .join("; ")}
                  . Using{" "}
                  {bgModels.find((m) => m.id === modelId)?.name ??
                    "the best available model"}
                  .
                </p>
              )}
              {qualityModel && modelId !== qualityModel.id && (
                <p className="text-xs text-muted">
                  Soft edges, or thin dark parts cut off?{" "}
                  <button
                    onClick={() => setModelId(qualityModel.id)}
                    className="font-medium underline text-accent-text underline-offset-2"
                  >
                    Use {qualityModel.name}
                  </button>
                  .
                </p>
              )}
            </ModelSelector>
            {bgModels.find((m) => m.id === modelId)?.wasm === false && (
              <Notice tone="warning" role="note">
                Runs on the GPU only (WebGPU). If this GPU cannot run it, offpix
                switches to the next best model.
              </Notice>
            )}
            {!running && <StatusText text={panelStatus} />}
            {!running && items.length > 1 && pendingCount > 0 && (
              <p className="text-xs text-muted">
                {pendingCount} image{pendingCount > 1 ? "s" : ""} waiting.
              </p>
            )}
          </Section>

          {hasResult && (
            <>
              <Section id="refine-h" title="Refine">
                <SegmentedControl
                  label="Subject"
                  value={subject}
                  onChange={chooseSubject}
                  options={SUBJECTS.map((s) => ({
                    value: s.id,
                    label: s.label,
                    title: s.hint,
                  }))}
                />
                <Checkbox
                  checked={fillHoles}
                  onChange={setFillHoles}
                  label="Fill enclosed regions"
                  hint="For screens inside a frame. Turn off for rings or gaps in hair."
                />
                {fillHoles && selected.filled && !refining && (
                  <p className="text-xs text-muted" role="status">
                    {selected.filled.regions
                      ? `Filled ${selected.filled.regions} region${selected.filled.regions > 1 ? "s" : ""} (${+((selected.filled.pixels / (selected.width! * selected.height!)) * 100).toPrecision(2)} % of the image).`
                      : "No enclosed regions at this size."}
                  </p>
                )}
                {refining && (
                  <p className="text-xs text-muted" role="status">
                    Refining…
                  </p>
                )}
                <Disclosure id="bg-advanced" summary="Advanced">
                  {fillHoles && (
                    <Slider
                      id="fill-area"
                      label="Smallest region to fill"
                      value={fillArea}
                      min={0}
                      max={FILL_AREAS.length - 1}
                      defaultValue={FILL_AREAS.indexOf(DEFAULT_FILL_MIN_AREA)}
                      onChange={setFillArea}
                      format={(i) =>
                        `${+(FILL_AREAS[i] * 100).toPrecision(2)} % of image`
                      }
                    />
                  )}
                  <Slider
                    id="fringe"
                    label="Fringe removal"
                    value={fringe}
                    min={0}
                    max={10}
                    defaultValue={presetFringe}
                    onChange={setFringe}
                    format={(v) => (v ? `${v * 10} %` : "Off")}
                    hint="Removes backdrop colour between hair strands. Higher values thin fine strands."
                  />
                  <Slider
                    id="shift"
                    label="Shift edge"
                    value={shift}
                    min={-5}
                    max={5}
                    defaultValue={0}
                    onChange={setShift}
                    format={(v) =>
                      `${v > 0 ? "+" : ""}${v * shiftUnit(selected.width ?? 0, selected.height ?? 0)} px`
                    }
                  />
                  <Slider
                    id="feather"
                    label="Feather"
                    value={feather}
                    min={0}
                    max={10}
                    defaultValue={0}
                    onChange={setFeather}
                    format={(v) => (v ? `${v} px` : "Off")}
                    hint="Shift and Feather change only the outline, not hair or the solid inside."
                  />
                </Disclosure>
              </Section>

              <Section
                id="brush-h"
                title="Touch up"
                actions={
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon={Undo2}
                      label="Undo"
                      onClick={doUndo}
                      disabled={!selected.history.done.length}
                      aria-keyshortcuts="Control+Z"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon={Redo2}
                      label="Redo"
                      onClick={doRedo}
                      disabled={!selected.history.undone.length}
                      aria-keyshortcuts="Control+Shift+Z"
                    />
                  </div>
                }
              >
                <SegmentedControl
                  label="Brush mode"
                  aria-keyshortcuts="X"
                  value={brushMode}
                  onChange={setBrushMode}
                  options={(["erase", "restore"] as const).map((m) => ({
                    value: m,
                    icon: m === "erase" ? Eraser : Brush,
                    label: (
                      <>
                        {m === "erase" ? "Erase" : "Restore"}
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ background: BRUSH_COLOR[m] }}
                          aria-hidden
                        />
                      </>
                    ),
                  }))}
                />
                <Slider
                  id="brush-size"
                  label="Brush size"
                  value={brushSize}
                  min={4}
                  max={200}
                  onChange={setBrushSize}
                  format={(v) => `${v} px`}
                />
                <Slider
                  id="brush-soft"
                  label="Softness"
                  value={brushSoftness}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setBrushSoftness}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              </Section>

              <Section id="bg-h" title="Background">
                <SegmentedControl
                  label="Background type"
                  size="sm"
                  value={bgSettings.mode}
                  onChange={(mode) => setBgSettings((s) => ({ ...s, mode }))}
                  options={BG_MODES.map(({ mode, label }) => ({
                    value: mode,
                    label,
                  }))}
                />
                {bgSettings.mode === "color" && (
                  <label className="flex items-center gap-3 text-sm font-medium">
                    <input
                      type="color"
                      className="w-12 h-10 p-1 border rounded cursor-pointer border-border-strong bg-surface"
                      value={bgSettings.color}
                      onChange={(e) =>
                        setBgSettings((s) => ({ ...s, color: e.target.value }))
                      }
                    />
                    Background colour
                  </label>
                )}
                {bgSettings.mode === "gradient" && (
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      className="w-12 h-10 p-1 border rounded cursor-pointer border-border-strong bg-surface"
                      aria-label="Gradient start"
                      value={bgSettings.gradient[0]}
                      onChange={(e) =>
                        setBgSettings((s) => ({
                          ...s,
                          gradient: [e.target.value, s.gradient[1]],
                        }))
                      }
                    />
                    <input
                      type="color"
                      className="w-12 h-10 p-1 border rounded cursor-pointer border-border-strong bg-surface"
                      aria-label="Gradient end"
                      value={bgSettings.gradient[1]}
                      onChange={(e) =>
                        setBgSettings((s) => ({
                          ...s,
                          gradient: [s.gradient[0], e.target.value],
                        }))
                      }
                    />
                  </div>
                )}
                {bgSettings.mode === "blur" && (
                  <Slider
                    id="blur"
                    label="Blur"
                    value={bgSettings.blur}
                    min={1}
                    max={50}
                    onChange={(v) => setBgSettings((s) => ({ ...s, blur: v }))}
                    format={(v) => `${v} px`}
                  />
                )}
                {bgSettings.mode === "image" && (
                  <DropZone
                    onFiles={setBackgroundImage}
                    multiple={false}
                    compact
                    label={
                      bgImage
                        ? "Replace background image"
                        : "Choose a background image"
                    }
                  />
                )}
              </Section>

              <Section id="export-h" title="Export">
                <Select
                  id="bg-format"
                  label="Format"
                  inline
                  value={format}
                  onChange={(v) => setFormat(v as ExportFormat)}
                >
                  <option value="png">PNG</option>
                  <option value="webp">WebP</option>
                </Select>
                {format === "webp" && (
                  <Slider
                    id="bg-quality"
                    label="Quality"
                    value={quality}
                    min={0.5}
                    max={1}
                    step={0.01}
                    onChange={setQuality}
                    format={(v) => `${Math.round(v * 100)}`}
                    hint="The browser's WebP encoder can lose detail in fine semi-transparent edges. PNG keeps them exactly."
                  />
                )}
                {doneItems.length > 1 && (
                  <Button
                    icon={FolderArchive}
                    onClick={downloadZip}
                    disabled={exporting || running}
                  >
                    Download ZIP ({doneItems.length})
                  </Button>
                )}
                {bitmap && selected.width! < bitmap.width ? (
                  <Notice tone="warning" role="note">
                    Large image (
                    {((bitmap.width * bitmap.height) / 1e6).toFixed(1)} MP):
                    processed and saved at {selected.width}×{selected.height} (
                    {((selected.width! * selected.height!) / 1e6).toFixed(1)}{" "}
                    MP) to stay within this device's memory.
                  </Notice>
                ) : (
                  <p className="text-xs text-muted">
                    Saved at full resolution ({selected.width}×{selected.height}
                    ).
                  </p>
                )}
              </Section>
            </>
          )}
        </Workspace>
      )}
    </div>
  );
}
