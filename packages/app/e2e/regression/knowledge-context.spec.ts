import { expect, test } from "@playwright/test"
import type { RemoteKnowledge } from "../../src/utils/knowledge-sync"

test.skip(process.env.GAMMA_KNOWLEDGE_E2E !== "1", "Dedicated Gamma backend required")
test.use({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", actionTimeout: 15_000 })

test("create projects with zero, one and multiple spaces; toggle and switch without changing knowledge", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000)
  const backend = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4538"}/product`
  const initial: RemoteKnowledge = await (await request.get(`${backend}/knowledge`)).json()
  const suffix = Date.now()
  const spaces = ["CRM", "Support"].map((name) => ({
    id: `context-${name}-${suffix}`,
    name: `${name} ${suffix}`,
    description: `${name} processes`,
    createdAt: "",
    updatedAt: "",
  }))
  const published = await request.post(`${backend}/knowledge/publish`, {
    data: {
      expectedVersion: initial.version,
      requestID: `context-${suffix}`,
      originals: initial.originals,
      data: {
        ...initial.data,
        spaces: [...initial.data.spaces, ...spaces],
        sources: [
          ...initial.data.sources,
          ...spaces.flatMap((space) =>
            ["123", "456"].map((id) => ({
              id: `${space.id}-${id}`,
              spaceID: space.id,
              type: "note",
              name: `${space.name} ${id}`,
              description: "Short description",
              text: `# Physical material ${id}`,
              tags: [],
              createdAt: "",
              updatedAt: "",
            })),
          ),
        ],
        relations: [
          ...initial.data.relations,
          {
            id: `edge-${suffix}`,
            spaceID: spaces[0].id,
            source: `${spaces[0].id}-123`,
            target: `${spaces[0].id}-456`,
            type: "RELATED_TO",
            provenance: "manual",
            metadata: {},
          },
        ],
      },
    },
  })
  expect(published.ok()).toBe(true)
  const baseline = await (await request.get(`${backend}/knowledge`)).json()
  const names: string[] = []
  for (const count of [0, 1, 2]) {
    await page.goto("/")
    await page.getByRole("button", { name: /^(Создать первый проект|Новый проект)$/ }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText("Необязательно", { exact: true })).toBeVisible()
    const name = `context-${count}-${suffix}`
    names.push(name)
    await dialog.getByRole("textbox", { name: "Название проекта", exact: true }).fill(name)
    await expect(dialog.getByRole("checkbox")).toHaveCount(0)
    if (count) {
      await dialog.getByRole("button", { name: "Выбрать пространства", exact: true }).click()
      for (const space of spaces.slice(0, count))
        await page.getByRole("checkbox", { name: space.name, exact: true }).check()
      await page.keyboard.press("Escape")
    }
    if (count === 2) await page.screenshot({ path: info.outputPath("create-with-knowledge.png") })
    await dialog.getByRole("button", { name: "Создать проект", exact: true }).click()
    const trigger = page.getByRole("button", { name: `База знаний · ${count}`, exact: true })
    await expect(trigger).toBeVisible()
    await expect(page.getByRole("button", { name: "Поделиться", exact: true })).toHaveCount(0)
    await expect(trigger.locator(".gamma-project-kb-count")).toHaveText(String(count))
    await page.getByRole("button", { name: "Дополнительные опции", exact: true }).click()
    await expect(page.getByRole("menuitem", { name: /Поделиться/ })).toHaveCount(0)
    await expect(page.getByRole("menuitem", { name: /Переименовать/ })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect
      .poll(async () => {
        const projects = await (await request.get(`${backend}/knowledge/projects`)).json()
        return projects.find((project: { name: string }) => project.name === name)?.spaces
      })
      .toEqual(spaces.slice(0, count).map((space) => space.id))
  }
  await page.getByRole("button", { name: "База знаний · 2", exact: true }).click()
  await expect(page.getByRole("switch", { name: spaces[0].name, exact: true })).toBeChecked()
  await page.screenshot({ path: info.outputPath("knowledge-popover.png"), animations: "disabled" })
  await page.getByRole("switch", { name: spaces[0].name, exact: true }).locator("..").click()
  await expect(page.getByRole("button", { name: "База знаний · 1", exact: true })).toBeVisible()
  await page.getByRole("switch", { name: spaces[0].name, exact: true }).locator("..").click()
  await expect(page.getByRole("button", { name: "База знаний · 2", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  // Empty sessions are intentionally discarded on unload; reopen the project.
  await page.goto("/")
  await page.reload()
  await page
    .getByRole("region", { name: "Мои проекты" })
    .getByRole("button", { name: `${names[2]} Открыть`, exact: true })
    .click()
  await expect(page.getByRole("button", { name: "База знаний · 2", exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  // The existing mobile file drawer overlays the chat until explicitly closed.
  await page.getByRole("button", { name: "Рабочая область", exact: true }).click()
  await page.getByRole("button", { name: "База знаний · 2", exact: true }).click()
  await expect(page.getByRole("switch", { name: spaces[0].name, exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("knowledge-mobile.png"), animations: "disabled" })
  await page.keyboard.press("Escape")
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole("link", { name: "Gamma", exact: true }).click()
  await page
    .getByRole("region", { name: "Мои проекты" })
    .getByRole("button", { name: `${names[0]} Открыть`, exact: true })
    .click()
  await expect(page.getByRole("button", { name: "База знаний · 0", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "База знаний · 0", exact: true }).click()
  await page.getByRole("switch", { name: spaces[0].name, exact: true }).locator("..").click()
  await expect(page.getByRole("button", { name: "База знаний · 1", exact: true })).toBeVisible()
  await page.getByRole("link", { name: "Открыть Базу знаний", exact: true }).click()
  await expect(page.locator(".kb-sync > span")).toHaveText("Сохранено на сервере")
  expect(await (await request.get(`${backend}/knowledge`)).json()).toEqual(baseline)
})

test("failed connection retries on the same newly created project", async ({ page, request }) => {
  const backend = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4538"}/product`
  const data: RemoteKnowledge = await (await request.get(`${backend}/knowledge`)).json()
  const space = data.data.spaces[0]
  expect(space).toBeTruthy()
  const name = `context-retry-${Date.now()}`
  await page.goto("/")
  await page.getByRole("button", { name: "Новый проект", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("textbox", { name: "Название проекта", exact: true }).fill(name)
  await dialog.getByRole("button", { name: "Выбрать пространства", exact: true }).click()
  await page.getByRole("checkbox", { name: space.name, exact: true }).check()
  await page.keyboard.press("Escape")
  await page.route("**/product/knowledge/projects", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    await route.fulfill({ status: 409, json: { code: "busy" } })
  })
  await dialog.getByRole("button", { name: "Создать проект", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("Проект создан, но подключить Базу знаний не удалось")
  await page.unroute("**/product/knowledge/projects")
  await dialog.getByRole("button", { name: "Создать проект", exact: true }).click()
  await expect(page.getByRole("button", { name: "База знаний · 1", exact: true })).toBeVisible()
  const projects = await (await request.get(`${backend}/knowledge/projects`)).json()
  expect(projects.filter((project: { name: string }) => project.name === name)).toHaveLength(1)
  expect(projects.find((project: { name: string }) => project.name === name).spaces).toEqual([space.id])
})

test("compact project picker searches a large list, preserves selection and fits mobile", async ({
  page,
  request,
}, info) => {
  const backend = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4538"}/product`
  const original: RemoteKnowledge = await (await request.get(`${backend}/knowledge`)).json()
  const spaces = Array.from({ length: 30 }, (_, index) => ({
    id: `picker-${index}`,
    name:
      index === 0
        ? "Очень длинное название пространства знаний для документации и материалов проекта"
        : `Пространство ${String(index).padStart(2, "0")}`,
    description: "Длинное описание, которое не должно отображаться",
    createdAt: "",
    updatedAt: "",
  }))
  await page.route("**/product/knowledge", (route) =>
    route.fulfill({ json: { ...original, data: { ...original.data, spaces } } }),
  )
  await page.goto("/")
  await page.getByRole("button", { name: "Новый проект", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("checkbox")).toHaveCount(0)
  await expect(dialog).not.toContainText("Full Permissions")
  await page.screenshot({ path: info.outputPath("compact-project.png"), animations: "disabled" })
  await dialog.getByRole("button", { name: "Выбрать пространства", exact: true }).click()
  const menu = page.locator(".gamma-knowledge-menu")
  await expect(menu.getByRole("checkbox")).toHaveCount(30)
  await expect(menu).not.toContainText(spaces[0].description)
  expect(await menu.locator(".gamma-knowledge-options").evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await menu.getByRole("checkbox", { name: spaces[0].name, exact: true }).check()
  await menu.getByRole("searchbox").fill("29")
  await expect(menu.getByRole("checkbox")).toHaveCount(1)
  await menu.getByRole("checkbox").check()
  await page.keyboard.press("Escape")
  await expect(dialog.getByRole("button", { name: "Выбрано пространств: 2", exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Выбрано пространств: 2", exact: true }).click()
  await expect(menu.getByRole("checkbox")).toBeChecked()
  await menu.getByRole("checkbox").uncheck()
  await menu.getByRole("searchbox").fill("нет совпадений")
  await expect(menu.getByText("Пространства не найдены")).toBeVisible()
  await menu.getByRole("searchbox").fill("")
  await expect(menu.getByRole("checkbox", { name: spaces[0].name, exact: true })).toBeChecked()
  await page.screenshot({ path: info.outputPath("picker-desktop.png"), animations: "disabled" })
  await page.keyboard.press("Escape")
  await page.setViewportSize({ width: 390, height: 844 })
  await dialog.getByRole("button", { name: "Выбрано пространств: 1", exact: true }).click()
  await expect(menu.getByRole("checkbox", { name: spaces[0].name, exact: true })).toBeChecked()
  const rect = await menu.boundingBox()
  expect(rect!.x).toBeGreaterThanOrEqual(0)
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(390)
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(844)
  await page.screenshot({ path: info.outputPath("picker-mobile.png"), animations: "disabled" })
  await menu.getByRole("link", { name: "Перейти в Базу знаний", exact: true }).click()
  await expect(page).toHaveURL(/\/knowledge$/)
  await expect(page.locator(".gamma-project-picker")).toHaveCount(0)
})

test("project popover handles search, long names, pending and failed connections", async ({ page, request }, info) => {
  const backend = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4538"}/product`
  const original: RemoteKnowledge = await (await request.get(`${backend}/knowledge`)).json()
  const spaces = original.data.spaces.slice(0, 25).map((space, index) => ({
    ...space,
    name:
      index === 0
        ? "Очень длинное название пространства знаний для документации и материалов проекта"
        : `Пространство ${index}`,
  }))
  expect(spaces.length).toBeGreaterThanOrEqual(20)
  await page.route("**/product/knowledge", (route) =>
    route.fulfill({ json: { ...original, data: { ...original.data, spaces } } }),
  )
  await page.goto("/")
  await page.getByRole("button", { name: "Новый проект", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("textbox", { name: "Название проекта", exact: true }).fill(`popover-${Date.now()}`)
  await dialog.getByRole("button", { name: "Создать проект", exact: true }).click()
  await page.getByRole("button", { name: "База знаний · 0", exact: true }).click()
  const menu = page.locator(".gamma-project-kb")
  await expect(menu.getByRole("switch")).toHaveCount(spaces.length)
  await expect(menu).not.toContainText("Full Permissions")
  expect(await menu.locator(".gamma-project-kb-list").evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await menu.getByRole("searchbox").fill("Очень длинное")
  await expect(menu.getByRole("switch")).toHaveCount(1)
  let release = () => {}
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/product/knowledge/projects", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    await pending
    await route.fulfill({ status: 500, json: { error: "test failure" } })
  })
  const control = menu.getByRole("switch", { name: spaces[0].name, exact: true })
  await control.locator("..").click()
  await expect(control).toBeDisabled()
  await expect(control).not.toBeChecked()
  await expect(page.getByRole("button", { name: "База знаний · 0", exact: true })).toBeVisible()
  release()
  await expect(menu.getByRole("alert")).toBeVisible()
  await expect(control).toBeEnabled()
  await expect(control).not.toBeChecked()
  await page.unroute("**/product/knowledge/projects")
  await control.locator("..").click()
  await expect(control).toBeChecked()
  await expect(page.getByRole("button", { name: "База знаний · 1", exact: true })).toBeVisible()
  await menu.getByRole("searchbox").fill("")
  await expect(menu.getByRole("switch").first()).toBeChecked()
  await page.screenshot({ path: info.outputPath("popover-desktop.png"), animations: "disabled" })
  await menu.getByRole("searchbox").fill("нет совпадений")
  await expect(menu.getByText("Пространства не найдены")).toBeVisible()
  await menu.getByRole("searchbox").fill("")
  await page.keyboard.press("Escape")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Рабочая область", exact: true }).click()
  await page.getByRole("button", { name: "База знаний · 1", exact: true }).click()
  await expect(menu.getByRole("switch").first()).toBeChecked()
  const rect = await menu.boundingBox()
  expect(rect!.x).toBeGreaterThanOrEqual(0)
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(390)
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(844)
  await page.screenshot({ path: info.outputPath("popover-mobile.png"), animations: "disabled" })
})
