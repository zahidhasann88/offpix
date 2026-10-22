import {
  Check,
  CircleAlert,
  Clock,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button, ProgressRing } from "./kit";

export type ItemStatus = "pending" | "processing" | "done" | "error";

export interface StripItem {
  id: string;
  name: string;
  thumb: string;
  status: ItemStatus;
  error?: string;
}

interface Props {
  items: StripItem[];
  selectedId: string | null;
  busy: boolean;
  progress?: number;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

const BADGE: Record<Exclude<ItemStatus, "processing">, [string, LucideIcon]> = {
  done: ["bg-success text-surface", Check],
  error: ["bg-danger text-surface", CircleAlert],
  pending: ["bg-muted text-surface", Clock],
};
const STATUS_TEXT: Record<ItemStatus, string> = {
  pending: "waiting",
  processing: "processing",
  done: "done",
  error: "failed",
};

export function ImageStrip({
  items,
  selectedId,
  busy,
  progress,
  onSelect,
  onRemove,
  onClear,
}: Props) {
  return (
    <div className="flex items-center gap-3 shrink-0">
      <ul
        className="flex flex-1 gap-3 px-2 pt-2 pb-1 overflow-x-auto"
        aria-label="Images"
      >
        {items.map((item) => {
          return (
            <li key={item.id} className="relative shrink-0">
              <button
                onClick={() => onSelect(item.id)}
                aria-current={item.id === selectedId}
                aria-label={`${item.name}: ${STATUS_TEXT[item.status]}`}
                title={item.error ?? item.name}
                className={`block h-16 w-16 overflow-hidden rounded border-2 ${item.id === selectedId ? "border-accent" : "border-border"}`}
              >
                <img
                  src={item.thumb}
                  alt=""
                  className="object-cover w-full h-full"
                />
                {item.status === "processing" ? (
                  <span
                    className="absolute flex items-center justify-center w-5 h-5 rounded-full bottom-1 left-1 bg-surface/90"
                    aria-hidden
                  >
                    <ProgressRing percent={progress} size={14} />
                  </span>
                ) : (
                  <Badge status={item.status} />
                )}
                {item.status === "processing" && (
                  <span
                    className="absolute inset-0 bg-surface/30"
                    aria-hidden
                  />
                )}
              </button>
              <button
                onClick={() => onRemove(item.id)}
                disabled={item.status === "processing"}
                aria-label={`Remove ${item.name}`}
                title={`Remove ${item.name}`}
                className="absolute flex items-center justify-center w-6 h-6 border rounded-full shadow-sm -right-2 -top-2 border-border bg-surface text-muted hover:text-fg disabled:hidden"
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <Button size="sm" icon={Trash2} onClick={onClear} disabled={busy}>
        Clear all
      </Button>
    </div>
  );
}

function Badge({ status }: { status: Exclude<ItemStatus, "processing"> }) {
  const [color, Mark] = BADGE[status];
  return (
    <span
      className={`absolute bottom-1 left-1 flex h-4 w-4 items-center justify-center rounded-sm ${color}`}
      aria-hidden
    >
      <Mark size={12} strokeWidth={2.5} />
    </span>
  );
}
