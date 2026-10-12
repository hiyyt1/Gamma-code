import { expect, test } from "@playwright/test"
import { setupGamma, sessionURL } from "./fixture"

const baseline = process.env.GAMMA_LIGHT_BASELINE === "1"
test("mobile file panel, navigation, project form and settings", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  await page.setViewportSize({ width: 390, height: 900 })
  await page.emulateMedia({ colorScheme: baseline ? "light" : "dark" })
  await page.addInitScript(() =>
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    ),
  )
  await setupGamma(page)
  await page.goto(sessionURL)
  await expect(page.getByText("README.md", { exact: true })).toBeVisible()
  await page.getByText("README.md", { exact: true }).click()
  await expect(page.getByText("Светлый интерфейс", { exact: true })).toBeVisible()
  await expect(page).toHaveScreenshot("390-file.png")
  await page.getByRole("button", { name: "Рабочая область", exact: true }).click()
  await expect(page.getByRole("complementary", { name: "Рабочая область", exact: true })).toHaveCount(0)
  await page.getByRole("textbox", { name: "Промпт", exact: true }).fill("Текст на мобильном")
  await expect(page.getByRole("textbox", { name: "Промпт", exact: true })).toHaveText("Текст на мобильном")
  await page.getByRole("textbox", { name: "Промпт", exact: true }).fill("")
  await page.getByRole("textbox", { name: "Промпт", exact: true }).blur()
  await expect(page).toHaveScreenshot("390-chat-closed-panel.png")
  await page.getByRole("button", { name: "Переключить боковую панель", exact: true }).click()
  const sidebar = page.locator('[data-component="gamma-sidebar"]')
  await expect(sidebar.getByRole("button", { name: "Новый чат", exact: true })).toBeVisible()
  await expect(page).toHaveScreenshot("390-navigation.png")
  await sidebar.getByRole("button", { name: "Настройки", exact: true }).click()
  await expect(page.locator('[data-action="settings-ui-font"]')).toBeVisible()
  if (!baseline) {
    await expect(page.locator('[data-action="settings-color-scheme"]')).toHaveCount(0)
    await expect(page.locator('[data-action="settings-theme"]')).toHaveCount(0)
    await expect(page).toHaveScreenshot("390-settings-light-only.png")
  }
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Переключить боковую панель", exact: true, expanded: true }).click()
  await page.goto("/")
  await expect(page.locator(".gamma-dashboard-card")).toBeEnabled()
  await page.locator(".gamma-dashboard-primary").click()
  await page.getByRole("textbox", { name: "Название проекта", exact: true }).fill("Мобильный проект")
  await expect(page.getByRole("dialog").getByRole("button", { name: "Создать проект", exact: true })).toBeEnabled()
  await expect(page).toHaveScreenshot("390-create-project.png")
  await page.keyboard.press("Escape")
  expect(errors).toEqual([])
})
