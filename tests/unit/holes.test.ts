import { describe, it, expect } from "vitest";
import { fillEnclosed, enclosedRegions } from "../../src/tools/holes";
import {
  refineCutout,
  defaultRefineOptions,
} from "../../src/tools/bg-pipeline";
import { boxBlur } from "../../src/tools/filters";
import { makeScene } from "../synthetic/scenes";

function screenPixels(s: ReturnType<typeof makeScene>): Uint8Array {
  return Uint8Array.from(s.alpha, (a, i) =>
    a === 1 && s.fg[i * 3] > 0.98 && !s.highlight[i] ? 1 : 0,
  );
}

function screenAsBackground(
  s: ReturnType<typeof makeScene>,
  value = 0.2,
): Float32Array {
  const scr = screenPixels(s);
  return Float32Array.from(s.alpha, (a, i) => (scr[i] ? value : a));
}

describe("fillEnclosed", () => {
  const phone = makeScene("phone", "white", 192, 192);
  const ring = makeScene("ring", "white", 192, 192);

  it("ON: a white screen inside a bezel, read as background, becomes opaque", () => {
    const scr = screenPixels(phone);
    let n = 0;
    for (const v of scr) n += v;
    expect(n).toBeGreaterThan(2000);
    for (const value of [0, 0.05, 0.45]) {
      const out = fillEnclosed(
        screenAsBackground(phone, value),
        phone.w,
        phone.h,
      );
      for (let i = 0; i < out.length; i++) if (scr[i]) expect(out[i]).toBe(1);
    }
  });

  it("does not fill a screen the model left semi-opaque (>= 0.5): that is not background-labelled", () => {
    const scr = screenPixels(phone);
    const out = fillEnclosed(screenAsBackground(phone, 0.7), phone.w, phone.h);
    for (let i = 0; i < out.length; i++)
      if (scr[i]) expect(out[i]).toBeCloseTo(0.7, 5);
  });

  it("ON never touches the background connected to the border", () => {
    const input = screenAsBackground(phone);
    const out = fillEnclosed(input, phone.w, phone.h);
    for (let i = 0; i < out.length; i++)
      if (phone.alpha[i] === 0) expect(out[i]).toBe(input[i]);
  });

  it("OFF (not applied): the ring keeps its real hole; ON fills it (why Portrait has it off)", () => {
    const c = (ring.h / 2) * ring.w + ring.w / 2;
    expect(ring.alpha[c]).toBe(0);
    expect(fillEnclosed(ring.alpha, ring.w, ring.h)[c]).toBe(1);
    expect(fillEnclosed(ring.alpha, ring.w, ring.h)[0]).toBe(0);
  });

  it("leaves regions that touch the border alone (a U shape is not a hole)", () => {
    const w = 30,
      h = 30,
      a = new Float32Array(w * h);
    for (let y = 5; y < 25; y++) for (let x = 5; x < 25; x++) a[y * w + x] = 1;
    for (let y = 0; y < 20; y++) for (let x = 10; x < 20; x++) a[y * w + x] = 0;
    expect(enclosedRegions(a, w, h).every((v) => v === 0)).toBe(true);
  });

  it("keeps small enclosed gaps below the area threshold", () => {
    const w = 100,
      h = 100,
      a = new Float32Array(w * h);
    for (let y = 10; y < 90; y++)
      for (let x = 10; x < 90; x++) a[y * w + x] = 1;
    a[50 * w + 50] = 0;
    for (let y = 20; y < 40; y++)
      for (let x = 20; x < 40; x++) a[y * w + x] = 0;
    const fill = enclosedRegions(a, w, h);
    expect(fill[50 * w + 50]).toBe(0);
    expect(fill[30 * w + 30]).toBe(1);
  });
});

describe("refineCutout with the toggle (end to end after the model)", () => {
  const blurry = (a: Float32Array, w: number, h: number) => boxBlur(a, w, h, 1);

  it("phone: ON makes the screen opaque, OFF leaves it as the model said", () => {
    const s = makeScene("phone", "white", 384, 384);
    const scr = screenPixels(s);
    const coarse = blurry(screenAsBackground(s, 0.05), s.w, s.h);
    const on = refineCutout(s.image, s.w, s.h, coarse, 1, {
      ...defaultRefineOptions,
      fillHoles: true,
    }).alpha;
    const off = refineCutout(s.image, s.w, s.h, coarse, 1, {
      ...defaultRefineOptions,
      fillHoles: false,
    }).alpha;
    let minOn = 1,
      meanOff = 0,
      n = 0;
    for (let i = 0; i < scr.length; i++)
      if (scr[i]) {
        minOn = Math.min(minOn, on[i]);
        meanOff += off[i];
        n++;
      }
    expect(minOn).toBe(1);
    expect(meanOff / n).toBeLessThan(0.5);
  });

  it("ring: OFF keeps the hole transparent", () => {
    const s = makeScene("ring", "white", 160, 160);
    const off = refineCutout(s.image, s.w, s.h, blurry(s.alpha, s.w, s.h), 1, {
      ...defaultRefineOptions,
      fillHoles: false,
    }).alpha;
    expect(off[(s.h / 2) * s.w + s.w / 2]).toBeLessThan(0.05);
  });
});

describe("fill statistics and area threshold", () => {
  it("reports regions and pixels, and the threshold decides which enclosed regions count", () => {
    const w = 100,
      h = 100,
      a = new Float32Array(w * h);
    for (let y = 10; y < 90; y++)
      for (let x = 10; x < 90; x++) a[y * w + x] = 1;
    for (let y = 20; y < 30; y++)
      for (let x = 20; x < 30; x++) a[y * w + x] = 0;
    for (let y = 50; y < 80; y++)
      for (let x = 50; x < 80; x++) a[y * w + x] = 0;
    const small = { regions: 0, pixels: 0 },
      large = { regions: 0, pixels: 0 };
    fillEnclosed(a, w, h, { minAreaFraction: 0.005 }, small);
    fillEnclosed(a, w, h, { minAreaFraction: 0.05 }, large);
    expect(small).toEqual({ regions: 2, pixels: 1000 });
    expect(large).toEqual({ regions: 1, pixels: 900 });
  });
});
