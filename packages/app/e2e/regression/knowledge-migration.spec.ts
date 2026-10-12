import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { selectKnowledgeNode } from "../utils/knowledge"
import type { RemoteKnowledge } from "../../src/utils/knowledge-sync"

test.skip(process.env.GAMMA_KNOWLEDGE_E2E !== "1", "Dedicated backend required")
test.use({ locale: "ru-RU", viewport: { width: 1600, height: 1000 } })
test("complete backup and verified migration preserve all original formats and existing server records", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000)
  const backend = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT}/product/knowledge`
  const before: RemoteKnowledge = await (await request.get(backend)).json()
  const files = await Promise.all(
    ["research.pdf", "research.docx"].map(async (name) => ({
      name,
      bytes: [...(await readFile(new URL(`../fixtures/knowledge-viewer/${name}`, import.meta.url)))],
      mime: name.endsWith("pdf")
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })),
  )
  files.push(
    { name: "real.md", bytes: [...Buffer.from("# Полный Markdown\n\nОписание")], mime: "text/markdown" },
    { name: "real.txt", bytes: [...Buffer.from("Строка 1\n  Строка 2\n")], mime: "text/plain" },
  )
  await page.goto("/knowledge")
  await expect(page.locator(".kb-sync")).toHaveText(/Сохранено на сервере|Серверное хранилище пусто/)
  const id = `migration-${crypto.randomUUID()}`
  const local = await page.evaluate(
    async ({ id, files }) => {
      const path = "/src/utils/knowledge.ts"
      const api = await import(path)
      const data = await api.readKnowledge()
      data.spaces.push({
        id,
        name: "Миграция всех форматов",
        description: "Исходное пространство",
        createdAt: "",
        updatedAt: "",
      })
      const common = {
        spaceID: id,
        description: "Сохранённое описание",
        tags: ["тег"],
        createdAt: "",
        updatedAt: "",
        visual: { color: "#7455F6", icon: "document", size: "large", style: "glass" },
      }
      const originals = files.map((file, index) => {
        const sourceID = `${id}-${index}`
        const blob = new File([new Uint8Array(file.bytes)], file.name, { type: file.mime })
        data.sources.push({
          ...common,
          id: sourceID,
          type: "document",
          name: file.name,
          filename: file.name,
          mime: file.mime,
          size: blob.size,
          ...(file.name.endsWith("md") || file.name.endsWith("txt")
            ? { text: new TextDecoder().decode(new Uint8Array(file.bytes)) }
            : {}),
        })
        return { id: sourceID, file: blob }
      })
      data.sources.push(
        { ...common, id: `${id}-note`, type: "note", name: "Заметка", text: "# Текст заметки" },
        { ...common, id: `${id}-url`, type: "link", name: "Источник", url: "https://example.org/original" },
      )
      data.relations.push({
        id: `${id}-edge`,
        spaceID: id,
        source: `${id}-0`,
        target: `${id}-1`,
        type: "RELATED_TO",
        provenance: "manual",
        metadata: { reason: "Сохранить тип" },
      })
      await api.saveKnowledge(data, originals)
      return api.readKnowledge()
    },
    { id, files },
  )
  await page.reload()
  await page.getByRole("button", { name: "Резервная копия", exact: true }).click()
  await page.getByRole("button", { name: "Проверить локальные данные", exact: true }).click()
  await expect(page.locator(".kb-migration")).toContainText("Пространства: 1 · Материалы: 6 · Связи: 1 · Оригиналы: 4")
  await page.getByRole("button", { name: "Подготовить резервную копию с оригиналами", exact: true }).click()
  const download = page.waitForEvent("download")
  await page.getByRole("link", { name: "Скачать резервную копию с оригиналами", exact: true }).click()
  const backupPath = info.outputPath("full-backup.json")
  await (await download).saveAs(backupPath)
  const backup = JSON.parse(await readFile(backupPath, "utf8"))
  expect(backup.records.find((record: { key: string }) => record.key === "current").value).toEqual(local)
  expect(backup.missing).toEqual([])
  expect(backup.files).toHaveLength(4)
  for (const [index, file] of files.entries()) {
    const entry = backup.files.find((file: { key: string }) => file.key === `${id}-${index}`)
    expect([...Buffer.from(entry.base64, "base64")]).toEqual(file.bytes)
    expect(entry.sha256).toBe(createHash("sha256").update(new Uint8Array(file.bytes)).digest("hex"))
  }
  await page.screenshot({ path: info.outputPath("inventory-backup.png"), fullPage: true })
  await page
    .getByRole("dialog", { name: "Резервная копия", exact: true })
    .getByRole("button", { name: "Закрыть", exact: true })
    .click()
  await page.getByRole("button", { name: "Перенести локальные данные на сервер", exact: true }).click()
  await expect(page.locator(".kb-sync > span")).toHaveText("Сохранено на сервере")
  const after: RemoteKnowledge = await (await request.get(backend)).json()
  expect(after.data.sources.filter((source) => source.spaceID === id)).toEqual(local.sources)
  expect(after.data.relations.filter((edge) => edge.spaceID === id)).toEqual(local.relations)
  expect(after.data.sources.filter((source) => source.spaceID !== id)).toEqual(before.data.sources)
  const checked = await (await request.get(`${backend}/verify`)).json()
  expect(checked.errors).toEqual([])
  const folder = path.join(checked.root, "spaces", after.spaces.find((space) => space.id === id)!.storageID)
  const index = JSON.parse(await readFile(path.join(folder, "index.json"), "utf8"))
  const links = JSON.parse(await readFile(path.join(folder, "links.json"), "utf8"))
  expect(links[`${id}-0`]).toEqual([`${id}-1`])
  expect(links[`${id}-1`]).toEqual([`${id}-0`])
  for (const [number, file] of files.entries()) {
    const sourceID = `${id}-${number}`
    const hash = createHash("sha256").update(sourceID).digest("hex")
    expect([...(await readFile(path.join(folder, "originals", `${hash}.${file.name.split(".").pop()}`)))]).toEqual(
      file.bytes,
    )
    await readFile(path.join(folder, index[sourceID][0]))
  }
  expect(await readFile(path.join(folder, index[`${id}-url`][0]), "utf8")).toContain(
    "Сохранённое описание\n\nhttps://example.org/original",
  )
  await page.reload()
  await page.getByRole("button", { name: "Просмотреть сохранённые локальные данные", exact: true }).click()
  await expect(page.getByRole("button", { name: "Перенести локальные данные на сервер", exact: true })).toBeEnabled()
  await expect(page.getByRole("combobox", { name: "Выберите пространство" })).toHaveValue(id)
  await page.getByRole("button", { name: "Вернуться к серверным данным", exact: true }).click()
  await expect(page.locator(".kb-sync > span")).toHaveText("Сохранено на сервере")
  await page.getByRole("combobox", { name: "Выберите пространство" }).selectOption(id)
  for (const name of ["research.pdf", "research.docx"]) {
    await selectKnowledgeNode(page, name)
    await page.locator(".kb-details").getByRole("button", { name: "Открыть", exact: true }).click()
    const viewer = page.locator(".kb-viewer")
    if (name.endsWith("pdf")) await expect(viewer.locator("canvas")).toBeVisible()
    else
      await expect(
        viewer.frameLocator("iframe").getByRole("heading", { name: "Product research brief", exact: true }),
      ).toBeVisible()
    await viewer.getByRole("button", { name: "Закрыть", exact: true }).click()
  }
  await page.getByRole("button", { name: "Резервная копия", exact: true }).click()
  await page.getByRole("button", { name: "Проверить файлы на сервере", exact: true }).click()
  await expect(page.locator(".kb-migration")).toContainText(
    "Физические файлы, индексы, связи и хеши оригиналов проверены.",
  )
  await page.screenshot({ path: info.outputPath("verified-migration.png"), fullPage: true })
})
