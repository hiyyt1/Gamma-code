import { expect, test } from "@playwright/test"
import { readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"

test.skip(process.env.OPENCODE_WORKSPACE_UPLOAD_E2E !== "1", "Requires a local product server")
test.use({ viewport: { width: 1440, height: 1000 } })

test("fixed-root New chat flow preserves sessions and scopes files, previews and uploads", async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const suffix = Date.now()
  const names = [`alpha-${suffix}`, `beta-${suffix}`]
  const directories: string[] = []
  const sessions: string[] = []
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  const panel = page.getByRole("complementary", { name: "Workspace", exact: true })
  const sidebar = page.locator('[data-component="oreshnik-sidebar"]')
  const dialog = page.getByRole("dialog")
  const create = async (name: string, existing = false) => {
    await sidebar.getByRole("button", { name: "New chat", exact: true }).click()
    await expect(dialog.getByRole("heading", { name: "Where shall we work?" })).toBeVisible()
    const response = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/session",
    )
    if (existing) await dialog.getByRole("button", { name, exact: true }).click()
    else {
      await dialog.getByRole("button", { name: "Create project", exact: true }).click()
      await dialog.getByRole("textbox", { name: "Project name" }).fill(name)
      await dialog.getByRole("button", { name: "Create project", exact: true }).click()
    }
    const result = await response
    expect(result.ok()).toBe(true)
    const session = await result.json()
    sessions.push(session.id)
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`${session.id}$`))
    await expect(panel.getByRole("button", { name: "Upload files" })).toBeEnabled()
    return session
  }
  const upload = async (name: string, id: string) => {
    const response = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().endsWith(`/product/session/${id}/files`),
    )
    await panel.locator('input[type="file"]').setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(name) })
    expect((await response).ok()).toBe(true)
    await expect(panel.getByRole("button", { name, exact: true })).toBeVisible()
  }
  try {
    await page.goto("/")
    const a = await create(names[0])
    directories.push(a.directory)
    expect((await stat(a.directory)).isDirectory()).toBe(true)
    await expect(stat(join(a.directory, ".git"))).rejects.toThrow()
    await upload("a.txt", a.id)
    const a2 = await create(names[0], true)
    expect(a2.id).not.toBe(a.id)
    expect(a2.directory).toBe(a.directory)
    await expect(panel.getByRole("button", { name: "a.txt", exact: true })).toBeVisible()
    const b = await create(names[1])
    directories.push(b.directory)
    await expect(panel.getByRole("button", { name: "a.txt", exact: true })).toHaveCount(0)
    await upload("b.txt", b.id)
    expect(await readFile(join(a.directory, "a.txt"), "utf8")).toBe("a.txt")
    expect(await readFile(join(b.directory, "b.txt"), "utf8")).toBe("b.txt")
    await expect(readFile(join(a.directory, "b.txt"))).rejects.toThrow()
    await expect(readFile(join(b.directory, "a.txt"))).rejects.toThrow()
    await panel.getByRole("button", { name: "b.txt", exact: true }).click()
    await expect(page.locator("diffs-container").getByText("b.txt", { exact: true })).toBeVisible()
    await page.goBack()
    await expect(dialog).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "a.txt", exact: true })).toBeVisible()
    await page.goForward()
    await expect(panel.getByRole("button", { name: "b.txt", exact: true })).toBeVisible()
    await page.goBack()
    await expect(panel.getByRole("button", { name: "a.txt", exact: true })).toBeVisible()
    for (const index of [1, 0, 1, 0]) {
      await sidebar.getByRole("button", { name: names[index], exact: true }).click()
      await expect(panel.getByRole("button", { name: index ? "b.txt" : "a.txt", exact: true })).toBeVisible()
      await expect(panel.getByRole("button", { name: index ? "a.txt" : "b.txt", exact: true })).toHaveCount(0)
    }
    await page.reload()
    await expect(panel.getByRole("button", { name: "a.txt", exact: true })).toBeVisible()
    await expect(sidebar.getByRole("button", { name: names[1], exact: true })).toBeVisible()
    await panel.getByRole("button", { name: "Collapse workspace files" }).click()
    await expect(panel).toHaveCount(0)
    await page.getByRole("button", { name: "Workspace files", exact: true }).click()
    const activeID = page.url().split("/").at(-1)
    const dropped = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().endsWith(`/product/session/${activeID}/files`),
    )
    await panel.evaluate((element) => {
      const data = new DataTransfer()
      data.items.add(new File(["drop"], "drop.txt", { type: "text/plain" }))
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }))
    })
    expect((await dropped).ok()).toBe(true)
    await expect(panel.getByRole("button", { name: "drop.txt", exact: true })).toBeVisible()
    expect(await readFile(join(a.directory, "drop.txt"), "utf8")).toBe("drop")
    await writeFile(join(a.directory, "agent-result.md"), "Generated result")
    await panel.getByRole("button", { name: "Refresh files" }).click()
    await expect(panel.getByRole("button", { name: "agent-result.md", exact: true })).toBeVisible()
    const all = await (await request.get(`${baseURL}/session`, { params: { directory: a.directory } })).json()
    expect(all.map((session: { id: string }) => session.id)).toEqual(expect.arrayContaining([a.id, a2.id]))
    for (const name of ["../etc", "/tmp/test", "..", "a/b", "\\", "", "%2e%2e", ".hidden"]) {
      const invalid = await request.post(`${baseURL}/product/projects`, { data: { name } })
      expect(invalid.status()).toBe(400)
    }
    expect((await request.post(`${baseURL}/product/projects`, { data: { name: names[0] } })).status()).toBe(400)
    await page.getByRole("link", { name: "Oreshnik", exact: true }).click()
    await sidebar.getByRole("button", { name: names[0], exact: true }).click()
    await expect(panel.getByRole("button", { name: "a.txt", exact: true })).toBeVisible()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator("body")).not.toContainText(a.directory)
    expect(errors).toEqual([])
  } finally {
    await page.goto("/")
    for (const id of sessions) await request.delete(`${baseURL}/session/${id}`)
    for (const directory of directories) await rm(directory, { recursive: true, force: true })
  }
})
