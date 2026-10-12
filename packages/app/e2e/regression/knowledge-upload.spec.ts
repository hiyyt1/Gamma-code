import { expect, test, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { seedKnowledgeSpace, selectKnowledgeNode } from "../utils/knowledge"

test.use({ locale: "ru-RU" })

const read = (page: Page) =>
  page.evaluate(async () => {
    const path = "/src/utils/knowledge.ts"
    return (await import(path)).readKnowledge()
  })

async function drop(
  page: Page,
  files: { name: string; type: string; bytes: number[] }[],
  enterOnly = false,
  target = page.getByTestId("knowledge-dropzone"),
) {
  const transfer = await page.evaluateHandle((files) => {
    const data = new DataTransfer()
    files.forEach((file) => data.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type })))
    return data
  }, files)
  await target.dispatchEvent("dragenter", { dataTransfer: transfer })
  if (!enterOnly) await target.dispatchEvent("drop", { dataTransfer: transfer })
  await transfer.dispose()
}

for (const viewport of [
  { width: 1600, height: 1000 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport, locale: "ru-RU" })
    test("sidebar upload, persistent panel, drop queue, validation and demo return", async ({ page }, info) => {
      test.setTimeout(120_000)
      const errors: string[] = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.goto("/knowledge")
      await seedKnowledgeSpace(page)
      const before = await read(page)
      await expect(page.getByRole("button", { name: "Загрузить тестовое пространство", exact: true })).toHaveCount(0)
      await expect(
        page.locator(".kb-hero").getByRole("button", { name: "Загрузить материалы", exact: true }),
      ).toHaveCount(0)
      await expect(
        page.locator(".kb-tools").getByRole("button", { name: "Загрузить материалы", exact: true }),
      ).toHaveCount(0)
      await expect(page.locator(".kb-tools").getByRole("button", { name: "Создать файл", exact: true })).toHaveCount(0)
      await page.locator(".kb-details").getByRole("button", { name: "Закрыть", exact: true }).click()
      await expect(page.locator(".kb-add-materials")).toBeVisible()
      await expect(page.locator(".kb-details")).toBeVisible()
      await expect(page.getByRole("button", { name: "Загрузить документ", exact: true })).toBeVisible()
      await expect(page.locator(".kb-map .kb-file-overlay")).toHaveCount(0)
      await page.getByRole("button", { name: "Создать файл", exact: true }).click()
      await expect(page.locator(".kb-editor").getByRole("textbox", { name: "Markdown", exact: true })).toBeVisible()
      await page.locator(".kb-editor").getByRole("button", { name: "Закрыть", exact: true }).click()
      await page.getByRole("button", { name: "Загрузить документ", exact: true }).click()
      await expect(page.getByRole("dialog").locator('input[type="file"]')).toBeAttached()
      await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click()
      await page.screenshot({ path: info.outputPath("map-without-selection.png"), fullPage: true })
      const files = await Promise.all(
        ["research.pdf", "research.docx"].map(async (name) => ({
          name,
          type: name.endsWith("pdf")
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          bytes: [...(await readFile(new URL(`../fixtures/knowledge-viewer/${name}`, import.meta.url)))],
        })),
      )
      files.push(
        { name: "drop.md", type: "text/markdown", bytes: [...Buffer.from("# Dropped Markdown")] },
        { name: "drop.txt", type: "text/plain", bytes: [...Buffer.from("Dropped text")] },
      )
      await drop(page, files, true)
      await expect(page.getByText("Отпустите, чтобы добавить материал", { exact: true })).toBeVisible()
      await page.screenshot({ path: info.outputPath("drop-overlay.png"), fullPage: true })
      await drop(page, files)
      const editor = page.locator(".kb-editor")
      for (const file of files) {
        await expect(editor.getByLabel("Имя файла", { exact: true })).toHaveValue(file.name)
        await editor.getByRole("button", { name: "Закрыть", exact: true }).click()
      }
      await expect(editor).not.toBeVisible()
      expect(await read(page)).toEqual(before)
      for (const file of [
        { name: "no.exe", type: "application/octet-stream", bytes: [77, 90] },
        { name: "fake.pdf", type: "application/pdf", bytes: [...Buffer.from("not PDF")] },
        { name: "fake.docx", type: "application/zip", bytes: [80, 75, 3, 4] },
        { name: "fake.txt", type: "image/png", bytes: [0, 1] },
      ]) {
        await drop(page, [file])
        await expect(page.locator(".kb-inner > .kb-error")).toBeVisible()
        await expect(editor).not.toBeVisible()
        expect(await read(page)).toEqual(before)
      }
      await drop(page, files)
      for (const file of files) {
        await expect(editor.getByLabel("Имя файла", { exact: true })).toHaveValue(file.name)
        await editor.getByRole("button", { name: "4 Сохранение", exact: true }).click()
        await editor.getByRole("button", { name: "Сохранить", exact: true }).click()
      }
      await expect(editor).not.toBeVisible()
      const after = await read(page)
      expect(after.sources).toHaveLength(before.sources.length + 4)
      expect(
        after.sources.filter((source: { id: string }) =>
          before.sources.some((old: { id: string }) => old.id === source.id),
        ),
      ).toEqual(before.sources)
      expect(after.relations).toEqual(before.relations)
      await selectKnowledgeNode(page, "Архитектура платформы")
      const canvas = page.locator(".kb-webgl canvas")
      const render = async () => {
        const box = (await canvas.boundingBox())!
        return page.screenshot({ clip: { x: box.x + 4, y: box.y + 4, width: box.width - 8, height: box.height - 8 } })
      }
      const frames = { previous: Buffer.alloc(0) }
      await expect
        .poll(async () => {
          const current = await canvas.screenshot()
          const settled = frames.previous.equals(current)
          frames.previous = current
          return settled
        })
        .toBe(true)
      const pose = await render()
      await page.getByRole("button", { name: "Посмотреть демо-карту", exact: true }).click()
      await expect(page.locator(".kb-demo")).toContainText("Изменения здесь не сохраняются")
      await expect(
        page.locator(".kb-demo").getByRole("button", { name: "← Вернуться к моей базе", exact: true }),
      ).toBeVisible()
      await expect(page.locator(".kb-demo").getByRole("button")).toBeInViewport()
      await page.screenshot({ path: info.outputPath("demo-return.png"), fullPage: true })
      await page.getByRole("button", { name: "← Вернуться к моей базе", exact: true }).click()
      await expect(page.locator(".kb-details h2")).toHaveText("Архитектура платформы")
      await expect(page.getByRole("combobox", { name: "Выберите пространство" })).toHaveValue(
        "test-gamma-ai-platform-v1",
      )
      expect(await read(page)).toEqual(after)
      await canvas.scrollIntoViewIfNeeded()
      await expect.poll(async () => (await render()).equals(pose)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.reload()
      expect(await read(page)).toEqual(after)
      expect(errors).toEqual([])
    })
  })
}

test("drop into a new base resumes the existing wizard after space creation", async ({ page }) => {
  await page.goto("/knowledge")
  await expect(page.getByRole("heading", { name: "Начните свою историю знаний", exact: true })).toBeVisible()
  const files = [{ name: "first.txt", type: "text/plain", bytes: [...Buffer.from("First material")] }]
  await drop(page, files)
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click()
  expect((await read(page)).spaces).toHaveLength(0)
  expect((await read(page)).sources).toHaveLength(0)
  await drop(page, files)
  await dialog.getByRole("textbox", { name: "Название", exact: true }).fill("New space")
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click()
  const editor = page.locator(".kb-editor")
  await expect(editor.getByLabel("Имя файла", { exact: true })).toHaveValue("first.txt")
  expect((await read(page)).sources).toHaveLength(0)
  await editor.getByRole("button", { name: "4 Сохранение", exact: true }).click()
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(editor).not.toBeVisible()
  await expect(page.locator(".kb-webgl[aria-busy=false] canvas")).toBeVisible()
  expect((await read(page)).sources).toHaveLength(1)
})

test("dropping on the graph does not open upload or add an overlay", async ({ page }) => {
  await page.goto("/knowledge")
  await seedKnowledgeSpace(page)
  await page.locator(".kb-details").getByRole("button", { name: "Закрыть", exact: true }).click()
  const before = await read(page)
  await drop(
    page,
    [{ name: "map.txt", type: "text/plain", bytes: [...Buffer.from("Do not import")] }],
    false,
    page.locator(".kb-map"),
  )
  await expect(page.locator(".kb-editor")).toHaveCount(0)
  await expect(page.locator(".kb-file-overlay")).toHaveCount(0)
  await expect(page.locator(".kb-details").getByTestId("knowledge-dropzone")).toBeVisible()
  expect(await read(page)).toEqual(before)
})
