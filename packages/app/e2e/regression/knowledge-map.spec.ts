import { expect, test } from "@playwright/test"
import { selectKnowledgeNode, seedKnowledgeSpace, showKnowledgeAdd } from "../utils/knowledge"

test.use({ viewport: { width: 1600, height: 1000 }, locale: "ru-RU" })

test("related documents, filters, search and viewer retain the same map and stored data", async ({ page }, info) => {
  await page.goto("/knowledge")
  await seedKnowledgeSpace(page)
  const canvas = page.locator(".kb-webgl[aria-busy=false] canvas")
  await expect(canvas).toBeVisible()
  const original = (await canvas.elementHandle())!
  const read = () =>
    page.evaluate(async () => {
      const path = "/src/utils/knowledge.ts"
      const { readKnowledge } = await import(path)
      return readKnowledge()
    })
  const data = await read()
  const sameMap = async () => {
    await expect(canvas).toBeVisible()
    await expect(page.locator(".kb-list")).toHaveCount(0)
    expect(await original.evaluate((el) => el.isConnected && el === document.querySelector(".kb-webgl canvas"))).toBe(
      true,
    )
  }
  await page.getByRole("button", { name: "Связанные документы", exact: true }).click()
  await expect(page.getByRole("button", { name: "Связанные документы", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await sameMap()
  await page.screenshot({ path: info.outputPath("related-map.png"), fullPage: true })
  await page.getByRole("button", { name: "ADR-001 · Границы сервисов", exact: true }).click()
  await expect(page.locator(".kb-details h2")).toHaveText("ADR-001 · Границы сервисов")
  await sameMap()
  await page.getByRole("navigation", { name: "Фильтры" }).getByRole("button", { name: "Заметки", exact: true }).click()
  await sameMap()
  await page.getByRole("searchbox").fill("No matching knowledge node")
  await expect(page.locator(".kb-map-message")).toBeVisible()
  await sameMap()
  await page.getByRole("button", { name: "Показать всю карту", exact: true }).click()
  await expect(page.getByRole("searchbox")).toHaveValue("")
  await sameMap()
  await page.getByRole("navigation", { name: "Фильтры" }).getByRole("button", { name: "Проекты", exact: true }).click()
  await expect(page.locator(".kb-map-message")).toBeVisible()
  await sameMap()
  await page.getByRole("button", { name: "Показать всю карту", exact: true }).click()
  await selectKnowledgeNode(page, "Архитектура платформы")
  await sameMap()
  const frames = { previous: Buffer.alloc(0) }
  await expect
    .poll(async () => {
      const current = await canvas.screenshot()
      const settled = frames.previous.equals(current)
      frames.previous = current
      return settled
    })
    .toBe(true)
  const before = await canvas.screenshot()
  await page.getByRole("button", { name: "Открыть", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await sameMap()
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click()
  await expect(page.locator(".kb-details h2")).toHaveText("Архитектура платформы")
  await sameMap()
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(true)
  expect(await read()).toEqual(data)
})

test("a node without relations keeps its map and reports the empty neighborhood", async ({ page }) => {
  await page.goto("/knowledge")
  await seedKnowledgeSpace(page)
  const original = (await page.locator(".kb-webgl[aria-busy=false] canvas").elementHandle())!
  await showKnowledgeAdd(page)
  await page.getByRole("button", { name: "Загрузить документ", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Заметки", exact: true }).click()
  await dialog.getByRole("textbox", { name: "Название", exact: true }).fill("Без связей")
  await dialog.getByRole("textbox", { name: "Текст", exact: true }).fill("Отдельная заметка")
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole("button", { name: "Связанные документы", exact: true }).click()
  await expect(page.getByText("Связанных документов пока нет", { exact: true })).toBeVisible()
  expect(await original.evaluate((el) => el.isConnected && el === document.querySelector(".kb-webgl canvas"))).toBe(
    true,
  )
  await expect(page.locator(".kb-list")).toHaveCount(0)
  await page.getByRole("button", { name: "Показать всю карту", exact: true }).click()
  await expect(page.getByRole("button", { name: "Связанные документы", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  )
})
