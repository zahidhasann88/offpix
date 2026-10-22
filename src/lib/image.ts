import type { ImageInput } from "../engine/workerApi";
import { unsupportedFileError } from "../engine/errors";

export const SUPPORTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const ACCEPT = SUPPORTED_TYPES.join(",");

export async function fileToImageInput(file: File): Promise<ImageInput> {
  const buffer = await file.arrayBuffer();
  return { buffer, mimeType: file.type || "image/png" };
}

function isImageFile(file: File): boolean {
  return SUPPORTED_TYPES.includes(file.type);
}

export async function decodeImageFile(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw unsupportedFileError(
      "The image could not be decoded. It may be corrupt or in an unsupported format.",
    );
  }
}

export function partitionFiles(files: File[]): {
  accepted: File[];
  rejectedMessage: string | null;
} {
  const accepted = files.filter(isImageFile);
  const rejected = files.filter((f) => !isImageFile(f));
  if (!rejected.length) return { accepted, rejectedMessage: null };
  const names = rejected
    .slice(0, 3)
    .map((f) => f.name || "pasted item")
    .join(", ");
  const more = rejected.length > 3 ? ` and ${rejected.length - 3} more` : "";
  return {
    accepted,
    rejectedMessage: `Skipped ${names}${more}: only PNG, JPEG and WebP images are supported.`,
  };
}
