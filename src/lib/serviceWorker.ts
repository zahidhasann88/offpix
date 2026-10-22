import { ORT_RUNTIME_FILES } from "../buildProfile";

const RELOAD_FLAG = "offpix-coi-reload";

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_FLAG) === "1";
  } catch {
    return true;
  }
}
function writeFlag(): void {
  try {
    sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch {
    /* without storage we just don't reload */
  }
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  const base = import.meta.env.BASE_URL;
  navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base })
    .catch(() => {});

  if (!self.crossOriginIsolated && !readFlag()) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (self.crossOriginIsolated || readFlag()) return;
      writeFlag();
      location.reload();
    });
  }
}

export function isOfflineCapable(): boolean {
  return (
    "serviceWorker" in navigator && navigator.serviceWorker.controller != null
  );
}

const RUNTIME_CACHE = "offpix-runtime-v1";

export async function cacheRuntimeForOffline(): Promise<void> {
  if (!import.meta.env.PROD || typeof caches === "undefined") return;
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    for (const f of ORT_RUNTIME_FILES) {
      const url = `${import.meta.env.BASE_URL}${f}`;
      if (!(await cache.match(url))) await cache.add(url);
    }
  } catch {
    // Best effort: offline use just needs a re-download later.
  }
}
