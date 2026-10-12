import { expect, test, type Page, type Locator } from "@playwright/test"
import { setupGamma } from "./fixture"

const baseline = process.env.GAMMA_LIGHT_BASELINE === "1"
const profiles = baseline
  ? [{ name: "clean-light", os: "light" as const, saved: "" }]
  : [
      { name: "clean-light", os: "light" as const, saved: "" },
      { name: "clean-dark", os: "dark" as const, saved: "" },
      { name: "saved-dark", os: "light" as const, saved: "dark" },
      { name: "saved-system", os: "dark" as const, saved: "system" },
      { name: "stale-cache", os: "dark" as const, saved: "dark", custom: true },
    ]

async function readable(locator: Locator) {
  await expect(locator).toBeVisible()
  const contrast = await locator.evaluate((element) => {
    const rgba = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number)
    const over = (top: number[], bottom: number[]) =>
      top.slice(0, 3).map((v, i) => v * (top[3] ?? 1) + bottom[i] * (1 - (top[3] ?? 1)))
    const parents: Element[] = []
    for (let node: Element | null = element; node; node = node.parentElement) parents.push(node)
    const bg = parents
      .reverse()
      .reduce((result, node) => over(rgba(getComputedStyle(node).backgroundColor), result), [255, 255, 255])
    const fg = over(rgba(getComputedStyle(element).color), bg)
    const luminance = (rgb: number[]) =>
      rgb
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
    return (Math.max(luminance(bg), luminance(fg)) + 0.05) / (Math.min(luminance(bg), luminance(fg)) + 0.05)
  })
  await test.info().attach("contrast", {
    body: JSON.stringify({ element: await locator.textContent(), ratio: contrast }),
    contentType: "application/json",
  })
  expect(contrast).toBeGreaterThanOrEqual(4.5)
}

async function screenshot(page: Page, name: string, width: number) {
  await page.evaluate(() => document.fonts.ready)
  await expect(page).toHaveScreenshot(`${width}-${name}.png`, { maxDiffPixelRatio: 0.002 })
}

for (const width of [1440, 390])
  for (const profile of profiles) {
    test(`${width} ${profile.name}: pages and interactions`, async ({ page }, info) => {
      const errors: string[] = []
      page.on("pageerror", (error) => errors.push(error.message))
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text())
      })
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme: profile.os })
      await page.addInitScript((profile) => {
        if (sessionStorage.getItem("gamma-light-seeded")) return
        sessionStorage.setItem("gamma-light-seeded", "1")
        localStorage.setItem(
          "settings.v3",
          JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
        )
        if (profile.saved) localStorage.setItem("opencode-color-scheme", profile.saved)
        if ("custom" in profile && profile.custom) {
          localStorage.setItem("opencode-theme-id", "nightowl")
          localStorage.setItem(
            "opencode-theme-css-light",
            "--text-base:white;--v2-text-text-base:white;--v2-background-bg-base:black;",
          )
          localStorage.setItem("opencode-theme-css-dark", "--text-base:white;--v2-text-text-base:white;")
        }
      }, profile)
      await setupGamma(page)
      await page.goto("/")
      const card = page
        .locator(".gamma-dashboard-card")
        .filter({ has: page.getByRole("heading", { name: "Gamma Light", exact: true }) })
      await expect(card).toBeEnabled()
      await readable(card)
      await screenshot(page, "home", width)
      await card.click()
      await expect(page.getByRole("heading", { name: "Проверка интерфейса", exact: true })).toBeVisible()
      await expect(page.getByText("Текст ответа должен быть видимым.", { exact: true })).toBeVisible()
      await readable(page.getByText("Текст ответа должен быть видимым.", { exact: true }))
      const input = page.locator('[contenteditable="true"]')
      await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeDisabled()
      await input.fill("Проверка ввода")
      await expect(input).toHaveText("Проверка ввода")
      await readable(input)
      await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled()
      await input.fill("")
      await input.blur()
      await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeDisabled()
      await screenshot(page, "chat", width)
      if (width === 1440) {
        await expect(page.getByText("README.md", { exact: true })).toBeVisible()
        await page.getByText("README.md", { exact: true }).click()
        await expect(page.getByText("Светлый интерфейс", { exact: true })).toBeVisible()
        await screenshot(page, "file", width)
        const newChat = page.getByRole("button", { name: "Новый чат", exact: true })
        await readable(newChat)
        await newChat.hover()
        await readable(newChat)
        await newChat.focus()
        await expect(newChat).toBeFocused()
        await newChat.click()
        await expect(page.getByRole("heading", { name: "Создавайте что угодно", exact: true })).toBeVisible()
        await screenshot(page, "new-chat", width)
        await page.goto("/")
        await expect(card).toBeEnabled()
        await page.locator(".gamma-dashboard-primary").click()
        await expect(page.getByRole("dialog")).toBeVisible()
        const create = page.getByRole("dialog").getByRole("button", { name: "Создать проект", exact: true })
        await expect(create).toBeDisabled()
        await page.getByRole("textbox", { name: "Название проекта", exact: true }).fill("Новый проект")
        await expect(create).toBeEnabled()
        await readable(create)
        await screenshot(page, "create-project", width)
        await page.keyboard.press("Escape")
        await expect(page.getByRole("dialog")).toHaveCount(0)
      }
      await page.goto("/agents")
      const agent = page
        .getByRole("article")
        .filter({ has: page.getByRole("heading", { name: "Тестовый дизайнер", exact: true }) })
      await expect(agent.getByRole("button", { name: "Использовать", exact: true })).toBeEnabled()
      await readable(agent.getByRole("button", { name: "Использовать", exact: true }))
      await screenshot(page, "agents", width)
      await page.getByRole("searchbox").fill("не существует")
      await expect(page.getByRole("article")).toHaveCount(0)
      await page.getByRole("searchbox").fill("дизайнер")
      await expect(agent).toBeVisible()
      await agent.getByRole("button", { name: "Подробнее", exact: true }).click()
      await expect(page.getByRole("dialog")).toContainText("Проверка интерфейса")
      await screenshot(page, "agent-details", width)
      await page.keyboard.press("Escape")
      await page.goto("/knowledge")
      await expect(page.getByRole("heading", { name: "Начните свою историю знаний", exact: true })).toBeVisible()
      await readable(page.getByRole("heading", { name: "Начните свою историю знаний", exact: true }))
      await screenshot(page, "knowledge", width)
      await page.getByRole("button", { name: "Создать пространство", exact: true }).click()
      const knowledgeDialog = page.getByRole("dialog")
      await knowledgeDialog.getByRole("textbox", { name: "Название", exact: true }).fill("Знания Gamma")
      await readable(knowledgeDialog.getByRole("textbox", { name: "Название", exact: true }))
      await screenshot(page, "knowledge-dialog", width)
      await knowledgeDialog.getByRole("button", { name: "Отмена", exact: true }).click()
      await expect(knowledgeDialog).not.toBeVisible()
      if (width === 1440) {
        await page.getByRole("button", { name: /gamma-test/ }).click()
        await expect(page.getByRole("menuitem", { name: "Открыть настройки", exact: true })).toBeVisible()
        await screenshot(page, "profile-menu", width)
        await page.getByRole("menuitem", { name: "Открыть настройки", exact: true }).click()
        await expect(page.locator('[data-action="settings-ui-font"]')).toBeVisible()
        if (!baseline) {
          await expect(page.locator('[data-action="settings-color-scheme"]')).toHaveCount(0)
          await expect(page.locator('[data-action="settings-theme"]')).toHaveCount(0)
          await screenshot(page, "settings-light-only", width)
        }
        await page.keyboard.press("Escape")
      }
      if (!baseline) {
        await page.emulateMedia({ colorScheme: profile.os === "dark" ? "light" : "dark" })
        await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
        await page.reload()
        await expect(page.getByRole("heading", { name: "Начните свою историю знаний", exact: true })).toBeVisible()
        await expect(page.locator("html")).toHaveCSS("color-scheme", "light only")
        expect(
          await page.evaluate(() => ({
            scheme: localStorage.getItem("opencode-color-scheme"),
            theme: localStorage.getItem("opencode-theme-id"),
            light: localStorage.getItem("opencode-theme-css-light"),
            dark: localStorage.getItem("opencode-theme-css-dark"),
          })),
        ).toEqual({ scheme: "light", theme: "oc-2", light: null, dark: null })
        await screenshot(page, "knowledge", width)
      }
      await info.attach("console", { body: JSON.stringify(errors), contentType: "application/json" })
      expect(errors).toEqual([])
    })
  }
