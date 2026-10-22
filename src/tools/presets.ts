import { DEFAULT_FILL_MIN_AREA, type RefineOptions } from "./bg-pipeline";

export const DEFAULT_PORTRAIT_FRINGE = 0.5;

export type Subject = "general" | "portrait" | "product";

export const SUBJECTS: {
  id: Subject;
  label: string;
  hint: string;
  refine: RefineOptions;
}[] = [
  {
    id: "general",
    label: "General",
    hint: "Any photo.",
    refine: { eps: 1e-4, fillHoles: false, fillMinArea: DEFAULT_FILL_MIN_AREA },
  },
  {
    id: "portrait",
    label: "Portrait",
    hint: "People and animals: keeps gaps between arms, hair and fur, and removes backdrop colour between strands.",
    refine: {
      eps: 1e-4,
      fillHoles: false,
      fillMinArea: DEFAULT_FILL_MIN_AREA,
      fringe: DEFAULT_PORTRAIT_FRINGE,
    },
  },
  {
    id: "product",
    label: "Product & UI",
    hint: "Objects, devices and screenshots: fills screens and other enclosed areas.",
    refine: { eps: 1e-4, fillHoles: true, fillMinArea: DEFAULT_FILL_MIN_AREA },
  },
];

export function subjectPreset(id: Subject): RefineOptions {
  return { ...(SUBJECTS.find((s) => s.id === id) ?? SUBJECTS[0]).refine };
}

export const FILL_AREAS = [
  0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05,
];

export function sameRefine(
  a: RefineOptions | undefined,
  b: RefineOptions,
): boolean {
  return (
    !!a &&
    a.eps === b.eps &&
    a.fillHoles === b.fillHoles &&
    (!a.fillHoles || a.fillMinArea === b.fillMinArea) &&
    (a.fringe ?? 0) === (b.fringe ?? 0)
  );
}
