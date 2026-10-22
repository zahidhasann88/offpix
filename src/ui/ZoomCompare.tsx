import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "./kit";
import {
  clampView,
  fitView,
  panBy,
  scaleLimits,
  visibleRegion,
  zoomAt,
  type Size,
  type View,
} from "../lib/viewport";

interface Props {
  after: CanvasImageSource;
  afterSize: Size;
  before?: CanvasImageSource;
  beforeSize?: Size;
  label: string;
}

const DIVIDER_GRAB_PX = 18;

export function ZoomCompare({
  after,
  afterSize,
  before,
  beforeSize,
  label,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [vp, setVp] = useState<Size | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [split, setSplit] = useState(0.5);
  const drag = useRef<{ mode: "pan" | "split"; x: number; y: number } | null>(
    null,
  );
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current!;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setVp((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [afterSize.w, afterSize.h]);

  useEffect(() => {
    setView(null);
  }, [after]);
  const current = vp
    ? view
      ? clampView(view, afterSize, vp)
      : fitView(afterSize, vp)
    : null;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !vp || !current) return;
    const dpr = window.devicePixelRatio || 1;
    if (
      canvas.width !== Math.round(vp.w * dpr) ||
      canvas.height !== Math.round(vp.h * dpr)
    ) {
      canvas.width = Math.round(vp.w * dpr);
      canvas.height = Math.round(vp.h * dpr);
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vp.w, vp.h);
    ctx.imageSmoothingQuality = "high";
    ctx.imageSmoothingEnabled = current.scale < 4;
    const r = visibleRegion(current, afterSize, vp);
    if (r.sw <= 0 || r.sh <= 0) return;
    ctx.drawImage(after, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
    if (before && beforeSize) {
      const k = beforeSize.w / afterSize.w;
      const x = split * vp.w;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, x, vp.h);
      ctx.clip();
      ctx.clearRect(0, 0, x, vp.h);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        before,
        r.sx * k,
        r.sy * k,
        r.sw * k,
        r.sh * k,
        r.dx,
        r.dy,
        r.dw,
        r.dh,
      );
      ctx.restore();
      ctx.fillStyle = "#fff";
      ctx.fillRect(x - 1, 0, 2, vp.h);
      ctx.beginPath();
      ctx.arc(x, vp.h / 2, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.stroke();
    }
  }, [after, afterSize, before, beforeSize, current, split, vp]);

  useEffect(() => {
    const id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [draw]);

  const update = (fn: (v: View) => View) => {
    if (!vp) return;
    setView((v) =>
      fn(v ? clampView(v, afterSize, vp) : fitView(afterSize, vp)),
    );
  };
  const zoomBy = (factor: number, px?: number, py?: number) =>
    update((v) =>
      zoomAt(v, factor, px ?? vp!.w / 2, py ?? vp!.h / 2, afterSize, vp!),
    );

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomBy(
        Math.exp(-e.deltaY * 0.0015),
        e.clientX - r.left,
        e.clientY - r.top,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const local = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
      drag.current = null;
      return;
    }
    const nearDivider =
      before && vp && Math.abs(p.x - split * vp.w) < DIVIDER_GRAB_PX;
    drag.current = { mode: nearDivider ? "split" : "pan", x: p.x, y: p.y };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    if (!pointers.current.has(e.pointerId)) {
      e.currentTarget.style.cursor =
        before && vp && Math.abs(p.x - split * vp.w) < DIVIDER_GRAB_PX
          ? "ew-resize"
          : "grab";
      return;
    }
    pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      zoomBy(dist / pinch.current.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch.current.dist = dist;
      return;
    }
    const d = drag.current;
    if (!d || !vp) return;
    if (d.mode === "split") setSplit(Math.min(1, Math.max(0, p.x / vp.w)));
    else update((v) => panBy(v, p.x - d.x, p.y - d.y, afterSize, vp));
    d.x = p.x;
    d.y = p.y;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 60;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => update((v) => panBy(v, step, 0, afterSize, vp!)),
      ArrowRight: () => update((v) => panBy(v, -step, 0, afterSize, vp!)),
      ArrowUp: () => update((v) => panBy(v, 0, step, afterSize, vp!)),
      ArrowDown: () => update((v) => panBy(v, 0, -step, afterSize, vp!)),
      "+": () => zoomBy(1.25),
      "=": () => zoomBy(1.25),
      "-": () => zoomBy(0.8),
      "0": () => setView(null),
    };
    const fn = keys[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  };

  const limits = vp ? scaleLimits(afterSize, vp) : null;

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <div
        ref={wrapRef}
        className="relative flex-1 min-h-0 overflow-hidden border rounded-lg border-border bg-surface-2"
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label={`${label}. Drag to pan, scroll or pinch to zoom${before ? ", drag the divider to compare" : ""}. Arrow keys pan, plus and minus zoom, 0 fits.`}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            touchAction: "none",
            display: "block",
          }}
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (current && vp && current.scale < 1)
              zoomBy(1 / current.scale, e.clientX - r.left, e.clientY - r.top);
            else setView(null);
          }}
          onKeyDown={onKeyDown}
        />
        {before && (
          <>
            <span className="pointer-events-none absolute left-2 top-2 rounded-sm bg-black/65 px-1.5 py-0.5 text-xs font-medium text-white">
              Before
            </span>
            <span className="pointer-events-none absolute right-2 top-2 rounded-sm bg-black/65 px-1.5 py-0.5 text-xs font-medium text-white">
              After
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 overflow-x-auto shrink-0">
        <Button
          size="sm"
          iconOnly
          icon={ZoomOut}
          label="Zoom out"
          onClick={() => zoomBy(0.8)}
          disabled={!current || !limits || current.scale <= limits.min + 1e-6}
        />
        <span
          className="text-sm text-center w-14 tabular-nums text-muted"
          aria-live="polite"
          aria-label="Zoom level"
        >
          {current ? `${Math.round(current.scale * 100)}%` : ""}
        </span>
        <Button
          size="sm"
          iconOnly
          icon={ZoomIn}
          label="Zoom in"
          onClick={() => zoomBy(1.25)}
          disabled={!current || !limits || current.scale >= limits.max - 1e-6}
        />
        <Button size="sm" icon={Maximize} onClick={() => setView(null)}>
          Fit
        </Button>
        <Button size="sm" onClick={() => update((v) => ({ ...v, scale: 1 }))}>
          100%
        </Button>
        {before && (
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(split * 100)}
            onChange={(e) => setSplit(Number(e.target.value) / 100)}
            aria-label="Before/after comparison position"
            className="w-40 h-6 ml-auto cursor-pointer"
          />
        )}
      </div>
    </div>
  );
}
