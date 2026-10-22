import { describe, it, expect } from "vitest";
import { sha256Buffer } from "../../src/lib/hash";

describe("sha256", () => {
  it("computes known hashes", async () => {
    expect(await sha256Buffer(new TextEncoder().encode("abc").buffer)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256Buffer(new ArrayBuffer(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
