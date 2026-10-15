import { readFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"

// The supplied session must belong to a disposable local project. It should have
// an agent-created static site containing PREVIEW-LOCAL-742 and a Счётчик button.
test.beforeEach(async ({ page }) => {
  test.skip(!process.env.GAMMA_LIVE_URL || !process.env.GAMMA_LIVE_LOGIN || !process.env.GAMMA_LIVE_SESSION)
  const origin = new URL(process.env.GAMMA_LIVE_URL!)
  expect(origin.hostname).toBe("localhost")
  expect(origin.protocol).toBe("http:")
  expect(new URL(process.env.GAMMA_LIVE_SESSION!, origin).origin).toBe(origin.origin)
  await page.goto("/")
  if (new URL(page.url()).pathname === "/login") {
    const login = JSON.parse(await readFile(process.env.GAMMA_LIVE_LOGIN!, "utf8"))
    await page.locator("#gamma-login-name").fill(login.username)
    await page.locator("#gamma-login-password").fill(login.password)
    await page.getByRole("button", { name: "Войти", exact: true }).click()
    await page.waitForURL(origin.origin + "/", { timeout: 15_000 })
  }
  await page.goto(process.env.GAMMA_LIVE_SESSION!)
  await expect(page.getByRole("textbox", { name: "Промпт", exact: true })).toBeEditable()
  await expect(page.getByRole("button", { name: "qwen3.5-plus", exact: true })).toBeVisible()
})

test("real picker, cancellation, workspace upload, duplicate error and drop", async ({ page }) => {
  const name = `live-${Date.now()}.txt`
  const upload = page.getByRole("button", { name: "Загрузить файлы", exact: true })
  const cancelled = page.waitForEvent("filechooser")
  await upload.click()
  await (await cancelled).setFiles([])
  await expect(upload).toBeEnabled()
  const payload = { name, mimeType: "text/plain", buffer: Buffer.from("LIVE-UPLOAD-571") }
  for (const duplicate of [false, true]) {
    const chooser = page.waitForEvent("filechooser")
    await upload.click()
    await (await chooser).setFiles(payload)
    await expect(page.locator(".workspace-files-progress")).toHaveCount(0)
    await expect(upload).toBeEnabled()
    if (duplicate) await expect(page.locator(".workspace-files-errors")).toContainText(name)
    else await expect(page.locator(".workspace-files-panel").getByText(name, { exact: true })).toBeVisible()
  }
  const dataTransfer = await page.evaluateHandle(() => {
    const data = new DataTransfer()
    data.items.add(new File(["LIVE-DROP-572"], `drop-${Date.now()}.txt`, { type: "text/plain" }))
    return data
  })
  const dropped = await dataTransfer.evaluate((data) => data.files[0].name)
  await upload.dispatchEvent("drop", { dataTransfer })
  await expect(page.locator(".workspace-files-panel").getByText(dropped, { exact: true })).toBeVisible()
  await dataTransfer.dispose()
  await page.locator(".workspace-files-panel").getByText(name, { exact: true }).click()
  await expect(page.locator(".workspace-files-panel")).toContainText("LIVE-UPLOAD-571")
  await page.locator('[data-action="prompt-attach"]').click()
  const attachment = page.waitForEvent("filechooser")
  await page.getByRole("menuitem", { name: /Изображения и файлы/ }).click()
  await (await attachment).setFiles({ ...payload, name: "attachment-live.txt" })
  await expect(page.getByText("attachment-live.txt", { exact: true })).toBeVisible()
  await expect(page.getByRole("menu")).toHaveCount(0)
})

test("agent-created site renders scripts and assets, survives reload and releases lease", async ({ page }) => {
  for (const reload of [false, true]) {
    if (reload) await page.reload()
    await page
      .locator(".gamma-session-actions")
      .getByRole("button", { name: /Предпросмотр/ })
      .click()
    const frame = page.frameLocator(".gamma-site-preview iframe")
    await expect(frame.getByText("PREVIEW-LOCAL-742", { exact: true })).toBeVisible()
    await expect(frame.getByRole("heading", { name: "Gamma", exact: true })).toHaveCSS("color", "rgb(0, 102, 204)")
    await frame.getByRole("button", { name: /Счётчик/ }).click()
    await expect(frame.locator("body")).toContainText("1")
    const url = await page.locator(".gamma-site-preview iframe").getAttribute("src")
    expect(new URL(url!).hostname).toMatch(/^[a-f0-9]{48}\.localhost$/)
    const stopped = page.waitForResponse((response) => response.url().endsWith("/preview/stop"))
    await page.locator(".gamma-site-preview").getByRole("button", { name: "Закрыть", exact: true }).click()
    expect((await stopped).ok()).toBe(true)
    expect(
      await page.evaluate(
        async (url) => (await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(5000) })).status,
        url!,
      ),
    ).toBe(404)
  }
})

test("LLM independently searches current information and fetches sources", async ({ page }) => {
  // A fresh conversation prevents a model from legitimately reusing an earlier
  // weather answer instead of exercising the tools again on repeated runs.
  await page.getByRole("button", { name: "Новый чат", exact: true }).click()
  await page.waitForURL(/\/new-session\?/)
  const prompt = page.getByRole("textbox", { name: "Промпт", exact: true })
  await expect(prompt).toBeEditable()
  await expect(page.locator('[data-action="prompt-agent"]')).toHaveAttribute("data-agent", "gamma")
  await prompt.fill(
    "Узнай актуальную погоду в Москве на сегодня в интернете. Найди источники поиском, открой найденную страницу и проверь дату. Ответь кратко со ссылками. Не угадывай температуру из несвязанных чисел; если точные данные недоступны, честно скажи об этом. Не меняй файлы проекта.",
  )
  await page.getByRole("button", { name: "Отправить", exact: true }).click()
  await page.waitForURL(/\/session\/ses_/)
  const session = new URL(page.url()).pathname.split("/").at(-1)!
  await expect(page.getByRole("button", { name: "Остановить", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Остановить", exact: true })).toHaveCount(0, { timeout: 210_000 })
  const messages: {
    info: { role: string }
    parts: { type: string; tool?: string; text?: string; state?: { status: string; output?: string } }[]
  }[] = await page.request.get(`/session/${session}/message`).then((response) => response.json())
  const parts = messages.flatMap((message) => message.parts)
  const search = parts.find((part) => part.tool === "websearch" && part.state?.status === "completed")
  expect(search?.state?.output).toMatch(/https?:\/\//)
  expect(search?.state?.output).not.toMatch(/rate limit|API key|quota exceeded/i)
  expect(parts.some((part) => part.tool === "webfetch" && part.state?.status === "completed")).toBe(true)
  const answer = messages
    .at(-1)
    ?.parts.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
  expect(answer).toMatch(/https?:\/\//)
  await expect(page.locator('a[href^="https://"]').first()).toBeVisible()
})
