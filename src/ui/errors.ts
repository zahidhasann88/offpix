export function describeError(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  const msg = e instanceof Error ? e.message : String(e);
  switch (name) {
    case "CancelledError":
      return "Cancelled.";
    case "ModelDownloadError":
      return `Error: ${msg}. Check your connection and try again.`;
    case "ModelIntegrityError":
      return `Error: ${msg}. The download was corrupted; clear downloaded models and retry.`;
    case "ModelLoadError":
      return `Error: ${msg}. Try the smaller model, or reload the page.`;
    case "OutOfMemoryError":
      return "Error: ran out of memory. Use a smaller tile size, the smaller model, or a smaller image.";
    case "UnsupportedFileError":
    case "ImageTooLargeError":
      return `Error: ${msg}`;
    default:
      return `Error: ${msg}`;
  }
}
