const ENGINE_ERRORS = [
  "CancelledError",
  "ModelDownloadError",
  "ModelIntegrityError",
  "ModelLoadError",
  "OutOfMemoryError",
  "UnsupportedFileError",
  "ImageTooLargeError",
  "GpuOnlyError",
] as const;
type EngineErrorName = (typeof ENGINE_ERRORS)[number];

function make(name: EngineErrorName, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

export const cancelledError = () => make("CancelledError", "Cancelled");
export const modelDownloadError = (msg: string) =>
  make("ModelDownloadError", msg);
export const modelIntegrityError = (msg: string) =>
  make("ModelIntegrityError", msg);
export const modelLoadError = (msg: string) => make("ModelLoadError", msg);
export const outOfMemoryError = (msg: string) => make("OutOfMemoryError", msg);
export const unsupportedFileError = (msg: string) =>
  make("UnsupportedFileError", msg);
export const imageTooLargeError = (msg: string) =>
  make("ImageTooLargeError", msg);

export function isGpuOnlyFailure(e: unknown): boolean {
  return e instanceof Error && e.name === "GpuOnlyError";
}

export function isOutOfMemory(e: unknown): boolean {
  return e instanceof Error && e.name === "OutOfMemoryError";
}

export function isCancelled(e: unknown): boolean {
  return e instanceof Error && e.name === "CancelledError";
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError();
}

export function classifyError(e: unknown): Error {
  if (
    e instanceof Error &&
    (ENGINE_ERRORS as readonly string[]).includes(e.name)
  )
    return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (
    /out of memory|memory access out of bounds|Array buffer allocation failed|allocation size overflow|Invalid typed array length|could not allocate|bad_alloc|bad allocation|Maximum memory size exceeded|Memory\.grow|OOM/i.test(
      msg,
    )
  ) {
    return outOfMemoryError(msg);
  }
  return e instanceof Error ? e : new Error(msg);
}
