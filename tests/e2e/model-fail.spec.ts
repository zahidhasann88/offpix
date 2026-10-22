import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'

test('model download failure path', async ({ page }) => {
  await page.route('**/models/u2netp.onnx', route => route.abort())
  await page.goto('/')
  await page.getByRole('tab', { name: 'Remove background' }).click()
  const fileInput = page.locator('input[type="file"]').first()
  await fileInput.setInputFiles(fileURLToPath(new URL('fixtures/small.png', import.meta.url)))
  await page.selectOption('#model-select', 'u2netp')
  await page.getByRole('button', { name: 'Remove background' }).click()
  await expect(page.getByText(/Error:/)).toBeVisible({ timeout: 30000 })
})
