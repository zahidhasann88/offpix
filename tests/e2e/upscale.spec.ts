import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const fixture = (name: string) =>
  fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

function pngSize(buf: Uint8Array): [number, number] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return [v.getUint32(16), v.getUint32(20)];
}

async function open(page: Page, file: string, modelId: string) {
  await page.goto("/");
  await page.getByRole("tab", { name: "Upscale" }).click();
  await page.locator('input[type="file"]').first().setInputFiles(fixture(file));
  await page.selectOption("#model-select", modelId);
}

test("upscale flow", async ({ page }) => {
  await open(page, "small.png", "real-esrgan-x2");
  await expect(page.getByText("64×64 → 128×128")).toBeVisible();
  await page.getByRole("button", { name: "Upscale", exact: true }).click();
  await expect(page.getByText(/^Done in/)).toBeVisible({ timeout: 300000 });

  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG" }).click();
  const dl = await pending;
  expect(dl.suggestedFilename()).toBe("small-2x.png");
  expect(pngSize(new Uint8Array(fs.readFileSync((await dl.path())!)))).toEqual([
    128, 128,
  ]);
});

test("fast 4x model, zoom and compare controls", async ({ page }) => {
  await open(page, "small.png", "realesr-general-x4v3");
  await page.getByRole("button", { name: "Upscale", exact: true }).click();
  await expect(page.getByText(/^Done in/)).toBeVisible({ timeout: 120000 });
  await expect(
    page.getByRole("img", { name: /Upscaled result, 256×256/ }),
  ).toBeVisible();

  const zoom = page.getByLabel("Zoom level");
  const fit = await zoom.textContent();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom).not.toHaveText(fit!);
  await page.getByRole("button", { name: "Fit" }).click();
  await expect(zoom).toHaveText(fit!);
  await expect(
    page.getByLabel("Before/after comparison position"),
  ).toBeVisible();
});

test("cancel stops a running upscale", async ({ page }) => {
  await open(page, "gradient-256.png", "realesr-general-x4v3");
  await page.getByText("Advanced").click();
  await page.getByLabel("Tile size").fill("64");
  await page.getByRole("button", { name: "Upscale", exact: true }).click();
  await expect(page.getByText(/Tiles [1-9]\d*\//)).toBeVisible({
    timeout: 120000,
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Cancelled.")).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByRole("button", { name: "Upscale", exact: true }),
  ).toBeEnabled();
});

test("oversized input is rejected up front with a clear message", async ({
  page,
}) => {
  await open(page, "huge-16.8mp.png", "realesr-general-x4v3");
  await expect(page.getByRole("alert")).toContainText("maximum is 16 MP");
  await expect(
    page.getByRole("button", { name: "Upscale", exact: true }),
  ).toBeDisabled();
});
