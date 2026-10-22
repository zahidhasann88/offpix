export interface TilePlan {
  x0: number;
  y0: number;
  w: number;
  h: number;
  overlapLeft: number;
  overlapTop: number;
}

function axisStarts(size: number, tile: number, overlap: number): number[] {
  if (size <= tile) return [0];
  const step = Math.max(1, tile - overlap);
  const starts: number[] = [];
  for (let p = 0; p + tile < size; p += step) starts.push(p);
  starts.push(size - tile);
  return starts;
}

export function planTiles(
  srcW: number,
  srcH: number,
  tileSize: number,
  overlap: number,
): TilePlan[] {
  const xs = axisStarts(srcW, tileSize, overlap);
  const ys = axisStarts(srcH, tileSize, overlap);
  const tw = Math.min(tileSize, srcW);
  const th = Math.min(tileSize, srcH);
  const out: TilePlan[] = [];
  ys.forEach((y0, j) => {
    xs.forEach((x0, i) => {
      out.push({
        x0,
        y0,
        w: tw,
        h: th,
        overlapLeft: i > 0 ? xs[i - 1] + tw - x0 : 0,
        overlapTop: j > 0 ? ys[j - 1] + th - y0 : 0,
      });
    });
  });
  return out;
}

export function ramp(t: number, len: number): number {
  return len > 0 ? Math.min(1, (t + 1) / len) : 1;
}

export function blendTileInto(
  out: Uint8ClampedArray,
  outW: number,
  tile: Float32Array,
  tw: number,
  th: number,
  dx: number,
  dy: number,
  overlapLeft: number,
  overlapTop: number,
): void {
  const plane = tw * th;
  for (let y = 0; y < th; y++) {
    const ay = ramp(y, overlapTop);
    for (let x = 0; x < tw; x++) {
      const a = ay * ramp(x, overlapLeft);
      const si = y * tw + x;
      const di = ((dy + y) * outW + dx + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = tile[c * plane + si] * 255;
        out[di + c] = a >= 1 ? v : out[di + c] * (1 - a) + v * a;
      }
    }
  }
}
