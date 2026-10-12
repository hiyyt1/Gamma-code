import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1600, height: 1000 }, locale: "ru-RU" })

test("map selection toggles, switches and clears without affecting drag or double-click focus", async ({ page }) => {
  await page.goto("/knowledge")
  await expect(page.getByRole("heading", { name: "Начните свою историю знаний", exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const path = "/src/utils/knowledge.ts"
    const { emptyKnowledge, saveKnowledge } = await import(path)
    const data = emptyKnowledge()
    const date = "2026-10-09"
    data.spaces.push({ id: "selection", name: "Selection", description: "", createdAt: date, updatedAt: date })
    data.sources = ["left", "right"].map((id) => ({
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
  })
  await page.reload()
  const canvas = page.locator(".kb-webgl[aria-busy=false] canvas")
  const render = async () => {
    const box = (await canvas.boundingBox())!
    // Exclude the rounded container corners, whose clipping is rasterized anew on resize.
    return page.screenshot({ clip: { x: box.x + 4, y: box.y + 4, width: box.width - 8, height: box.height - 8 } })
  }
  const heading = page.locator(".kb-details").getByRole("heading", { level: 2 })
  await expect(canvas).toBeVisible()
  await expect(page.locator(".kb-add-materials")).toBeVisible()
  // Body centres for this deterministic two-node fixture and fixed viewport.
  const left = { x: 222, y: 166 }
  const right = { x: 734, y: 330 }
  const background = { x: 480, y: 70 }
  const click = async (position: { x: number; y: number }) => {
    const point = { x: position.x + ((await canvas.boundingBox())!.width - 960) / 2, y: position.y }
    await canvas.hover({ position: point })
    if (position === background) await expect(canvas).not.toHaveClass(/clickable/)
    else await expect(canvas).toHaveClass(/clickable/)
    await canvas.click({ position: point })
  }
  const settleCamera = async () => {
    const frames = { previous: Buffer.alloc(0) }
    await expect
      .poll(async () => {
        const current = await render()
        const settled = frames.previous.equals(current)
        frames.previous = current
        return settled
      })
      .toBe(true)
  }
  await settleCamera()
  const normal = await render()
  await click(left)
  await expect(heading).toHaveText("left")
  await expect.poll(async () => (await render()).equals(normal)).toBe(false)
  const selected = await render()
  await page.getByRole("button", { name: "Связанные документы", exact: true }).click()
  await expect(page.getByRole("button", { name: "Связанные документы", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await click(left)
  await expect(page.locator(".kb-add-materials")).toBeVisible()
  // Exact rendered equality catches stale size, colour, glow and link highlights.
  await expect.poll(async () => (await render()).equals(normal)).toBe(true)
  await click(left)
  await expect(heading).toHaveText("left")
  await click(right)
  await expect(heading).toHaveText("right")
  await click(background)
  await expect(page.locator(".kb-add-materials")).toBeVisible()
  await expect.poll(async () => (await render()).equals(normal)).toBe(true)

  for (const alreadySelected of [false, true]) {
    if (alreadySelected) {
      await click(left)
      await expect(heading).toHaveText("left")
    }
    const point = { x: left.x + ((await canvas.boundingBox())!.width - 960) / 2, y: left.y }
    await canvas.hover({ position: point })
    await expect(canvas).toHaveClass(/clickable/)
    await canvas.dblclick({ position: point })
    await expect(heading).toHaveText("left")
    await expect.poll(async () => (await render()).equals(selected)).toBe(false)
    await settleCamera()
    await page.getByRole("button", { name: "Сбросить камеру", exact: true }).click()
    await settleCamera()
    await click(background)
    await expect(page.locator(".kb-add-materials")).toBeVisible()
  }

  await click(right)
  await expect(heading).toHaveText("right")
  const beforeDrag = await render()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + left.x, box.y + left.y)
  await page.mouse.down()
  await page.mouse.move(box.x + left.x + 65, box.y + left.y + 35, { steps: 12 })
  await page.mouse.up()
  await expect.poll(async () => (await render()).equals(beforeDrag)).toBe(false)
  await expect(heading).toHaveText("right")
  const beforeOrbit = await render()
  await page.mouse.move(box.x + background.x, box.y + background.y)
  await page.mouse.down()
  await page.mouse.move(box.x + background.x + 90, box.y + background.y + 40, { steps: 12 })
  await page.mouse.up()
  await expect.poll(async () => (await render()).equals(beforeOrbit)).toBe(false)
  await expect(heading).toHaveText("right")
  const beforePan = await render()
  await canvas.hover({ position: background })
  await page.mouse.down({ button: "right" })
  await page.mouse.move(box.x + background.x + 65, box.y + background.y + 25, { steps: 12 })
  await page.mouse.up({ button: "right" })
  await expect.poll(async () => (await render()).equals(beforePan)).toBe(false)
  await expect(heading).toHaveText("right")
  const beforeZoom = await render()
  await page.getByRole("button", { name: "Приблизить", exact: true }).click()
  await expect.poll(async () => (await render()).equals(beforeZoom)).toBe(false)
  await expect(heading).toHaveText("right")
})
