import { describe, it, expect } from "vitest";
import { classifyError, isOutOfMemory } from "../../src/engine/errors";

describe("out-of-memory classification across browsers", () => {
  it.each([
    [
      "ORT WASM heap (any browser)",
      "failed to call OrtRun(). ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc",
    ],
    ["Chromium", "RangeError: Array buffer allocation failed"],
    ["Firefox", "InternalError: allocation size overflow"],
    [
      "Firefox WASM grow",
      "RangeError: WebAssembly.Memory.grow(): Maximum memory size exceeded",
    ],
    ["WebKit / Safari", "RangeError: Out of memory"],
  ])("%s", (_, msg) => {
    expect(isOutOfMemory(classifyError(new Error(msg)))).toBe(true);
  });

  it("does not misclassify ordinary errors", () => {
    expect(isOutOfMemory(classifyError(new Error("Failed to fetch")))).toBe(
      false,
    );
  });
});
