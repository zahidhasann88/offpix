const CACHE_NAME = "offpix-models-v1";
const SHA_HEADER = "X-Model-Sha256";
const SIZE_HEADER = "X-Model-Size";

function openModelCache(): Promise<Cache> {
  return caches.open(CACHE_NAME);
}

export async function cacheHas(url: string, sha256?: string): Promise<boolean> {
  const cache = await openModelCache();
  const res = await cache.match(url);
  if (!res) return false;
  if (!sha256) return true;
  return res.headers.get(SHA_HEADER)?.toLowerCase() === sha256.toLowerCase();
}

export async function cacheGet(
  url: string,
  sha256?: string,
): Promise<ArrayBuffer | null> {
  const cache = await openModelCache();
  const res = await cache.match(url);
  if (!res) return null;
  if (
    sha256 &&
    res.headers.get(SHA_HEADER)?.toLowerCase() !== sha256.toLowerCase()
  )
    return null;
  return res.arrayBuffer();
}

export async function cachePut(
  url: string,
  data: ArrayBuffer,
  sha256: string,
): Promise<void> {
  const cache = await openModelCache();
  const res = new Response(data, {
    headers: {
      "Content-Type": "application/octet-stream",
      [SHA_HEADER]: sha256,
      [SIZE_HEADER]: String(data.byteLength),
    },
  });
  await cache.put(url, res);
}

export async function cacheDelete(url: string): Promise<void> {
  const cache = await openModelCache();
  await cache.delete(url);
}

export async function cacheClear(): Promise<void> {
  await caches.delete(CACHE_NAME);
}

export interface CachedModelInfo {
  url: string;
  size: number;
}

export async function cacheList(): Promise<CachedModelInfo[]> {
  const cache = await openModelCache();
  const keys = await cache.keys();
  const out: CachedModelInfo[] = [];
  for (const req of keys) {
    const res = await cache.match(req);
    if (!res) continue;
    const size =
      Number(res.headers.get(SIZE_HEADER)) ||
      (await res.arrayBuffer()).byteLength;
    out.push({ url: req.url, size });
  }
  return out;
}
