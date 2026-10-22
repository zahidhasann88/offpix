import { useEffect, useMemo, useRef, useState } from "react";
import { decode as decodePng } from "fast-png";
import { engine } from "../engine/client";
import type { BgDebugResult } from "../engine/workerApi";
import { buildMask, refineMask } from "../engine/maskClient";
import { defaultRefineOptions } from "../tools/bg-pipeline";
import type { RefineResult } from "../workers/mask.worker";
import { applyEdgeRefine } from "../tools/edges";
import { models } from "../models";
import { fileToImageInput } from "../lib/image";
import { exportCutout, defaultBgSettings } from "../lib/composite";
import { Button, DropZone, Slider } from "../ui/kit";
import { PreviewBgPicker, type PreviewBg } from "../ui/PreviewBg";
import { describeError } from "../ui/errors";
import {
  aspectMapping,
  alphaStats,
  transitionWidth,
  ridgeStats,
  borderColour,
  edgeSpill,
  premultipliedGridShare,
  lowAlphaColourError,
  highlightLoss,
  shadowKept,
  changeAwayFromEdges,
} from "./diagnostics";

const bgModels = models.filter((m) => m.tool === "background-remove");
const CROP = 128;
const ZOOM = 3;

type Gray = {
  data: Float32Array | Uint8ClampedArray | Uint8Array;
  w: number;
  h: number;
  max: number;
};
type Rgba = { data: Uint8ClampedArray | Uint8Array; w: number; h: number };

const toF = (a: Uint8ClampedArray | Uint8Array) =>
  Float32Array.from(a, (v) => v / 255);

function grayImage(g: Gray): ImageData {
  const img = new ImageData(g.w, g.h);
  for (let i = 0; i < g.w * g.h; i++) {
    const v = (g.data[i] / g.max) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  return img;
}

const BG_RGB: Record<Exclude<PreviewBg, "checker">, number[]> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  red: [255, 0, 0],
};

function compositeOver(
  rgb: Rgba["data"],
  alpha: Float32Array | null,
  w: number,
  h: number,
  bg: PreviewBg,
): ImageData {
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const a = alpha ? alpha[i] : rgb[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) {
      img.data[i * 4 + c] =
        bg === "checker"
          ? rgb[i * 4 + c]
          : a * rgb[i * 4 + c] + (1 - a) * BG_RGB[bg][c];
    }
    img.data[i * 4 + 3] = bg === "checker" ? a * 255 : 255;
  }
  return img;
}

function Panel({
  title,
  img,
  note,
  crop,
  onPick,
}: {
  title: string;
  img: ImageData | null;
  note?: string;
  crop?: { x: number; y: number; sx: number; sy: number };
  onPick?: (fx: number, fy: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const zref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !img) return;
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")!.putImageData(img, 0, 0);
    const z = zref.current;
    if (!z || !crop) return;
    const cw = Math.round(CROP * crop.sx),
      ch = Math.round(CROP * crop.sy);
    z.width = CROP * ZOOM;
    z.height = CROP * ZOOM;
    const zc = z.getContext("2d")!;
    zc.imageSmoothingEnabled = false;
    zc.clearRect(0, 0, z.width, z.height);
    zc.drawImage(
      c,
      Math.round(crop.x * crop.sx - cw / 2),
      Math.round(crop.y * crop.sy - ch / 2),
      cw,
      ch,
      0,
      0,
      z.width,
      z.height,
    );
  }, [img, crop]);
  return (
    <figure className="space-y-1" data-panel={title}>
      <figcaption className="text-xs font-medium">
        {title}
        {note && <span className="ml-1 font-normal text-muted">{note}</span>}
      </figcaption>
      <canvas
        ref={ref}
        className="block w-full h-auto border rounded border-border checkerboard"
        onClick={
          onPick &&
          ((e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onPick(
              (e.clientX - r.left) / r.width,
              (e.clientY - r.top) / r.height,
            );
          })
        }
      />
      {crop && (
        <canvas
          ref={zref}
          data-crop={title}
          className="block h-auto w-full rounded border border-border checkerboard [image-rendering:pixelated]"
        />
      )}
    </figure>
  );
}

interface Exported {
  rgba: Uint8Array;
  bytes: number;
  png: Uint8Array;
}

export default function DebugView() {
  const [modelId, setModelId] = useState(bgModels[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<
    (BgDebugResult & { refined: RefineResult }) | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feather, setFeather] = useState(0);
  const [shift, setShift] = useState(0);
  const [finalAlpha, setFinalAlpha] = useState<Float32Array | null>(null);
  const [exported, setExported] = useState<Exported | null>(null);
  const [bg, setBg] = useState<PreviewBg>("black");
  const [pick, setPick] = useState({ fx: 0.5, fy: 0.25 });

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setRes(null);
    setFinalAlpha(null);
    setExported(null);
    try {
      const d = await engine.debugBackground(
        await fileToImageInput(file),
        modelId,
      );
      const t = performance.now();
      const refined = await refineMask(
        `debug-${file.name}-${file.size}`,
        file,
        d.lowMask,
        d.outSize,
        d.map,
        defaultRefineOptions,
        true,
        d.logits,
      );
      d.timings.refine = performance.now() - t;
      setRes({ ...d, refined });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!res) return;
    let alive = true;
    buildMask(
      res.refined.mask.slice(),
      res.width,
      res.height,
      feather,
      shift,
      [],
    ).then((m) => {
      if (alive) setFinalAlpha(m);
    });
    return () => {
      alive = false;
    };
  }, [res, feather, shift]);

  useEffect(() => {
    if (!res || !finalAlpha || !file) return;
    let alive = true;
    (async () => {
      const { width: w, height: h } = res;
      const original = await createImageBitmap(
        new ImageData(res.original.slice(), w, h),
      );
      const blob = await exportCutout(
        original,
        res.refined.fg,
        finalAlpha,
        w,
        h,
        { ...defaultBgSettings, mode: "transparent" },
        null,
        "png",
        1,
      );
      const png = decodePng(new Uint8Array(await blob.arrayBuffer()));
      if (alive)
        setExported({
          rgba: png.data as Uint8Array,
          bytes: blob.size,
          png: new Uint8Array(await blob.arrayBuffer()),
        });
      original.close();
    })().catch((e) => alive && setError(describeError(e)));
    return () => {
      alive = false;
    };
  }, [res, finalAlpha, file]);

  const metrics = useMemo(() => {
    if (!res || !finalAlpha) return null;
    const { width: w, height: h } = res;
    const refined = toF(res.refined.mask),
      up = toF(res.refined.coarse!);
    const border = borderColour(res.original, w, h);
    const radius = Math.max(4, Math.round(Math.max(w, h) / 100));
    const exact = new Uint8ClampedArray(res.refined.fg);
    for (let i = 0; i < w * h; i++) exact[i * 4 + 3] = finalAlpha[i] * 255;
    const final8 = Uint8ClampedArray.from(finalAlpha, (v) => v * 255);
    const hl = highlightLoss(res.original, refined, w, h, border.mean);
    const sh = shadowKept(res.original, refined, w, h, border.mean);
    return {
      model: res.modelId,
      image: `${w}x${h}`,
      backend: res.backend,
      fallbackReason: res.fallbackReason,
      timingsMs: res.timings,
      h1: {
        modelInput: `${res.size}x${res.size}`,
        ...aspectMapping(w, h, res.size),
        resamplePsnrDb: res.resamplePsnr,
      },
      h2: {
        tensor: res.tensor,
        maxDiffToRembg: res.rembgDiff,
        rawOutputRange: res.rawRange,
      },
      h3: {
        modelOutput: `${res.outSize}x${res.outSize}`,
        fullResPixelsPerMaskPixel: Math.max(w, h) / res.outSize,
        transitionPx: {
          upscaled: transitionWidth(up, w, h),
          refined: transitionWidth(refined, w, h),
          final: transitionWidth(finalAlpha, w, h),
        },
        ridges: {
          upscaled: ridgeStats(up, w, h),
          refined: ridgeStats(refined, w, h),
          final: ridgeStats(finalAlpha, w, h),
        },
      },
      h4: {
        upscaled: alphaStats(res.refined.coarse!),
        refined: alphaStats(res.refined.mask),
        final: alphaStats(final8),
      },
      h5: {
        background: border,
        input: edgeSpill(res.original, refined, w, h, border.mean, radius),
        output: edgeSpill(res.refined.fg, refined, w, h, border.mean, radius),
      },
      h6: exported && {
        pngBytes: exported.bytes,
        gridShare: premultipliedGridShare(exported.rgba),
        exactGridShare: premultipliedGridShare(exact),
        lowAlphaError: lowAlphaColourError(exported.rgba, exact),
      },
      h7: {
        holePixels: hl.holePixels,
        bgLikeInside: hl.bgLikeInside,
        bgLikeLost: hl.bgLikeLost,
        lostShare: hl.lostShare,
      },
      h8: {
        shadowPixels: sh.shadowPixels,
        keptOver50: sh.keptOver50,
        partial2to50: sh.partial2to50,
        meanAlpha: sh.meanAlpha,
      },
      h9: {
        feather,
        shift,
        ridgeRetention:
          ridgeStats(finalAlpha, w, h).count /
          Math.max(1, ridgeStats(refined, w, h).count),
        shiftPlus1: changeAwayFromEdges(
          refined,
          applyEdgeRefine(refined, w, h, 0, 1),
        ),
      },
      maps: { holes: hl.holes, shadow: sh.map },
    };
  }, [res, finalAlpha, exported, feather, shift]);

  useEffect(() => {
    if (!metrics) return;
    const { maps: _maps, ...plain } = metrics;
    void _maps;
    const png = exported
      ? btoa(Array.from(exported.png, (b) => String.fromCharCode(b)).join(""))
      : null;
    (window as unknown as { __offpixDebug?: unknown }).__offpixDebug = {
      metrics: plain,
      ready: !!metrics.h6,
      png,
    };
  }, [metrics, exported]);

  const imgs = useMemo(() => {
    if (!res) return null;
    const { width: w, height: h, size, outSize } = res;
    const mapImg = (holes: Uint8Array, shadow: Uint8Array) => {
      const img = new ImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const q = i * 4;
        const g =
          (0.299 * res.original[q] +
            0.587 * res.original[q + 1] +
            0.114 * res.original[q + 2]) *
          0.5;
        img.data[q] = holes[i] ? 255 : shadow[i] ? 0 : g;
        img.data[q + 1] = holes[i] ? 0 : shadow[i] ? 90 : g;
        img.data[q + 2] = holes[i] ? 0 : shadow[i] ? 255 : g;
        img.data[q + 3] = 255;
      }
      return img;
    };
    return {
      input: new ImageData(res.original.slice(), w, h),
      modelInput: new ImageData(res.modelInput.slice(), size, size),
      raw: grayImage({
        data: res.logits
          ? Float32Array.from(res.lowMask, (v) => 1 / (1 + Math.exp(-v)))
          : res.lowMask,
        w: outSize,
        h: outSize,
        max: 1,
      }),
      up: grayImage({ data: res.refined.coarse!, w, h, max: 255 }),
      refined: grayImage({ data: res.refined.mask, w, h, max: 255 }),
      final: finalAlpha && grayImage({ data: finalAlpha, w, h, max: 1 }),
      exact: finalAlpha && compositeOver(res.refined.fg, finalAlpha, w, h, bg),
      exported: exported && compositeOver(exported.rgba, null, w, h, bg),
      maps: metrics && mapImg(metrics.maps.holes, metrics.maps.shadow),
    };
  }, [res, finalAlpha, exported, bg, metrics]);

  const crop = (sx: number, sy: number) =>
    res && { x: pick.fx * res.width, y: pick.fy * res.height, sx, sy };
  const full = crop(1, 1) ?? undefined;
  useEffect(() => {
    (
      window as unknown as {
        __offpixDebugPick?: (fx: number, fy: number) => void;
      }
    ).__offpixDebugPick = (fx, fy) => setPick({ fx, fy });
  }, []);

  return (
    <div className="space-y-4" data-testid="debug-view">
      <h2 className="text-lg font-semibold">Background removal debug</h2>
      <DropZone
        onFiles={(f) => setFile(f[0] ?? null)}
        multiple={false}
        compact
        label={file ? file.name : "Drop an image to inspect"}
      />
      <div className="flex flex-wrap items-center gap-3">
        <select
          id="debug-model"
          aria-label="Model"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          className="h-10 px-2 text-sm border rounded border-border-strong bg-surface"
        >
          {bgModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <Button variant="primary" onClick={run} disabled={!file} loading={busy}>
          Run
        </Button>
        <PreviewBgPicker value={bg} onChange={setBg} />
        <div className="w-40">
          <Slider
            id="dbg-feather"
            label="Feather"
            value={feather}
            min={0}
            max={10}
            onChange={setFeather}
          />
        </div>
        <div className="w-40">
          <Slider
            id="dbg-shift"
            label="Shift edge"
            value={shift}
            min={-5}
            max={5}
            onChange={setShift}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {res && imgs && (
        <>
          <p className="text-xs text-muted">
            Click the input to move the zoomed crop ({CROP}px at {ZOOM}x).
            Status: {metrics?.h6 ? "ready" : "measuring…"}
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Panel
              title="Input"
              img={imgs.input}
              crop={full}
              onPick={(fx, fy) => setPick({ fx, fy })}
            />
            <Panel
              title="Model input"
              note={`${res.size}² as fed`}
              img={imgs.modelInput}
              crop={
                crop(res.size / res.width, res.size / res.height) ?? undefined
              }
            />
            <Panel
              title="Raw output"
              note={`${res.outSize}²`}
              img={imgs.raw}
              crop={
                crop(res.outSize / res.width, res.outSize / res.height) ??
                undefined
              }
            />
            <Panel
              title="Upscaled mask"
              note="mapped back"
              img={imgs.up}
              crop={full}
            />
            <Panel
              title="Refined alpha"
              note="worker output"
              img={imgs.refined}
              crop={full}
            />
            <Panel
              title="Final alpha"
              note={`feather ${feather}, shift ${shift}`}
              img={imgs.final}
              crop={full}
            />
            <Panel
              title="Cut-out (exact)"
              note={`unpremultiplied, over ${bg}`}
              img={imgs.exact}
              crop={full}
            />
            <Panel
              title="Cut-out (exported PNG)"
              note={`app export path, over ${bg}`}
              img={imgs.exported}
              crop={full}
            />
            <Panel
              title="Holes / shadow"
              note="red: holes in subject, blue: shadow-like with alpha<0.98"
              img={imgs.maps}
              crop={full}
            />
          </div>
          {metrics && (
            <pre
              data-testid="debug-metrics"
              className="max-h-[32rem] overflow-auto rounded bg-surface-2 p-3 text-xs"
            >
              {JSON.stringify(
                { ...metrics, maps: undefined },
                (_k, v) =>
                  typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v,
                2,
              )}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
