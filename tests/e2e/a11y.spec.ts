import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fileURLToPath } from "node:url";

const fixture = (name: string) =>
  fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

async function audit(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = violations.map(
    (v) =>
      `${label}: [${v.impact}] ${v.id} (${v.nodes.length}) ${v.nodes
        .slice(0, 2)
        .map((n) => n.target.join(" "))
        .join(" | ")}`,
  );
  expect(summary).toEqual([]);
}

for (const theme of ["light", "dark"] as const) {
  test(`no WCAG A/AA violations (${theme} theme)`, async ({ page }) => {
    await page.addInitScript((t) => {
      try {
        localStorage.setItem("theme", JSON.stringify(t));
      } catch {
        /* ignore */
      }
    }, theme);
    await page.goto("/");
    await audit(page, "empty");

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(fixture("notes.txt"));
    await expect(page.getByRole("alert")).toBeVisible();
    await audit(page, "rejected file");

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles([fixture("small.png"), fixture("small2.png")]);
    await page.selectOption("#model-select", "u2netp");
    await page.getByRole("button", { name: "Remove background" }).click();
    await expect(page.getByText(/^Done:/)).toBeVisible({ timeout: 120000 });
    await audit(page, "remove-bg result");
    await page.getByText("Advanced").click();
    await page.getByLabel("Feather").fill("3");
    await audit(page, "remove-bg advanced");

    await page.getByRole("tab", { name: "Upscale" }).click();
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(fixture("small2.png"));
    await page.selectOption("#model-select", "realesr-general-x4v3");
    await page.getByRole("button", { name: "Upscale", exact: true }).click();
    await expect(page.getByText(/^Done in/)).toBeVisible({ timeout: 120000 });
    await audit(page, "upscale result");

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
    await audit(page, "count result");

    await page.getByRole("button", { name: "About" }).click();
    await expect(
      page.getByRole("dialog", { name: "About offpix" }),
    ).toBeVisible();
    await audit(page, "about");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });
}

test("tool tabs are keyboard operable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Remove background" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Upscale" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Upscale" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("tab", { name: "Remove background" }),
  ).toHaveAttribute("aria-selected", "true");
});
