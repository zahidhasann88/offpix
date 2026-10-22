import type { Rect } from "./maskEdit";
import { cutoutRgba, compositeOver, encodePng } from "./export";

export type BgMode = "transparent" | "color" | "gradient" | "blur" | "image";

export interface BgSettings {
  mode: BgMode;
  color: string;
  gradient: [string, string];
  blur: number;
}

export const defaultBgSettings: BgSettings = {
  mode: "transparent",
  color: "#ffffff",
  gradient: ["#e0e7ff", "#1e3a8a"],
  blur: 15,
};

export type Ctx2D =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export function createCanvas(
  w: number,
  h: number,
): { canvas: AnyCanvas; ctx: Ctx2D } {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    return { canvas, ctx: canvas.getContext("2d")! };
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d")! };
}

export function canvasToBlob(
  canvas: AnyCanvas,
  type: string,
  quality?: number,
): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Export failed"))),
      type,
      quality,
    ),
  );
}

export function blurRadiusPx(blur: number, w: number, h: number): number {
  return (blur / 1000) * Math.max(w, h);
}

export function coverRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
) {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const sw = dstW / scale,
    sh = dstH / scale;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

export function fitSize(
  w: number,
  h: number,
  maxSide: number,
): { w: number; h: number } {
  const s = Math.min(1, maxSide / Math.max(w, h));
  return {
    w: Math.max(1, Math.round(w * s)),
    h: Math.max(1, Math.round(h * s)),
  };
}

export function maskToRgba(
  mask: Float32Array,
  maskW: number,
  rect: Rect,
  out: Uint8ClampedArray,
): void {
  const rw = rect.x1 - rect.x0;
  for (let y = rect.y0; y < rect.y1; y++) {
    let o = (y - rect.y0) * rw * 4;
    for (let x = rect.x0; x < rect.x1; x++, o += 4) {
      out[o] = out[o + 1] = out[o + 2] = 0;
      out[o + 3] = mask[y * maskW + x] * 255;
    }
  }
}

export function updateMaskCanvas(
  ctx: Ctx2D,
  mask: Float32Array,
  w: number,
  h: number,
  rect: Rect = { x0: 0, y0: 0, x1: w, y1: h },
): void {
  const img = ctx.createImageData(rect.x1 - rect.x0, rect.y1 - rect.y0);
  maskToRgba(mask, w, rect, img.data);
  ctx.putImageData(img, rect.x0, rect.y0);
}

function drawBlurred(
  ctx: Ctx2D,
  src: CanvasImageSource,
  w: number,
  h: number,
  radius: number,
): void {
  if (typeof ctx.filter === "string") {
    // Draw slightly oversized so edges don't blur into transparency.
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(
      src,
      -radius * 2,
      -radius * 2,
      w + radius * 4,
      h + radius * 4,
    );
    ctx.filter = "none";
    return;
  }
  // No canvas filter support (older Safari): approximate by down- then up-sampling.
  const k = Math.max(1, radius / 2);
  const small = createCanvas(
    Math.max(1, Math.round(w / k)),
    Math.max(1, Math.round(h / k)),
  );
  small.ctx.imageSmoothingQuality = "high";
  small.ctx.drawImage(src, 0, 0, small.canvas.width, small.canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small.canvas, 0, 0, w, h);
}

function drawBackground(
  ctx: Ctx2D,
  w: number,
  h: number,
  original: CanvasImageSource,
  settings: BgSettings,
  bgImage: ImageBitmap | null,
): void {
  switch (settings.mode) {
    case "color":
      ctx.fillStyle = settings.color;
      ctx.fillRect(0, 0, w, h);
      break;
    case "gradient": {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, settings.gradient[0]);
      g.addColorStop(1, settings.gradient[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case "blur":
      drawBlurred(ctx, original, w, h, blurRadiusPx(settings.blur, w, h));
      break;
    case "image":
      if (bgImage) {
        const r = coverRect(bgImage.width, bgImage.height, w, h);
        ctx.drawImage(bgImage, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
      }
      break;
    case "transparent":
      break;
  }
}

export function renderComposite(
  ctx: Ctx2D,
  w: number,
  h: number,
  original: CanvasImageSource,
  maskCanvas: CanvasImageSource,
  settings: BgSettings,
  bgImage: ImageBitmap | null,
  foreground: CanvasImageSource = original,
): void {
  ctx.clearRect(0, 0, w, h);
  drawBackground(ctx, w, h, original, settings, bgImage);
  const fg = createCanvas(w, h);
  fg.ctx.drawImage(foreground, 0, 0, w, h);
  fg.ctx.globalCompositeOperation = "destination-in";
  fg.ctx.drawImage(maskCanvas, 0, 0, w, h);
  ctx.drawImage(fg.canvas, 0, 0);
}

export type ExportFormat = "png" | "webp";

export async function exportCutout(
  original: ImageBitmap,
  fg: Uint8ClampedArray,
  alpha: Float32Array,
  w: number,
  h: number,
  settings: BgSettings,
  bgImage: ImageBitmap | null,
  format: ExportFormat,
  quality: number,
): Promise<Blob> {
  const transparent =
    settings.mode === "transparent" || (settings.mode === "image" && !bgImage);
  let rgba: Uint8ClampedArray<ArrayBuffer>;
  if (transparent) {
    rgba = cutoutRgba(fg, alpha);
  } else {
    const { ctx } = createCanvas(w, h);
    drawBackground(ctx, w, h, original, settings, bgImage);
    rgba = compositeOver(ctx.getImageData(0, 0, w, h).data, fg, alpha);
  }
  if (format === "png")
    return new Blob([encodePng(rgba, w, h)], { type: "image/png" });
  const { canvas, ctx } = createCanvas(w, h);
  ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  return canvasToBlob(canvas, "image/webp", quality);
}
