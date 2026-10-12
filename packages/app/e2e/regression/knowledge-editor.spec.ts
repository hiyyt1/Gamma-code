import { expect, test, type Page } from "@playwright/test"
import { selectKnowledgeNode, seedKnowledgeSpace, showKnowledgeAdd } from "../utils/knowledge"
import type { KnowledgeData } from "../../src/utils/knowledge"

test.use({ viewport: { width: 1920, height: 1080 }, locale: "ru-RU" })
const read = (page: Page): Promise<KnowledgeData> =>
  page.evaluate(async () => {
    const path = "/src/utils/knowledge.ts"
    return (await import(path)).readKnowledge()
  })
const save = async (page: Page) => {
  await page.locator(".kb-editor").getByRole("button", { name: "4 Сохранение", exact: true }).click()
  await page.locator(".kb-editor").getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(page.locator(".kb-editor")).not.toBeVisible()
}

test("Markdown, visuals, typed relations, editing and persistence preserve seed", async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto("/knowledge")
  await seedKnowledgeSpace(page)
  await expect(page.locator(".kb-webgl[aria-busy=false] canvas")).toBeVisible()
  const before = await read(page)
  await showKnowledgeAdd(page)
  await page.getByRole("button", { name: "Создать файл", exact: true }).click()
  const editor = page.locator(".kb-editor")
  await editor.getByLabel("Название", { exact: true }).fill("План корпоративного пилота")
  await expect(editor.getByLabel("Имя файла", { exact: true })).toHaveValue("План корпоративного пилота.md")
  await editor.getByLabel("Имя файла", { exact: true }).fill("pilot-plan.md")
  await editor
    .getByLabel("Когда агенту полезно использовать этот материал?", { exact: true })
    .fill("Использовать при планировании пилота и проверке требований безопасности.")
  await editor
    .getByRole("textbox", { name: "Markdown", exact: true })
    .fill(
      "# План пилота\n\n## Цель\nПроверить работу агентов на разрешённых документах.\n\n- Изолировать пространства\n- Проверить роли пользователей\n- Измерить качество ответов\n\n**Критерий приёмки:** все проверки доступа пройдены.",
    )
  await editor.getByRole("button", { name: "Предпросмотр", exact: true }).click()
  await expect(editor.locator(".kb-markdown-preview")).toContainText("План пилота")
  await page.screenshot({ path: "/home/nikita/menti/knowledge-base-test/editor/editor.png" })
  await editor.getByRole("button", { name: "2 Оформление", exact: true }).click()
  await editor.getByRole("button", { name: "Цвет 3", exact: true }).click()
  await editor.getByRole("button", { name: "Сущность", exact: true }).click()
  await editor.getByRole("button", { name: "XL — Выделенный", exact: true }).click()
  await editor.getByRole("button", { name: "3 Связи", exact: true }).click()
  for (const [suffix, type] of [
    ["architecture", "PART_OF"],
    ["security", "DEPENDS_ON"],
  ]) {
    await editor.getByRole("button", { name: "Добавить связь", exact: false }).click()
    await editor.getByLabel("Связанное знание", { exact: true }).selectOption(`test-gamma-ai-platform-v1:${suffix}`)
    await editor.locator(".kb-edge-add").getByLabel("Тип связи", { exact: true }).selectOption(type)
    await editor.locator(".kb-edge-add").getByRole("button", { name: "Добавить связь", exact: true }).click()
  }
  await expect(editor.locator(".kb-edge-row")).toHaveCount(2)
  await page.screenshot({ path: "/home/nikita/menti/knowledge-base-test/editor/relations.png" })
  await save(page)
  await expect(page.locator(".kb-details h2")).toHaveText("План корпоративного пилота")
  const added = (await read(page)).sources.find((item) => item.filename === "pilot-plan.md")!
  expect(added.visual).toEqual({ color: "#a8d2f3", icon: "entity", size: "featured" })
  const blob = await page.evaluate(async (id) => {
    const path = "/src/utils/knowledge.ts"
    return (await (await import(path)).readKnowledgeFile(id)).text()
  }, added.id)
  expect(blob).toBe(added.text)
  await expect(page.locator(".kb-webgl[aria-busy=false] canvas")).toBeVisible()
  await page.screenshot({ path: "/home/nikita/menti/knowledge-base-test/editor/map.png" })
  await page.getByRole("button", { name: "Редактировать материал", exact: true }).click()
  await editor.getByRole("textbox", { name: "Markdown", exact: true }).fill("# Обновлённый план\n\nПилот согласован.")
  await editor.getByRole("button", { name: "3 Связи", exact: true }).click()
  await editor.locator(".kb-edge-row").first().getByLabel("Тип связи").selectOption("DESCRIBES")
  await editor.locator(".kb-edge-row").last().getByRole("button", { name: "Удалить связь" }).click()
  await save(page)
  await page.reload()
  const after = await read(page)
  expect(after.sources.filter((item) => item.id !== added.id)).toEqual(before.sources)
  expect(after.spaces).toEqual(before.spaces)
  expect(after.relations.filter((item) => item.source !== added.id && item.target !== added.id)).toEqual(
    before.relations,
  )
  const relations = after.relations.filter((item) => item.source === added.id)
  expect(relations).toHaveLength(1)
  expect(relations[0]).toMatchObject({
    type: "DESCRIBES",
    target: "test-gamma-ai-platform-v1:architecture",
    origin: "manual",
  })
  expect(after.sources.find((item) => item.id === added.id)?.text).toContain("Обновлённый")
  await selectKnowledgeNode(page, "План корпоративного пилота")
  await page.getByRole("button", { name: "Редактировать материал", exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(editor).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: "/home/nikita/menti/knowledge-base-test/editor/mobile.png" })
  await editor.getByLabel("Название", { exact: true }).fill("Несохранённое")
  page.once("dialog", (dialog) => dialog.dismiss())
  await editor.getByRole("button", { name: "Закрыть", exact: true }).click()
  await expect(editor).toBeVisible()
  page.once("dialog", (dialog) => dialog.accept())
  await editor.getByRole("button", { name: "Закрыть", exact: true }).click()
  await expect(editor).not.toBeVisible()
})

test("map picking creates directed relations without changing camera controls; duplicates are rejected", async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto("/knowledge")
  await seedKnowledgeSpace(page)
  const canvas = page.locator(".kb-webgl[aria-busy=false] canvas")
  await expect(canvas).toBeVisible()
  const original = (await canvas.elementHandle())!
  await page.getByRole("button", { name: "Связанные документы", exact: true }).click()
  await page.getByRole("button", { name: "Добавить связь", exact: true }).click()
  await expect(page.locator(".kb-connect-banner")).toBeVisible()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width - 30, box.y + box.height - 40)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 80, box.y + box.height - 60, { steps: 8 })
  await page.mouse.up()
  await page.getByRole("button", { name: "Сбросить камеру", exact: true }).click()
  const settleCamera = async () => {
    const frames = { previous: Buffer.alloc(0) }
    await expect
      .poll(async () => {
        const current = await canvas.screenshot()
        const settled = frames.previous.equals(current)
        frames.previous = current
        return settled
      })
      .toBe(true)
  }
  await settleCamera()
  await canvas.hover({ position: { x: 484, y: 300 } })
  await expect(canvas).toHaveClass(/clickable/)
  await canvas.click({ position: { x: 484, y: 300 } })
  const editor = page.locator(".kb-editor")
  await expect(editor).toBeVisible()
  await expect(editor.getByLabel("Связанное знание", { exact: true })).toHaveValue("test-gamma-ai-platform-v1:agents")
  await editor.locator(".kb-edge-add").getByLabel("Тип связи", { exact: true }).selectOption("DEPENDS_ON")
  await editor.locator(".kb-edge-add").getByRole("button", { name: "Добавить связь", exact: true }).click()
  await save(page)
  expect((await read(page)).relations).toHaveLength(65)
  expect(await original.evaluate((el) => el.isConnected && el === document.querySelector(".kb-webgl canvas"))).toBe(
    true,
  )
  await expect(page.locator(".kb-list")).toHaveCount(0)
  expect(
    (await read(page)).relations.find((edge) => edge.type === "DEPENDS_ON" && edge.source.endsWith(":architecture")),
  ).toMatchObject({ target: "test-gamma-ai-platform-v1:agents", origin: "manual" })
  await page.getByRole("button", { name: "Редактировать связи", exact: true }).click()
  await editor.getByRole("button", { name: "Добавить связь", exact: false }).click()
  await editor.getByLabel("Связанное знание", { exact: true }).selectOption("test-gamma-ai-platform-v1:agents")
  await editor.locator(".kb-edge-add").getByLabel("Тип связи", { exact: true }).selectOption("DEPENDS_ON")
  await editor.locator(".kb-edge-add").getByRole("button", { name: "Добавить связь", exact: true }).click()
  await expect(editor.getByRole("alert")).toContainText("такая связь уже существует")
  await editor.getByLabel("Направление", { exact: true }).selectOption("in")
  await editor.locator(".kb-edge-add").getByRole("button", { name: "Добавить связь", exact: true }).click()
  await save(page)
  expect((await read(page)).relations).toHaveLength(66)
  await page.getByRole("button", { name: "Редактировать связи", exact: true }).click()
  await editor
    .locator(".kb-edge-row")
    .filter({ hasText: "AI-агенты → Архитектура платформы" })
    .getByRole("button", { name: "Удалить связь", exact: true })
    .click()
  await save(page)
  expect((await read(page)).relations).toHaveLength(65)
  expect(await original.evaluate((el) => el.isConnected && el === document.querySelector(".kb-webgl canvas"))).toBe(
    true,
  )
  await expect(page.locator(".kb-list")).toHaveCount(0)
  await page.getByRole("button", { name: "Создать связь на карте", exact: true }).click()
  await page.locator(".kb-connect-banner").getByRole("button", { name: "Отмена" }).click()
  await expect(page.locator(".kb-connect-banner")).not.toBeVisible()
  await page.getByRole("button", { name: "Сбросить камеру", exact: true }).click()
  await settleCamera()
  await canvas.hover({ position: { x: 484, y: 300 } })
  await expect(canvas).toHaveClass(/clickable/)
  await canvas.click({ position: { x: 484, y: 300 } })
  await expect(page.locator(".kb-details h2")).toHaveText("AI-агенты")
})

test("uploaded Markdown original stays intact; node deletion removes relations and blobs", async ({ page }) => {
  await page.goto("/knowledge")
  await seedKnowledgeSpace(page)
  await expect(page.locator(".kb-webgl[aria-busy=false] canvas")).toBeVisible()
  await showKnowledgeAdd(page)
  await page.getByRole("button", { name: "Загрузить документ", exact: true }).click()
  await page
    .getByRole("dialog")
    .locator('input[type="file"]')
    .setInputFiles({ name: "immutable.md", mimeType: "text/markdown", buffer: Buffer.from("# Immutable original") })
  const editor = page.locator(".kb-editor")
  await expect(editor.getByLabel("Имя файла", { exact: true })).toHaveValue("immutable.md")
  await editor
    .getByLabel("Когда агенту полезно использовать этот материал?", { exact: true })
    .fill("Original for the audit")
  await save(page)
  const source = (await read(page)).sources.find((item) => item.filename === "immutable.md")!
  await page.getByRole("button", { name: "Редактировать материал", exact: true }).click()
  await editor.getByRole("textbox", { name: "Markdown", exact: true }).fill("# Edited material")
  await editor.getByRole("button", { name: "3 Связи", exact: true }).click()
  await editor.getByRole("button", { name: "Добавить связь", exact: false }).click()
  await editor.getByLabel("Связанное знание", { exact: true }).selectOption("test-gamma-ai-platform-v1:architecture")
  await editor.locator(".kb-edge-add").getByRole("button", { name: "Добавить связь", exact: true }).click()
  await save(page)
  expect((await read(page)).sources.find((item) => item.id === source.id)?.text).toBe("# Edited material")
  expect(
    await page.evaluate(async (id) => {
      const path = "/src/utils/knowledge.ts"
      return (await (await import(path)).readKnowledgeFile(id)).text()
    }, source.id),
  ).toBe("# Immutable original")
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "Удалить материал", exact: true }).click()
  await expect(page.locator(".kb-add-materials")).toBeVisible()
  const after = await read(page)
  expect(after.sources).toHaveLength(44)
  expect(after.relations).toHaveLength(64)
  expect(after.jobs.some((job) => job.sourceID === source.id)).toBe(false)
  expect(
    await page.evaluate(async (id) => {
      const path = "/src/utils/knowledge.ts"
      return (await import(path)).readKnowledgeFile(id).then(
        () => false,
        () => true,
      )
    }, source.id),
  ).toBe(true)
})
