import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixture = (name: string) =>
  fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const { scrollW, clientW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(
    scrollW,
    `${label}: page is ${scrollW}px wide on a ${clientW}px screen`,
  ).toBeLessThanOrEqual(clientW);
}

test("mobile smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("offpix", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Remove background" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page, "empty");
});

test("no horizontal overflow with results on screen", async ({ page }) => {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([fixture("small.png"), fixture("small2.png")]);
  await page.selectOption("#model-select", "isnet-general-use");
  await expectNoHorizontalOverflow(page, "remove-bg loaded");
  await page.selectOption("#model-select", "u2netp");
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByText(/^Done:/)).toBeVisible({ timeout: 120000 });
  await expectNoHorizontalOverflow(page, "remove-bg result");

  await page.getByRole("tab", { name: "Upscale" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("small.png"));
  await page.selectOption("#model-select", "real-esrgan-x2");
  await expectNoHorizontalOverflow(page, "upscale loaded");
  await page.selectOption("#model-select", "realesr-general-x4v3");
  await page.getByRole("button", { name: "Upscale", exact: true }).click();
  await expect(page.getByText(/^Done in/)).toBeVisible({ timeout: 120000 });
  await expectNoHorizontalOverflow(page, "upscale result");

  await page.getByRole("tab", { name: "Count objects" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("scene-synthetic.png"));
  await page.selectOption("#model-select", "yolox-tiny");
  await page.getByRole("button", { name: "Count objects" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 120000,
  });
  await expectNoHorizontalOverflow(page, "count result");
});
