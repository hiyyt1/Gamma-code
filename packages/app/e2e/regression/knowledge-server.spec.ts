import { readFile } from "node:fs/promises"
import path from "node:path"
import { expect, test } from "@playwright/test"
import type { RemoteKnowledge } from "../../src/utils/knowledge-sync"
import { selectKnowledgeNode, showKnowledgeAdd } from "../utils/knowledge"

// Requires a dedicated, initially empty backend, never a user's running store.
test.skip(process.env.GAMMA_KNOWLEDGE_E2E !== "1", "Dedicated Knowledge Base backend required")
test.use({ viewport: { width: 1600, height: 1000 }, locale: "ru-RU" })

test("imports local originals without loss, publishes editor changes, rejects stale writes and reloads", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000)
  const backend = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4518"}/product/knowledge`
  const read = async (): Promise<RemoteKnowledge> => (await request.get(backend)).json()
  const baseline = await read()
  expect(baseline.data.spaces.some((space) => space.id === "space-123")).toBe(false)
  await page.goto("/knowledge")
  await expect(page.locator(".kb-sync")).toHaveText(/Сохранено на сервере|Серверное хранилище пусто/)
  const local = await page.evaluate(async () => {
    const path = "/src/utils/knowledge.ts"
    const { readKnowledge, saveKnowledge } = await import(path)
    const data = await readKnowledge()
    const date = "2026-10-09T00:00:00.000Z"
    data.spaces.push({ id: "space-123", name: "Проверка переноса", description: "", createdAt: date, updatedAt: date })
    data.sources.push(
      {
        id: "123",
        spaceID: "space-123",
        type: "document",
        name: "Работа с CRM",
        description: "Работа с CRM",
        filename: "crm.md",
        text: "# CRM\n\nИсходный документ",
        mime: "text/markdown",
        size: new Blob(["# CRM\n\nИсходный документ"]).size,
        tags: [],
        createdAt: date,
        updatedAt: date,
      },
      {
        id: "456",
        spaceID: "space-123",
        type: "note",
        name: "Карточка клиента",
        description: "Карточка клиента",
        text: "Клиент 456",
        tags: [],
        createdAt: date,
        updatedAt: date,
      },
    )
    data.relations.push({
      id: "relation-1",
      spaceID: "space-123",
      source: "123",
      target: "456",
      type: "RELATED_TO",
      provenance: "manual",
      metadata: {},
    })
    await saveKnowledge(data, [{ id: "123", file: new Blob([data.sources[0].text], { type: "text/markdown" }) }])
    return readKnowledge()
  })
  await page.reload()
  await page.getByRole("button", { name: "Перенести локальные данные на сервер", exact: true }).click()
  await expect(page.locator(".kb-sync > span")).toHaveText("Сохранено на сервере")
  const imported = await read()
  expect(imported.data.sources.filter((source) => source.spaceID === "space-123")).toEqual(local.sources)
  expect(imported.data.relations.filter((edge) => edge.spaceID === "space-123")).toEqual(local.relations)
  expect(imported.data.spaces.filter((space) => space.id === "space-123")).toEqual(local.spaces)
  await page.screenshot({ path: info.outputPath("server-knowledge.png"), fullPage: true })
  expect(
    await page.evaluate(async () => {
      const path = "/src/utils/knowledge.ts"
      const api = await import(path)
      return { data: await api.readKnowledge(), original: await (await api.readLocalKnowledgeFile("123")).text() }
    }),
  ).toEqual({ data: local, original: "# CRM\n\nИсходный документ" })
  await page.reload()
  await expect(page.locator(".kb-sync > span")).toHaveText("Сохранено на сервере")
  await page.getByRole("combobox", { name: "Выберите пространство" }).selectOption("space-123")
  await selectKnowledgeNode(page, "Работа с CRM")
  await page.getByRole("button", { name: "Открыть", exact: true }).click()
  await expect(
    page.locator(".kb-viewer").frameLocator("iframe").getByText("Исходный документ", { exact: true }),
  ).toBeVisible()
  await page.locator(".kb-viewer").getByRole("button", { name: "Закрыть", exact: true }).click()
  await showKnowledgeAdd(page)
  await page.getByRole("button", { name: "Создать файл", exact: true }).click()
  const editor = page.locator(".kb-editor")
  await editor.getByLabel("Название", { exact: true }).fill("Серверный документ")
  await editor.getByRole("textbox", { name: "Markdown", exact: true }).fill("# Новый серверный документ")
  await editor.getByRole("button", { name: "3 Связи", exact: true }).click()
  await editor.getByRole("button", { name: "Добавить связь", exact: false }).click()
  await editor.getByLabel("Связанное знание", { exact: true }).selectOption("123")
  await editor.locator(".kb-edge-add").getByRole("button", { name: "Добавить связь", exact: true }).click()
  await editor.getByRole("button", { name: "4 Сохранение", exact: true }).click()
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(editor).not.toBeVisible()
  const created = await read()
  expect(created.data.sources).toHaveLength(baseline.data.sources.length + 3)
  expect(created.data.relations).toHaveLength(baseline.data.relations.length + 2)
  await page.getByRole("button", { name: "Редактировать материал", exact: true }).click()
  await editor.getByRole("textbox", { name: "Markdown", exact: true }).fill("# Обновлено на сервере")
  await editor.getByRole("button", { name: "3 Связи", exact: true }).click()
  await editor.locator(".kb-edge-row").getByRole("button", { name: "Удалить связь" }).click()
  await editor.getByRole("button", { name: "4 Сохранение", exact: true }).click()
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(editor).not.toBeVisible()
  const edited = await read()
  expect(edited.data.relations).toHaveLength(baseline.data.relations.length + 1)
  expect(edited.data.sources.find((source) => source.name === "Серверный документ")?.text).toBe(
    "# Обновлено на сервере",
  )
  const verified = await (await request.get(`${backend}/verify`)).json()
  expect(verified.errors).toEqual([])
  const folder = path.join(verified.root, "spaces", edited.spaces.find((space) => space.id === "space-123")!.storageID)
  const index = JSON.parse(await readFile(path.join(folder, "index.json"), "utf8"))
  const material = edited.data.sources.find((source) => source.name === "Серверный документ")!
  expect(await readFile(path.join(folder, index[material.id][0]), "utf8")).toBe("# Обновлено на сервере")
  expect(JSON.parse(await readFile(path.join(folder, "links.json"), "utf8"))[material.id]).toEqual([])
  // An independent publication while this editor is open must not silently overwrite either draft.
  await page.getByRole("button", { name: "Редактировать материал", exact: true }).click()
  await editor.getByRole("textbox", { name: "Markdown", exact: true }).fill("# Устаревший черновик")
  const response = await request.post(`${backend}/publish`, {
    data: {
      expectedVersion: edited.version,
      requestID: "concurrent-e2e",
      data: edited.data,
      originals: edited.originals,
    },
  })
  expect(response.ok()).toBeTruthy()
  await editor.getByRole("button", { name: "4 Сохранение", exact: true }).click()
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(page.locator(".kb-sync")).toContainText("другая версия")
  await expect(editor).toBeVisible()
  expect((await read()).data.sources).toEqual(edited.data.sources)
  page.once("dialog", (dialog) => dialog.accept())
  await editor.getByRole("button", { name: "Закрыть", exact: true }).click()
  await page.getByRole("button", { name: "Обновить с сервера", exact: true }).click()
  await expect(page.locator(".kb-sync > span")).toHaveText("Сохранено на сервере")
  await page.reload()
  await page.getByRole("combobox", { name: "Выберите пространство" }).selectOption("space-123")
  await selectKnowledgeNode(page, "Серверный документ")
  await showKnowledgeAdd(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole("region", { name: "Добавить в базу знаний", exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("server-knowledge-mobile.png"), fullPage: true })
  expect(
    await page.evaluate(async () => {
      const path = "/src/utils/knowledge.ts"
      return (await import(path)).readKnowledge()
    }),
  ).toEqual(local)
})

test("project settings connect many spaces without copying or granting agent access", async ({
  page,
  request,
}, info) => {
  const backend = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4518"}/product`
  const name = `kb-connect-${crypto.randomUUID().slice(0, 8)}`
  expect((await request.post(`${backend}/projects`, { data: { name } })).ok()).toBeTruthy()
  const original: RemoteKnowledge = await (await request.get(`${backend}/knowledge`)).json()
  const space = { id: name, name: `Дополнительное пространство ${name}`, description: "", createdAt: "", updatedAt: "" }
  expect(
    (
      await request.post(`${backend}/knowledge/publish`, {
        data: {
          expectedVersion: original.version,
          requestID: name,
          data: { ...original.data, spaces: [...original.data.spaces, space] },
          originals: original.originals,
        },
      })
    ).ok(),
  ).toBeTruthy()
  await page.goto("/")
  await page.getByRole("button", { name: "Новый чат", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name, exact: true }).click()
  await page.getByRole("button", { name: "Настройки проекта Директория и конфигурация", exact: true }).click()
  const section = page.getByRole("region", { name: "База знаний", exact: true })
  await expect(section).toContainText("Агент сможет использовать файлы подключённых пространств")
  const spaces = [...original.data.spaces, space]
  for (const item of spaces) {
    const response = page.waitForResponse(
      (response) => response.url().endsWith("/knowledge/projects") && response.request().method() === "POST",
    )
    await section.getByRole("checkbox", { name: item.name, exact: true }).check()
    expect((await response).ok()).toBeTruthy()
    await expect(section.getByRole("checkbox", { name: item.name, exact: true })).toBeEnabled()
  }
  const projects = async (): Promise<{ id: string; name: string; spaces: string[] }[]> =>
    (await request.get(`${backend}/knowledge/projects`)).json()
  const connected = (await projects()).find((project) => project.name === name)!
  expect(connected.spaces).toEqual(spaces.map((space) => space.id))
  await page.screenshot({ path: info.outputPath("project-spaces.png"), fullPage: true })
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click()
  await page.getByRole("button", { name: "Настройки проекта Директория и конфигурация", exact: true }).click()
  await expect(section.getByRole("checkbox", { name: space.name, exact: true })).toBeChecked()
  const response = page.waitForResponse(
    (response) => response.url().endsWith("/knowledge/projects") && response.request().method() === "POST",
  )
  await section.getByRole("checkbox", { name: space.name, exact: true }).uncheck()
  expect((await response).ok()).toBeTruthy()
  expect((await projects()).find((project) => project.id === connected.id)?.spaces).toEqual(
    original.data.spaces.map((space) => space.id),
  )
  const after: RemoteKnowledge = await (await request.get(`${backend}/knowledge`)).json()
  expect(after.data.sources).toEqual(original.data.sources)
  expect(after.data.relations).toEqual(original.data.relations)
  expect(after.originals).toEqual(original.originals)
  expect(after.data.spaces).toContainEqual(space)
})

test("missing original aborts import; recovery and repeated import preserve IDs and local copy", async ({
  page,
  request,
}) => {
  const backend = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4518"}`
  const read = async (): Promise<RemoteKnowledge> => (await request.get(`${backend}/product/knowledge`)).json()
  const before = await read()
  await page.goto("/knowledge")
  await expect(page.locator(".kb-sync > span")).toHaveText("Сохранено на сервере")
  const id = `recover-${crypto.randomUUID()}`
  await page.evaluate(async (id) => {
    const path = "/src/utils/knowledge.ts"
    const api = await import(path)
    const data = await api.readKnowledge()
    data.spaces.push({ id, name: "Восстановление импорта", description: "", createdAt: "", updatedAt: "" })
    data.sources.push({
      id,
      spaceID: id,
      type: "document",
      name: "Восстановленный оригинал",
      description: "",
      tags: [],
      createdAt: "",
      updatedAt: "",
      filename: "recovery.md",
      text: "# Восстановлено",
      mime: "text/markdown",
    })
    await api.saveKnowledge(data)
  }, id)
  await page.reload()
  await page.getByRole("button", { name: "Перенести локальные данные на сервер", exact: true }).click()
  await expect(page.locator(".kb-sync")).toContainText("Не найден оригинал файла")
  expect(await read()).toEqual(before)
  const local = await page.evaluate(async (id) => {
    const path = "/src/utils/knowledge.ts"
    const api = await import(path)
    await api.saveKnowledge(await api.readKnowledge(), [
      { id, file: new Blob(["# Восстановлено"], { type: "text/markdown" }) },
    ])
    return api.readKnowledge()
  }, id)
  await page.reload()
  await page.getByRole("button", { name: "Перенести локальные данные на сервер", exact: true }).click()
  await expect(page.locator(".kb-sync > span")).toHaveText("Сохранено на сервере")
  const imported = await read()
  expect(imported.data.sources).toHaveLength(before.data.sources.length + 1)
  await page.evaluate(async (url) => {
    const path = "/src/utils/knowledge.ts"
    const db = await (await import(path)).openKnowledge()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("data", "readwrite")
      tx.objectStore("data").delete(`server:${url}`)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, backend)
  await page.reload()
  await page.getByRole("button", { name: "Перенести локальные данные на сервер", exact: true }).click()
  await expect(page.locator(".kb-sync > span")).toHaveText("Сохранено на сервере")
  const repeated = await read()
  expect(repeated.data.sources).toEqual(imported.data.sources)
  expect(repeated.data.spaces).toEqual(imported.data.spaces)
  expect(repeated.data.relations).toEqual(imported.data.relations)
  expect(repeated.originals).toEqual(imported.originals)
  expect(
    await page.evaluate(async () => {
      const path = "/src/utils/knowledge.ts"
      return (await import(path)).readKnowledge()
    }),
  ).toEqual(local)
})
