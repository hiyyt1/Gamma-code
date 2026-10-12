import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import { mkdir, writeFile, symlink } from "node:fs/promises"
import { join } from "node:path"

test.skip(process.env.GAMMA_WORKSPACE_E2E !== "1", "Requires an isolated local Gamma backend")
test.use({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", reducedMotion: "reduce" })
const backend = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4129"}`

async function project(request: APIRequestContext) {
  const response = await request.post(`${backend}/product/projects`, {
    data: { name: `files-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
  })
  expect(response.ok()).toBe(true)
  const directory: { path: string; name: string } = await response.json()
  const created = await request.post(`${backend}/session`, {
    headers: { "x-opencode-directory": directory.path },
    data: {},
  })
  expect(created.ok()).toBe(true)
  const session: { id: string; agent: string } = await created.json()
  return { ...directory, id: session.id, agent: session.agent }
}
async function open(page: Page, fixture: { path: string; id: string }) {
  await page.goto(`/${Buffer.from(fixture.path).toString("base64url")}/session/${fixture.id}`)
  const panel = page.getByRole("complementary", { name: "Рабочая область", exact: true })
  await expect(panel).toBeVisible()
  return panel
}

test("loading, genuine empty state, existing upload and narrow panel", async ({ page, request }, info) => {
  const fixture = await project(request)
  for (const name of [".git", "node_modules", ".cache"]) await mkdir(join(fixture.path, name))
  let release = () => {}
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(`**/product/session/${fixture.id}/files?*`, async (route) => {
    await ready
    await route.continue()
  })
  const panel = await open(page, fixture)
  await expect(panel.getByRole("status")).toContainText("Загрузка")
  await expect(panel.getByText("Здесь появятся файлы проекта", { exact: true })).toHaveCount(0)
  release()
  await expect(panel.getByText("0 файлов", { exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Загрузить файлы", exact: true })).toHaveCount(1)
  await expect(panel.getByRole("heading", { name: "Файлы проекта", exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("empty.png"), animations: "disabled" })
  const resize = panel.getByRole("separator")
  await resize.focus()
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")
  await expect(resize).toHaveAttribute("aria-valuenow", "260")
  await panel.getByText("Рабочая область", { exact: true }).click()
  await page.screenshot({ path: info.outputPath("narrow.png"), animations: "disabled" })
  const uploaded = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith(`/session/${fixture.id}/files`),
  )
  await panel
    .locator('input[type="file"]')
    .setInputFiles({ name: "README.md", mimeType: "text/plain", buffer: Buffer.from("# Uploaded project") })
  expect((await uploaded).ok()).toBe(true)
  await expect(panel.getByRole("button", { name: "README.md", exact: true })).toBeVisible()
  await expect(panel.getByText("Здесь появятся файлы проекта", { exact: true })).toHaveCount(0)
})

test("nested sorted tree, long names, readonly code, copy and image preview", async ({
  page,
  request,
  context,
}, info) => {
  const fixture = await project(request)
  await mkdir(join(fixture.path, "src", "components"), { recursive: true })
  await writeFile(
    join(fixture.path, "src", "components", "Header.tsx"),
    "export const Header = () => <h1>Gamma workspace</h1>\n",
  )
  await writeFile(join(fixture.path, "README.md"), "# Project\n")
  await writeFile(join(fixture.path, ".env.example"), "PUBLIC_TITLE=Gamma\n")
  const long = `${"long-file-name-".repeat(9)}.ts`
  await writeFile(join(fixture.path, long), "export const value = 1\n")
  await writeFile(join(fixture.path, "binary.bin"), Buffer.from([0, 255, 0]))
  await writeFile(
    join(fixture.path, "pixel.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFz0AAAAASUVORK5CYII=",
      "base64",
    ),
  )
  const panel = await open(page, fixture)
  await expect(panel.getByRole("button", { name: "src", exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: ".env.example", exact: true })).toBeVisible()
  const rows = panel.locator('[data-slot="file-tree-v2-row"]')
  expect((await rows.allTextContents())[0]).toBe("src")
  await panel.getByRole("button", { name: "src", exact: true }).click()
  await panel.getByRole("button", { name: "components", exact: true }).click()
  await expect(panel.getByRole("button", { name: "Header.tsx", exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Загрузить файлы", exact: true })).toHaveCount(1)
  await expect(panel.getByRole("button", { name: "Загрузить файлы", exact: true })).toBeEnabled()
  await expect(panel.getByRole("heading", { name: "Файлы проекта", exact: true })).toHaveCount(0)
  await expect(panel.getByRole("button", { name: "Обновить список файлов", exact: true })).toHaveCount(1)
  await expect(panel.getByText("Здесь появятся файлы проекта", { exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("tree.png"), animations: "disabled" })
  const resize = panel.getByRole("separator")
  await resize.focus()
  for (let index = 0; index < 12; index++) await page.keyboard.press("ArrowLeft")
  await expect(resize).toHaveAttribute("aria-valuenow", "560")
  await panel.getByRole("button", { name: "Header.tsx", exact: true }).click()
  await expect(panel.locator("diffs-container").getByText(/Gamma workspace/)).toBeVisible()
  await page.screenshot({ path: info.outputPath("preview.png"), animations: "disabled" })
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await panel.getByRole("button", { name: "Копировать содержимое", exact: true }).click()
  await expect(panel.getByRole("button", { name: "Скопировано", exact: true })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Gamma workspace")
  await panel.getByRole("button", { name: "Вернуться к файлам", exact: true }).click()
  await expect(panel.getByRole("button", { name: "Header.tsx", exact: true })).toBeVisible()
  await expect(panel.locator('[data-path="src/components/Header.tsx"]')).toHaveAttribute("data-selected", "")
  await panel.getByRole("button", { name: "Обновить список файлов", exact: true }).click()
  await expect(panel.getByRole("button", { name: "Header.tsx", exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "binary.bin", exact: true }).click()
  await expect(panel.getByText("Предпросмотр этого формата файла недоступен.", { exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Вернуться к файлам", exact: true }).click()
  await panel.getByRole("button", { name: "pixel.png", exact: true }).click()
  await expect(panel.getByRole("img", { name: "pixel.png", exact: true })).toBeVisible()
})

test("agent shell events replace empty state and update a preview without page refresh", async ({ page, request }) => {
  const fixture = await project(request)
  const panel = await open(page, fixture)
  await expect(panel.getByText("0 файлов", { exact: true })).toBeVisible()
  const shell = async (command: string) => {
    const response = await request.post(`${backend}/session/${fixture.id}/shell`, {
      headers: { "x-opencode-directory": fixture.path },
      data: { agent: fixture.agent, command },
    })
    expect(response.ok()).toBe(true)
  }
  await shell("mkdir -p src; printf 'export const site = 1\\n' > src/site.ts")
  await expect(panel.getByRole("button", { name: "src", exact: true })).toBeVisible()
  await expect(panel.getByText("Здесь появятся файлы проекта", { exact: true })).toHaveCount(0)
  await panel.getByRole("button", { name: "src", exact: true }).click()
  await panel.getByRole("button", { name: "site.ts", exact: true }).click()
  await expect(panel.locator("diffs-container").getByText(/export const site = 1/)).toBeVisible()
  await shell("printf 'export const site = 2\\n' > src/site.ts")
  await expect(panel.locator("diffs-container").getByText(/export const site = 2/)).toBeVisible()
  await shell("rm src/site.ts")
  await expect(panel.getByRole("alert")).toContainText("Не удалось прочитать файл")
  await panel.getByRole("button", { name: "Вернуться к файлам", exact: true }).click()
  await expect(panel.getByRole("button", { name: "site.ts", exact: true })).toHaveCount(0)
})

test("listing failure, read failure, size limit and server path protections", async ({ page, request }) => {
  const fixture = await project(request)
  await writeFile(join(fixture.path, "large.txt"), Buffer.alloc(2 * 1024 * 1024 + 1, 65))
  await writeFile(join(fixture.path, "unreadable.txt"), "test")
  await symlink("/etc", join(fixture.path, "escape"))
  await page.route(`**/product/session/${fixture.id}/files?*`, (route) =>
    route.fulfill({ status: 503, json: { code: "unavailable" } }),
  )
  const panel = await open(page, fixture)
  await expect(panel.getByRole("alert")).toContainText("Не удалось загрузить файлы проекта")
  await expect(panel.getByText("Здесь появятся файлы проекта", { exact: true })).toHaveCount(0)
  await page.unroute(`**/product/session/${fixture.id}/files?*`)
  await panel.getByRole("button", { name: "Повторить", exact: true }).click()
  await panel.getByRole("button", { name: "large.txt", exact: true }).click()
  await expect(panel.getByRole("alert")).toContainText("Максимальный размер — 2 МБ")
  await panel.getByRole("button", { name: "Вернуться к файлам", exact: true }).click()
  await page.route(`**/product/session/${fixture.id}/content?path=unreadable.txt`, (route) =>
    route.fulfill({ status: 403, json: { code: "permission_denied" } }),
  )
  await panel.getByRole("button", { name: "unreadable.txt", exact: true }).click()
  await expect(panel.getByRole("alert")).toContainText("Не удалось прочитать файл")
  for (const path of ["../outside", "/etc/passwd", "escape/passwd"]) {
    const response = await request.get(`${backend}/product/session/${fixture.id}/content`, { params: { path } })
    expect(response.status()).toBe(400)
  }
})
;([false, true] as const).forEach((durable) => {
  test(`switching projects scopes file lists and previews (durable=${durable})`, async ({ page, request }) => {
    const a = await project(request)
    const b = await project(request)
    // Keep both sessions durable: the existing lifecycle discards empty sessions on leave.
    for (const fixture of durable ? [a, b] : []) {
      const response = await request.post(`${backend}/session/${fixture.id}/prompt_async`, {
        headers: { "x-opencode-directory": fixture.path },
        data: { noReply: true, parts: [{ type: "text", text: "Workspace fixture" }] },
      })
      expect(response.ok()).toBe(true)
    }
    await writeFile(join(a.path, "alpha.txt"), "Alpha project")
    await writeFile(join(b.path, "beta.txt"), "Beta project")
    const panel = await open(page, a)
    await panel.getByRole("button", { name: "alpha.txt", exact: true }).click()
    await expect(panel.locator("diffs-container").getByText("Alpha project", { exact: true })).toBeVisible()
    await page.locator('[data-component="gamma-sidebar"]').getByRole("button", { name: b.name, exact: true }).click()
    await expect(panel.getByRole("button", { name: "beta.txt", exact: true })).toBeVisible()
    await expect(panel.getByRole("button", { name: "alpha.txt", exact: true })).toHaveCount(0)
    await expect(panel.getByRole("region", { name: "Просмотр файла", exact: true })).toHaveCount(0)
    await page.locator('[data-component="gamma-sidebar"]').getByRole("button", { name: a.name, exact: true }).click()
    await expect(panel.getByRole("button", { name: "alpha.txt", exact: true })).toBeVisible()
    await expect(panel.getByRole("button", { name: "beta.txt", exact: true })).toHaveCount(0)
  })
})

test("reference layout keeps upload available and accepts a real file drop", async ({ page, request }, info) => {
  const fixture = await project(request)
  const panel = await open(page, fixture)
  await expect(panel.getByText("0 файлов", { exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Загрузить файлы", exact: true })).toBeEnabled()
  await expect(panel.getByRole("button", { name: "Новая папка", exact: true })).toHaveCount(0)
  await panel.screenshot({ path: info.outputPath("reference-empty.png"), animations: "disabled" })
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer()
    data.items.add(new File(['print("Hello, Gamma!")\n'], "hello.py", { type: "text/plain" }))
    return data
  })
  const response = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith(`/session/${fixture.id}/files`),
  )
  await panel.dispatchEvent("dragenter", { dataTransfer: transfer })
  await expect(panel.locator(".workspace-files-drop")).toBeVisible()
  await panel.dispatchEvent("dragover", { dataTransfer: transfer })
  await panel.dispatchEvent("drop", { dataTransfer: transfer })
  expect((await response).ok()).toBe(true)
  await transfer.dispose()
  await expect(panel.getByRole("button", { name: "hello.py", exact: true })).toBeVisible()
  await expect(panel.getByText("1 файл", { exact: true })).toBeVisible()
  await expect(panel.locator(".workspace-files-drop")).toHaveCount(0)
  await panel.screenshot({ path: info.outputPath("reference-result.png"), animations: "disabled" })
  await page.screenshot({ path: info.outputPath("reference-desktop.png"), animations: "disabled" })
  await panel.getByRole("button", { name: "hello.py", exact: true }).click()
  await expect(panel.locator("diffs-container").getByText(/Hello, Gamma!/)).toBeVisible()
  await expect(panel.getByRole("button", { name: "Загрузить файлы", exact: true })).toBeEnabled()
})

test("chat expands without legacy review tabs and retains workspace file preview", async ({ page, request }) => {
  const fixture = await project(request)
  await request.post(`${backend}/session/${fixture.id}/message`, {
    headers: { "x-opencode-directory": fixture.path },
    data: { noReply: true, parts: [{ type: "text", text: "Layout regression" }] },
  })
  await writeFile(join(fixture.path, "layout-check.txt"), "Gamma workspace preview")
  const panel = await open(page, fixture)
  const content = page.locator(".workspace-files-content")
  const composer = page.locator('[data-component="prompt-input-v2"]')
  await expect(composer).toBeVisible()
  await expect(page.locator("#review-panel, #file-tree-panel")).toHaveCount(0)
  await expect(page.getByRole("tab", { name: "Обзор", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Создать репозиторий Git", exact: true })).toHaveCount(0)
  const width = await content.evaluate((element) => element.getBoundingClientRect().width)
  await page.getByRole("button", { name: "Рабочая область", exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect.poll(() => content.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(width)
  await page.reload()
  await expect(composer).toBeVisible()
  await expect(panel).toHaveCount(0)
  await expect(page.locator("#review-panel, #file-tree-panel")).toHaveCount(0)

  await page.keyboard.press("ControlOrMeta+p")
  await page.getByRole("textbox", { name: "Поиск файлов, команд и сессий", exact: true }).fill("layout-check.txt")
  await page.getByRole("option", { name: /layout-check\.txt/ }).click()
  await expect(panel.getByRole("region", { name: "Просмотр файла", exact: true })).toBeVisible()
  await expect(panel.locator("diffs-container").getByText("Gamma workspace preview", { exact: false })).toBeVisible()
  await expect(page.locator("#review-panel, #file-tree-panel")).toHaveCount(0)

  const next = await project(request)
  await request.post(`${backend}/session/${next.id}/message`, {
    headers: { "x-opencode-directory": next.path },
    data: { noReply: true, parts: [{ type: "text", text: "Session switch regression" }] },
  })
  await open(page, next)
  await expect(composer).toBeVisible()
  await expect(page.locator("#review-panel, #file-tree-panel")).toHaveCount(0)
  await page.reload()
  await expect(panel).toBeVisible()
  await expect(composer).toBeVisible()
  await expect(page.locator("#review-panel, #file-tree-panel")).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect.poll(() => panel.evaluate((element) => element.getBoundingClientRect().right <= innerWidth)).toBe(true)
  await page.getByRole("button", { name: "Рабочая область", exact: true }).click()
  await expect(composer).toBeVisible()
  await expect
    .poll(() =>
      composer.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= innerWidth
      }),
    )
    .toBe(true)
})
