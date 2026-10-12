import { expect, test } from "@playwright/test"

test.skip(process.env.GAMMA_ONBOARDING_E2E !== "1", "Requires an isolated Gamma product backend")
test.use({ viewport: { width: 1440, height: 1000 }, locale: "en-US", reducedMotion: "reduce" })
const backend = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test("empty dashboard offers project creation and scenario context without a composer", async ({ page }, info) => {
  const writes: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url())
  })
  await page.route("**/product/projects", (route) => route.fulfill({ json: [] }))
  await page.route("**/api/session?*", (route) => route.fulfill({ json: { data: [], cursor: {} } }))
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Что создадим сегодня?", exact: true })).toBeVisible()
  const create = page.getByRole("button", { name: "Создать первый проект", exact: true })
  await expect(create).toBeEnabled()
  await expect(page.getByRole("textbox")).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("empty-desktop.png"), animations: "disabled" })
  await create.click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("textbox", { name: "Название проекта", exact: true })).toBeEditable()
  await page.keyboard.press("Escape")
  for (const scenario of [
    { name: "Сайт Лендинг или сайт компании", context: /Создай сайт для кофейни/ },
    { name: "Telegram-бот Бот с командами и логикой", context: /команда \/start/ },
    { name: "Веб-приложение Личный кабинет, CRM или сервис", context: /Создай небольшую CRM/ },
    { name: "Другой проект Начните со своей идеи" },
  ]) {
    await page.getByRole("button", { name: scenario.name, exact: true }).click()
    await expect(dialog.getByRole("textbox", { name: "Название проекта", exact: true })).toBeEditable()
    if (scenario.context) await expect(dialog.getByText(scenario.context)).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
  }
  await page.reload()
  await expect(create).toBeEnabled()
  await page.getByRole("button", { name: "Новый чат", exact: true }).click()
  await expect(dialog.getByText("Где будем работать?", { exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  for (const link of ["Готовые агенты Готовые решения", "Маркет скилов Расширения для агента"]) {
    await page.getByRole("link", { name: link, exact: true }).click()
    await page.getByRole("link", { name: "Gamma", exact: true }).click()
    await expect(create).toBeEnabled()
  }
  expect(writes.filter((url) => /\/(session|product\/projects)(?:\?|$)/.test(url))).toHaveLength(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: info.outputPath("empty-mobile.png"), animations: "disabled", fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("two real projects render as a grid and an empty project opens its workspace", async ({ page, request }, info) => {
  const suffix = Date.now()
  const projects: { name: string; path: string }[] = []
  for (const name of [`Coffee Studio ${suffix}`, `Telegram Assistant ${suffix}`]) {
    const response = await request.post(`${backend}/product/projects`, { data: { name } })
    expect(response.ok()).toBe(true)
    projects.push(await response.json())
  }
  // Isolate the visible account; both directories above are real backend projects.
  await page.route("**/product/projects", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: projects })
    await route.continue()
  })
  await page.route("**/api/session?*", (route) => route.fulfill({ json: { data: [], cursor: {} } }))
  const sessions: { id: string; directory: string }[] = []
  const writes: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/product/projects" && request.method() === "POST")
      writes.push(request.url())
  })
  page.on("response", async (response) => {
    if (new URL(response.url()).pathname === "/session" && response.request().method() === "POST")
      sessions.push(await response.json())
  })
  await page.goto("/")
  const dashboard = page.getByRole("region", { name: "Мои проекты", exact: true })
  await expect(dashboard.getByRole("heading", { level: 2 })).toHaveCount(2)
  await expect(page.getByRole("heading", { name: "Что создадим сегодня?", exact: true })).toHaveCount(0)
  await expect(page.getByRole("textbox")).toHaveCount(0)
  const card = dashboard.getByRole("button", { name: `${projects[0].name} Открыть`, exact: true })
  await expect(card).toBeEnabled()
  await page.screenshot({ path: info.outputPath("projects-desktop.png"), animations: "disabled" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: info.outputPath("projects-mobile.png"), fullPage: true, animations: "disabled" })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole("button", { name: "Новый проект", exact: true }).click()
  await expect(page.getByRole("dialog").getByRole("textbox", { name: "Название проекта", exact: true })).toBeEditable()
  await page.keyboard.press("Escape")
  await card.click()
  await expect(page.getByRole("textbox", { name: "Промпт", exact: true })).toBeEditable()
  await expect.poll(() => sessions.length).toBe(1)
  expect(sessions[0].directory).toBe(projects[0].path)
  await page.getByRole("button", { name: "Новый чат", exact: true }).click()
  await expect.poll(() => sessions.length).toBe(2)
  expect(sessions[1].directory).toBe(projects[0].path)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.getByRole("link", { name: "Gamma", exact: true }).click()
  await expect(dashboard.getByRole("heading", { level: 2 })).toHaveCount(2)
  await page.reload()
  await expect(dashboard.getByRole("heading", { level: 2 })).toHaveCount(2)
  expect(sessions).toHaveLength(2)
  expect(writes).toHaveLength(0)
})

test("scenario creates one project and message then reopens the same session", async ({ page, request }) => {
  const name = `dashboard-${Date.now()}`
  const projects: { name: string; path: string }[] = []
  const sessions: string[] = []
  const sent: { parts: { type: string; text: string }[] }[] = []
  const writes: string[] = []
  await page.route("**/product/projects", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: projects })
    writes.push(route.request().url())
    const response = await route.fetch()
    projects.push(await response.json())
    await route.fulfill({ response })
  })
  page.on("response", async (response) => {
    if (new URL(response.url()).pathname === "/session" && response.request().method() === "POST")
      sessions.push((await response.json()).id)
  })
  await page.route("**/session/*/prompt_async*", async (route) => {
    const body = route.request().postDataJSON()
    sent.push(body)
    // Exercise durable admission without running a provider in this UI test.
    const response = await route.fetch({ postData: { ...body, noReply: true } })
    await route.fulfill({ response })
  })
  await page.goto("/")
  await page.getByRole("button", { name: "Сайт Лендинг или сайт компании", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText(/Создай сайт для кофейни/)).toBeVisible()
  await dialog.getByRole("textbox", { name: "Название проекта", exact: true }).fill(name)
  await dialog.locator("form").evaluate((form: HTMLFormElement) => {
    form.requestSubmit()
    form.requestSubmit()
  })
  await expect.poll(() => sent.length).toBe(1)
  await expect.poll(() => sessions.length).toBe(1)
  const text = sent[0].parts.find((part) => part.type === "text")!.text
  await expect(page.getByText(text, { exact: true })).toBeVisible()
  const sessionURL = page.url()
  const response = await request.get(`${backend}/session/${sessions[0]}/message`, {
    headers: { "x-opencode-directory": projects[0].path },
  })
  const messages = await response.json()
  expect(messages.filter((item: { info: { role: string } }) => item.info.role === "user")).toHaveLength(1)
  await page.reload()
  await expect(page.getByText(text, { exact: true })).toBeVisible()
  await page.getByRole("link", { name: "Gamma", exact: true }).click()
  await page
    .getByRole("region", { name: "Мои проекты", exact: true })
    .getByRole("button", { name: `${name} Открыть`, exact: true })
    .click()
  await expect(page).toHaveURL(sessionURL)
  await expect(page.getByText(text, { exact: true })).toBeVisible()
  expect(sessions).toHaveLength(1)
  expect(sent).toHaveLength(1)
  expect(writes).toHaveLength(1)
})

test("project loading failure has a retry state instead of a false empty dashboard", async ({ page }) => {
  await page.route("**/product/projects", (route) => route.fulfill({ status: 503, json: { code: "unavailable" } }))
  await page.goto("/")
  await expect(page.getByRole("alert")).toContainText("Не удалось загрузить проекты")
  await expect(page.getByRole("button", { name: "Создать первый проект", exact: true })).toHaveCount(0)
  await page.unroute("**/product/projects")
  await page.getByRole("button", { name: "Повторить", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Мои проекты", exact: true })).toBeVisible()
})

test("invalid project name stays in the existing creation form", async ({ page }) => {
  await page.route("**/product/projects", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] })
    await route.continue()
  })
  await page.goto("/")
  await page.getByRole("button", { name: "Создать первый проект", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("textbox", { name: "Название проекта", exact: true }).fill("invalid/name")
  await dialog.getByRole("button", { name: "Создать проект", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("Введите название")
  await expect(dialog.getByRole("textbox", { name: "Название проекта", exact: true })).toHaveValue("invalid/name")
})

test("session retry reuses the directory created by the existing project flow", async ({ page }) => {
  const projects: string[] = []
  const attempts: string[] = []
  await page.route("**/product/projects", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] })
    projects.push(route.request().url())
    await route.continue()
  })
  await page.route(/\/session(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    attempts.push(route.request().url())
    if (attempts.length === 1) return route.fulfill({ status: 500, json: { message: "test session failure" } })
    await route.continue()
  })
  await page.goto("/")
  await page.getByRole("button", { name: "Создать первый проект", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("textbox", { name: "Название проекта", exact: true }).fill(`dashboard-retry-${Date.now()}`)
  await dialog.getByRole("button", { name: "Создать проект", exact: true }).click()
  await expect(dialog.getByRole("alert")).toBeVisible()
  expect(projects).toHaveLength(1)
  await dialog.getByRole("button", { name: "Создать проект", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Промпт", exact: true })).toBeEditable()
  expect(projects).toHaveLength(1)
  expect(attempts).toHaveLength(2)
})
