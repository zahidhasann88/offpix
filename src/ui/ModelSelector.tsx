import type { ReactNode } from "react";
import type { ModelManifestEntry } from "../engine/types";
import { formatBytes } from "./format";
import { Disclosure, Select } from "./kit";

interface Props {
  models: ModelManifestEntry[];
  value: string;
  onChange: (id: string) => void;
  cached: Record<string, boolean>;
  children?: ReactNode;
}

export function ModelSelector({
  models,
  value,
  onChange,
  cached,
  children,
}: Props) {
  const current = models.find((m) => m.id === value);
  return (
    <div className="space-y-2">
      <Select
        id="model-select"
        label="Model"
        hideLabel
        value={value}
        onChange={onChange}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ·{" "}
            {m.webgpuFile
              ? `${formatBytes(m.size)} CPU / ${formatBytes(m.webgpuFile.size)} GPU`
              : formatBytes(m.size)}
            {cached[m.id] ? " (downloaded)" : ""}
          </option>
        ))}
      </Select>
      <Disclosure id="model-details" summary="Model details">
        {current && (
          <p className="text-xs text-muted">Licence: {current.license}</p>
        )}
        {children}
      </Disclosure>
    </div>
  );
}
