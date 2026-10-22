import { useRef, useState, type ReactNode } from "react";

interface Props {
  before: ReactNode;
  after: ReactNode;
  className?: string;
}

export function CompareSlider({ before, after, className = "" }: Props) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const setFromPointer = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };

  return (
    <div className={`relative select-none ${className}`}>
      <div
        ref={ref}
        className="relative cursor-ew-resize"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) setFromPointer(e.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        {after}
        <div
          className="absolute inset-0"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        >
          {before}
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 -ml-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
          style={{ left: `${pos}%` }}
        />
        <span className="pointer-events-none absolute left-2 top-2 rounded-sm bg-black/65 px-1.5 py-0.5 text-xs font-medium text-white">
          Before
        </span>
        <span className="pointer-events-none absolute right-2 top-2 rounded-sm bg-black/65 px-1.5 py-0.5 text-xs font-medium text-white">
          After
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(pos)}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Before/after comparison position"
        className="w-full h-6 mt-2 cursor-pointer"
      />
    </div>
  );
}
