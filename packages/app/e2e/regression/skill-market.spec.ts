import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1440, height: 1050 }, locale: "ru-RU" })

test("legacy Skill Market route redirects to the empty knowledge base", async ({ page }) => {
  await page.goto("/skills")
  await expect(page).toHaveURL(/\/knowledge$/)
  await expect(page.getByRole("heading", { name: "База знаний", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Начните свою историю знаний", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "База знаний Ваши материалы и связи", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: /Маркет скилов/ })).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole("heading", { name: "База знаний", exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
