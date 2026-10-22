import type { ProgressInfo } from "../engine/types";

export function formatBytes(n: number): string {
  return n < 1048576
    ? `${Math.round(n / 1024)} KB`
    : `${(n / 1048576).toFixed(1)} MB`;
}

export function formatSeconds(s: number): string {
  return s < 60
    ? `${Math.ceil(s)}s`
    : `${Math.floor(s / 60)}m ${Math.ceil(s % 60)}s`;
}

export function modelProgressText(
  p: ProgressInfo,
  afterDownload: string,
): string {
  return p.percent < 100
    ? `Downloading model… ${formatBytes(p.loaded)} / ${formatBytes(p.total)}`
    : afterDownload;
}
