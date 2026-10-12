import { expect, test } from "@playwright/test"
import { seedKnowledgeSpace, showKnowledgeAdd, selectKnowledgeNode } from "../utils/knowledge"

test.use({ locale: "ru-RU", viewport: { width: 1600, height: 1200 } })

test("appearance choices, presets, real map and edit persistence", async ({ page }, info) => {
  test.setTimeout(150_000)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/knowledge")
  await seedKnowledgeSpace(page)
  const before = await page.evaluate(async () => {
    const path = "/src/utils/knowledge.ts"
    return (await import(path)).readKnowledge()
  })
  const editor = page.locator(".kb-editor")
  for (const [index, style] of ["Мягкое свечение", "Контурный", "Стеклянный"].entries()) {
    await showKnowledgeAdd(page)
    await page.getByRole("button", { name: "Создать файл", exact: true }).click()
    await editor.getByLabel("Название", { exact: true }).fill(`Оформление ${index + 1}`)
    await editor.getByRole("textbox", { name: "Markdown", exact: true }).fill("# Содержимое сохраняется")
    await editor.getByRole("button", { name: "2 Оформление", exact: true }).click()
    await expect(editor.locator(".kb-node-preview")).toHaveAttribute("data-ready", "true")
    if (index === 0) {
      for (const button of await editor.locator(".kb-swatches button").all()) {
        await button.click()
        await expect(button).toHaveAttribute("aria-pressed", "true")
      }
      for (const button of await editor.locator(".kb-icon-options button").all()) {
        await button.click()
        await expect(button).toHaveAttribute("aria-pressed", "true")
        const selectedIcon = await button.locator("use").getAttribute("href")
        await expect(editor.locator(".kb-node-preview-icon use")).toHaveAttribute("href", selectedIcon!)
      }
      for (const button of await editor.locator(".kb-size-options button").all()) {
        await button.click()
        await expect(button).toHaveAttribute("aria-pressed", "true")
      }
      for (const button of await editor.locator(".kb-preset-options button").all()) {
        await button.click()
        await expect(button).toHaveAttribute("aria-pressed", "true")
      }
    }
    await editor
      .locator(".kb-preset-options")
      .getByRole("button", { name: ["Документ", "Ссылка", "Идея"][index], exact: true })
      .click()
    await editor.getByRole("button", { name: style, exact: true }).click()
    await expect(editor.locator(".kb-node-preview")).toHaveAttribute("data-style", ["glow", "outline", "glass"][index])
    await editor.locator(".kb-editor-body").evaluate((el) => {
      el.scrollTop = 0
    })
    await page.screenshot({ path: info.outputPath(`appearance-${index}.png`) })
    await editor.getByRole("button", { name: "4 Сохранение", exact: true }).click()
    await editor.getByRole("button", { name: "Сохранить", exact: true }).click()
    await expect(editor).not.toBeVisible()
  }
  await showKnowledgeAdd(page)
  await expect(page.locator(".kb-webgl[aria-busy=false] canvas")).toBeVisible()
  await page.screenshot({ path: info.outputPath("styled-map.png"), fullPage: true })
  await page.reload()
  const after = await page.evaluate(async () => {
    const path = "/src/utils/knowledge.ts"
    return (await import(path)).readKnowledge()
  })
  expect(after.sources.filter((source) => before.sources.some((old) => old.id === source.id))).toEqual(before.sources)
  expect(after.relations).toEqual(before.relations)
  const added = after.sources.filter((source) => source.name.startsWith("Оформление "))
  expect(added.map((source) => source.visual?.style)).toEqual(["glow", "outline", "glass"])
  expect(added.every((source) => source.text === "# Содержимое сохраняется")).toBe(true)
  await selectKnowledgeNode(page, "Оформление 3")
  await page.getByRole("button", { name: "Редактировать материал", exact: true }).click()
  await editor.getByRole("button", { name: "2 Оформление", exact: true }).click()
  await expect(editor.getByRole("button", { name: "Стеклянный", exact: true })).toHaveAttribute("aria-pressed", "true")
  await editor.getByRole("button", { name: "XL — Выделенный", exact: true }).click()
  await editor.getByRole("button", { name: "4 Сохранение", exact: true }).click()
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(editor).not.toBeVisible()
  await page.reload()
  const edited = await page.evaluate(async () => {
    const path = "/src/utils/knowledge.ts"
    return (await import(path)).readKnowledge()
  })
  expect(edited.sources.find((source) => source.name === "Оформление 3")?.visual).toMatchObject({
    style: "glass",
    size: "featured",
    icon: "idea",
    color: "#f3bea5",
  })
  expect(errors).toEqual([])
})

test("appearance on mobile and legacy node defaults", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/knowledge")
  await seedKnowledgeSpace(page)
  await page.getByRole("button", { name: "Редактировать материал", exact: true }).click()
  const editor = page.locator(".kb-editor")
  await editor.getByRole("button", { name: "2 Оформление", exact: true }).click()
  await expect(editor.getByRole("button", { name: "Мягкое свечение", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(editor.getByRole("button", { name: "M — Стандартный", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(editor.locator(".kb-node-preview")).toHaveAttribute("data-ready", "true")
  await page.screenshot({ path: info.outputPath("appearance-mobile.png") })
  await editor.getByRole("button", { name: "Контурный", exact: true }).click()
  await expect(editor.locator(".kb-node-preview")).toHaveAttribute("data-style", "outline")
  expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  page.on("dialog", (dialog) => dialog.accept())
  await editor.getByRole("button", { name: "Отмена", exact: true }).click()
  await expect(editor).not.toBeVisible()
})

test("dense graph retains responsive rendering with mixed materials", async ({ page }, info) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/knowledge")
  await seedKnowledgeSpace(page)
  await page.evaluate(async () => {
    const path = "/src/utils/knowledge.ts"
    const storage = await import(path)
    const data = await storage.readKnowledge()
    const template = data.sources[0]
    data.sources.push(
      ...Array.from({ length: 116 }, (_, index) => ({
        ...template,
        id: `dense-${index}`,
        name: `Dense ${index}`,
        visual: undefined,
      })),
    )
    await storage.saveKnowledge(data)
  })
  const samples: Record<string, { median: number; p95: number }> = {}
  for (const mode of ["glow", "mixed"]) {
    if (mode === "mixed")
      await page.evaluate(async () => {
        const path = "/src/utils/knowledge.ts"
        const editPath = "/src/utils/knowledge-edit.ts"
        const storage = await import(path)
        const { nodePresets } = await import(editPath)
        const presets = Object.values(nodePresets)
        const data = await storage.readKnowledge()
        data.sources.forEach((source: { visual: unknown }, index: number) => {
          source.visual = presets[index % presets.length]
        })
        await storage.saveKnowledge(data)
      })
    await page.reload()
    await expect(page.locator(".kb-webgl[aria-busy=false] canvas")).toBeVisible()
    // Frame intervals are measured as a performance sample, never used as a readiness wait.
    samples[mode] = await page.evaluate(
      () =>
        new Promise<{ median: number; p95: number }>((resolve) => {
          const intervals: number[] = []
          let previous = performance.now()
          const sample = (now: number) => {
            intervals.push(now - previous)
            previous = now
            if (intervals.length < 90) {
              requestAnimationFrame(sample)
              return
            }
            intervals.sort((a, b) => a - b)
            resolve({ median: intervals[45], p95: intervals[85] })
          }
          requestAnimationFrame(sample)
        }),
    )
  }
  await page.screenshot({ path: info.outputPath("dense-mixed-map.png"), fullPage: true })
  await info.attach("frame-intervals-ms", { body: JSON.stringify(samples), contentType: "application/json" })
  expect(errors).toEqual([])
})
