import { expect, test } from "@playwright/test"

test.skip(process.env.GAMMA_AGENT_E2E !== "1", "Requires an isolated Gamma product backend")
test.use({ viewport: { width: 1440, height: 1050 }, locale: "ru-RU" })
const backend = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test("catalog, details, filters, desktop and mobile preserve agent market", async ({ page }, info) => {
  await page.goto("/skills")
  await expect(page).toHaveURL(/\/knowledge$/)
  await expect(page.getByRole("heading", { name: "База знаний", exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("skills-desktop.png") })
  await page.goto("/agents")
  const cards = page.getByRole("article")
  await expect(cards).toHaveCount(16)
  await expect(cards.getByRole("button", { name: "Использовать", exact: true })).toHaveCount(16)
  await page.screenshot({ path: info.outputPath("agents-desktop.png") })
  await expect(page.getByRole("region", { name: "Популярные роли", exact: true }).getByRole("button")).toHaveCount(4)
  await page.getByRole("button", { name: "Создать своего агента", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText("Скоро появится")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.getByRole("button", { name: "Как это работает", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText("Специалист работает с файлами проекта")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.getByRole("searchbox").fill("Telegram")
  await expect(cards).toHaveCount(1)
  await expect(cards.getByRole("heading")).toHaveText("Telegram-разработчик")
  await page.getByRole("searchbox").fill("not-an-agent-123")
  await expect(cards).toHaveCount(0)
  await page.getByRole("searchbox").fill("")
  await page
    .getByRole("navigation", { name: "Категории" })
    .getByRole("button", { name: "Безопасность", exact: true })
    .click()
  await expect(cards).toHaveCount(1)
  await expect(cards.getByRole("heading")).toHaveText("Аудитор безопасности")
  await cards.getByRole("button", { name: "Подробнее", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "Разрешения", exact: true })).toBeVisible()
  await expect(dialog.getByRole("link")).toHaveAttribute("href", /github.com\/wshobson\/agents\/blob\/[a-f0-9]{40}\//)
  await page.screenshot({ path: info.outputPath("details.png") })
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await page.getByRole("navigation", { name: "Категории" }).getByRole("button", { name: "Все", exact: true }).click()
  await page.getByRole("tab", { name: "Команды", exact: true }).click()
  await expect(cards).toHaveCount(3)
  const team = cards.filter({ has: page.getByRole("heading", { name: "Команда веб-разработки", exact: true }) })
  await team.getByRole("button", { name: "Подробнее", exact: true }).click()
  await expect(dialog).toContainText("Состав команды")
  await expect(dialog).toContainText("UI/UX-дизайнер")
  await page.keyboard.press("Escape")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(team.getByRole("button", { name: "Использовать", exact: true })).toBeEnabled()
  await page.screenshot({ path: info.outputPath("agents-mobile.png"), fullPage: true })
  await team.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath("agents-mobile-cards.png") })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test("new and existing projects, replacement confirmation, cancellation, same agent and idempotent retry", async ({
  page,
  request,
}, info) => {
  const name = `agent-e2e-${crypto.randomUUID().slice(0, 8)}`
  const existing = `agent-existing-${crypto.randomUUID().slice(0, 8)}`
  expect((await request.post(`${backend}/product/projects`, { data: { name: existing } })).ok()).toBe(true)
  const applications: {
    requestId: string
    agentId: string
    expectedVersion: number
    confirmed: boolean
    connectSkills: boolean
  }[] = []
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith("/active-agent")) applications.push(req.postDataJSON())
  })
  await page.goto("/agents")
  const cards = page.getByRole("article")
  const website = cards.filter({ has: page.getByRole("heading", { name: "Создатель сайтов", exact: true }) })
  const backendCard = cards.filter({ has: page.getByRole("heading", { name: "Backend-разработчик", exact: true }) })
  await expect(website.getByRole("button", { name: "Использовать", exact: true })).toBeEnabled()
  await website.getByRole("button", { name: "Использовать", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Где будем работать?", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Создать проект", exact: true }).click()
  await dialog.getByRole("textbox", { name: "Название проекта", exact: true }).fill(name)
  await dialog.getByRole("button", { name: "Создать проект", exact: true }).click()
  await expect(dialog).toContainText(`${name} · Создатель сайтов`)
  const firstResponse = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().endsWith("/active-agent"),
  )
  await dialog.getByRole("button", { name: "Использовать", exact: true }).click()
  const first = await (await firstResponse).json()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(first.sessionId))
  await expect(page.getByRole("button", { name: "Создатель сайтов", exact: true })).toBeVisible()
  // Replay the exact committed request to prove a lost response cannot create another session.
  const retry = await request.post(`${backend}/product/projects/${name}/active-agent`, { data: applications[0] })
  expect(await retry.json()).toEqual(first)
  const selection = async () => (await request.get(`${backend}/product/projects/${name}/active-agent`)).json()
  expect(await selection()).toMatchObject({ agentId: "website-builder", version: 1 })
  await page.goto("/agents")
  await backendCard.getByRole("button", { name: "Использовать", exact: true }).click()
  await dialog.getByRole("button", { name, exact: true }).click()
  await expect(dialog.getByRole("heading", { name: "Заменить агента проекта?" })).toBeVisible()
  await expect(dialog).toContainText("Файлы и история переписки сохранятся.")
  await page.screenshot({ path: info.outputPath("replacement.png") })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(dialog.getByRole("button", { name: "Заменить агента", exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("replacement-mobile.png") })
  await page.setViewportSize({ width: 1440, height: 1050 })
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(applications).toHaveLength(1)
  expect(await selection()).toMatchObject({ agentId: "website-builder", version: 1 })
  await backendCard.getByRole("button", { name: "Использовать", exact: true }).click()
  await dialog.getByRole("button", { name, exact: true }).click()
  await dialog.getByRole("checkbox", { name: "Подключить необходимые навыки" }).check()
  const changedResponse = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().endsWith("/active-agent"),
  )
  await dialog.getByRole("button", { name: "Заменить агента", exact: true }).click()
  const changed = await (await changedResponse).json()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(changed.sessionId))
  expect(changed.selection).toMatchObject({ agentId: "backend-developer", version: 2 })
  await page.goto("/agents")
  await backendCard.getByRole("button", { name: "Использовать", exact: true }).click()
  await dialog.getByRole("button", { name, exact: true }).click()
  await expect(dialog.getByRole("heading", { name: "Заменить агента проекта?" })).toHaveCount(0)
  await dialog.getByRole("button", { name: "Использовать", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await selection()).toMatchObject({ agentId: "backend-developer", version: 2 })
  await page.goto("/agents")
  await website.getByRole("button", { name: "Использовать", exact: true }).click()
  await dialog.getByRole("button", { name: existing, exact: true }).click()
  await dialog.getByRole("button", { name: "Использовать", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await (await request.get(`${backend}/product/projects/${existing}/active-agent`)).json()).toMatchObject({
    agentId: "website-builder",
    version: 1,
  })
  expect(await selection()).toMatchObject({ agentId: "backend-developer", version: 2 })
})
