import { models } from "../models";
import { formatBytes } from "./format";
import { Trash2 } from "lucide-react";
import { Button, Dialog } from "./kit";

interface Props {
  open: boolean;
  onClose: () => void;
  cacheTotal: number;
  onClearCache: () => void;
}

const TOOL_NAMES: Record<string, string> = {
  "background-remove": "Remove background",
  upscale: "Upscale",
  "object-count": "Count objects",
};

const THIRD_PARTY: [string, string][] = [
  ["ONNX Runtime Web", "MIT"],
  ["React", "MIT"],
  ["Comlink", "Apache-2.0"],
  ["fflate", "MIT"],
  ["Inter typeface", "OFL-1.1"],
  ["Lucide icons", "ISC"],
];

const sourceUrl = (s: string) => s.split(" ")[0];

export function AboutDialog({
  open,
  onClose,
  cacheTotal,
  onClearCache,
}: Props) {
  return (
    <Dialog open={open} onClose={onClose} title="About offpix">
      <section className="space-y-2 text-sm">
        <p>
          offpix runs AI image tools entirely in your browser with ONNX Runtime
          Web. Your images never leave your device: there is no backend, no
          analytics and no third-party requests.
        </p>
        <p>
          Models are downloaded once from this site, checked against a SHA-256
          hash and stored in your browser. After that the app works offline. You
          can remove them at any time with "Clear downloaded models".
        </p>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm border rounded border-border bg-surface-2">
        <span>
          Downloaded models:{" "}
          <span className="tabular-nums">{formatBytes(cacheTotal)}</span>
        </span>
        <Button
          size="sm"
          variant="danger"
          icon={Trash2}
          onClick={onClearCache}
          disabled={!cacheTotal}
        >
          Clear downloaded models
        </Button>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Models</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="py-1.5 pr-3 font-medium">Model</th>
                <th className="py-1.5 pr-3 font-medium">Tool</th>
                <th className="py-1.5 pr-3 font-medium">Size</th>
                <th className="py-1.5 font-medium">License</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id} className="align-top border-b border-border">
                  <td className="py-1.5 pr-3">
                    <a
                      href={sourceUrl(m.source)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline text-accent-text decoration-accent-text/40 underline-offset-2 hover:decoration-accent-text"
                    >
                      {m.name}
                    </a>
                  </td>
                  <td className="py-1.5 pr-3">{TOOL_NAMES[m.tool]}</td>
                  <td className="py-1.5 pr-3 tabular-nums">
                    {formatBytes(m.size)}
                  </td>
                  <td className="py-1.5">{m.license}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-1 text-xs text-muted">
        <p>offpix code: MIT. Models keep their own licenses (above).</p>
        <p>
          Third-party code:{" "}
          {THIRD_PARTY.map(([n, l]) => `${n} (${l})`).join(", ")}.
        </p>
        <p>
          Full license texts and copyright notices:{" "}
          <a
            href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.md`}
            target="_blank"
            rel="noopener"
            className="underline text-accent-text underline-offset-2"
          >
            third-party notices
          </a>{" "}
          (models and libraries) and the{" "}
          <a
            href={`${import.meta.env.BASE_URL}licenses/onnxruntime.ThirdPartyNotices.txt`}
            target="_blank"
            rel="noopener"
            className="underline text-accent-text underline-offset-2"
          >
            ONNX Runtime notices
          </a>
          .
        </p>
      </section>
    </Dialog>
  );
}
