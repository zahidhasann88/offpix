export type Backend = "webgpu" | "wasm" | "wasm-single";

export interface ModelManifestEntry {
  id: string;
  tool: "background-remove" | "upscale" | "object-count";
  variant: string;
  name: string;
  url: string;
  downloadUrl?: string;
  size: number;
  sha256: string;
  license: string;
  source: string;
  input: {
    name: string;
    shape: (number | string)[];
    layout: "NCHW" | "NHWC";
    dtype: "float32" | "uint8";
    mean?: number[];
    std?: number[];
    channels?: "RGB" | "BGR";
  };
  output: {
    name: string;
    shape: (number | string)[];
    layout: "NCHW" | "NHWC";
    dtype: "float32" | "uint8";
    activation?: "sigmoid";
  };
  webgpuFile?: ModelFile & { downloadUrl?: string; derivedFrom?: DerivedFrom };
  dtype?: "fp32" | "fp16";
  verified?: ("wasm" | "webgpu")[];
  export?: {
    script: string;
    checkpoint: { url: string; size: number; sha256: string };
    code: { url: string; commit: string };
    requirements: string;
  };
  derivedFrom?: DerivedFrom;
  pagesParts?: boolean;
  tier?: number;
  optIn?: boolean;
  gpuRequirements?: {
    shaderF16?: boolean;
    minStorageBuffersPerShaderStage?: number;
    minMaxBufferSize?: number;
    minDeviceMemoryGB?: number;
    excludeArchitectures?: string[];
  };
  heavy?: boolean;
  wasm?: boolean;
  webgpu?: boolean;
  scale?: number;
  inputMultiple?: number;
  notes?: string;
}

export interface ModelFile {
  url: string;
  size: number;
  sha256: string;
  dtype?: "fp32" | "fp16";
  verified?: ("wasm" | "webgpu")[];
}

export interface DerivedFrom {
  downloadUrl: string;
  size: number;
  sha256: string;
  patch: string;
}

export interface ProgressInfo {
  loaded: number;
  total: number;
  percent: number;
}
