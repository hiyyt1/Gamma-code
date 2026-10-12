import { expect, test, type Page } from "@playwright/test"

test.use({ viewport: { width: 1600, height: 1000 }, locale: "ru-RU" })

const read = (page: Page) =>
  page.evaluate(async () => {
    const path = "/src/utils/knowledge.ts"
    return (await import(path)).readKnowledge()
  })

async function seed(page: Page, count = 2) {
  await page.goto("/knowledge")
  await expect(page.getByRole("heading", { name: "Начните свою историю знаний", exact: true })).toBeVisible()
  await page.evaluate(async (count) => {
    const path = "/src/utils/knowledge.ts"
    const { emptyKnowledge, saveKnowledge } = await import(path)
    const data = emptyKnowledge()
    const date = "2026-10-09"
    data.spaces.push({ id: "selection", name: "Selection", description: "", createdAt: date, updatedAt: date })
    data.sources = ["left", "right"].slice(0, count).map((id) => ({
      id,
      name: id,
      spaceID: "selection",
      type: "note",
      text: id,
      description: "",
      tags: [],
      createdAt: date,
      updatedAt: date,
    }))
    if (count === 2)
      data.relations.push({
        id: "edge",
        source: "left",
        target: "right",
        spaceID: "selection",
        type: "RELATED_TO",
        provenance: "manual",
        metadata: {},
      })
    await saveKnowledge(data)
  }, count)
  await page.reload()
  await expect(page.locator(".kb-webgl[aria-busy=false] canvas")).toBeVisible()
}

async function clickNode(page: Page, x: number, y: number) {
  const canvas = page.locator(".kb-webgl canvas")
  const point = { x: x + ((await canvas.boundingBox())!.width - 960) / 2, y }
  await canvas.hover({ position: point })
  await expect(canvas).toHaveClass(/clickable/)
  await canvas.click({ position: point })
}

async function save(page: Page) {
  const editor = page.locator(".kb-editor")
  await expect(editor.getByRole("button", { name: "Сохранить", exact: true })).toBeEnabled()
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(editor).not.toBeVisible()
}

test("map picking holds the camera, cancellation preserves data, Next validates and saves the pending relation", async ({
  page,
}, info) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await seed(page)
  await clickNode(page, 222, 166)
  await expect(page.locator(".kb-details h2")).toHaveText("left")
  const before = await read(page)
  const canvas = page.locator(".kb-webgl canvas")
  const original = (await canvas.elementHandle())!
  const box = (await canvas.boundingBox())!
  // Exclude the mode instruction overlay, while retaining both nodes and the edge.
  const clip = { x: box.x, y: box.y + 100, width: box.width, height: box.height - 100 }
  const pose = await page.screenshot({ clip })
  await page.getByRole("button", { name: "Добавить связь", exact: true }).click()
  await expect(page.locator(".kb-connect-banner")).toBeVisible()
  expect(await canvas.boundingBox()).toEqual(box)
  await expect.poll(async () => (await page.screenshot({ clip })).equals(pose)).toBe(true)
  await page.screenshot({ path: info.outputPath("adding-relation.png") })
  await page.locator(".kb-connect-banner").getByRole("button", { name: "Отмена", exact: true }).click()
  expect(await read(page)).toEqual(before)
  await page.getByRole("button", { name: "Добавить связь", exact: true }).click()
  await clickNode(page, 734, 330)
  const editor = page.locator(".kb-editor")
  await expect(editor.getByLabel("Связанное знание", { exact: true })).toHaveValue("right")
  await editor.getByRole("button", { name: "Далее", exact: true }).click()
  await expect(editor.getByRole("alert")).toContainText("такая связь уже существует")
  await expect(editor.getByLabel("Связанное знание", { exact: true })).toHaveValue("right")
  await editor.locator(".kb-edge-add").getByLabel("Тип связи", { exact: true }).selectOption("USES")
  await editor.getByRole("button", { name: "Далее", exact: true }).click()
  await save(page)
  expect((await read(page)).relations).toEqual([
    ...before.relations,
    expect.objectContaining({ source: "left", target: "right", type: "USES" }),
  ])
  expect(await original.evaluate((el) => el.isConnected)).toBe(true)
  await page.reload()
  expect((await read(page)).relations).toHaveLength(2)
  expect(errors).toEqual([])
})

test("search target does not focus the camera; cancelling its editor is read-only and review confirms the pending edge", async ({
  page,
}) => {
  await seed(page)
  await clickNode(page, 222, 166)
  const before = await read(page)
  const canvas = page.locator(".kb-webgl canvas")
  const pose = await canvas.screenshot()
  for (const cancel of [true, false]) {
    await page.getByRole("button", { name: "Добавить связь", exact: true }).click()
    await page.getByRole("searchbox").fill("right")
    await page
      .getByRole("region", { name: "Результаты поиска", exact: true })
      .getByRole("button", { name: "right", exact: true })
      .click()
    const editor = page.locator(".kb-editor")
    await expect(editor.getByLabel("Связанное знание", { exact: true })).toHaveValue("right")
    if (cancel) {
      await editor.getByRole("button", { name: "Закрыть", exact: true }).click()
      await page.getByRole("searchbox").fill("")
      await expect.poll(async () => (await canvas.screenshot()).equals(pose)).toBe(true)
      expect(await read(page)).toEqual(before)
      continue
    }
    await editor.locator(".kb-edge-add").getByLabel("Тип связи", { exact: true }).selectOption("DESCRIBES")
    await editor.getByRole("button", { name: "4 Сохранение", exact: true }).click()
    await save(page)
  }
  expect((await read(page)).relations).toEqual([
    ...before.relations,
    expect.objectContaining({ source: "left", target: "right", type: "DESCRIBES" }),
  ])
})

test("a space with one node reports no targets and allows cancellation", async ({ page }) => {
  await seed(page, 1)
  await page.getByRole("searchbox").fill("left")
  await page
    .getByRole("region", { name: "Результаты поиска", exact: true })
    .getByRole("button", { name: "left", exact: true })
    .click()
  const before = await read(page)
  await page.getByRole("button", { name: "Добавить связь", exact: true }).click()
  await expect(page.locator(".kb-connect-banner")).toContainText("Подходящих узлов нет")
  await page.locator(".kb-connect-banner").getByRole("button", { name: "Отмена", exact: true }).click()
  await expect(page.locator(".kb-connect-banner")).not.toBeVisible()
  expect(await read(page)).toEqual(before)
})

test("an IndexedDB revision conflict releases save controls; cancel and retry retain concurrent data", async ({
  page,
}) => {
  await seed(page)
  await clickNode(page, 222, 166)
  await page.getByRole("button", { name: "Добавить связь", exact: true }).click()
  await clickNode(page, 734, 330)
  const editor = page.locator(".kb-editor")
  await editor.locator(".kb-edge-add").getByLabel("Тип связи", { exact: true }).selectOption("USES")
  await editor.getByRole("button", { name: "Далее", exact: true }).click()
  // A real concurrent write exercises the transaction abort path without stubbing IndexedDB.
  await page.evaluate(async () => {
    const path = "/src/utils/knowledge.ts"
    const { readKnowledge, saveKnowledge } = await import(path)
    const data = await readKnowledge()
    data.sources.find((source: { id: string }) => source.id === "right").description = "Concurrent edit"
    await saveKnowledge(data)
    const channel = new BroadcastChannel("gamma-knowledge")
    channel.postMessage("updated")
    channel.close()
  })
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(editor.getByRole("alert")).toBeVisible()
  await expect(editor.getByRole("button", { name: "Сохранить", exact: true })).toBeEnabled()
  await expect(editor.getByRole("button", { name: "Отмена", exact: true })).toBeEnabled()
  expect((await read(page)).relations).toHaveLength(1)
  page.once("dialog", (dialog) => dialog.accept())
  await editor.getByRole("button", { name: "Отмена", exact: true }).click()
  await page.reload()
  await clickNode(page, 222, 166)
  await page.getByRole("button", { name: "Добавить связь", exact: true }).click()
  await clickNode(page, 734, 330)
  await editor.locator(".kb-edge-add").getByLabel("Тип связи", { exact: true }).selectOption("USES")
  await editor.getByRole("button", { name: "Далее", exact: true }).click()
  await save(page)
  const data = await read(page)
  expect(data.relations).toHaveLength(2)
  expect(data.sources.find((source: { id: string }) => source.id === "right").description).toBe("Concurrent edit")
})
