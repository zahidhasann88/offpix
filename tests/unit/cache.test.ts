import { describe, it, expect, beforeEach } from "vitest";
import {
  cacheHas,
  cacheGet,
  cachePut,
  cacheClear,
  cacheList,
} from "../../src/engine/cache";
import { installMemCaches } from "../helpers/memCache";

installMemCaches();

describe("cache", () => {
  beforeEach(async () => {
    await cacheClear();
  });
  it("miss then hit", async () => {
    expect(await cacheHas("http://x/m.onnx")).toBe(false);
    expect(await cacheGet("http://x/m.onnx")).toBeNull();
    await cachePut("http://x/m.onnx", new ArrayBuffer(8), "abc");
    expect(await cacheHas("http://x/m.onnx")).toBe(true);
    const buf = await cacheGet("http://x/m.onnx");
    expect(buf?.byteLength).toBe(8);
  });
  it("treats an entry stored under another hash as a miss", async () => {
    await cachePut("http://x/m.onnx", new ArrayBuffer(8), "abc");
    expect(await cacheHas("http://x/m.onnx", "abc")).toBe(true);
    expect(await cacheHas("http://x/m.onnx", "def")).toBe(false);
    expect(await cacheGet("http://x/m.onnx", "def")).toBeNull();
  });
  it("lists sizes from headers", async () => {
    await cachePut("http://x/a.onnx", new ArrayBuffer(8), "a");
    await cachePut("http://x/b.onnx", new ArrayBuffer(24), "b");
    const list = await cacheList();
    expect(list.map((i) => i.size).sort((a, b) => a - b)).toEqual([8, 24]);
  });
  it("clear", async () => {
    await cachePut("http://x/m.onnx", new ArrayBuffer(8), "abc");
    await cacheClear();
    expect(await cacheHas("http://x/m.onnx")).toBe(false);
  });
});
