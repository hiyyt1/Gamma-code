import { expect, test } from "@playwright/test"
import { setupGamma, sessionURL } from "./fixture"

test.skip(process.env.GAMMA_LIGHT_BASELINE === "1", "New loading contract")

for (const width of [1440, 390])
  test(`file loading preserves controls at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ colorScheme: "dark" })
    await setupGamma(page)
    let release!: () => void
    const content = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route("**/product/session/*/content?*", async (route) => {
      await content
      await route.fulfill({ json: { type: "text", content: "Готовый файл", mimeType: "text/plain" } })
    })
    await page.goto(sessionURL)
    await page.getByText("README.md", { exact: true }).click()
    const preview = page.locator(".workspace-files-preview")
    await expect(preview.getByRole("status")).toContainText("Загрузка")
    await expect(preview.getByRole("button")).toBeVisible()
    await expect(preview.getByRole("button")).toBeEnabled()
    await preview.getByRole("button").click({ trial: true })
    await page.screenshot({ path: info.outputPath("file-loading.png") })
    release()
    await expect(preview.getByText("Готовый файл", { exact: true })).toBeVisible()
    await expect(preview.getByRole("status")).toHaveCount(0)
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
  })
