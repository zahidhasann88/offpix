import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fileURLToPath } from "node:url";

const fixture = (name: string) =>
  fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const SIZES = [
  [1280, 720],
  [1440, 900],
  [768, 1024],
  [390, 844],
] as const;

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "runs in the chromium project only",
  );
});

async function load(page: Page, model?: string) {
  await page.goto("/");
  await page.getByRole("tab", { name: "Remove background" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("scene-synthetic.png"));
  await expect(page.locator("#model-select")).toBeVisible();
  if (model) await page.selectOption("#model-select", model);
}

const pageScroll = (page: Page) =>
  page.evaluate(() => ({
    y: document.documentElement.scrollHeight - window.innerHeight,
    x: document.documentElement.scrollWidth - window.innerWidth,
  }));

async function inViewport(page: Page, name: string) {
  const box = (await page
    .getByRole("button", { name, exact: true })
    .boundingBox())!;
  const vp = page.viewportSize()!;
  return (
    box.y >= 0 &&
    box.y + box.height <= vp.height &&
    box.x >= 0 &&
    box.x + box.width <= vp.width
  );
}

async function recordStages(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __stages: string[] };
    w.__stages = [];
    const note = () => {
      const t = document
        .querySelector("[data-testid=progress-stage]")
        ?.textContent?.replace(/\s*\d+%$/, "");
      if (t && w.__stages.at(-1) !== t) w.__stages.push(t);
    };
    new MutationObserver(note).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  return () =>
    page.evaluate(() => (window as unknown as { __stages: string[] }).__stages);
}

for (const [w, h] of SIZES) {
  test(`the editor fits ${w}x${h} without page scroll`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await load(page, "u2netp");
    expect(await pageScroll(page)).toEqual({ x: 0, y: 0 });
    expect(await inViewport(page, "Remove background")).toBe(true);
    await page
      .getByRole("button", { name: "Remove background", exact: true })
      .click();
    await expect(page.getByText("Done", { exact: true })).toBeVisible({
      timeout: 120000,
    });
    expect(await pageScroll(page)).toEqual({ x: 0, y: 0 });
    expect(await inViewport(page, "Remove background")).toBe(true);
    expect(await inViewport(page, "Download PNG")).toBe(true);
    const view = (await page
      .getByRole("group", { name: "View", exact: true })
      .boundingBox())!;
    const bg = (await page
      .getByRole("group", { name: "Preview background" })
      .boundingBox())!;
    expect(Math.abs(view.y - bg.y)).toBeLessThan(2);
  });
}

test("the image stays visible while processing, with stage changes, and the layout does not move", async ({
  page,
}) => {
  test.setTimeout(300000);
  await load(page);
  const box = page.getByTestId("preview-box");
  const before = await box.boundingBox();
  const stages = await recordStages(page);
  await page
    .getByRole("button", { name: "Remove background", exact: true })
    .click();
  const panel = page.getByTestId("progress-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByLabel("Original image")).toBeVisible();
  expect(await box.boundingBox()).toEqual(before);
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 240000,
  });
  await expect(panel).toBeHidden();
  expect(await box.boundingBox()).toEqual(before);
  const seen = await stages();
  expect(seen).toContain("Downloading model");
  expect(seen).toContain("Running model");
  expect(seen).toContain("Refining edges");
  expect(seen.indexOf("Downloading model")).toBeLessThan(
    seen.indexOf("Refining edges"),
  );
});

test("Cancel stops processing and restores the original", async ({ page }) => {
  await load(page);
  await page
    .getByRole("button", { name: "Remove background", exact: true })
    .click();
  await expect(page.getByTestId("progress-panel")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).press("Enter");
  await expect(page.getByText("Cancelled.")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("progress-panel")).toBeHidden();
  await expect(page.getByLabel("Original image")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Download PNG/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Remove background", exact: true }),
  ).toBeEnabled();
});

test("the progress panel and the mobile layout pass axe", async ({ page }) => {
  const audit = async (label: string) => {
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      ),
    );
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      violations.map((v) => `${label}: ${v.id} (${v.nodes.length})`),
    ).toEqual([]);
  };
  await load(page);
  await page
    .getByRole("button", { name: "Remove background", exact: true })
    .click();
  await expect(page.getByTestId("progress-panel")).toBeVisible();
  await audit("progress panel");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Cancelled.")).toBeVisible({ timeout: 30000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.selectOption("#model-select", "u2netp");
  await page
    .getByRole("button", { name: "Remove background", exact: true })
    .click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 120000,
  });
  await audit("mobile layout");
});
