export const CAP_MP = { lowMemory: 12, unknown: 16, default: 24 } as const;

export function maxProcessingPixels(deviceMemory: number | undefined): number {
  const mp =
    deviceMemory === undefined
      ? CAP_MP.unknown
      : deviceMemory <= 4
        ? CAP_MP.lowMemory
        : CAP_MP.default;
  return mp * 1e6;
}

export function processingSize(
  w: number,
  h: number,
  maxPixels: number,
): { w: number; h: number; capped: boolean } {
  if (w * h <= maxPixels) return { w, h, capped: false };
  const k = Math.sqrt(maxPixels / (w * h));
  return {
    w: Math.max(1, Math.floor(w * k)),
    h: Math.max(1, Math.floor(h * k)),
    capped: true,
  };
}
