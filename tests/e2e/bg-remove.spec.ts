import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { unzipSync } from "fflate";

const fixture = (name: string) =>
  fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

function pngSize(buf: Uint8Array): [number, number] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return [v.getUint32(16), v.getUint32(20)];
}

async function open(page: Page, ...files: string[]) {
  await page.goto("/");
  await page.getByRole("tab", { name: "Remove background" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(files.map(fixture));
  await page.selectOption("#model-select", "u2netp");
}

async function downloadBytes(
  page: Page,
  button: string | RegExp,
): Promise<{ name: string; bytes: Uint8Array }> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: button }).click();
  const dl = await pending;
  return {
    name: dl.suggestedFilename(),
    bytes: new Uint8Array(fs.readFileSync((await dl.path())!)),
  };
}

test("background removal flow", async ({ page }) => {
  await open(page, "small.png");
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 120000,
  });
  await expect(page.locator("canvas").first()).toBeVisible();

  const { name, bytes } = await downloadBytes(page, "Download PNG");
  expect(name).toBe("small-nobg.png");
  expect(pngSize(bytes)).toEqual([64, 64]);
});

test("respects EXIF orientation and exports at original resolution", async ({
  page,
}) => {
  await open(page, "rotated-exif6.jpg");
  await expect(page.getByText("20×40", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 120000,
  });
  const { bytes } = await downloadBytes(page, "Download PNG");
  expect(pngSize(bytes)).toEqual([20, 40]);
});

test("batch mode processes a queue and downloads a ZIP", async ({ page }) => {
  await open(page, "small.png", "small2.png");
  await expect(
    page.getByRole("list", { name: "Images" }).getByRole("listitem"),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByText("Done: 2 images processed")).toBeVisible({
    timeout: 120000,
  });

  const { name, bytes } = await downloadBytes(page, /Download ZIP/);
  expect(name).toBe("offpix-nobg.zip");
  const entries = unzipSync(bytes);
  expect(Object.keys(entries).sort()).toEqual([
    "small-nobg.png",
    "small2-nobg.png",
  ]);
  expect(pngSize(entries["small2-nobg.png"])).toEqual([32, 32]);
});

test("brush edits can be undone and compare view works", async ({ page }) => {
  await open(page, "small.png");
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 120000,
  });

  const undoBtn = page.getByRole("button", { name: "Undo" });
  await expect(undoBtn).toBeDisabled();
  const result = page.getByLabel(/^Result: drag/);
  await result.scrollIntoViewIfNeeded();
  const box = (await result.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(undoBtn).toBeEnabled();
  await undoBtn.click();
  await expect(undoBtn).toBeDisabled();
  await expect(page.getByRole("button", { name: "Redo" })).toBeEnabled();

  await page.getByRole("button", { name: "Compare" }).click();
  await expect(
    page.getByLabel("Before/after comparison position"),
  ).toBeVisible();
});

test("pasting an image loads it", async ({ page }) => {
  await page.goto("/");
  const b64 = fs.readFileSync(fixture("small.png")).toString("base64");
  await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt }));
  }, b64);
  await expect(page.getByText("64×64", { exact: true })).toBeVisible();
});

test("unsupported files get a clear message", async ({ page }) => {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("notes.txt"));
  await expect(page.getByRole("alert")).toContainText(
    "only PNG, JPEG and WebP",
  );
});

async function alphaAt(
  page: Page,
  png: Uint8Array,
  fx: number,
  fy: number,
): Promise<number> {
  return page.evaluate(
    async ([b64, x, y]) => {
      const bm = await createImageBitmap(
        new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], {
          type: "image/png",
        }),
      );
      const c = new OffscreenCanvas(bm.width, bm.height);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bm, 0, 0);
      return ctx.getImageData(
        Math.round(x * bm.width),
        Math.round(y * bm.height),
        1,
        1,
      ).data[3];
    },
    [Buffer.from(png).toString("base64"), fx, fy] as const,
  );
}

test("Erase removes and Restore brings back what the brush paints", async ({
  page,
}) => {
  await open(page, "scene-synthetic.png");
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 120000,
  });
  await page.getByText("Advanced").click();
  await page.getByLabel("Feather").fill("0");
  await expect(page.getByRole("button", { name: "Erase" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const result = page.getByLabel(/^Result: drag to/);
  await result.scrollIntoViewIfNeeded();
  const sky = { fx: 0.45, fy: 0.12 };
  const stroke = async () => {
    const before = (await result.boundingBox())!;
    await result.hover({
      position: { x: before.width * sky.fx, y: before.height * sky.fy },
    });
    const b = (await result.boundingBox())!;
    const x = b.x + b.width * sky.fx,
      y = b.y + b.height * sky.fy;
    await page.mouse.move(x - 10, y);
    await page.mouse.down();
    await page.mouse.move(x + 10, y, { steps: 4 });
    await page.mouse.up();
  };
  expect(
    await alphaAt(
      page,
      (await downloadBytes(page, "Download PNG")).bytes,
      sky.fx,
      sky.fy,
    ),
  ).toBeLessThan(30);

  await result.hover();
  await page.keyboard.press("x");
  await expect(page.getByRole("button", { name: "Restore" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(result).toHaveAccessibleName(/restore \(bring back\)/);
  await stroke();
  expect(
    await alphaAt(
      page,
      (await downloadBytes(page, "Download PNG")).bytes,
      sky.fx,
      sky.fy,
    ),
  ).toBeGreaterThan(220);

  await page.getByRole("button", { name: "Erase" }).click();
  await stroke();
  expect(
    await alphaAt(
      page,
      (await downloadBytes(page, "Download PNG")).bytes,
      sky.fx,
      sky.fy,
    ),
  ).toBeLessThan(30);
});

test("GPU-only models are hidden without WebGPU, with the reason", async ({
  page,
}) => {
  // Headless Chromium exposes no WebGPU adapter.
  await page.goto("/");
  await page.getByRole("tab", { name: "Remove background" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("small.png"));
  await page.getByText("Model details").click();
  await expect(
    page.getByText(
      /Not available on this device: Max quality: BiRefNet Lite 1024 .*needs WebGPU/,
    ),
  ).toBeVisible({ timeout: 30000 });
  const options = await page.locator("#model-select option").allTextContents();
  expect(options.some((o) => o.includes("needs a strong GPU"))).toBe(false);
});

test("low device memory hides the heavy CPU model, with the reason", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "deviceMemory", {
      get: () => 4,
    }),
  );
  await page.goto("/");
  await page.getByRole("tab", { name: "Remove background" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("small.png"));
  await page.getByText("Model details").click();
  await expect(
    page.getByText(
      /BiRefNet Lite 512 .*: needs more memory than this device reports \(4 GB\)/,
    ),
  ).toBeVisible({ timeout: 30000 });
  expect(
    (await page.locator("#model-select option").allTextContents()).some((o) =>
      o.includes("BiRefNet Lite 512"),
    ),
  ).toBe(false);
});

test("an out-of-memory failure stops cleanly and falls back to the next tier", async ({
  page,
}) => {
  test.skip(
    !!process.env.E2E_BASE_URL,
    "needs the dev-only ?simulateOom hook (stripped from builds)",
  );
  await page.goto("/?simulateOom=birefnet-lite-512");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("tab", { name: "Remove background" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("small.png"));
  await page.selectOption("#model-select", "birefnet-lite-512");
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByRole("alert")).toContainText(
    /BiRefNet Lite 512 .*could not run on this device.*out of memory/,
    { timeout: 60000 },
  );
  await page.getByText("Model details").click();
  await expect(
    page.getByText(
      /Not available on this device:.*BiRefNet Lite 512 [^:]*: could not run on this device \(out of memory/,
    ),
  ).toBeVisible();
  expect(await page.locator("#model-select").inputValue()).toBe(
    "isnet-general-use",
  );
  await page.selectOption("#model-select", "u2netp");
  const t0 = Date.now();
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: Number(process.env.E2E_SLOW_MS ?? 120000),
  });
  console.log(
    `next tier finished in ${Math.round((Date.now() - t0) / 1000)} s`,
  );
});

test("fresh profile: BiRefNet Lite 512 is the default where it can run", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("tab", { name: "Remove background" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("small.png"));
  await expect(page.locator("#model-select")).toHaveValue("birefnet-lite-512", {
    timeout: 30000,
  });
  await expect(
    page.locator('#model-select option[value="birefnet-lite-512"]'),
  ).toContainText(/MB CPU \/ .* MB GPU/);
});

test("processing cap: above it the image is processed and saved smaller, and the UI says so", async ({
  page,
}) => {
  test.setTimeout(300000);
  await page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "deviceMemory", {
      get: () => 4,
    }),
  );
  await page.goto("/");
  await page.getByRole("tab", { name: "Remove background" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("huge-16.8mp.png"));
  await page.selectOption("#model-select", "u2netp");
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 240000,
  });
  await expect(
    page
      .getByRole("note")
      .filter({
        hasText:
          /Large image \(16\.8 MP\): processed and saved at \d+×\d+ \(1[12]\.\d MP\)/,
      }),
  ).toBeVisible();
  const { bytes } = await downloadBytes(page, "Download PNG");
  const [w, h] = pngSize(bytes);
  expect(w * h).toBeLessThanOrEqual(12e6);
  expect(w).toBe(h);
});

test("below the cap: exported at the original resolution", async ({ page }) => {
  test.setTimeout(300000);
  await page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "deviceMemory", {
      get: () => 8,
    }),
  );
  await page.goto("/");
  await page.getByRole("tab", { name: "Remove background" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture("huge-16.8mp.png"));
  await page.selectOption("#model-select", "u2netp");
  await page.getByRole("button", { name: "Remove background" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({
    timeout: 240000,
  });
  await expect(
    page.getByText("Saved at full resolution (4100×4100)."),
  ).toBeVisible();
  expect(pngSize((await downloadBytes(page, "Download PNG")).bytes)).toEqual([
    4100, 4100,
  ]);
});
