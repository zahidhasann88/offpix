import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { engine } from "./engine/client";
import type { BackendInfo, EngineInfo } from "./engine/workerApi";
import { loadSetting, saveSetting } from "./lib/settings";
import { AboutDialog } from "./ui/AboutDialog";
import { BackgroundRemover } from "./ui/BackgroundRemover";
import { Upscaler } from "./ui/Upscaler";
import { ObjectCounter } from "./ui/ObjectCounter";
import { describeError } from "./ui/errors";
import { cacheRuntimeForOffline, isOfflineCapable } from "./lib/serviceWorker";
import {
  CircleCheck,
  Expand,
  Info,
  Moon,
  ScanSearch,
  Scissors,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { Button, ICON, Notice, Switch } from "./ui/kit";

const DebugView = import.meta.env.DEV
  ? lazy(() => import("./debug/DebugView"))
  : null;
const debugMode =
  !!DebugView && new URLSearchParams(location.search).has("debug");

type Tool = "remove" | "upscale" | "count";

const TOOLS: { id: Tool; label: string; icon: LucideIcon }[] = [
  { id: "remove", label: "Remove background", icon: Scissors },
  { id: "upscale", label: "Upscale", icon: Expand },
  { id: "count", label: "Count objects", icon: ScanSearch },
];

function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    loadSetting<"light" | "dark">(
      "theme",
      window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
    ),
  );
  const [tool, setTool] = useState<Tool>(() =>
    loadSetting<Tool>("tool", "remove"),
  );
  const [aboutOpen, setAboutOpen] = useState(false);
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [backend, setBackend] = useState<BackendInfo | null>(null);
  const [useGpu, setUseGpu] = useState(() => loadSetting("useGpu", true));
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [cacheTotal, setCacheTotal] = useState(0);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    saveSetting("theme", theme);
  }, [theme]);
  useEffect(() => {
    saveSetting("tool", tool);
  }, [tool]);
  useEffect(() => {
    saveSetting("useGpu", useGpu);
    engine.setGpuEnabled(useGpu).then(
      () => setBackend(null),
      () => {},
    );
  }, [useGpu]);

  const refreshCached = useCallback(async () => {
    try {
      setCached(await engine.modelStatus());
      setCacheTotal((await engine.cacheInfo()).total);
    } catch {
      // Cache API unavailable (e.g. some private modes); models are simply re-downloaded.
    }
  }, []);

  useEffect(() => {
    engine
      .init()
      .then(setEngineInfo)
      .catch((e) => setEngineError(describeError(e)));
    refreshCached();
  }, [refreshCached]);

  const clearCache = async () => {
    await engine.clearCache();
    refreshCached();
  };

  const backendLabel = backend
    ? backend.backend === "webgpu"
      ? "Running on GPU (WebGPU)"
      : `Running on CPU (WASM, ${backend.backend === "wasm" ? `${engineInfo?.threads ?? 1} threads` : "single thread"})`
    : engineInfo
      ? engineInfo.webgpu
        ? useGpu
          ? "GPU available"
          : "GPU off"
        : engineInfo.webgpuInBuild
          ? "CPU only (no WebGPU)"
          : "CPU (WASM)"
      : "";

  const onModelsChanged = useCallback(() => {
    refreshCached();
    cacheRuntimeForOffline();
  }, [refreshCached]);
  const toolProps = { cached, onModelsChanged, onBackend: setBackend };
  const caps = {
    webgpu: !!engineInfo?.webgpu,
    gpuEnabled: useGpu,
    ready: !!engineInfo,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number })
      .deviceMemory,
    adapter: engineInfo?.adapter,
  };
  const offlineReady =
    isOfflineCapable() && Object.values(cached).some(Boolean);

  const tablist = (cls: string) => (
    <div
      className={cls}
      role="tablist"
      aria-label="Tool"
      onKeyDown={(e) => {
        const i = TOOLS.findIndex((t) => t.id === tool);
        const next = {
          ArrowRight: i + 1,
          ArrowLeft: i - 1,
          Home: 0,
          End: TOOLS.length - 1,
        }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        const t = TOOLS[(next + TOOLS.length) % TOOLS.length];
        setTool(t.id);
        document.getElementById(`tab-${t.id}`)?.focus();
      }}
    >
      {TOOLS.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tool === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tool === t.id ? 0 : -1}
            onClick={() => setTool(t.id)}
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-[5px] px-2 py-1 text-center text-[13px] font-medium leading-tight transition-colors duration-150 md:h-9 md:min-h-0 md:whitespace-nowrap md:px-3 md:text-sm ${tool === t.id ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}
          >
            <Icon
              size={ICON.sm}
              aria-hidden
              className="hidden shrink-0 md:block"
            />
            {t.label}
          </button>
        );
      })}
    </div>
  );
  const wide =
    typeof window !== "undefined" &&
    window.matchMedia?.("(min-width: 768px)").matches;
  const [isWide, setIsWide] = useState(wide);
  useEffect(() => {
    const mq = window.matchMedia?.("(min-width: 768px)");
    if (!mq) return;
    const on = () => setIsWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return (
    <div className="flex flex-col overflow-hidden h-dvh">
      <header className="border-b shrink-0 border-border bg-surface">
        <div className="flex items-center justify-between gap-3 px-3 mx-auto h-14 max-w-screen-2xl md:px-4">
          <div className="flex items-center min-w-0 gap-4">
            <h1 className="text-base font-bold tracking-tight">offpix</h1>
            {isWide && tablist("flex gap-0.5 rounded-md bg-surface-3 p-0.5")}
          </div>
          <div className="flex items-center gap-1 sm:gap-3">
            <span
              className="hidden text-xs text-muted xl:inline"
              role="status"
              title={backend?.fallbackReason}
            >
              {backendLabel}
            </span>
            {offlineReady && (
              <span className="items-center hidden gap-1 text-xs text-success md:inline-flex">
                <CircleCheck size={14} aria-hidden />
                Ready to work offline
              </span>
            )}
            {engineInfo?.webgpu && (
              <Switch
                checked={useGpu}
                onChange={setUseGpu}
                label="Use GPU"
                title="Turn off if results look wrong on this device"
              />
            )}
            <Button
              variant="ghost"
              iconOnly
              icon={theme === "light" ? Moon : Sun}
              label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
              onClick={() =>
                setTheme((t) => (t === "light" ? "dark" : "light"))
              }
            />
            <Button
              variant="ghost"
              icon={Info}
              onClick={() => setAboutOpen(true)}
              className="px-2 sm:px-3"
            >
              About
            </Button>
          </div>
        </div>
      </header>

      <main className="flex flex-col flex-1 w-full min-h-0 gap-3 px-3 pt-3 pb-3 mx-auto max-w-screen-2xl md:px-4">
        {!isWide &&
          tablist(
            "grid w-full shrink-0 grid-cols-3 gap-0.5 rounded-md bg-surface-3 p-0.5",
          )}
        {engineError && (
          <Notice tone="error" role="alert">
            {engineError} Try reloading the page.
          </Notice>
        )}
        {engineInfo && !engineInfo.crossOriginIsolated && (
          <Notice tone="warning">
            Cross-origin isolation is not available, so processing runs on one
            CPU thread and is slower.
          </Notice>
        )}

        <div
          role="tabpanel"
          id={`panel-${tool}`}
          aria-labelledby={`tab-${tool}`}
          className="flex-1 min-h-0"
        >
          {tool === "remove" &&
            (debugMode && DebugView ? (
              <Suspense fallback={null}>
                <div className="h-full overflow-auto">
                  <DebugView />
                </div>
              </Suspense>
            ) : (
              <BackgroundRemover caps={caps} {...toolProps} />
            ))}
          {tool === "upscale" && (
            <Upscaler engineInfo={engineInfo} {...toolProps} />
          )}
          {tool === "count" && <ObjectCounter {...toolProps} />}
        </div>
      </main>

      <AboutDialog
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        cacheTotal={cacheTotal}
        onClearCache={clearCache}
      />
    </div>
  );
}

export default App;
