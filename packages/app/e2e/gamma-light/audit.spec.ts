import { expect, test } from "@playwright/test"
import { directory, setupGamma, sessionURL } from "./fixture"

test.beforeEach(async ({ page }) => {
  await setupGamma(page)
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
})

test("session load benchmark", async ({ page }, info) => {
  const start = performance.now()
  await page.goto(sessionURL)
  await expect(page.getByText("Текст ответа должен быть видимым.", { exact: true })).toBeVisible()
  await expect(page.locator('[contenteditable="true"]')).toBeEditable()
  await info.attach("session-ready-ms", { body: String(performance.now() - start), contentType: "text/plain" })
})

test("session menu closes by trigger, Escape and outside click", async ({ page }) => {
  await page.goto(sessionURL)
  const trigger = page.locator(".gamma-session-actions").getByRole("button", { name: "Дополнительные опции" })
  await expect(page.locator('[contenteditable="true"]')).toBeEditable()
  await trigger.click()
  await expect(page.getByRole("menu")).toBeVisible()
  await trigger.click()
  await expect(page.getByRole("menu")).toHaveCount(0)
  await trigger.click()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toHaveCount(0)
  await trigger.click()
  await page.locator('[contenteditable="true"]').click()
  await expect(page.getByRole("menu")).toHaveCount(0)
  await page.locator('[contenteditable="true"]').fill("Still usable")
})

test("knowledge trigger survives a pending refetch", async ({ page }) => {
  await page.route("**/product/knowledge/projects", (route) =>
    route.fulfill({ json: [{ id: "kb-project", path: directory, spaces: [] }] }),
  )
  await page.goto(sessionURL)
  const button = page.locator(".gamma-session-actions").getByRole("button", { name: /База знаний/ })
  await expect(button).toBeEnabled()
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/product/knowledge", async (route) => {
    await pending
    await route.fallback()
  })
  const request = page.waitForRequest("**/product/knowledge")
  await button.click()
  await request
  await expect(button).toBeVisible()
  release()
  await expect(page.locator(".gamma-project-kb-search")).toBeEditable()
})

test("attachment picker opens and accepts a file", async ({ page }) => {
  await page.goto(sessionURL)
  await expect(page.locator('[contenteditable="true"]')).toBeEditable()
  await page.locator('[data-action="prompt-attach"]').click()
  const chooser = page.waitForEvent("filechooser")
  await page.getByRole("menuitem", { name: /Изображения и файлы/ }).click()
  await (await chooser).setFiles({ name: "audit.txt", mimeType: "text/plain", buffer: Buffer.from("attachment") })
  await expect(page.getByText("audit.txt", { exact: true })).toBeVisible()
  await expect(page.getByRole("menu")).toHaveCount(0)
})

test("composer waits for agent configuration before accepting input or attachments", async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/\/(api\/)?agent(?:\?|$)/, async (route) => {
    await pending
    await route.fallback()
  })
  await page.goto(sessionURL)
  const editor = page.getByRole("textbox", { name: "Промпт", exact: true })
  await expect(editor).toBeVisible()
  await expect(editor).not.toBeEditable()
  await expect(page.locator('[data-action="prompt-attach"]')).toBeDisabled()
  release()
  await expect(editor).toBeEditable()
  await expect(page.locator('[data-action="prompt-attach"]')).toBeEnabled()
})

test("legacy session restores agent after reload", async ({ page }) => {
  await page.goto(sessionURL)
  await expect(page.getByText("Текст ответа должен быть видимым.", { exact: true })).toBeVisible()
  await expect(page.locator('[data-action="prompt-agent"]')).toHaveAttribute("data-agent", "build")
  await page.reload()
  await expect(page.locator('[data-action="prompt-agent"]')).toHaveAttribute("data-agent", "build")
})

test("context shows real fractional usage after reload", async ({ page }) => {
  await page.goto(sessionURL)
  await page.reload()
  await expect(page.getByText("Текст ответа должен быть видимым.", { exact: true })).toBeVisible()
  await page.locator(".gamma-session-actions").getByRole("button", { name: "Дополнительные опции" }).click()
  await expect(page.getByRole("menuitem", { name: /Показать использование контекста/ })).toContainText(/<0[.,]1%/)
})

test("pending agent metadata does not suspend the menu or agent dialog", async ({ page }) => {
  await setupGamma(page, { agent: "gamma-test-designer" })
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/product/agent-market/agents/test-designer", async (route) => {
    await pending
    await route.fulfill({ json: { id: "test-designer", name: "Тестовый дизайнер", description: "Описание" } })
  })
  await page.goto(sessionURL)
  await expect(page.locator('[contenteditable="true"]')).toBeEditable()
  const metadata = page.waitForRequest("**/product/agent-market/agents/test-designer")
  await page.locator(".gamma-session-actions").getByRole("button", { name: "Дополнительные опции" }).click()
  await metadata
  await page.getByRole("menuitem", { name: "gamma-test-designer", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true })).toBeEnabled()
  release()
  await expect(page.getByRole("dialog")).toContainText("Тестовый дизайнер")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
})

for (const protocol of ["v1", "v2"] as const) {
  test(`missing context limit is unavailable in ${protocol}`, async ({ page }) => {
    await setupGamma(page, { protocol, context: 0 })
    await page.goto(sessionURL)
    await expect(page.getByText("Текст ответа должен быть видимым.", { exact: true })).toBeVisible()
    await page.locator(".gamma-session-actions").getByRole("button", { name: "Дополнительные опции" }).click()
    const usage = page.getByRole("menuitem", { name: /Показать использование контекста/ })
    await expect(usage).toContainText("—")
    await expect(usage).not.toContainText("0%")
  })

  test(`removed specialist identity survives reload in ${protocol}`, async ({ page }) => {
    await setupGamma(page, { protocol, agent: "gamma-removed-specialist" })
    await page.route("**/product/agent-market/agents/removed-specialist", (route) =>
      route.fulfill({ status: 404, json: { code: "missing" } }),
    )
    await page.goto(sessionURL)
    await expect(page.locator('[data-action="prompt-agent"]')).toHaveAttribute("data-agent", "gamma-removed-specialist")
    await page.reload()
    await expect(page.locator('[data-action="prompt-agent"]')).toContainText("gamma-removed-specialist")
    await page.locator(".gamma-session-actions").getByRole("button", { name: "Дополнительные опции" }).click()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("menu")).toHaveCount(0)
  })
}

test("preview remains discoverable when deployment needs configuration", async ({ page }) => {
  await page.route("**/product/session/*/preview", (route) =>
    route.fulfill({
      json: {
        enabled: false,
        apps: [{ path: "dist", kind: "static" }],
      },
    }),
  )
  await page.goto(sessionURL)
  const preview = page.locator(".gamma-session-actions").getByRole("button", { name: /Предпросмотр/ })
  await expect(preview).toBeEnabled()
  await preview.click()
  await expect(page.locator(".gamma-site-preview").getByRole("alert")).toBeVisible()
  await page.reload()
  await expect(preview).toBeEnabled()
})

test("preview selects the built artifact beside a dev project and releases its lease", async ({ page }) => {
  await page.route("**/product/session/*/preview", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        apps: [
          { path: "", kind: "dynamic" },
          { path: "dist", kind: "static" },
        ],
      },
    }),
  )
  await page.route("**/product/session/*/preview/start", (route) => {
    expect(route.request().postDataJSON()).toEqual({ path: "dist" })
    return route.fulfill({ json: { id: "fixture-lease", url: "https://preview.example.test/" } })
  })
  await page.route("**/product/session/*/preview/stop", (route) => route.fulfill({ json: true }))
  await page.route("https://preview.example.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: { "access-control-allow-origin": "*" },
      body: '<html><body><script>document.body.append("Preview ready")</script></body></html>',
    }),
  )
  await page.goto(sessionURL)
  await page
    .locator(".gamma-session-actions")
    .getByRole("button", { name: /Предпросмотр/ })
    .click()
  await expect(page.frameLocator(".gamma-site-preview iframe").getByText("Preview ready")).toBeVisible()
  const stopped = page.waitForRequest("**/product/session/*/preview/stop")
  await page.locator(".gamma-site-preview").getByRole("button", { name: "Закрыть", exact: true }).click()
  expect((await stopped).postDataJSON()).toEqual({ id: "fixture-lease" })
  await expect(page.locator(".gamma-site-preview")).toHaveCount(0)
})

test("workspace picker cancellation and failed upload release the controls", async ({ page }) => {
  await page.route("**/product/session/*/files", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 403, json: { code: "access_denied" } })
      : route.fallback(),
  )
  await page.goto(sessionURL)
  const upload = page.getByRole("button", { name: "Загрузить файлы", exact: true })
  await expect(upload).toBeEnabled()
  const cancelled = page.waitForEvent("filechooser")
  await upload.click()
  await (await cancelled).setFiles([])
  await expect(upload).toBeEnabled()
  const selected = page.waitForEvent("filechooser")
  await upload.click()
  await (await selected).setFiles({ name: "denied.txt", mimeType: "text/plain", buffer: Buffer.from("data") })
  await expect(page.locator(".workspace-files-errors")).toContainText("denied.txt")
  await expect(page.locator(".workspace-files-progress")).toHaveCount(0)
  await expect(upload).toBeEnabled()
})

test("workspace drop uploads bytes and shows progress until completion", async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/product/session/*/files", async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    expect(route.request().postDataBuffer()?.toString()).toContain("drop bytes")
    await pending
    await route.fulfill({ json: { name: "drop.txt" } })
  })
  await page.goto(sessionURL)
  const upload = page.getByRole("button", { name: "Загрузить файлы", exact: true })
  await expect(upload).toBeEnabled()
  const dataTransfer = await page.evaluateHandle(() => {
    const data = new DataTransfer()
    data.items.add(new File(["drop bytes"], "drop.txt", { type: "text/plain" }))
    return data
  })
  await upload.dispatchEvent("drop", { dataTransfer })
  await expect(page.locator(".workspace-files-progress")).toContainText("drop.txt")
  await expect(upload).toBeDisabled()
  release()
  await expect(upload).toBeEnabled()
  await expect(page.locator(".workspace-files-progress")).toHaveCount(0)
  await dataTransfer.dispose()
})

test("completed upload releases controls while directory refresh is pending", async ({ page }) => {
  await page.goto(sessionURL)
  const upload = page.getByRole("button", { name: "Загрузить файлы", exact: true })
  await expect(page.locator(".workspace-files-panel").getByText("README.md", { exact: true })).toBeVisible()
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/\/product\/session\/[^/]+\/files(?:\?|$)/, async (route) => {
    if (route.request().method() === "POST") return route.fulfill({ json: { name: "complete.txt" } })
    await pending
    await route.fallback()
  })
  const refresh = page.waitForRequest((request) => request.method() === "GET" && request.url().includes("/files?"))
  const chooser = page.waitForEvent("filechooser")
  await upload.click()
  await (await chooser).setFiles({ name: "complete.txt", mimeType: "text/plain", buffer: Buffer.from("complete") })
  await refresh
  await expect(upload).toBeEnabled()
  await expect(page.locator(".workspace-files-progress")).toHaveCount(0)
  release()
})
