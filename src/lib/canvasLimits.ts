const SAFE_AREA = 16_000_000;

export function canvasCanHold(w: number, h: number): boolean {
  if (w * h <= SAFE_AREA) return true;
  try {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return false;
    ctx.fillStyle = "#000";
    ctx.fillRect(w - 1, h - 1, 1, 1);
    const ok = ctx.getImageData(w - 1, h - 1, 1, 1).data[3] === 255;
    c.width = c.height = 0;
    return ok;
  } catch {
    return false;
  }
}
