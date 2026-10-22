import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const fixture = (name: string) =>
  fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const total = (page: Page) => page.getByTestId("count-total");

function pngSize(buf: Uint8Array): [number, number] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return [v.getUint32(16), v.getUint32(20)];
}

// The street photo is not in the repo (see fixtures/ATTRIBUTION.md); without it these tests skip.
const PHOTO = "street.jpg";
test.skip(!fs.existsSync(fixture(PHOTO)), `needs tests/e2e/fixtures/${PHOTO}`);

/** Count the street photo with YOLOX Nano. */
async function count(page: Page, tiled: boolean) {
  await page.goto("/");
  await page.getByRole("tab", { name: "Count objects" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture(PHOTO));
  await page.selectOption("#model-select", "yolox-nano");
  await page.getByLabel(/Find small objects/).setChecked(tiled);
  await page.getByRole("button", { name: "Count objects" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 120000,
  });
}

async function chipCount(page: Page, label: string): Promise<number> {
  const text = await page
    .getByRole("group", { name: "What to count" })
    .getByRole("button", { name: new RegExp(`^${label} \\d+$`) })
    .textContent();
  return Number(text!.match(/(\d+)$/)![1]);
}

test("counts people, cars and traffic lights in a street photo", async ({
  page,
}) => {
  await count(page, false);
  expect(await chipCount(page, "person")).toBeGreaterThanOrEqual(9);
  expect(await chipCount(page, "person")).toBeLessThanOrEqual(11);
  expect(await chipCount(page, "car")).toBeGreaterThanOrEqual(1);
  expect(await chipCount(page, "traffic light")).toBeGreaterThanOrEqual(3);

  await page.getByRole("button", { name: /^person \d+$/ }).click();
  await expect(total(page)).toHaveText(String(await chipCount(page, "person")));
  await expect(page.getByText("person", { exact: true })).toBeVisible();
});

test("finding small objects scans tiles and finds more people", async ({
  page,
}) => {
  await count(page, false);
  const single = await chipCount(page, "person");
  await page.getByLabel(/Find small objects/).check();
  await page.getByRole("button", { name: "Count objects" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 120000,
  });
  expect(await chipCount(page, "person")).toBeGreaterThanOrEqual(single + 5);
});

test("the count can be corrected and exported", async ({ page }) => {
  await count(page, false);
  await page.getByRole("button", { name: /^person \d+$/ }).click();
  const start = Number(await total(page).textContent());

  await page.getByText(/^Detections \(\d+\)$/).click();
  await page
    .getByRole("checkbox", { name: /^person/ })
    .first()
    .uncheck();
  await expect(total(page)).toHaveText(String(start - 1));

  await page.getByRole("button", { name: "Add missed" }).click();
  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.9 } });
  await expect(total(page)).toHaveText(String(start));
  await expect(page.getByText("1 excluded, 1 added by hand.")).toBeVisible();

  const csvDl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csv = fs
    .readFileSync((await (await csvDl).path())!, "utf8")
    .trim()
    .split("\n");
  expect(csv[0]).toBe("id,label,score,x1,y1,x2,y2,status");
  expect(csv.filter((l) => l.endsWith(",counted"))).toHaveLength(start - 1);
  expect(csv.filter((l) => l.endsWith(",excluded"))).toHaveLength(1);
  expect(csv.filter((l) => l.endsWith(",manual"))).toHaveLength(1);

  const pngDl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download image" }).click();
  const png = await pngDl;
  expect(png.suggestedFilename()).toBe("street-count.png");
  expect(pngSize(new Uint8Array(fs.readFileSync((await png.path())!)))).toEqual(
    [960, 720],
  );

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(total(page)).toHaveText(String(start));
  await expect(page.getByText(/added by hand/)).toBeHidden();
});

test("confidence slider changes the count without re-running", async ({
  page,
}) => {
  await count(page, false);
  const atDefault = Number(await total(page).textContent());
  await page.getByLabel("Confidence").fill("0.1");
  expect(Number(await total(page).textContent())).toBeGreaterThan(atDefault);
  await page.getByLabel("Confidence").fill("0.9");
  expect(Number(await total(page).textContent())).toBeLessThan(atDefault);
});
