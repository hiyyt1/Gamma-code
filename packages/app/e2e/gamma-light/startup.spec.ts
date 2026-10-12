import { expect, test } from "@playwright/test"
import { setupGamma } from "./fixture"

test.skip(process.env.GAMMA_LIGHT_BASELINE === "1", "New startup contract")

for (const blocked of [false, true])
  test(`light before module execution; blocked storage=${blocked}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" })
    await page.addInitScript((blocked) => {
      if (blocked) {
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new DOMException("Storage denied", "SecurityError")
          },
        })
        return
      }
      localStorage.setItem("opencode-color-scheme", "dark")
      localStorage.setItem("opencode-theme-id", "nightowl")
      localStorage.setItem("opencode-theme-css-dark", "--text-base:white;--background-base:black;")
    }, blocked)
    // Hold all module scripts, while allowing the blocking preload and CSS to run.
    await page.route("**/assets/*.js", (route) => route.fulfill({ contentType: "text/javascript", body: "" }))
    await page.goto("/")
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
    await expect(page.locator("html")).toHaveAttribute("data-theme", "oc-2")
    await expect(page.locator("html")).toHaveCSS("color-scheme", "light only")
    await expect(page.locator("html")).toHaveCSS("background-color", "rgb(250, 250, 250)")
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--text-base").trim()),
    ).toBe("#6f6f6f")
    await expect(page.locator("#oc-theme-preload")).toHaveCount(0)
  })

test("older tab cannot switch the mounted application back to dark", async ({ page, context }) => {
  await setupGamma(page)
  await page.goto("/")
  await expect(page.locator(".gamma-dashboard-card")).toBeEnabled()
  const other = await context.newPage()
  await setupGamma(other)
  await other.goto("/")
  await expect(other.locator(".gamma-dashboard-card")).toBeEnabled()
  await other.evaluate(() => {
    localStorage.setItem("opencode-color-scheme", "dark")
    localStorage.setItem("opencode-theme-id", "nightowl")
    localStorage.setItem("opencode-theme-css-dark", "--text-base:white;")
  })
  await expect.poll(() => page.evaluate(() => localStorage.getItem("opencode-color-scheme"))).toBe("light")
  await expect.poll(() => page.evaluate(() => localStorage.getItem("opencode-theme-id"))).toBe("oc-2")
  await expect.poll(() => page.evaluate(() => localStorage.getItem("opencode-theme-css-dark"))).toBeNull()
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
  await page.keyboard.press("Control+Shift+S")
  await page.keyboard.press("Control+Shift+T")
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
  await page.emulateMedia({ colorScheme: "dark" })
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light only")
})
