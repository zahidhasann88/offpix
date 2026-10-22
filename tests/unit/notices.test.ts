import { describe, it, expect } from "vitest";
import fs from "node:fs";
import manifest from "../../src/models/manifest.json";

const notices = fs
  .readFileSync("THIRD_PARTY_NOTICES.md", "utf8")
  .replace(/\r\n/g, "\n");

function section(title: string): string | undefined {
  const start = notices.indexOf(`\n### ${title}\n`);
  if (start < 0) return undefined;
  const body = notices.slice(start + title.length + 6);
  const end = body.indexOf("\n### ");
  return (end < 0 ? body : body.slice(0, end)).replace(/^\n+/, "");
}

describe("third-party notices", () => {
  it("has an entry for every manifest model, each pointing at a full license text", () => {
    for (const m of manifest.models) {
      const body = section(m.id);
      expect(body, `no notices entry for ${m.id}`).toBeTruthy();
      const keys = [
        ...body!.matchAll(/under "Model licenses" below \((\w+)\)/g),
      ].map((x) => x[1]);
      expect(keys.length, m.id).toBeGreaterThan(0);
      for (const k of keys) {
        const heading = notices
          .split("\n")
          .find((l) => l.startsWith("### ") && l.endsWith(` (${k})`));
        expect(heading, `${m.id}: no license section for ${k}`).toBeTruthy();
        const text = section(heading!.slice(4))!;
        expect(text).toMatch(/^License: .+\nSource: https:\/\/github\.com\//);
        const fenced = text.split("```text\n")[1]?.split("\n```")[0] ?? "";
        expect(fenced.length, `${m.id}: ${k} license text`).toBeGreaterThan(
          500,
        );
      }
    }
  });

  it("carries the upstream copyright lines, and the files it links to exist", () => {
    expect(notices).toContain("Copyright (c) 2024 ZhengPeng");
    expect(notices).toContain("Copyright 2021 Megvii, Base Detection");
    expect(notices).toContain("Copyright (c) Microsoft Corporation");
    for (const f of [
      "public/THIRD_PARTY_NOTICES.md",
      "public/licenses/onnxruntime.ThirdPartyNotices.txt",
    ])
      expect(fs.existsSync(f), f).toBe(true);
  });
});
