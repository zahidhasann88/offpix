import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type React from "react";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Info,
  Loader2,
  RotateCcw,
  TriangleAlert,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { ACCEPT } from "../lib/image";

export const ICON = { sm: 16, md: 20, lg: 24 } as const;

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-hover font-semibold shadow-sm",
  secondary:
    "border border-border-strong bg-surface text-fg hover:bg-surface-2 active:bg-surface-3",
  ghost: "text-fg hover:bg-surface-2 active:bg-surface-3",
  danger:
    "border border-danger/40 bg-surface text-danger hover:bg-danger-bg active:bg-danger-bg",
};

interface ButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  variant?: Variant;
  size?: "sm" | "md";
  icon?: LucideIcon;
  iconOnly?: boolean;
  label?: string;
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  iconOnly,
  label,
  loading,
  block,
  children,
  className = "",
  disabled,
  ...rest
}: ButtonProps) {
  const sizeCls = iconOnly
    ? size === "sm"
      ? "h-10 w-10 sm:h-8 sm:w-8"
      : "h-10 w-10"
    : size === "sm"
      ? "h-10 sm:h-8 px-3 text-sm gap-1.5"
      : "h-10 px-4 text-sm gap-2";
  const button = (
    <button
      type="button"
      disabled={disabled || loading}
      aria-label={iconOnly ? label : undefined}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center rounded transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 ${focusRing} ${VARIANT[variant]} ${sizeCls} ${block ? "min-w-0 flex-auto whitespace-nowrap" : "shrink-0"} ${className}`}
      {...rest}
    >
      {loading ? (
        <Loader2
          size={ICON.sm}
          aria-hidden
          className="shrink-0 motion-safe:animate-spin"
        />
      ) : (
        Icon && (
          <Icon
            size={iconOnly && size === "md" ? ICON.md : ICON.sm}
            aria-hidden
            className="shrink-0"
          />
        )
      )}
      {!iconOnly && children}
    </button>
  );
  return iconOnly && label ? <Tooltip text={label}>{button}</Tooltip> : button;
}

export function Tooltip({
  text,
  children,
  side = "bottom",
}: {
  text: string;
  children: ReactNode;
  side?: "top" | "bottom";
}) {
  return (
    <span className="relative inline-flex group/tt">
      {children}
      <span
        aria-hidden
        className={`pointer-events-none absolute left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded bg-fg px-2 py-1 text-xs font-medium text-bg opacity-0 shadow-md transition-opacity duration-100 group-hover/tt:opacity-100 group-has-[:focus-visible]/tt:opacity-100 ${side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}
      >
        {text}
      </span>
    </span>
  );
}

export interface Segment<T extends string | number> {
  value: T;
  label: ReactNode;
  title?: string;
  icon?: LucideIcon;
}

export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
  size = "md",
  nowrap,
  ...rest
}: {
  label: string;
  options: Segment<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  nowrap?: boolean;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "onChange">) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex max-w-full shrink-0 gap-0.5 rounded-md bg-surface-3 p-0.5 ${nowrap ? "flex-nowrap" : "flex-wrap"}`}
      {...rest}
    >
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`inline-flex min-w-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 text-sm transition-colors duration-150 ${size === "sm" ? "h-9 sm:h-7" : "h-10 sm:h-8"} ${focusRing} ${on ? "bg-surface font-medium text-fg shadow-sm" : "text-muted hover:text-fg"}`}
          >
            {Icon && <Icon size={ICON.sm} aria-hidden className="shrink-0" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
      {children}
    </label>
  );
}

export function Select({
  id,
  label,
  value,
  onChange,
  children,
  hint,
  inline,
  hideLabel,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  hint?: ReactNode;
  inline?: boolean;
  hideLabel?: boolean;
}) {
  return (
    <div
      className={inline ? "flex items-center gap-3" : "flex flex-col gap-1.5"}
    >
      {hideLabel ? (
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
      ) : (
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
      )}
      <div className={`relative ${inline ? "" : "w-full"}`}>
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`h-10 w-full min-w-0 appearance-none rounded border border-border-strong bg-surface py-0 pl-3 pr-9 text-sm text-fg hover:border-muted/60 ${focusRing}`}
        >
          {children}
        </select>
        <ChevronDown
          size={ICON.sm}
          aria-hidden
          className="absolute -translate-y-1/2 pointer-events-none right-3 top-1/2 text-muted"
        />
      </div>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Slider({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = String,
  defaultValue,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  defaultValue?: number;
  hint?: ReactNode;
}) {
  const labelId = `${id}-label`;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm min-h-6">
        <label htmlFor={id} id={labelId} className="font-medium text-fg">
          {label}
        </label>
        <span className="flex items-center gap-1">
          <span className="tabular-nums text-muted">{format(value)}</span>
          {defaultValue !== undefined && value !== defaultValue && (
            <Tooltip text="Reset to default">
              <button
                type="button"
                onClick={() => onChange(defaultValue)}
                aria-label="Reset to default"
                aria-describedby={labelId}
                className={`inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg ${focusRing}`}
              >
                <RotateCcw size={14} aria-hidden />
              </button>
            </Tooltip>
          )}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`h-6 w-full cursor-pointer accent-accent ${focusRing} rounded`}
      />
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  id?: string;
}) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={cid}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded-sm accent-accent ${focusRing}`}
      />
      <div className="min-w-0">
        <label
          htmlFor={cid}
          className="text-sm font-medium cursor-pointer text-fg"
        >
          {label}
        </label>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  title?: string;
}) {
  const id = useId();
  return (
    <span className="inline-flex items-center gap-2" title={title}>
      <span className="relative inline-flex h-5 w-9 shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className={`peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full bg-border-strong transition-colors checked:bg-accent ${focusRing}`}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 peer-checked:translate-x-4"
        />
      </span>
      <label htmlFor={id} className="text-xs cursor-pointer text-muted">
        {label}
      </label>
    </span>
  );
}

export function Card({
  children,
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={`rounded-lg border border-border bg-surface p-4 shadow-xs ${className}`}
      {...rest}
    >
      {children}
    </section>
  );
}

export function Section({
  id,
  title,
  actions,
  children,
}: {
  id: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="pb-5 space-y-3 border-b border-border last:border-b-0 last:pb-0"
    >
      <div className="flex items-center justify-between gap-2 min-h-8">
        <h2
          id={id}
          className="text-xs font-semibold tracking-wide uppercase text-muted"
        >
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Workspace({
  toolbar,
  preview,
  caption,
  actions,
  children,
}: {
  toolbar?: ReactNode;
  preview: ReactNode;
  caption?: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[45dvh_minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_23rem]">
      <div className="flex flex-col min-w-0 min-h-0 gap-2">
        <div className="flex items-center h-10 gap-2 overflow-x-auto shrink-0">
          {toolbar}
        </div>
        <div className="relative flex-1 min-h-0">{preview}</div>
        <p className="h-4 text-xs truncate shrink-0 text-muted">{caption}</p>
      </div>
      <aside
        aria-label="Controls"
        className="flex flex-col min-h-0 overflow-hidden border rounded-lg shadow-xs border-border bg-surface"
      >
        <div className="flex order-last gap-2 p-3 border-t shrink-0 border-border bg-surface lg:order-first lg:border-b lg:border-t-0">
          {actions}
        </div>
        <div className="flex-1 min-h-0 p-4 space-y-5 overflow-y-auto">
          {children}
        </div>
      </aside>
    </div>
  );
}

export function Disclosure({
  id,
  summary,
  children,
}: {
  id: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <details id={id} className="pt-3 border-t group/disc border-border">
      <summary
        className={`flex h-10 cursor-pointer select-none list-none items-center justify-between rounded text-sm font-medium text-fg sm:h-8 [&::-webkit-details-marker]:hidden ${focusRing}`}
      >
        {summary}
        <ChevronDown
          size={ICON.sm}
          aria-hidden
          className="transition-transform duration-150 text-muted group-open/disc:rotate-180"
        />
      </summary>
      <div className="mt-3 space-y-4">{children}</div>
    </details>
  );
}

type Tone = "info" | "warning" | "error" | "success";
const TONE: Record<Tone, [string, LucideIcon]> = {
  info: ["border-border bg-surface-2 text-fg", Info],
  warning: ["border-warning/30 bg-warning-bg text-warning", TriangleAlert],
  error: ["border-danger/30 bg-danger-bg text-danger", CircleAlert],
  success: ["border-success/30 bg-success-bg text-success", CircleCheck],
};

export function Notice({
  tone = "info",
  children,
  role,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  role?: "alert" | "note" | "status";
  className?: string;
}) {
  const [cls, Icon] = TONE[tone];
  return (
    <div
      role={role}
      className={`flex items-start gap-2 rounded border px-3 py-2 text-sm ${cls} ${className}`}
    >
      <Icon size={ICON.sm} aria-hidden className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function StatusText({ text }: { text: string }) {
  if (!text) return null;
  if (/^Error/.test(text))
    return (
      <Notice tone="error" role="alert">
        {text}
      </Notice>
    );
  if (/^Skipped/.test(text))
    return (
      <Notice tone="warning" role="alert">
        {text}
      </Notice>
    );
  return (
    <p className="text-sm text-muted" role="status">
      {text}
    </p>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      className="w-full space-y-1.5"
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Progress"}
    >
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${v}%` }}
        />
      </div>
      {label && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Loader2 size={12} aria-hidden className="motion-safe:animate-spin" />
          {label}
        </p>
      )}
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
      className="m-auto max-h-[85vh] w-[min(42rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-border bg-surface p-0 text-fg shadow-lg backdrop:bg-black/50"
    >
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <Button
            variant="ghost"
            icon={X}
            iconOnly
            label="Close"
            onClick={onClose}
          />
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function DropZone({
  onFiles,
  accept = ACCEPT,
  multiple = true,
  label = "Drop images here or choose files",
  hint,
  compact = false,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  label?: string;
  hint?: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      className={`flex cursor-pointer items-center justify-center rounded-lg border border-dashed text-center transition-colors duration-150 ${focusRing} ${
        compact ? "min-h-12 gap-2 px-4 py-2" : "flex-col gap-3 px-6 py-14"
      } ${drag ? "border-accent bg-accent-subtle" : "border-border-strong bg-surface hover:border-muted/70 hover:bg-surface-2"}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
    >
      {compact ? (
        <Upload size={ICON.sm} aria-hidden className="text-muted" />
      ) : (
        <span className="flex items-center justify-center w-12 h-12 rounded-full bg-surface-3 text-muted">
          <Upload size={ICON.lg} aria-hidden />
        </span>
      )}
      <div>
        <p
          className={
            compact ? "text-sm text-fg" : "text-base font-semibold text-fg"
          }
        >
          {label}
        </p>
        {hint && !compact && <p className="mt-1 text-sm text-muted">{hint}</p>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export type Stage =
  | "prepare"
  | "download"
  | "run"
  | "refine"
  | "encode"
  | "tiles";
export const STAGE_LABEL: Record<Stage, string> = {
  prepare: "Preparing image",
  download: "Downloading model",
  run: "Running model",
  refine: "Refining edges",
  encode: "Encoding result",
  tiles: "Running model",
};

export interface Activity {
  stage: Stage;
  percent?: number;
  detail?: string;
  startedAt: number;
}

function useElapsed(since: number) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(t);
  }, [since]);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ProcessingOverlay({
  activity,
  onCancel,
  error,
  onDismiss,
  box,
}: {
  activity?: Activity | null;
  onCancel?: () => void;
  error?: string | null;
  onDismiss?: () => void;
  box?: { w: number; h: number } | null;
}) {
  if (error) {
    return (
      <div className="absolute inset-0 z-10 flex items-end justify-center p-3 pointer-events-none sm:items-center">
        <div className="pointer-events-auto w-[min(22rem,100%)] rounded-lg border border-border bg-surface p-4 shadow-md">
          <ErrorBody error={error} onDismiss={onDismiss} />
        </div>
      </div>
    );
  }
  if (!activity) return null;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
      <ActivityLayer activity={activity} onCancel={onCancel} box={box} />
    </div>
  );
}

function ActivityLayer({
  activity,
  onCancel,
  box,
}: {
  activity: Activity;
  onCancel?: () => void;
  box?: { w: number; h: number } | null;
}) {
  const elapsed = useElapsed(activity.startedAt);
  const label = STAGE_LABEL[activity.stage];
  const determinate = activity.percent !== undefined;
  const pct = determinate ? Math.max(0, Math.min(100, activity.percent!)) : 0;
  return (
    <div
      className={`relative overflow-hidden rounded-lg ${box ? "" : "h-full w-full"}`}
      style={box ? { width: box.w, height: box.h } : undefined}
    >
      {/* Full-height layer whose gradient ends in a bright line; translating it by its own height sweeps the line top to bottom. */}
      <div
        aria-hidden
        className="absolute inset-0 hidden bg-[linear-gradient(to_bottom,transparent_70%,rgb(var(--accent)/0.14)_97%,rgb(var(--accent)/0.85)_99.5%,transparent)] motion-safe:block motion-safe:animate-scan"
      />
      <div
        className="pointer-events-auto absolute left-2 top-2 flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-full border border-border bg-surface py-1 pl-3 pr-1 text-xs shadow-sm"
        data-testid="progress-panel"
      >
        <span
          aria-hidden
          className="w-2 h-2 rounded-full shrink-0 bg-accent motion-safe:animate-pulse"
        />
        <p
          className="font-semibold shrink-0 text-fg"
          data-testid="progress-stage"
        >
          {label}
          {determinate ? ` ${Math.round(pct)}%` : ""}
        </p>
        {activity.detail && (
          <p className="min-w-0 truncate text-muted">{activity.detail}</p>
        )}
        <span
          className="shrink-0 tabular-nums text-muted"
          aria-label={`Elapsed ${elapsed}`}
        >
          {elapsed}
        </span>
        {onCancel ? (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={X}
            label="Cancel"
            onClick={onCancel}
          />
        ) : (
          <span className="w-1" />
        )}
      </div>
      <div
        className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-surface-3/60"
        role="progressbar"
        aria-label={label}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? 100 : undefined}
        aria-valuenow={determinate ? Math.round(pct) : undefined}
      >
        {determinate ? (
          <div
            className="h-full bg-accent transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="w-1/3 h-full bg-accent motion-safe:animate-indeterminate motion-reduce:w-full motion-reduce:opacity-50" />
        )}
      </div>
    </div>
  );
}

function ErrorBody({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss?: () => void;
}) {
  return (
    <div role="alert" className="flex items-start gap-2 text-sm text-danger">
      <CircleAlert size={ICON.md} aria-hidden className="mt-0.5 shrink-0" />
      <p className="flex-1 min-w-0">{error}</p>
      {onDismiss && (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={X}
          label="Dismiss"
          onClick={onDismiss}
        />
      )}
    </div>
  );
}

export function StageAnnouncer({ activity }: { activity?: Activity | null }) {
  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {activity ? STAGE_LABEL[activity.stage] : ""}
    </p>
  );
}

export function ProgressRing({
  percent,
  size = 16,
}: {
  percent?: number;
  size?: number;
}) {
  const p = percent === undefined ? 30 : Math.max(0, Math.min(100, percent));
  return (
    <span
      aria-hidden
      className={`inline-block rounded-full ${percent === undefined ? "motion-safe:animate-spin" : ""}`}
      style={{
        width: size,
        height: size,
        background: `conic-gradient(rgb(var(--accent)) ${p * 3.6}deg, rgb(var(--surface-3)) 0)`,
        WebkitMask: "radial-gradient(farthest-side, transparent 55%, #000 57%)",
        mask: "radial-gradient(farthest-side, transparent 55%, #000 57%)",
      }}
    />
  );
}

export function useFitSize(aspect: number | null, reserveH = 0) {
  // Callback ref: the element can mount after the hook (e.g. once an image is loaded).
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!el) return;
    const measure = () =>
      setBox((prev) =>
        prev && prev.w === el.clientWidth && prev.h === el.clientHeight
          ? prev
          : { w: el.clientWidth, h: el.clientHeight },
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  let size: { w: number; h: number } | null = null;
  if (box && aspect) {
    const h = Math.max(0, box.h - reserveH);
    const w = Math.min(box.w, h * aspect);
    size = { w: Math.floor(w), h: Math.floor(w / aspect) };
  }
  return { ref, size };
}
