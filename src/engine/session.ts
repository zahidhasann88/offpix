import type * as ort from "onnxruntime-web";
import type { Backend } from "./types";
import { isCancelled, modelLoadError } from "./errors";

export type CreateSession = (
  model: Uint8Array,
  options: ort.InferenceSession.SessionOptions,
) => Promise<ort.InferenceSession>;

export interface SessionResult {
  session: ort.InferenceSession;
  backend: Backend;
  fallbackReason?: string;
}

export interface CreateSessionOptions {
  create: CreateSession;
  webgpuAvailable: boolean;
  wasmThreads: number;
  unavailableReason?: string;
  gpuOnly?: boolean;
}

export class GpuOnlyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GpuOnlyError";
  }
}

export async function createSessionWithFallback(
  model: Uint8Array,
  opts: CreateSessionOptions,
): Promise<SessionResult> {
  let fallbackReason: string | undefined;
  if (opts.webgpuAvailable) {
    try {
      const session = await opts.create(model, {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "all",
      });
      return { session, backend: "webgpu" };
    } catch (e) {
      fallbackReason = `WebGPU session failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    fallbackReason =
      opts.unavailableReason ?? "WebGPU is not available in this browser";
  }
  if (opts.gpuOnly)
    throw new GpuOnlyError(
      `This model needs the GPU and cannot run on the CPU. ${fallbackReason}`,
    );
  try {
    const session = await opts.create(model, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    return {
      session,
      backend: opts.wasmThreads > 1 ? "wasm" : "wasm-single",
      fallbackReason,
    };
  } catch (e) {
    throw modelLoadError(
      `Could not load the model: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export interface AdapterCaps {
  vendor: string;
  architecture: string;
  shaderF16: boolean;
  maxStorageBuffersPerShaderStage: number;
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
}

interface GpuAdapterLike {
  features: { has(f: string): boolean };
  limits: Record<string, number>;
  info?: { vendor?: string; architecture?: string };
}

export async function detectAdapter(): Promise<AdapterCaps | null> {
  const gpu = (
    navigator as Navigator & {
      gpu?: { requestAdapter(): Promise<GpuAdapterLike | null> };
    }
  ).gpu;
  if (!gpu) return null;
  try {
    const a = await gpu.requestAdapter();
    if (!a) return null;
    return {
      vendor: a.info?.vendor ?? "",
      architecture: a.info?.architecture ?? "",
      shaderF16: a.features.has("shader-f16"),
      maxStorageBuffersPerShaderStage:
        a.limits.maxStorageBuffersPerShaderStage ?? 0,
      maxBufferSize: a.limits.maxBufferSize ?? 0,
      maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize ?? 0,
    };
  } catch {
    return null;
  }
}

export async function detectWebGPU(): Promise<boolean> {
  return (await detectAdapter()) != null;
}

export class FallbackSession {
  private current: SessionResult;
  private readonly reload: () => Promise<Uint8Array>;
  private readonly opts: CreateSessionOptions;

  constructor(
    initial: SessionResult,
    reload: () => Promise<Uint8Array>,
    opts: CreateSessionOptions,
  ) {
    this.current = initial;
    this.reload = reload;
    this.opts = opts;
  }

  get backend(): Backend {
    return this.current.backend;
  }
  get fallbackReason(): string | undefined {
    return this.current.fallbackReason;
  }

  async run<T>(fn: (session: ort.InferenceSession) => Promise<T>): Promise<T> {
    try {
      return await fn(this.current.session);
    } catch (e) {
      if (this.current.backend !== "webgpu" || isCancelled(e)) throw e;
      if (this.opts.gpuOnly)
        throw new GpuOnlyError(
          `WebGPU couldn't run this model: ${e instanceof Error ? e.message : String(e)}`,
        );
      const reason = `WebGPU couldn't run this model (${e instanceof Error ? e.message : String(e)}), so it runs on the CPU`;
      await this.current.session.release().catch(() => {});
      this.current = await createSessionWithFallback(await this.reload(), {
        ...this.opts,
        webgpuAvailable: false,
        unavailableReason: reason,
      });
      return fn(this.current.session);
    }
  }

  release(): Promise<void> {
    return this.current.session.release().catch(() => {});
  }
}
