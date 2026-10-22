import { SegmentedControl } from "./kit";

export type PreviewBg = "checker" | "white" | "black" | "red";

const PREVIEW_BGS: { id: PreviewBg; label: string }[] = [
  { id: "checker", label: "Checker" },
  { id: "white", label: "White" },
  { id: "black", label: "Black" },
  { id: "red", label: "Red" },
];

const COLOUR: Record<Exclude<PreviewBg, "checker">, string> = {
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
};

export function previewBgProps(bg: PreviewBg): {
  className: string;
  style?: React.CSSProperties;
} {
  return bg === "checker"
    ? { className: "checkerboard" }
    : { className: "", style: { background: COLOUR[bg] } };
}

function Swatch({ bg }: { bg: PreviewBg }) {
  return (
    <span
      aria-hidden
      className={`h-3 w-3 rounded-sm border border-border-strong ${bg === "checker" ? "checkerboard" : ""}`}
      style={
        bg === "checker"
          ? { backgroundSize: "6px 6px" }
          : { background: COLOUR[bg] }
      }
    />
  );
}

export function PreviewBgPicker({
  value,
  onChange,
}: {
  value: PreviewBg;
  onChange: (v: PreviewBg) => void;
}) {
  return (
    <SegmentedControl
      label="Preview background"
      size="sm"
      nowrap
      value={value}
      onChange={onChange}
      options={PREVIEW_BGS.map((b) => ({
        value: b.id,
        title: b.label,
        label: (
          <>
            <Swatch bg={b.id} />
            <span className="sr-only lg:not-sr-only">{b.label}</span>
          </>
        ),
      }))}
    />
  );
}
