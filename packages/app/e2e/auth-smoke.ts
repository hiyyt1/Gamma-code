// Run from packages/app after building. Uses disposable data and credentials.
import { chromium, expect } from "@playwright/test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { createGammaServer } from "../../../deploy/web"

const root = path.resolve(import.meta.dir, "../../..")
const temporary = await mkdtemp(path.join(tmpdir(), "gamma-auth-browser-"))
const ports = { backend: 14896, web: 14897, preview: 14898, tls: 14899 }
const origin = `https://localhost:${ports.tls}`
const password = randomBytes(24).toString("hex")
const internal = randomBytes(48).toString("hex")
const authorization = `Basic ${Buffer.from(`gamma-internal:${internal}`).toString("base64")}`
const llm = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    await request.json()
    return new Response(
      [
        {
          id: "chatcmpl-auth",
          object: "chat.completion.chunk",
          choices: [
            { index: 0, delta: { role: "assistant", content: "Gamma auth agent verified." }, finish_reason: null },
          ],
        },
        {
          id: "chatcmpl-auth",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      ]
        .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
        .join("") + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream" } },
    )
  },
})
const env = {
  PATH: process.env.PATH!,
  XDG_DATA_HOME: `${temporary}/data`,
  XDG_CONFIG_HOME: `${temporary}/config`,
  XDG_CACHE_HOME: `${temporary}/cache`,
  XDG_STATE_HOME: `${temporary}/state`,
  OPENCODE_TEST_HOME: temporary,
  OPENCODE_TEST_MANAGED_CONFIG_DIR: `${temporary}/managed`,
  OPENCODE_DB: `${temporary}/gamma.db`,
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_MODELS_PATH: `${root}/packages/opencode/test/tool/fixtures/models-api.json`,
  OPENCODE_SERVER_USERNAME: "gamma-internal",
  OPENCODE_SERVER_PASSWORD: internal,
  GAMMA_WORKSPACES_ROOT: `${temporary}/workspaces`,
  GAMMA_KNOWLEDGE_ROOT: `${temporary}/knowledge`,
  GAMMA_AGENT_MARKET_ROOT: `${root}/gamma-agent-market`,
  GAMMA_SKILL_MARKET_ROOT: `${root}/gamma-skill-market`,
  GAMMA_PUBLIC_ORIGIN: origin,
  GAMMA_PREVIEW_DOMAIN: "preview.test",
  GAMMA_PREVIEW_PORT: String(ports.preview),
  OPENCODE_CONFIG_CONTENT: JSON.stringify({
    model: "auth-fixture/test-model",
    enabled_providers: ["auth-fixture"],
    provider: {
      "auth-fixture": {
        npm: "@ai-sdk/openai-compatible",
        name: "Auth fixture",
        options: { baseURL: `${llm.url.origin}/v1`, apiKey: "fixture-only" },
        models: { "test-model": { name: "Auth fixture", limit: { context: 32768, output: 1024 } } },
      },
    },
  }),
}
await mkdir(`${temporary}/config`, { recursive: true })
const certificate = Bun.spawn(
  [
    "openssl",
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${temporary}/key.pem`,
    "-out",
    `${temporary}/cert.pem`,
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
  ],
  { stdout: "ignore", stderr: "ignore" },
)
if (await certificate.exited) throw new Error("Test certificate failed")
const backend = Bun.spawn(
  [process.execPath, "run", "src/index.ts", "serve", "--hostname", "127.0.0.1", "--port", String(ports.backend)],
  {
    cwd: `${root}/packages/opencode`,
    env,
    stdout: Bun.file(`${temporary}/backend.log`),
    stderr: Bun.file(`${temporary}/backend-error.log`),
  },
)
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] })
const services: Array<() => unknown> = []
try {
  await expect
    .poll(
      async () =>
        fetch(`http://127.0.0.1:${ports.backend}/global/health`, { headers: { Authorization: authorization } })
          .then((r) => r.status)
          .catch(() => 0),
      { timeout: 60000 },
    )
    .toBe(200)
  const web = await createGammaServer({
    auth: {
      origin,
      username: "auth-admin",
      passwordHash: await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 }),
      backendAuthorization: authorization,
    },
    backend: `http://127.0.0.1:${ports.backend}`,
    root: `${root}/packages/app/dist`,
    port: ports.web,
  })
  services.push(web.close)
  const tls = Bun.spawn(
    [
      "node",
      `${root}/packages/app/e2e/fixtures/auth-tls.mjs`,
      `${temporary}/key.pem`,
      `${temporary}/cert.pem`,
      String(ports.tls),
      String(ports.web),
    ],
    { stdout: "pipe", stderr: "inherit" },
  )
  services.push(() => tls.kill("SIGTERM"))
  const ready = tls.stdout.getReader()
  expect(new TextDecoder().decode((await ready.read()).value)).toBe("ready\n")
  ready.releaseLock()
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: "ru-RU",
    viewport: { width: 1440, height: 1000 },
  })
  await context.route(/^https:\/\/[a-f0-9]+\.preview\.test\//, async (route) => {
    const url = new URL(route.request().url())
    const response = await fetch(`http://127.0.0.1:${ports.preview}${url.pathname}${url.search}`, {
      headers: { host: url.host },
    })
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await context.addInitScript(
    (previous) => localStorage.setItem("opencode.settings.dat:defaultServerUrl", previous),
    `http://127.0.0.1:${ports.backend}`,
  )
  const page = await context.newPage()
  await page.goto(origin + "/knowledge")
  await expect(page).toHaveURL(origin + "/login")
  await expect(page.getByRole("heading", { name: "Вход в Gamma" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Войти", exact: true })).toBeEnabled()
  await page.screenshot({ path: "/tmp/gamma-login-desktop.png" })
  for (const endpoint of [
    "/product/projects",
    "/global/event",
    "/session",
    "/product/knowledge",
    "/file?path=/",
    "/api/v2/session",
    "/pty/test/connect",
  ]) {
    expect((await context.request.get(origin + endpoint)).status()).toBe(401)
  }
  expect((await fetch(`http://127.0.0.1:${ports.backend}/session`)).status).toBe(401)
  await page.getByLabel("Логин", { exact: true }).fill("auth-admin")
  await page.getByLabel("Пароль", { exact: true }).fill("wrong-fixture-password")
  await page.getByRole("button", { name: "Показать пароль" }).click()
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveAttribute("type", "text")
  await page.getByRole("button", { name: "Скрыть пароль" }).click()
  await page.getByRole("button", { name: "Войти", exact: true }).click()
  await expect(page.getByRole("alert")).toHaveText("Неверный логин или пароль.")
  await page.getByLabel("Пароль", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Войти", exact: true }).click()
  await expect(page).toHaveURL(origin + "/")
  await expect(page.getByRole("button", { name: /auth-admin/ })).toBeVisible({ timeout: 30000 })
  const cookie = (await context.cookies()).find((item) => item.name === "__Host-gamma_session")!
  expect(cookie.httpOnly).toBe(true)
  expect(cookie.secure).toBe(true)
  expect(cookie.sameSite).toBe("Lax")
  expect(await page.evaluate(() => document.cookie)).not.toContain("gamma_session")
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(cookie.value)
  await page.reload()
  await expect(page.getByRole("button", { name: /auth-admin/ })).toBeVisible()
  console.log("Browser login, error, password toggle, HTTPS cookie and reload passed")
  const api = async (endpoint: string, body?: object, directory?: string) => {
    const response = await context.request.fetch(origin + endpoint, {
      method: body ? "POST" : "GET",
      data: body,
      headers: { Origin: origin, ...(directory ? { "x-opencode-directory": directory } : {}) },
    })
    expect(response.ok(), `${endpoint}: HTTP ${response.status()}`).toBe(true)
    return response.json()
  }
  const project = await api("/product/projects", { name: "auth-smoke" })
  await Bun.write(`${project.path}/index.html`, "<!doctype html><h1>Authenticated Preview</h1>")
  const session = await api("/session", { agent: "gamma" }, project.path)
  const reply = await api(
    `/session/${session.id}/message`,
    {
      agent: "gamma",
      model: { providerID: "auth-fixture", modelID: "test-model" },
      parts: [{ type: "text", text: "Reply with the fixture message." }],
    },
    project.path,
  )
  expect(JSON.stringify(reply)).toContain("Gamma auth agent verified.")
  expect((await api(`/session/${session.id}`, undefined, project.path)).agent).toBe("gamma")
  expect(JSON.stringify(await api("/file?path=", undefined, project.path))).toContain("index.html")
  expect(JSON.stringify(await api("/file/content?path=index.html", undefined, project.path))).toContain(
    "Authenticated Preview",
  )
  expect((await api("/product/knowledge")).data).toBeDefined()
  const discovery = await api(`/product/session/${session.id}/preview`, undefined, project.path)
  expect(discovery.enabled).toBe(true)
  expect(discovery.apps.some((app: { path: string }) => app.path === "")).toBe(true)
  const preview = await api(`/product/session/${session.id}/preview/start`, { path: "" }, project.path)
  const previewPage = await context.newPage()
  await previewPage.goto(preview.url)
  await expect(previewPage.getByRole("heading", { name: "Authenticated Preview" })).toBeVisible()
  await previewPage.close()
  console.log(
    "Real backend: agent execution (local LLM fixture), binding, files, knowledge and isolated Preview passed",
  )
  await page.goto(`${origin}/${Buffer.from(project.path).toString("base64url")}/session/${session.id}`)
  await expect(page.getByText("Gamma auth agent verified.", { exact: true })).toBeVisible({ timeout: 30000 })
  await page.screenshot({ path: "/tmp/gamma-auth-session.png" })
  await page.getByRole("button", { name: /auth-admin/ }).click()
  await page.getByRole("menuitem", { name: "Выйти из аккаунта", exact: true }).click()
  await expect(page).toHaveURL(origin + "/login")
  await expect(page.getByRole("button", { name: "Войти", exact: true })).toBeEnabled({ timeout: 30000 })
  expect((await context.request.get(origin + "/session")).status()).toBe(401)
  expect(
    (
      await context.request.get(origin + "/auth/session", { headers: { Cookie: `${cookie.name}=${cookie.value}` } })
    ).status(),
  ).toBe(401)
  await page.goBack()
  await expect(page).toHaveURL(origin + "/login")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole("button", { name: "Войти", exact: true })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: "/tmp/gamma-login-mobile.png" })
  console.log("Logout, revoked-cookie replay, browser back and mobile layout passed")
} catch (error) {
  console.error(error instanceof Error ? error.message : "Auth smoke assertion failed")
  await browser
    .contexts()[0]
    ?.pages()[0]
    ?.screenshot({ path: "/tmp/gamma-auth-failure.png", timeout: 3000 })
    .catch(() => undefined)
  console.log("failure location", browser.contexts()[0]?.pages()[0]?.url())
  console.error(`Auth smoke failed; isolated backend logs: ${temporary}`)
  throw error
} finally {
  await browser.close()
  services.reverse().forEach((close) => close())
  backend.kill("SIGKILL")
  await backend.exited
  await llm.stop(true)
  if (!process.env.KEEP_AUTH_SMOKE) await rm(temporary, { recursive: true, force: true })
}
