import { describe, it, expect } from "vitest";
import manifest from "../../src/models/manifest.json";
import { partRanges, partUrl } from "../../src/engine/parts";

const byId = Object.fromEntries(manifest.models.map((m) => [m.id, m]));

describe("model manifest", () => {
  it("every entry is complete, pinned and self-hosted", () => {
    for (const m of manifest.models) {
      expect(m.url, m.id).toMatch(/^\/models\/[\w.-]+\.onnx$/);
      expect(m.sha256, m.id).toMatch(/^[0-9a-f]{64}$/);
      expect(m.size, m.id).toBeGreaterThan(0);
      expect(m.license, m.id).not.toBe("");
      const derived = (
        m as {
          derivedFrom?: { downloadUrl: string; sha256: string; patch: string };
        }
      ).derivedFrom;
      const exported = (
        m as {
          export?: {
            script: string;
            checkpoint: { url: string; sha256: string };
          };
        }
      ).export;
      if (exported) {
        expect(exported.script, m.id).toMatch(/^scripts\/[\w.-]+\.py v\d+$/);
        expect(exported.checkpoint.sha256, m.id).toMatch(/^[0-9a-f]{64}$/);
      }
      const url =
        derived?.downloadUrl ?? exported?.checkpoint.url ?? m.downloadUrl;
      expect(url, m.id).toMatch(/^https:\/\//);
      expect(url, m.id).not.toMatch(/\/(main|master|latest)\//);
      if (derived) {
        expect(derived.sha256, m.id).toMatch(/^[0-9a-f]{64}$/);
        expect(derived.patch, m.id).toMatch(/^scripts\/[\w.-]+\.py v\d+$/);
      }
      expect(m.input.mean, m.id).toHaveLength(3);
      expect(m.input.std, m.id).toHaveLength(3);
    }
    expect(new Set(manifest.models.map((m) => m.id)).size).toBe(
      manifest.models.length,
    );
  });

  it("background models use rembg preprocessing", () => {
    expect(byId["u2netp"].input).toMatchObject({
      mean: [0.485, 0.456, 0.406],
      std: [0.229, 0.224, 0.225],
      shape: [1, 3, 320, 320],
    });
    expect(byId["isnet-general-use"].input).toMatchObject({
      mean: [0.5, 0.5, 0.5],
      std: [1, 1, 1],
      shape: [1, 3, 1024, 1024],
    });
  });

  it("object counters use YOLOX preprocessing (BGR, raw 0..255)", () => {
    for (const id of ["yolox-nano", "yolox-tiny"]) {
      expect(byId[id].input).toMatchObject({
        channels: "BGR",
        mean: [0, 0, 0],
        shape: [1, 3, 416, 416],
      });
      for (const s of byId[id].input.std) expect(s * 255).toBeCloseTo(1);
    }
  });

  it("release-published models list parts that cover the file exactly", () => {
    const released = manifest.models.filter(
      (m) => "release" in m,
    ) as unknown as {
      id: string;
      url: string;
      size: number;
      pagesParts?: boolean;
      release: {
        tag: string;
        parts: { name: string; size: number; sha256: string }[];
      };
    }[];
    expect(released.map((m) => m.id)).toContain("birefnet-lite-512");
    for (const m of released) {
      expect(m.pagesParts).toBe(true);
      expect(m.release.tag).toMatch(/^models-v\d+$/);
      const ranges = partRanges(m.size);
      expect(m.release.parts.map((p) => p.size)).toEqual(
        ranges.map(([a, b]) => b - a),
      );
      m.release.parts.forEach((p, k) => {
        expect("/models/" + p.name).toBe(partUrl(m.url, k));
        expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
      });
    }
  });
});
