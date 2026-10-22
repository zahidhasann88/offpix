declare const __OFFPIX_PROFILE__: "full" | "pages";
declare const __OFFPIX_PAGES_PARTS__: string[];

export const PROFILE = __OFFPIX_PROFILE__;
export const WEBGPU_IN_BUILD = PROFILE === "full";
export const PAGES_PARTS: readonly string[] = __OFFPIX_PAGES_PARTS__;
export const PAGES_FILE_LIMIT = 25 * 1024 * 1024;
export const ORT_RUNTIME_FILES = WEBGPU_IN_BUILD
  ? [
      "ort/ort-wasm-simd-threaded.jsep.mjs",
      "ort/ort-wasm-simd-threaded.jsep.wasm",
    ]
  : ["ort/ort-wasm-simd-threaded.mjs", "ort/ort-wasm-simd-threaded.wasm"];
