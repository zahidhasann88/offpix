import { describe, it, expect } from "vitest";
import { boxBlur, guidedFilter } from "../../src/tools/filters";
import { rng } from "../synthetic/scenes";

function slowGuided(
  I: Float32Array[],
  p: Float32Array,
  w: number,
  h: number,
  r: number,
  eps: number,
): Float32Array {
  const win = (x: number, y: number) => {
    const out: number[] = [];
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++)
      for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++)
        out.push(yy * w + xx);
    return out;
  };
  const solve3 = (M: number[][], v: number[]) => {
    const A = M.map((row, i) => [...row, v[i]]);
    for (let c = 0; c < 3; c++) {
      let piv = c;
      for (let k = c + 1; k < 3; k++)
        if (Math.abs(A[k][c]) > Math.abs(A[piv][c])) piv = k;
      [A[c], A[piv]] = [A[piv], A[c]];
      for (let k = 0; k < 3; k++)
        if (k !== c) {
          const f = A[k][c] / A[c][c];
          for (let j = c; j < 4; j++) A[k][j] -= f * A[c][j];
        }
    }
    return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
  };
  const a = Array.from({ length: w * h }, () => [0, 0, 0]),
    b = new Float64Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ids = win(x, y),
        n = ids.length;
      const mu = [0, 1, 2].map((c) => ids.reduce((s, i) => s + I[c][i], 0) / n);
      const mp = ids.reduce((s, i) => s + p[i], 0) / n;
      const S = [0, 1, 2].map((c) =>
        [0, 1, 2].map(
          (d) =>
            ids.reduce((s, i) => s + I[c][i] * I[d][i], 0) / n -
            mu[c] * mu[d] +
            (c === d ? eps : 0),
        ),
      );
      const cov = [0, 1, 2].map(
        (c) => ids.reduce((s, i) => s + I[c][i] * p[i], 0) / n - mu[c] * mp,
      );
      const ak = solve3(S, cov);
      a[y * w + x] = ak;
      b[y * w + x] = mp - ak[0] * mu[0] - ak[1] * mu[1] - ak[2] * mu[2];
    }
  const q = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ids = win(x, y),
        n = ids.length;
      let s = 0;
      for (const k of ids)
        s +=
          a[k][0] * I[0][y * w + x] +
          a[k][1] * I[1][y * w + x] +
          a[k][2] * I[2][y * w + x] +
          b[k];
      q[y * w + x] = s / n;
    }
  return q;
}

describe("guidedFilter", () => {
  it("matches a slow direct implementation", () => {
    const w = 23,
      h = 17,
      rand = rng(3);
    const I = [0, 1, 2].map(() =>
      Float32Array.from({ length: w * h }, () => rand()),
    );
    const p = Float32Array.from(
      { length: w * h },
      (_, i) => (i % w > 11 ? 1 : 0) * 0.8 + rand() * 0.2,
    );
    for (const [r, eps] of [
      [1, 1e-2],
      [3, 1e-4],
      [2, 1e-6],
    ]) {
      const fast = guidedFilter(
        I as [Float32Array, Float32Array, Float32Array],
        p,
        w,
        h,
        r,
        eps,
      );
      const slow = slowGuided(I, p, w, h, r, eps);
      let worst = 0;
      for (let i = 0; i < w * h; i++)
        worst = Math.max(worst, Math.abs(fast[i] - slow[i]));
      expect(worst).toBeLessThan(2e-3);
    }
  });

  it("is the identity for p = a linear function of the guide", () => {
    const w = 16,
      h = 12,
      rand = rng(5);
    const I = [0, 1, 2].map(() =>
      Float32Array.from({ length: w * h }, () => rand()),
    ) as [Float32Array, Float32Array, Float32Array];
    const p = Float32Array.from(
      { length: w * h },
      (_, i) => 0.3 * I[0][i] - 0.2 * I[1][i] + 0.5 * I[2][i] + 0.1,
    );
    const q = guidedFilter(I, p, w, h, 2, 1e-9);
    for (let i = 0; i < w * h; i++) expect(q[i]).toBeCloseTo(p[i], 3);
  });

  it("puts a sharp step exactly at the edge in the guide", () => {
    const w = 40,
      h = 6,
      edge = 20;
    const I = [0, 1, 2].map((c) =>
      Float32Array.from({ length: w * h }, (_, i) =>
        i % w < edge ? [0.6, 0.1, 0.1][c] : [0.9, 0.85, 0.8][c],
      ),
    ) as [Float32Array, Float32Array, Float32Array];
    const p = Float32Array.from(
      { length: w * h },
      (_, i) => 1 / (1 + Math.exp(((i % w) - edge) / 3)),
    );
    const q = guidedFilter(I, p, w, h, 4, 1e-4);
    const row = 3 * w;
    let best = 0,
      at = -1;
    for (let x = 1; x < w; x++) {
      const d = q[row + x - 1] - q[row + x];
      if (d > best) {
        best = d;
        at = x;
      }
    }
    expect(at).toBe(edge);
    expect(best).toBeGreaterThan(4 * (p[row + edge - 1] - p[row + edge]));
  });
});

describe("boxBlur", () => {
  it("matches a brute-force clamped window mean", () => {
    const w = 7,
      h = 5,
      r = 2;
    const src = Float32Array.from({ length: w * h }, (_, i) => (i * 37) % 11);
    const out = boxBlur(src, w, h, r);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0,
          n = 0;
        for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++)
          for (
            let xx = Math.max(0, x - r);
            xx <= Math.min(w - 1, x + r);
            xx++
          ) {
            s += src[yy * w + xx];
            n++;
          }
        expect(out[y * w + x]).toBeCloseTo(s / n, 4);
      }
  });
});
