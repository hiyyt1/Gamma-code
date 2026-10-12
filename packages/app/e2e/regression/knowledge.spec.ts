import { readFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { selectKnowledgeNode, seedKnowledgeSpace, showKnowledgeAdd } from "../utils/knowledge"

test.use({ viewport: { width: 1600, height: 1000 }, locale: "ru-RU" })

test("spaces, original files, notes, links, persistence and confirmed deletion", async ({ page }) => {
  await page.goto("/knowledge")
  await expect(page.getByRole("heading", { name: "Начните свою историю знаний", exact: true })).toBeVisible()
  await page.locator(".kb-hero").getByRole("button", { name: "Создать пространство", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("textbox", { name: "Название", exact: true }).fill("Тестовая база")
  await dialog.getByRole("textbox", { name: "Описание", exact: true }).fill("Материалы проверки")
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole("combobox", { name: "Выберите пространство" })).toContainText("Тестовая база")
  await showKnowledgeAdd(page)
  await page.getByRole("button", { name: "Загрузить документ", exact: true }).click()
  await dialog.locator('input[type="file"]').setInputFiles([
    { name: "original.txt", mimeType: "text/plain", buffer: Buffer.from("Original document contents") },
    { name: "original.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") },
    {
      name: "original.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: await readFile(new URL("../fixtures/knowledge-viewer/research.docx", import.meta.url)),
    },
    { name: "original.md", mimeType: "text/markdown", buffer: Buffer.from("# Markdown original") },
  ])
  for (const filename of ["original.txt", "original.pdf", "original.docx", "original.md"]) {
    await expect(page.locator(".kb-editor").getByLabel("Имя файла", { exact: true })).toHaveValue(filename)
    await page.locator(".kb-editor").getByRole("button", { name: "4 Сохранение", exact: true }).click()
    await page.locator(".kb-editor").getByRole("button", { name: "Сохранить", exact: true }).click()
  }
  await expect(dialog).not.toBeVisible()
  await selectKnowledgeNode(page, "original.txt")
  await expect(page.getByRole("heading", { name: "original.txt", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Открыть", exact: true }).click()
  await expect(dialog).toContainText("Original document contents")
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click()
  await page.reload()
  await expect(page.getByRole("combobox", { name: "Выберите пространство" })).toContainText("Тестовая база")
  await selectKnowledgeNode(page, "original.pdf")
  await expect(page.locator(".kb-job")).toContainText("Ожидает обработчика")
  await page.getByRole("button", { name: "Открыть", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("Не удалось отобразить документ")
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Скачать оригинал", exact: true }).click()
  expect((await downloading).suggestedFilename()).toBe("original.pdf")
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click()
  await page.getByRole("button", { name: "Повторить", exact: true }).click()
  await expect(page.locator(".kb-job")).toContainText("Ожидает обработчика")
  await showKnowledgeAdd(page)
  await page.getByRole("button", { name: "Загрузить документ", exact: true }).click()
  await dialog.getByRole("button", { name: "Заметки", exact: true }).click()
  await dialog.getByRole("textbox", { name: "Название", exact: true }).fill("Заметка проверки")
  await dialog.getByRole("textbox", { name: "Текст", exact: true }).fill("Текст заметки")
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole("heading", { name: "Заметка проверки", exact: true })).toBeVisible()
  await showKnowledgeAdd(page)
  await page.getByRole("button", { name: "Загрузить документ", exact: true }).click()
  await dialog.getByRole("button", { name: "Ссылки", exact: true }).click()
  await dialog.getByRole("textbox", { name: "Название", exact: true }).fill("Ссылка проверки")
  await dialog.getByRole("textbox", { name: "URL", exact: true }).fill("https://example.com/")
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator(".kb-stats article strong")).toHaveText(["4", "1", "1", "0"])
  await page.getByRole("button", { name: "Изменить пространство", exact: true }).click()
  await dialog.getByRole("textbox", { name: "Название", exact: true }).fill("Переименованная база")
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole("combobox", { name: "Выберите пространство" })).toContainText("Переименованная база")
  await page.getByRole("button", { name: "Удалить", exact: true }).click()
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Выберите пространство" })).toContainText("Переименованная база")
  await page.getByRole("button", { name: "Удалить", exact: true }).click()
  await dialog.getByRole("button", { name: "Удалить", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole("heading", { name: "Начните свою историю знаний", exact: true })).toBeVisible()
  await expect(page.locator(".kb-stats article strong")).toHaveText(["0", "0", "0", "0"])
})

test("demo is separate, selection, search, fullscreen and responsive rendering", async ({ page }, info) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/knowledge")
  await page.getByRole("button", { name: "Посмотреть демо-карту", exact: true }).click()
  await expect(page.locator(".kb-details h2")).toHaveText("Кофейня Зёрна")
  await expect(page.locator(".kb-stats article strong")).toHaveText(["34", "6", "2", "51"])
  await expect(page.locator(".kb-webgl[aria-busy=false] canvas")).toBeVisible()
  await selectKnowledgeNode(page, "Мария Светлова")
  await page
    .getByRole("region", { name: "Исходящие связи", exact: true })
    .getByRole("button", { name: /отвечает за.*Калибровка эспрессо/ })
    .click()
  await expect(page.locator(".kb-details h2")).toHaveText("Калибровка эспрессо")
  await page.getByRole("button", { name: "Приблизить", exact: true }).click()
  await page.getByRole("button", { name: "Отдалить", exact: true }).click()
  await page.getByRole("button", { name: "Полноэкранный режим", exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  await page.evaluate(() => document.exitFullscreen())
  await page.screenshot({ path: info.outputPath("knowledge-desktop.png") })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath("knowledge-mobile.png") })
  await page.getByRole("button", { name: "← Вернуться к моей базе", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Начните свою историю знаний", exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test("WebGL unavailable falls back to an accessible list", async ({ playwright, baseURL }) => {
  const browser = await playwright.chromium.launch({ args: ["--disable-webgl"] })
  const context = await browser.newContext({ locale: "ru-RU" })
  const page = await context.newPage()
  try {
    await page.goto(`${baseURL}/knowledge`)
    await page.getByRole("button", { name: "Посмотреть демо-карту", exact: true }).click()
    await expect(page.getByTestId("knowledge-webgl-fallback")).toContainText(
      "3D недоступно. Материалы доступны в списке.",
    )
    await page.getByRole("button", { name: "Дегустация: версия латте №2 Заметки →", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Дегустация: версия латте №2", exact: true })).toBeVisible()
  } finally {
    await browser.close()
  }
})

test("storage rejects stale writes and removes originals atomically", async ({ page }) => {
  await page.goto("/knowledge")
  await expect(page.getByRole("heading", { name: "Начните свою историю знаний", exact: true })).toBeVisible()
  const result = await page.evaluate(async () => {
    const path = "/src/utils/knowledge.ts"
    const { emptyKnowledge, readKnowledge, saveKnowledge, readKnowledgeFile } = await import(path)
    const first = emptyKnowledge()
    const stale = emptyKnowledge()
    first.spaces.push({
      id: "test-space",
      name: "Stored",
      description: "",
      createdAt: "2026-10-09",
      updatedAt: "2026-10-09",
    })
    await saveKnowledge(first, [{ id: "original", file: new Blob(["exact original"]) }])
    const original = await (await readKnowledgeFile("original")).text()
    const rejected = await saveKnowledge(stale, [{ id: "uncommitted", file: new Blob(["stale"]) }]).then(
      () => false,
      () => true,
    )
    const rollback = await readKnowledgeFile("uncommitted").then(
      () => false,
      () => true,
    )
    const current = await readKnowledge()
    const name = current.spaces[0].name
    current.spaces = []
    await saveKnowledge(current, [], ["original"])
    const removed = await readKnowledgeFile("original").then(
      () => false,
      () => true,
    )
    return { original, rejected, rollback, name, removed }
  })
  expect(result).toEqual({ original: "exact original", rejected: true, rollback: true, name: "Stored", removed: true })
})

test("seed preserves the restored page areas and real data after reload", async ({ page }) => {
  await page.goto("/knowledge")
  await seedKnowledgeSpace(page)
  await expect(page.getByRole("combobox", { name: "Выберите пространство" })).toHaveValue("test-gamma-ai-platform-v1")
  await expect(page.locator(".kb-hero")).toBeVisible()
  await expect(page.locator(".kb-details")).toBeVisible()
  await expect(page.locator(".kb-spaces")).toBeVisible()
  await expect(page.locator(".kb-stats article strong")).toHaveText(["18", "10", "8", "8"])
  await expect(page.locator(".kb-webgl[aria-busy=false] canvas")).toBeVisible()
  await expect(page.locator(".kb-list")).toHaveCount(0)
  await page
    .getByRole("navigation", { name: "Фильтры" })
    .getByRole("button", { name: "Документы", exact: true })
    .click()
  await expect(page.locator(".kb-webgl[aria-busy=false] canvas")).toBeVisible()
  await expect(page.locator(".kb-list")).toHaveCount(0)
  await page.getByRole("navigation", { name: "Фильтры" }).getByRole("button", { name: "Все", exact: true }).click()
  await page.getByRole("searchbox").fill("vLLM")
  await expect(page.getByRole("region", { name: "Результаты поиска", exact: true }).getByRole("button")).toHaveCount(2)
  await expect(page.locator(".kb-webgl canvas")).toBeVisible()
  await page.reload()
  await expect(page.locator(".kb-stats article strong")).toHaveText(["18", "10", "8", "8"])
  await expect(page.locator(".kb-hero")).toBeVisible()
})
