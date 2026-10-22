export const PART_SIZE = 20 * 1024 * 1024

export interface PartsManifest {
  size: number
  sha256: string
  parts: { url: string; size: number; sha256: string }[]
}

export function partsManifestUrl(url: string): string {
  return `${url}.parts.json`
}

export function partUrl(url: string, index: number): string {
  return `${url}.part${String(index).padStart(3, '0')}`
}

export function partRanges(size: number, partSize = PART_SIZE): [number, number][] {
  const out: [number, number][] = []
  for (let start = 0; start < size; start += partSize) out.push([start, Math.min(size, start + partSize)])
  return out
}

export function validatePartsManifest(m: PartsManifest, expected: { size: number; sha256: string }): string | null {
  if (m.size !== expected.size || m.sha256.toLowerCase() !== expected.sha256.toLowerCase()) return 'parts manifest does not describe this model (size or sha256 differ)'
  if (!m.parts.length) return 'parts manifest lists no parts'
  if (m.parts.reduce((a, p) => a + p.size, 0) !== m.size) return 'part sizes do not add up to the file size'
  if (m.parts.some(p => p.size > PART_SIZE || !/^[0-9a-f]{64}$/i.test(p.sha256))) return 'a part is too large or has no valid sha256'
  return null
}
