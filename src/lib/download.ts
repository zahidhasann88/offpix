import { zip, type Zippable } from "fflate";

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function baseName(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  const i = name.lastIndexOf(".");
  const stem = i > 0 ? name.slice(0, i) : name;
  const ext = i > 0 ? name.slice(i) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

export function zipFiles(
  files: { name: string; data: Uint8Array }[],
): Promise<Blob> {
  const entries: Zippable = {};
  const taken = new Set<string>();
  for (const f of files)
    entries[uniqueName(f.name, taken)] = [f.data, { level: 0 }];
  return new Promise((resolve, reject) =>
    zip(entries, (err, data) =>
      err
        ? reject(err)
        : resolve(
            new Blob([data as Uint8Array<ArrayBuffer>], {
              type: "application/zip",
            }),
          ),
    ),
  );
}
