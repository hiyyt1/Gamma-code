// Read-only audit of an existing session. No prompt submission or history changes.
// bun run e2e/preview-layout-audit.ts <sessionID> <directory>
import { chromium, expect } from "@playwright/test"

const [sessionID, directory] = process.argv.slice(2)
if (!sessionID || !directory) throw new Error("sessionID and directory required")
const backend = process.env.PREVIEW_AUDIT_BACKEND ?? "http://127.0.0.1:4108"
const origin = process.env.PREVIEW_AUDIT_ORIGIN ?? "http://localhost:4456"
const history = () => fetch(`${backend}/session/${sessionID}/message`).then((response) => response.text())
const before = await history()
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
try {
  await page.route("**/*", (route) =>
    ["POST", "PUT", "PATCH", "DELETE"].includes(route.request().method()) ? route.abort() : route.continue(),
  )
  await page.goto(`${origin}/${Buffer.from(directory).toString("base64url")}/session/${sessionID}`)
  const card = page.getByRole("article", { name: "Созданный сайт" })
  await expect(card).toBeVisible({ timeout: 30_000 })
  await expect(card.getByRole("status")).toContainText("Предпросмотр отключён или не настроен")
  await expect(card.getByRole("button", { name: "Открыть сайт" })).toBeDisabled()
  const measure = () =>
    page.locator(".gamma-assistant-response").evaluateAll((elements) =>
      elements.map((element) => {
        const text = element.querySelector('[data-component="text-part"]')
        return { width: element.getBoundingClientRect().width, text: text?.getBoundingClientRect().width }
      }),
    )
  const withCard = await measure()
  const hidden = await page.addStyleTag({ content: ".gamma-site-result-row { display: none; }" })
  expect(await measure()).toEqual(withCard)
  await hidden.evaluate((element) => element.remove())
  for (const view of ["files-open", "files-closed", "narrow"] as const) {
    if (view === "files-closed") await page.getByRole("button", { name: "Рабочая область", exact: true }).click()
    if (view === "narrow") await page.setViewportSize({ width: 390, height: 844 })
    await card.scrollIntoViewIfNeeded()
    await expect
      .poll(() =>
        card.evaluate((element) => {
          const row = element.closest('[data-timeline-row="AssistantPart"]')!
          const text = row.querySelector('[data-component="text-part"]')!.getBoundingClientRect()
          const box = element.getBoundingClientRect()
          return box.y >= text.bottom && box.width <= text.width + 1 && Math.abs(box.x - text.x) < 1
        }),
      )
      .toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `/tmp/preview-real-${view}.png`, fullPage: true })
    console.log(view, JSON.stringify(await measure()))
  }
  await page.reload()
  await expect(card).toHaveCount(1)
  await expect(card.getByRole("status")).toContainText("Предпросмотр отключён или не настроен")
  expect(await history()).toBe(before)
  console.log(
    "PASS: real session, unchanged history, full message widths, card below answer, open/closed files, narrow viewport, reload, precise unconfigured state",
  )
} finally {
  await browser.close()
}
