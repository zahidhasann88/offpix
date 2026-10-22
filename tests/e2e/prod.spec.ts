import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixture = (name: string) =>
  fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

async function watch(context: BrowserContext, page: Page, origin: string) {
  const external: string[] = [];
  context.on("request", (req) => {
    const u = new URL(req.url());
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
  return {
    external,
    violations: () =>
      page.evaluate(() => (window as unknown as { __csp: string[] }).__csp),
  };
}

async function removeBackground(page: Page) {
  await page.getByRole("tab", { name: "Remove background" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("small.png"));
  await page.selectOption("#model-select", "u2netp");
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 120000,
  });
}

test("strict CSP, cross-origin isolated, and zero external requests across all tools", async ({
  page,
  context,
  baseURL,
}) => {
  const w = await watch(context, page, new URL(baseURL!).origin);
  await page.goto("/");

  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).not.toContain("unsafe-inline");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  await removeBackground(page);

  await page.getByRole("tab", { name: "Upscale" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("small2.png"));
  await page.selectOption("#model-select", "realesr-general-x4v3");
  await page.getByRole("button", { name: "Upscale", exact: true }).click();
  await expect(page.getByText(/^Done in/)).toBeVisible({ timeout: 120000 });

  await page.getByRole("tab", { name: "Count objects" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("scene-synthetic.png"));
  await page.selectOption("#model-select", "yolox-nano");
  await page.getByRole("button", { name: "Count objects" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 120000,
  });

  expect(await w.violations()).toEqual([]);
  expect(w.external).toEqual([]);
});

test("works offline after models are downloaded", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await removeBackground(page);
  await expect(page.getByText("Ready to work offline")).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Remove background" }),
  ).toBeVisible();
  await removeBackground(page);
});
