import { expect, test } from "@playwright/test"
import { selectKnowledgeNode } from "../utils/knowledge"

// Publications below belong to a dedicated test store, never the user's backend.
test.skip(process.env.GAMMA_KNOWLEDGE_E2E !== "1", "Dedicated Knowledge Base backend required")
test.use({ viewport: { width: 1600, height: 1200 }, locale: "ru-RU" })

test("fictional demo, documents, navigation, camera and explicit durable copies", async ({ page, request }, info) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const endpoint = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT}/product/knowledge`
  const initial = await (await request.get(endpoint)).json()
  expect(initial.data.spaces).toHaveLength(0)
  await page.goto("/knowledge")
  await expect(page.locator(".kb-sync")).toContainText("Серверное хранилище пусто")
  await page.getByRole("button", { name: "Посмотреть демо-карту", exact: true }).click()
  await expect(page.locator(".kb-demo")).toContainText("Кофейня Зёрна — демо")
  const canvas = page.locator(".kb-webgl[aria-busy=false] canvas")
  await expect(canvas).toBeVisible()
  await expect(page.locator(".kb-details h2")).toHaveText("Кофейня Зёрна")
  const catalog = await page.evaluate(async () => {
    const path = "/src/utils/knowledge-demo.ts"
    const { demoKnowledge } = await import(path)
    return demoKnowledge
  })
  expect(catalog.sources).toHaveLength(96)
  expect(catalog.relations).toHaveLength(146)
  const originalCanvas = await canvas.elementHandle()
  await selectKnowledgeNode(page, "Мария Светлова")
  await page
    .getByRole("region", { name: "Исходящие связи", exact: true })
    .getByRole("button", { name: /отвечает за.*Калибровка эспрессо/ })
    .click()
  await expect(page.locator(".kb-details h2")).toHaveText("Калибровка эспрессо")
  await expect(page.locator(".kb-details")).toContainText("Мария Светлова")
  await page.getByRole("button", { name: "Исходный документ", exact: true }).click()
  const viewer = page.getByRole("dialog")
  await expect(viewer.frameLocator("iframe").locator("body")).toContainText("рабочий регламент")
  await expect(viewer.getByRole("button", { name: "Редактировать материал", exact: true })).toHaveCount(0)
  await viewer.getByRole("button", { name: "Закрыть", exact: true }).click()

  for (const source of catalog.sources.filter((source: { type: string }) =>
    ["document", "note"].includes(source.type),
  )) {
    await selectKnowledgeNode(page, source.name)
    await page.getByRole("button", { name: "Открыть", exact: true }).click()
    await expect(viewer.frameLocator("iframe").locator("body")).toContainText("Вымышленная компания")
    await expect(viewer.frameLocator("iframe").locator("body")).toContainText(
      source.text.includes("## Содержание") ? "Условия и контроль" : "Проверка и исключения",
    )
    await expect(viewer.getByRole("alert")).toHaveCount(0)
    await viewer.getByRole("button", { name: "Закрыть", exact: true }).click()
  }
  await page.getByRole("button", { name: "Фильтры", exact: true }).click()
  await page.getByLabel("Бизнес-тип (можно указать свой)", { exact: true }).selectOption("Поставщик")
  await page.getByRole("searchbox").fill("поставщик")
  await expect(page.getByRole("region", { name: "Результаты поиска", exact: true }).getByRole("button")).toHaveCount(3)
  await page.getByRole("button", { name: "Показать всю карту", exact: true }).click()
  expect(await originalCanvas?.evaluate((element) => element.isConnected)).toBe(true)
  await canvas.scrollIntoViewIfNeeded()
  const render = () => canvas.screenshot()
  const beforeZoom = await render()
  await page.getByRole("button", { name: "Приблизить", exact: true }).click()
  await expect.poll(async () => (await render()).equals(beforeZoom)).toBe(false)
  const beforeOrbit = await render()
  const box = (await canvas.boundingBox())!
  await canvas.hover({ position: { x: 100, y: 65 } })
  await expect(canvas).not.toHaveClass(/clickable/)
  await page.mouse.down()
  await page.mouse.move(box.x + 180, box.y + 110, { steps: 12 })
  await page.mouse.up()
  await expect.poll(async () => (await render()).equals(beforeOrbit)).toBe(false)
  const beforePan = await render()
  await page.mouse.down({ button: "right" })
  await page.mouse.move(box.x + 230, box.y + 145, { steps: 12 })
  await page.mouse.up({ button: "right" })
  await expect.poll(async () => (await render()).equals(beforePan)).toBe(false)
  await page.getByRole("button", { name: "Сбросить камеру", exact: true }).click()
  await page.screenshot({ path: info.outputPath("ziorna-demo.png"), fullPage: true })

  await page.reload()
  await expect(page.locator(".kb-demo")).toContainText("Кофейня Зёрна — демо")
  await expect(canvas).toBeVisible()
  expect(await (await request.get(endpoint)).json()).toEqual(initial)
  const local = await page.evaluate(async () => {
    const path = "/src/utils/knowledge.ts"
    return (await import(path)).readKnowledge()
  })
  expect(local.spaces).toHaveLength(0)

  const publication = page.waitForResponse((response) => response.url() === `${endpoint}/publish` && response.ok())
  await page.getByRole("button", { name: "Создать редактируемую копию", exact: true }).click()
  const saved = await (await publication).json()
  expect(saved.data.sources).toHaveLength(96)
  expect(saved.data.relations).toHaveLength(146)
  await expect(page.locator(".kb-demo")).toHaveCount(0)
  await expect(page.locator(".kb-sync")).toContainText("Сохранено на сервере")
  await page.reload()
  await expect(canvas).toBeVisible()
  await selectKnowledgeNode(page, "Рецептура овсяного латте")
  await page.getByRole("button", { name: "Открыть", exact: true }).click()
  await expect(viewer.frameLocator("iframe").locator("body")).toContainText("ванильный сироп 15 мл")
  await expect(viewer.getByRole("button", { name: "Редактировать материал", exact: true })).toBeVisible()
  await viewer.getByRole("button", { name: "Закрыть", exact: true }).click()
  const verify = await (await request.get(`${endpoint}/verify`)).json()
  expect(verify.errors).toEqual([])
  expect(verify.materials).toBe(96)

  await page.getByRole("button", { name: "Посмотреть демо-карту", exact: true }).click()
  const secondPublication = page.waitForResponse(
    (response) => response.url() === `${endpoint}/publish` && response.ok(),
  )
  await page.getByRole("button", { name: "Создать редактируемую копию", exact: true }).click()
  const second = await (await secondPublication).json()
  expect(second.data.spaces).toHaveLength(2)
  expect(
    second.data.sources.filter((source: { spaceID: string }) => source.spaceID === saved.data.spaces[0].id),
  ).toEqual(saved.data.sources)
  // Delete only the second copy through the same versioned publication API.
  const remaining = {
    ...second.data,
    spaces: second.data.spaces.filter((space: { id: string }) => space.id === saved.data.spaces[0].id),
    sources: saved.data.sources,
    relations: saved.data.relations,
  }
  const deletion = await request.post(`${endpoint}/publish`, {
    data: { expectedVersion: second.version, requestID: "demo-test-remove-copy", data: remaining, originals: {} },
  })
  expect(deletion.ok()).toBe(true)
  await page.reload()
  await expect(canvas).toBeVisible()
  expect((await (await request.get(endpoint)).json()).data.sources).toEqual(saved.data.sources)
  expect(errors).toEqual([])
})
