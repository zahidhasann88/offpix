import { useCallback, useEffect, useMemo, useState } from "react";
import { engine } from "../engine/client";
import type { BackendInfo, EngineInfo } from "../engine/workerApi";
import { checkUpscaleLimits, defaultTileSize } from "../tools/upscale";
import { models } from "../models";
import { loadSetting, saveSetting } from "../lib/settings";
import {
  decodeImageFile,
  fileToImageInput,
  partitionFiles,
} from "../lib/image";
import { baseName, downloadBlob } from "../lib/download";
import { canvasToBlob, createCanvas } from "../lib/composite";
import { canvasCanHold } from "../lib/canvasLimits";
import { Download, Expand } from "lucide-react";
import { ModelSelector } from "./ModelSelector";
import { ZoomCompare } from "./ZoomCompare";
import { describeError } from "./errors";
import { usePasteFiles } from "./usePasteFiles";
import { formatBytes, formatSeconds, modelProgressText } from "./format";
import {
  Button,
  Disclosure,
  DropZone,
  Notice,
  ProcessingOverlay,
  Section,
  Select,
  Slider,
  StageAnnouncer,
  StatusText,
  Workspace,
  type Activity,
} from "./kit";

const upModels = models.filter((m) => m.tool === "upscale");
type Format = "png" | "jpeg" | "webp";

interface Props {
  engineInfo: EngineInfo | null;
  cached: Record<string, boolean>;
  onModelsChanged: () => void;
  onBackend: (b: BackendInfo) => void;
}

interface Result {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  scale: number;
}

export function Upscaler({
  engineInfo,
  cached,
  onModelsChanged,
  onBackend,
}: Props) {
  const [modelId, setModelId] = useState(() => {
    const saved = loadSetting("upModel", upModels[0]?.id ?? "");
    return upModels.some((m) => m.id === saved)
      ? saved
      : (upModels[0]?.id ?? "");
  });
  const [file, setFile] = useState<File | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [tileSize, setTileSize] = useState<number | null>(() =>
    loadSetting<number | null>("tileSize", null),
  );
  const [format, setFormat] = useState<Format>(() =>
    loadSetting<Format>("upFormat", "png"),
  );
  const [quality, setQuality] = useState(() => loadSetting("upQuality", 0.92));
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    saveSetting("upModel", modelId);
  }, [modelId]);
  useEffect(() => {
    if (tileSize != null) saveSetting("tileSize", tileSize);
  }, [tileSize]);
  useEffect(() => {
    saveSetting("upFormat", format);
  }, [format]);
  useEffect(() => {
    saveSetting("upQuality", quality);
  }, [quality]);

  const entry = upModels.find((m) => m.id === modelId);
  const scale = entry?.scale ?? 4;
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  const lowMemory = deviceMemory != null && deviceMemory <= 4;
  const effectiveTileSize =
    tileSize ??
    defaultTileSize(engineInfo?.webgpu ? "webgpu" : "wasm", deviceMemory);

  const limitError = useMemo(() => {
    if (!bitmap) return null;
    try {
      checkUpscaleLimits(bitmap.width, bitmap.height, scale, deviceMemory);
    } catch (e) {
      return describeError(e);
    }
    if (!canvasCanHold(bitmap.width * scale, bitmap.height * scale)) {
      return `Error: this browser can't hold a ${bitmap.width * scale}×${bitmap.height * scale} image. Try ${scale === 4 ? "2x or " : ""}a smaller image.`;
    }
    return null;
  }, [bitmap, scale, deviceMemory]);

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
    } catch (e) {
      setStatus(describeError(e));
    }
  }, []);
  usePasteFiles(handleFiles);

  const run = async () => {
    if (!file || limitError) return;
    setRunning(true);
    setStatus("Loading model…");
    setError(null);
    const started = performance.now();
    setActivity({ stage: "prepare", startedAt: started });
    let inferenceStarted = 0;
    // Progress arrives over separate message ports and can trail the result; drop late ones.
    let settled = false;
    try {
      const res = await engine.upscale(
        await fileToImageInput(file),
        { modelId, tileSize: effectiveTileSize, overlap: 16 },
        (p) => {
          if (settled) return;
          setStatus(modelProgressText(p, "Preparing…"));
          setActivity(
            p.percent < 100
              ? {
                  stage: "download",
                  percent: p.percent,
                  detail: `${formatBytes(p.loaded)} of ${formatBytes(p.total)}`,
                  startedAt: started,
                }
              : { stage: "run", startedAt: started },
          );
        },
        (done, total) => {
          if (settled) return;
          if (done === 1) inferenceStarted = performance.now();
          const perTile =
            done > 1 ? (performance.now() - inferenceStarted) / (done - 1) : 0;
          const left = perTile
            ? ` · about ${formatSeconds((perTile * (total - done)) / 1000)} left`
            : "";
          setStatus(
            perTile
              ? `Upscaling… about ${formatSeconds((perTile * (total - done)) / 1000)} left`
              : "Upscaling…",
          );
          setActivity({
            stage: "tiles",
            percent: (done / total) * 100,
            detail: `Tiles ${done}/${total}${left}`,
            startedAt: started,
          });
        },
      );
      settled = true;
      onBackend(res);
      const { canvas, ctx } = createCanvas(res.width, res.height);
      ctx.putImageData(
        new ImageData(
          res.data as Uint8ClampedArray<ArrayBuffer>,
          res.width,
          res.height,
        ),
        0,
        0,
      );
      setResult({ canvas, width: res.width, height: res.height, scale });
      setStatus(
        `Done in ${formatSeconds((performance.now() - started) / 1000)}`,
      );
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

  const download = async () => {
    if (!result) return;
    setExporting(true);
    setActivity({
      stage: "encode",
      detail: format.toUpperCase(),
      startedAt: performance.now(),
    });
    try {
      const mime =
        format === "png"
          ? "image/png"
          : format === "jpeg"
            ? "image/jpeg"
            : "image/webp";
      const out = format === "jpeg" ? flattenForJpeg(result) : result.canvas;
      downloadBlob(
        await canvasToBlob(out, mime, quality),
        `${baseName(file?.name || "image")}-${result.scale}x.${format}`,
      );
    } catch (e) {
      setStatus(describeError(e));
    } finally {
      setExporting(false);
      setActivity(null);
    }
  };

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
              : "Drop an image to upscale"
          }
          hint="Or paste it, or choose a file. PNG, JPEG or WebP."
        />
        {!bitmap && <StatusText text={status} />}
      </div>
      {lowMemory && bitmap && (
        <Notice tone="warning" className="shrink-0">
          This device reports {deviceMemory} GB of memory, so tiles are smaller
          and output is limited to 16 MP.
        </Notice>
      )}
      {bitmap && (
        <Workspace
          preview={
            <div className="absolute inset-0">
              <div
                className={`h-full transition-opacity duration-200 ${running ? "opacity-60" : ""}`}
              >
                {result ? (
                  <ZoomCompare
                    after={result.canvas}
                    afterSize={{ w: result.width, h: result.height }}
                    before={bitmap}
                    beforeSize={{ w: bitmap.width, h: bitmap.height }}
                    label={`Upscaled result, ${result.width}×${result.height}`}
                  />
                ) : (
                  <ZoomCompare
                    after={bitmap}
                    afterSize={{ w: bitmap.width, h: bitmap.height }}
                    label={`Original, ${bitmap.width}×${bitmap.height}`}
                  />
                )}
              </div>
              <ProcessingOverlay
                activity={activity}
                onCancel={running ? () => engine.cancel() : undefined}
                error={running ? null : error}
                onDismiss={() => setError(null)}
              />
            </div>
          }
          caption={
            result
              ? `${result.width}×${result.height}`
              : `${bitmap.width}×${bitmap.height}`
          }
          actions={
            <>
              <Button
                variant={result ? "secondary" : "primary"}
                icon={Expand}
                onClick={run}
                disabled={running || exporting || !!limitError}
                loading={running}
                block
              >
                Upscale
              </Button>
              {result && (
                <Button
                  variant="primary"
                  icon={Download}
                  onClick={download}
                  disabled={running}
                  loading={exporting}
                  block
                >
                  Download {format.toUpperCase()}
                </Button>
              )}
            </>
          }
        >
          <Section id="up-model-h" title="Model">
            <ModelSelector
              models={upModels}
              value={modelId}
              onChange={setModelId}
              cached={cached}
            />
            <p className="text-sm text-muted">
              {bitmap.width}×{bitmap.height} →{" "}
              <span className="font-medium text-fg">
                {bitmap.width * scale}×{bitmap.height * scale}
              </span>{" "}
              ({scale}x)
            </p>
            {limitError && (
              <Notice tone="error" role="alert">
                {limitError}
              </Notice>
            )}
            {!running && <StatusText text={status} />}
            <Disclosure id="up-advanced" summary="Advanced">
              <Slider
                id="tile-size"
                label="Tile size"
                value={effectiveTileSize}
                min={64}
                max={512}
                step={32}
                onChange={setTileSize}
                format={(v) => `${v} px${tileSize == null ? " (auto)" : ""}`}
                hint="Smaller tiles use less memory; larger tiles are faster on a GPU."
              />
              {tileSize != null && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTileSize(null)}
                >
                  Reset to auto
                </Button>
              )}
            </Disclosure>
          </Section>

          {result && (
            <Section id="up-export-h" title="Export">
              <Select
                id="up-format"
                label="Format"
                inline
                value={format}
                onChange={(v) => setFormat(v as Format)}
              >
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </Select>
              {format !== "png" && (
                <Slider
                  id="up-quality"
                  label="Quality"
                  value={quality}
                  min={0.5}
                  max={1}
                  step={0.01}
                  onChange={setQuality}
                  format={(v) => `${Math.round(v * 100)}`}
                />
              )}
            </Section>
          )}
        </Workspace>
      )}
    </div>
  );
}

function flattenForJpeg(r: Result): HTMLCanvasElement | OffscreenCanvas {
  const { canvas, ctx } = createCanvas(r.width, r.height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, r.width, r.height);
  ctx.drawImage(r.canvas, 0, 0);
  return canvas;
}
