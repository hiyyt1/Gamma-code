import { expect, test, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { selectKnowledgeNode } from "../utils/knowledge"

test.use({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU" })

const markdown =
  "# План исследования\n\n## Цель\nОбъединить документы, заметки и идеи в Gamma.\n\n- Сохранить оригиналы\n- Читать внутри приложения\n- Связать знания\n\n| Материал | Статус |\n| --- | --- |\n| Исследование | Готово |\n| Интервью | В работе |\n\n> Знания полезнее вместе.\n\n**Результат:** единое пространство команды."

async function seed(page: Page) {
  await page.goto("/knowledge")
  await expect(page.getByRole("heading", { name: "Начните свою историю знаний", exact: true })).toBeVisible()
  const pdf = await readFile(new URL("../fixtures/knowledge-viewer/research.pdf", import.meta.url))
  const docx = await readFile(new URL("../fixtures/knowledge-viewer/research.docx", import.meta.url))
  const longDocx = await readFile(new URL("../fixtures/knowledge-viewer/long.docx", import.meta.url))
  const unsafeDocx = await readFile(new URL("../fixtures/knowledge-viewer/unsafe.docx", import.meta.url))
  await page.evaluate(
    async ({ pdf, docx, longDocx, unsafeDocx, markdown }) => {
      const path = "/src/utils/knowledge.ts"
      const { emptyKnowledge, saveKnowledge } = await import(path)
      const data = emptyKnowledge()
      const now = "2026-10-09T00:00:00Z"
      data.spaces.push({ id: "viewer", name: "Viewer checks", description: "", createdAt: now, updatedAt: now })
      const files = [
        { id: "research.pdf", file: new Blob([new Uint8Array(pdf)], { type: "application/pdf" }) },
        { id: "research.docx", file: new Blob([new Uint8Array(docx)]) },
        { id: "long.docx", file: new Blob([new Uint8Array(longDocx)]) },
        { id: "unsafe.docx", file: new Blob([new Uint8Array(unsafeDocx)]) },
        { id: "research.md", file: new Blob([markdown], { type: "text/markdown" }) },
        { id: "lines.txt", file: new Blob(["First line\n  indented\n\nLast line"]) },
        ...["empty.pdf", "empty.docx", "empty.md", "empty.txt"].map((id) => ({ id, file: new Blob([]) })),
        ...["broken.pdf", "broken.docx"].map((id) => ({ id, file: new Blob(["invalid document"]) })),
        { id: "long.txt", file: new Blob(["Long document line\n".repeat(150000) + "END OF DOCUMENT"]) },
        { id: "long.md", file: new Blob(["A large paragraph.\n\n".repeat(10000) + "END OF DOCUMENT"]) },
        { id: "oversized.md", file: new Blob(["# Long\n".repeat(300000)]) },
        {
          id: "unsafe.md",
          file: new Blob([
            '# Safe heading\n\n<script>parent.alert("executed")</script>\n<img src="https://viewer.invalid/tracker" onerror="alert(1)"><style>body{background:url(https://viewer.invalid/css)}</style>\n\n![remote](https://viewer.invalid/image)\n\n[unsafe](javascript:alert(1))\n\n[safe](https://example.com/)\n\n<iframe src="https://viewer.invalid/embed"></iframe><svg onload="alert(1)"></svg>',
          ]),
        },
      ]
      data.sources.push(
        ...files.map((item) => ({
          id: item.id,
          name: item.id,
          filename: item.id,
          size: item.file.size,
          spaceID: "viewer",
          type: "document",
          description: "Viewer fixture",
          tags: [],
          createdAt: now,
          updatedAt: now,
        })),
      )
      data.sources.push(
        ...[
          { id: "note", name: "Meeting note", type: "note", text: "# Итоги встречи\n\nРешение согласовано." },
          {
            id: "link",
            name: "Saved source",
            type: "link",
            url: "https://example.com/",
            description: "Saved source description",
          },
          { id: "missing", name: "missing.pdf", type: "document", filename: "missing.pdf" },
          { id: "cached", name: "cached.md", type: "document", filename: "cached.md", text: "# Сохранённый текст" },
        ].map((item) => ({ spaceID: "viewer", description: "", tags: [], createdAt: now, updatedAt: now, ...item })),
      )
      data.relations.push({
        id: "relation",
        spaceID: "viewer",
        source: "research.md",
        target: "note",
        type: "RELATED_TO",
        provenance: "manual",
        metadata: {},
      })
      await saveKnowledge(data, files)
    },
    {
      pdf: Array.from(pdf),
      docx: Array.from(docx),
      longDocx: Array.from(longDocx),
      unsafeDocx: Array.from(unsafeDocx),
      markdown,
    },
  )
  await page.reload()
  await expect(page.getByRole("combobox", { name: "Выберите пространство" })).toContainText("Viewer checks")
}

async function open(page: Page, name: string) {
  await selectKnowledgeNode(page, name)
  await page.locator(".kb-details").getByRole("button", { name: "Открыть", exact: true }).click()
  await expect(page.getByRole("dialog", { name, exact: true })).toBeVisible()
  return page.getByRole("dialog", { name, exact: true })
}

test.beforeEach(async ({ page }) => {
  await seed(page)
})

test("PDF stays in app, navigates 30 pages, zooms, downloads exact original and closes", async ({ page }, info) => {
  const downloads: string[] = []
  page.on("download", (download) => downloads.push(download.suggestedFilename()))
  const dialog = await open(page, "research.pdf")
  await expect(dialog).toHaveJSProperty("open", true)
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true)
  await expect(dialog.getByRole("img", { name: "Страница 1 из 30", exact: true })).toBeVisible()
  expect(downloads).toEqual([])
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(1000)
  await page.screenshot({ path: info.outputPath("pdf.png") })
  await dialog.getByRole("button", { name: "Следующая страница", exact: true }).click()
  await expect(dialog.getByRole("img", { name: "Страница 2 из 30", exact: true })).toBeVisible()
  await dialog.getByRole("spinbutton", { name: "Страница", exact: true }).fill("30")
  await dialog.getByRole("spinbutton", { name: "Страница", exact: true }).press("Enter")
  await expect(dialog.getByRole("img", { name: "Страница 30 из 30", exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Следующая страница", exact: true })).toBeDisabled()
  await dialog.getByRole("button", { name: "Приблизить", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "По ширине", exact: true })).toHaveText("125%")
  await expect(dialog.locator(".kb-pdf-surface")).toHaveAttribute("aria-busy", "false")
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Скачать оригинал", exact: true }).click()
  const download = await downloading
  expect(await readFile((await download.path())!)).toEqual(
    await readFile(new URL("../fixtures/knowledge-viewer/research.pdf", import.meta.url)),
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await dialog.getByRole("button", { name: "По ширине", exact: true }).click()
  await expect(dialog.locator(".kb-pdf-surface")).toHaveAttribute("aria-busy", "false")
  expect(await dialog.evaluate((element) => element.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath("pdf-mobile.png") })
  await page.keyboard.press("Escape")
  await expect(dialog).not.toBeVisible()
  await open(page, "research.pdf")
  await expect(page.getByRole("img", { name: "Страница 1 из 30", exact: true })).toBeVisible()
})

test("DOCX and Markdown render headings, lists and tables; editing preserves uploaded original", async ({
  page,
}, info) => {
  const downloads: string[] = []
  page.on("download", (download) => downloads.push(download.suggestedFilename()))
  for (const [name, title] of [
    ["research.docx", "Product research brief"],
    ["research.md", "План исследования"],
  ]) {
    const dialog = await open(page, name)
    const frame = dialog.frameLocator("iframe")
    await expect(frame.getByRole("heading", { name: title, exact: true })).toBeVisible()
    await expect(frame.getByRole("listitem")).toHaveCount(3)
    await expect(frame.getByRole("table")).toBeVisible()
    expect(downloads).toEqual([])
    await page.screenshot({ path: info.outputPath(name.endsWith("docx") ? "docx.png" : "markdown.png") })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await dialog.evaluate((element) => element.scrollWidth <= innerWidth)).toBe(true)
    await expect(frame.getByRole("heading", { name: title, exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath(name.endsWith("docx") ? "docx-mobile.png" : "markdown-mobile.png") })
    await page.setViewportSize({ width: 1440, height: 1000 })
    if (name.endsWith("docx")) {
      await expect(dialog.getByRole("button", { name: "Редактировать материал", exact: true })).toHaveCount(0)
      await dialog.getByRole("button", { name: "Закрыть", exact: true }).click()
      continue
    }
    await dialog.getByRole("button", { name: "Редактировать материал", exact: true }).click()
    const editor = page.getByRole("dialog", { name: "Редактировать материал", exact: true })
    await expect(editor.getByRole("textbox", { name: "Markdown", exact: true })).toHaveValue(markdown)
    await editor.getByRole("textbox", { name: "Markdown", exact: true }).fill("# Обновлённый план")
    await editor.getByRole("button", { name: "4 Сохранение", exact: true }).click()
    await editor.getByRole("button", { name: "Сохранить", exact: true }).click()
    await expect(editor).not.toBeVisible()
  }
  const dialog = await open(page, "research.md")
  await expect(
    dialog.frameLocator("iframe").getByRole("heading", { name: "Обновлённый план", exact: true }),
  ).toBeVisible()
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Скачать оригинал", exact: true }).click()
  expect(await readFile((await (await downloading).path())!, "utf8")).toBe(markdown)
  const stored = await page.evaluate(async () => {
    const path = "/src/utils/knowledge.ts"
    const { readKnowledge } = await import(path)
    return readKnowledge()
  })
  expect(stored.relations).toHaveLength(1)
  expect(stored.spaces).toHaveLength(1)
  expect(stored.sources).toHaveLength(20)
})

test("TXT, notes and source cards; no navigation until explicit website action", async ({ page, context }) => {
  await context.route("https://example.com/", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Example source</h1>" }),
  )
  const txt = await open(page, "lines.txt")
  await expect(txt.locator("pre")).toHaveText("First line\n  indented\n\nLast line", { useInnerText: false })
  await txt.getByRole("button", { name: "Закрыть", exact: true }).click()
  const note = await open(page, "Meeting note")
  await expect(note.frameLocator("iframe").getByRole("heading", { name: "Итоги встречи", exact: true })).toBeVisible()
  await note.getByRole("button", { name: "Редактировать материал", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Markdown", exact: true })).toHaveValue(
    "# Итоги встречи\n\nРешение согласовано.",
  )
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click()
  const link = await open(page, "Saved source")
  await expect(link).toContainText("Saved source description")
  await expect(link.locator("iframe")).toHaveCount(0)
  expect(context.pages()).toHaveLength(1)
  const popup = page.waitForEvent("popup")
  await link.getByRole("link", { name: "Открыть сайт", exact: false }).click()
  await expect(await popup).toHaveURL("https://example.com/")
})

test("empty, damaged, missing and large documents have usable states", async ({ page }) => {
  for (const name of ["empty.pdf", "empty.docx", "empty.md", "empty.txt"]) {
    const dialog = await open(page, name)
    await expect(dialog.getByRole("status")).toHaveText("Файл пуст.")
    await expect(dialog.getByRole("button", { name: "Скачать оригинал", exact: true })).toBeEnabled()
    await page.keyboard.press("Escape")
  }
  for (const name of ["broken.pdf", "broken.docx"]) {
    const dialog = await open(page, name)
    await expect(dialog.getByRole("alert")).toContainText("Не удалось отобразить документ")
    await page.keyboard.press("Escape")
  }
  const missing = await open(page, "missing.pdf")
  await expect(missing.getByRole("status")).toContainText("Оригинал файла недоступен")
  await expect(missing.getByRole("button", { name: "Скачать оригинал", exact: true })).toBeDisabled()
  await page.keyboard.press("Escape")
  const cached = await open(page, "cached.md")
  await expect(
    cached.frameLocator("iframe").getByRole("heading", { name: "Сохранённый текст", exact: true }),
  ).toBeVisible()
  await page.keyboard.press("Escape")
  const large = await open(page, "oversized.md")
  await expect(large.getByRole("alert")).toContainText("Документ превышает ограничения просмотра")
  await page.keyboard.press("Escape")
  const text = await open(page, "long.txt")
  await expect(text.locator("pre")).toContainText("END OF DOCUMENT")
  expect(await text.locator(".kb-viewer-body").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  )
  await page.keyboard.press("Escape")
  const md = await open(page, "long.md")
  await expect(md.frameLocator("iframe").getByText("END OF DOCUMENT", { exact: true })).toBeAttached()
  await page.keyboard.press("Escape")
  await expect(md).not.toBeVisible()
  const docx = await open(page, "long.docx")
  await expect(docx.frameLocator("iframe").getByText("END OF DOCUMENT", { exact: true })).toBeAttached()
  await page.keyboard.press("Escape")
  await expect(docx).not.toBeVisible()
})

test("untrusted document markup cannot execute scripts or request external resources", async ({ page }) => {
  const requests: string[] = []
  const alerts: string[] = []
  page.on("request", (request) => {
    if (request.url().includes("viewer.invalid")) requests.push(request.url())
  })
  page.on("dialog", async (dialog) => {
    alerts.push(dialog.message())
    await dialog.dismiss()
  })
  const dialog = await open(page, "unsafe.md")
  const frame = dialog.frameLocator("iframe")
  await expect(frame.getByRole("heading", { name: "Safe heading", exact: true })).toBeVisible()
  await expect(frame.locator("script,img,iframe,svg,body style")).toHaveCount(0)
  await expect(frame.locator('a[href^="javascript:"]')).toHaveCount(0)
  await expect(frame.getByRole("link", { name: "safe", exact: true })).toHaveAttribute("rel", "noopener noreferrer")
  expect(requests).toEqual([])
  expect(alerts).toEqual([])
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click()
  const docx = await open(page, "unsafe.docx")
  const document = docx.frameLocator("iframe")
  await expect(document.getByRole("heading", { name: "Product research brief", exact: true })).toBeVisible()
  await expect(document.locator("img,script")).toHaveCount(0)
  await expect(document.locator('a[href^="javascript:"]')).toHaveCount(0)
  expect(requests).toEqual([])
  expect(alerts).toEqual([])
})
