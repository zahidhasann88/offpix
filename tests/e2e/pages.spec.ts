import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixture = (name: string) =>
  fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

const PARTS_JSON = "/models/birefnet-lite-512-offpix-fp16.onnx.parts.json";

async function optionValues(page: Page) {
  await expect(page.locator("#model-select")).toBeVisible();
  return page
    .locator("#model-select option")
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
}

test("ships only the small models and runs every tool on WASM with nothing leaving the origin", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const external: string[] = [];
  const requested: string[] = [];
  context.on("request", (req) => {
    const u = new URL(req.url());
    requested.push(u.pathname);
    if (!["data:", "blob:"].includes(u.protocol) && u.origin !== origin)
      external.push(req.url());
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  await page.goto("/");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("small.png"));
  const partsBuilt = (await page.request.get(PARTS_JSON)).ok();
  expect(await optionValues(page)).toEqual(
    partsBuilt ? ["u2netp", "birefnet-lite-512"] : ["u2netp"],
  );
  await page.selectOption("#model-select", "u2netp");
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 120000,
  });
  await expect(page.getByText(/Running on CPU \(WASM/)).toBeVisible();

  await page.getByRole("tab", { name: "Upscale" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("small2.png"));
  expect(await optionValues(page)).toEqual(["realesr-general-x4v3"]);
  await page.getByRole("button", { name: "Upscale", exact: true }).click();
  await expect(page.getByText(/^Done in/)).toBeVisible({ timeout: 120000 });

  await page.getByRole("tab", { name: "Count objects" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("scene-synthetic.png"));
  expect(await optionValues(page)).toEqual(["yolox-nano", "yolox-tiny"]);
  await page.getByRole("button", { name: "Count objects" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 120000,
  });

  await page.getByRole("button", { name: "About" }).click();
  await expect(page.getByRole("dialog").getByRole("row")).toHaveCount(
    partsBuilt ? 6 : 5,
  );

  expect(requested.filter((p) => p.includes(".jsep."))).toEqual([]);
  expect(
    await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp),
  ).toEqual([]);
  expect(external).toEqual([]);
});

test("works offline after models are downloaded", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("small.png"));
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 120000,
  });
  await expect(page.getByText("Ready to work offline")).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("small.png"));
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 120000,
  });
});

test("BiRefNet 512 loads from same-origin parts, verified, then works offline from the cache", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(600000);
  const partsBuilt = (await page.request.get(PARTS_JSON)).ok();
  test.skip(
    !partsBuilt,
    "the build had no BiRefNet 512 file (it is exported locally, not downloaded in CI)",
  );
  const origin = new URL(baseURL!).origin;
  const external: string[] = [];
  const modelRequests: string[] = [];
  context.on("request", (req) => {
    const u = new URL(req.url());
    if (!["data:", "blob:"].includes(u.protocol) && u.origin !== origin)
      external.push(req.url());
    if (u.pathname.startsWith("/models/birefnet"))
      modelRequests.push(u.pathname);
  });
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByRole("tab", { name: "Remove background" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("small.png"));
  await expect(page.locator("#model-select")).toHaveValue("birefnet-lite-512", {
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 300000,
  });
  const pm = (await (await page.request.get(PARTS_JSON)).json()) as {
    parts: { url: string }[];
  };
  expect(pm.parts.length).toBeGreaterThan(1);
  for (const p of pm.parts) expect(modelRequests).toContain(p.url);
  expect(modelRequests).not.toContain(
    "/models/birefnet-lite-512-offpix-fp16.onnx",
  );
  expect(external).toEqual([]);

  modelRequests.length = 0;
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("tab", { name: "Remove background" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("small2.png"));
  await expect(page.locator("#model-select")).toHaveValue("birefnet-lite-512", {
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 300000,
  });
  expect(modelRequests).toEqual([]);
  await context.setOffline(false);
  expect(external).toEqual([]);
});
