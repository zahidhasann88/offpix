import { describe, it, expect } from "vitest";
import { cspString } from "../../build/offpix-plugins";

const parse = (csp: string) =>
  Object.fromEntries(
    csp.split("; ").map((d) => {
      const [k, ...v] = d.split(" ");
      return [k, v];
    }),
  );

describe("content security policy", () => {
  const prod = parse(cspString("prod", true));

  it("only ever connects to this origin (models are self-hosted)", () => {
    expect(prod["connect-src"]).toEqual(["'self'"]);
    expect(prod["default-src"]).toEqual(["'self'"]);
    expect(prod["font-src"]).toEqual(["'self'"]);
  });

  it("allows no inline script, no eval beyond WebAssembly, and no inline styles in production", () => {
    expect(prod["script-src"]).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(prod["style-src"]).toEqual(["'self'"]);
    expect(cspString("prod", true)).not.toMatch(
      /'unsafe-inline'|'unsafe-eval'|https?:/,
    );
  });

  it("cannot be framed and blocks plugins/forms", () => {
    expect(prod["frame-ancestors"]).toEqual(["'none'"]);
    expect(prod["object-src"]).toEqual(["'none'"]);
    expect(prod["form-action"]).toEqual(["'none'"]);
    expect(cspString("prod", false)).not.toContain("frame-ancestors");
  });
});
