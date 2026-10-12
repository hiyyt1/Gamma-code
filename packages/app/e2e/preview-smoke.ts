// Run with Bun from packages/app after `bun run build`. Uses only disposable data.
// DNS/TLS for preview.test are transported through Playwright routing; responses
// come from the real preview listener, including its production security headers.
import { chromium, expect } from "@playwright/test"
import { mkdtemp, mkdir, rm, cp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { createGammaServer } from "../../../deploy/web"

const root = path.resolve(import.meta.dir, "../../..")
const temporary = await mkdtemp(path.join(tmpdir(), "gamma-preview-browser-"))
const ports = { backend: 14696, web: 14697, preview: 14698, tls: 14699 }
const main = `https://localhost:${ports.tls}`
const password = randomBytes(24).toString("hex")
const internal = randomBytes(48).toString("hex")
const authorization = `Basic ${Buffer.from(`preview-internal:${internal}`).toString("base64")}`
const backendFetch = (url: string, init?: RequestInit) =>
  fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), Authorization: authorization } })
const env = {
  OPENCODE_SERVER_USERNAME: "preview-internal",
  OPENCODE_SERVER_PASSWORD: internal,
  PATH: process.env.PATH!,
  HOME: temporary,
  XDG_DATA_HOME: `${temporary}/data`,
  XDG_CONFIG_HOME: `${temporary}/config`,
  XDG_CACHE_HOME: `${temporary}/cache`,
  XDG_STATE_HOME: `${temporary}/state`,
  OPENCODE_TEST_HOME: temporary,
  OPENCODE_TEST_MANAGED_CONFIG_DIR: `${temporary}/managed`,
  OPENCODE_DB: `${temporary}/gamma.db`,
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_MODELS_PATH: `${root}/packages/opencode/test/tool/fixtures/models-api.json`,
  GAMMA_WORKSPACES_ROOT: `${temporary}/workspaces`,
  GAMMA_KNOWLEDGE_ROOT: `${temporary}/knowledge`,
  GAMMA_PUBLIC_ORIGIN: main,
  GAMMA_PREVIEW_DOMAIN: "preview.test",
  GAMMA_PREVIEW_PORT: String(ports.preview),
  GAMMA_BACKEND_URL: `http://127.0.0.1:${ports.backend}`,
  GAMMA_WEB_PORT: String(ports.web),
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
if (await certificate.exited) throw new Error("certificate failed")
const backend = Bun.spawn(
  [process.execPath, "run", "src/index.ts", "serve", "--hostname", "127.0.0.1", "--port", String(ports.backend)],
  {
    cwd: `${root}/packages/opencode`,
    env,
    stdout: Bun.file(`${temporary}/backend.log`),
    stderr: Bun.file(`${temporary}/backend-error.log`),
  },
)
let web: Awaited<ReturnType<typeof createGammaServer>> | undefined
const gateway = Bun.spawn(
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
const ready = gateway.stdout.getReader()
expect(new TextDecoder().decode((await ready.read()).value)).toBe("ready\n")
ready.releaseLock()
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] })
try {
  await expect
    .poll(
      async () =>
        backendFetch(`${env.GAMMA_BACKEND_URL}/global/health`)
          .then((response) => response.status)
          .catch(() => 0),
      { timeout: 60_000 },
    )
    .toBe(200)
  web = await createGammaServer({
    auth: {
      origin: main,
      username: "preview-admin",
      passwordHash: await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 }),
      backendAuthorization: authorization,
    },
    backend: env.GAMMA_BACKEND_URL,
    root: `${root}/packages/app/dist`,
    port: ports.web,
  })
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: "ru-RU",
    viewport: { width: 1500, height: 1000 },
  })
  const login = await context.newPage()
  await login.goto(`${main}/login`)
  await login.getByLabel("Логин", { exact: true }).fill("preview-admin")
  await login.getByLabel("Пароль", { exact: true }).fill(password)
  await login.getByRole("button", { name: "Войти", exact: true }).click()
  await expect(login.getByRole("button", { name: /preview-admin/ })).toBeVisible()
  await login.close()
  await context.route(/^https:\/\/[a-f0-9]+\.preview\.test\//, async (route) => {
    const url = new URL(route.request().url())
    const response = await fetch(`http://127.0.0.1:${ports.preview}${url.pathname}${url.search}`, {
      method: route.request().method(),
      headers: { host: url.host },
    })
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  const project = (await backendFetch(`${env.GAMMA_BACKEND_URL}/product/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "preview-smoke" }),
  }).then((response) => response.json())) as { path: string }
  const session = (await backendFetch(`${env.GAMMA_BACKEND_URL}/session`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-opencode-directory": project.path },
    body: JSON.stringify({ agent: "build" }),
  }).then((response) => response.json())) as { id: string }
  if (!session.id) throw new Error(`Session creation failed: ${JSON.stringify(session)}`)
  const message = await backendFetch(`${env.GAMMA_BACKEND_URL}/session/${session.id}/message`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-opencode-directory": project.path },
    body: JSON.stringify({ noReply: true, parts: [{ type: "text", text: "Preview smoke fixture" }] }),
  })
  if (!message.ok) throw new Error(`Prompt admission failed: ${await message.text()}`)
  await Bun.write(
    `${project.path}/index.html`,
    '<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><h1>Preview fixture</h1><button id="counter">Count 0</button><img alt="Test image" src="/pixel.svg"><script type="module" src="/main.js"></script></body></html>',
  )
  await Bun.write(
    `${project.path}/style.css`,
    "h1{color:rgb(120,30,90);animation:pulse 2s infinite}@keyframes pulse{50%{opacity:.5}}",
  )
  await Bun.write(
    `${project.path}/pixel.svg`,
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
  )
  await Bun.write(
    `${project.path}/main.js`,
    'import { label } from "./module.js"; let count=0; const button=document.querySelector("button"); button.onclick=()=>button.textContent=label+ ++count; document.body.dataset.ready="yes";',
  )
  await Bun.write(`${project.path}/module.js`, 'export const label="Count ";')
  const page = await context.newPage()
  const navigationStarted = performance.now()
  await page.goto(`${main}/${Buffer.from(project.path).toString("base64url")}/session/${session.id}`)
  const workspace = page.getByRole("complementary", { name: "Рабочая область", exact: true })
  await expect(workspace).toBeVisible({ timeout: 30_000 })
  console.log(
    "PREVIEW_PRODUCTION_BENCHMARK",
    JSON.stringify({
      readyMs: performance.now() - navigationStarted,
      ...(await page.evaluate(() => ({
        nodes: document.querySelectorAll("*").length,
        resources: performance.getEntriesByType("resource").length,
      }))),
    }),
  )
  await expect(workspace.getByRole("button", { name: "Предпросмотр", exact: true })).toHaveCount(0)
  const cards = page.getByRole("article", { name: "Созданный сайт" })
  await expect(cards).toHaveCount(0)
  const seed = async (id: string, directory: string, file = "index.html", mode = "write") => {
    const child = Bun.spawn([process.execPath, "run", "script/preview-history-fixture.ts", id, directory, file, mode], {
      cwd: `${root}/packages/opencode`,
      env,
      stdout: "pipe",
      stderr: "pipe",
    })
    const errors = new Response(child.stderr).text()
    if (await child.exited) throw new Error(await errors)
  }
  await seed(session.id, project.path)
  await page.reload()
  await expect(cards).toHaveCount(1)
  const checkLayout = async () => {
    await expect(page.locator(".gamma-assistant-response pre")).toHaveCount(1)
    expect(
      await page.locator(".gamma-assistant-response").evaluateAll((elements) =>
        elements.every((element) => {
          const text = element.querySelector('[data-component="text-part"]')
          return (
            !text ||
            Math.abs(
              text.getBoundingClientRect().width -
                (element.clientWidth - parseFloat(getComputedStyle(element).paddingLeft)),
            ) < 1
          )
        }),
      ),
    ).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (await cards.count()) {
      expect(
        await cards.evaluate((element) => {
          const row = element.closest('[data-timeline-row="AssistantPart"]')!
          const text = row.querySelector('[data-component="text-part"]')!.getBoundingClientRect()
          const card = element.getBoundingClientRect()
          return card.y >= text.bottom && card.width <= text.width + 1
        }),
      ).toBe(true)
    }
  }
  await checkLayout()
  await page.getByRole("button", { name: "Рабочая область", exact: true }).click()
  await checkLayout()
  await page.setViewportSize({ width: 390, height: 844 })
  await checkLayout()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole("button", { name: "Рабочая область", exact: true }).click()
  const discovery = `${main}/product/session/${session.id}/preview`
  for (const fault of ["http_500", "http_403", "network"] as const) {
    await page.route(discovery, (route) =>
      fault === "network"
        ? route.abort()
        : route.fulfill({
            status: fault === "http_403" ? 403 : 500,
            contentType: "application/json",
            body: JSON.stringify({ code: fault }),
          }),
    )
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect(cards.getByRole("status")).toContainText(
      fault === "network" ? "Нет соединения" : fault === "http_403" ? "Нет доступа" : "Ошибка Preview API",
    )
    await expect(cards.getByRole("button", { name: "Открыть сайт" })).toBeDisabled()
    await expect(cards).not.toContainText("точка входа сайта не найдена")
    await page.unroute(discovery)
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect(cards.getByRole("button", { name: "Открыть сайт" })).toBeEnabled()
  }
  await cards.getByRole("button", { name: "Открыть сайт" }).click()
  const panel = page.getByRole("complementary", { name: "Предпросмотр", exact: true })
  const frame = panel.frameLocator("iframe")
  await expect(frame.getByRole("heading", { name: "Preview fixture" })).toBeVisible({ timeout: 30_000 })
  await expect(frame.locator("body")).toHaveAttribute("data-ready", "yes")
  await expect(frame.getByRole("heading")).toHaveCSS("color", "rgb(120, 30, 90)")
  await expect(frame.getByRole("heading")).toHaveCSS("animation-name", "pulse")
  expect(await frame.getByRole("img").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(10)
  await frame.getByRole("button", { name: "Count 0" }).click()
  await expect(frame.getByRole("button", { name: "Count 1" })).toBeVisible()
  expect(
    await frame.locator("body").evaluate(() => {
      try {
        parent.document.body
        return false
      } catch {
        return true
      }
    }),
  ).toBe(true)
  expect(
    await frame.locator("body").evaluate(() => {
      try {
        document.cookie
        return false
      } catch {
        return true
      }
    }),
  ).toBe(true)
  expect(
    await frame.locator("body").evaluate(
      async (_, main) =>
        fetch(`${main}/product/projects`)
          .then(() => false)
          .catch(() => true),
      main,
    ),
  ).toBe(true)
  await page.bringToFront()
  const popupReady = context.waitForEvent("page")
  await panel.getByRole("link", { name: "Открыть в новой вкладке" }).click()
  const popup = await popupReady
  await expect(popup.getByRole("heading", { name: "Preview fixture" })).toBeVisible()
  expect(await popup.evaluate(() => window.opener === null)).toBe(true)
  expect(
    await popup.evaluate(() => {
      try {
        localStorage.length
        return false
      } catch {
        return true
      }
    }),
  ).toBe(true)
  await Bun.write(`${project.path}/style.css`, "h1{color:rgb(10,20,30)}")
  await panel.getByRole("button", { name: "Обновить", exact: true }).click()
  await expect(frame.getByRole("heading")).toHaveCSS("color", "rgb(10, 20, 30)")
  const previewURL = await panel.getByRole("link").getAttribute("href")
  const stopped = page.waitForResponse((response) => response.url().endsWith("/preview/stop"))
  await panel.getByRole("button", { name: "Закрыть", exact: true }).click()
  expect((await stopped).ok()).toBe(true)
  await expect(workspace).toBeVisible()
  expect(
    (await fetch(`http://127.0.0.1:${ports.preview}/`, { headers: { host: new URL(previewURL!).host } })).status,
  ).toBe(404)
  expect(
    (
      await fetch(`http://127.0.0.1:${ports.web}/product/projects`, {
        headers: { origin: "null", "sec-fetch-site": "cross-site" },
      })
    ).status,
  ).toBe(401)
  await page.reload()
  await expect(cards).toHaveCount(1)
  const answer = page.locator("[data-slot='session-turn-assistant-content']")
  await answer.getByRole("link", { name: "index.html", exact: true }).click()
  await expect(frame.getByRole("heading", { name: "Preview fixture" })).toBeVisible()
  await panel.getByRole("button", { name: "Закрыть", exact: true }).click()
  await answer.getByRole("link", { name: "CSS", exact: true }).click()
  await expect(workspace.locator(".workspace-files-preview")).toBeVisible()
  await expect(panel).toHaveCount(0)
  await expect(answer.getByRole("link", { name: "Внешняя ссылка" })).toHaveAttribute(
    "href",
    "https://example.com/index.html",
  )
  await rm(`${project.path}/index.html`)
  await expect(cards.getByRole("button", { name: "Открыть сайт" })).toBeDisabled({ timeout: 15_000 })
  await expect(cards.getByRole("status")).toContainText("При последней успешной проверке точка входа сайта не найдена")
  await Bun.write(`${project.path}/nested/index.html`, "<h1>Nested website</h1>")
  await Bun.write(
    `${project.path}/react/package.json`,
    JSON.stringify({ scripts: { dev: "vite" }, devDependencies: { vite: "*" }, dependencies: { react: "*" } }),
  )
  await Bun.write(`${project.path}/react/index.html`, '<script type="module" src="/src/main.tsx"></script>')
  await seed(session.id, project.path, "nested/index.html")
  await seed(session.id, project.path, "react/index.html")
  await page.reload()
  await expect(cards).toHaveCount(1)
  await expect(cards).toContainText("nested/index.html")
  await cards.getByRole("button", { name: "Открыть сайт" }).click()
  await expect(frame.getByRole("heading", { name: "Nested website" })).toBeVisible()
  await panel.getByRole("button", { name: "Закрыть", exact: true }).click()
  await Bun.write(`${project.path}/react/dist/index.html`, "<h1>Vite build</h1>")
  await seed(session.id, project.path, "react/dist/index.html")
  await page.reload()
  await expect(cards).toHaveCount(2)
  const built = cards.filter({ hasText: "react/dist/index.html" })
  await expect(built).toContainText("Vite")
  await built.getByRole("button", { name: "Открыть сайт" }).click()
  await expect(frame.getByRole("heading", { name: "Vite build" })).toBeVisible()
  await panel.getByRole("button", { name: "Закрыть", exact: true }).click()
  const neighbor = (await backendFetch(`${env.GAMMA_BACKEND_URL}/session`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-opencode-directory": project.path },
    body: "{}",
  }).then((response) => response.json())) as { id: string }
  await backendFetch(`${env.GAMMA_BACKEND_URL}/session/${neighbor.id}/message`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-opencode-directory": project.path },
    body: JSON.stringify({ noReply: true, parts: [{ type: "text", text: "Обычный вопрос" }] }),
  })
  await seed(neighbor.id, project.path, "index.html", "text")
  await page.goto(`${main}/${Buffer.from(project.path).toString("base64url")}/session/${neighbor.id}`)
  await expect(page.getByText("Обычный ответ Gamma.", { exact: true })).toBeVisible()
  await expect(cards).toHaveCount(0)
  await checkLayout()
  await page.getByRole("button", { name: "Дополнительные опции", exact: true }).click()
  await page.getByRole("menuitem", { name: "Сайты проекта", exact: true }).click()
  await panel.getByRole("combobox").selectOption("nested")
  await expect(frame.getByRole("heading", { name: "Nested website" })).toBeVisible()
  await panel.getByRole("button", { name: "Закрыть", exact: true }).click()
  if (process.env.PREVIEW_REAL_SITE) {
    // Read-only source; only the disposable workspace and fixture history change.
    await cp(process.env.PREVIEW_REAL_SITE, `${project.path}/coffee-site`, { recursive: true })
    await seed(neighbor.id, project.path, "coffee-site/index.html")
    await page.reload()
    const coffee = cards.filter({ hasText: "coffee-site/index.html" })
    await expect(coffee.getByRole("button", { name: "Открыть сайт" })).toBeEnabled()
    await coffee.getByRole("button", { name: "Открыть сайт" }).click()
    await expect(frame.getByRole("heading", { level: 1 })).toContainText("Место, где время")
    await expect(frame.locator(".hero__title")).toHaveClass(/is-visible/)
    await expect(frame.locator(".hero__title")).not.toHaveCSS("font-family", '"Times New Roman"')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(frame.getByRole("heading", { level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "/tmp/preview-coffee-running.png", fullPage: true })
    await panel.getByRole("button", { name: "Закрыть", exact: true }).click()
  }
  console.log(
    "PASS: embedded site, CSS, JS modules, image, animation, new tab, refresh, sandbox, API denial, close/revoke, result cards, reload, file links, deletion, site selection, static builds, neighbor isolation, legacy project menu",
  )
} catch (error) {
  console.error((await Bun.file(`${temporary}/backend-error.log`).text()).slice(-4000))
  throw error
} finally {
  await browser.close()
  gateway.kill("SIGTERM")
  backend.kill("SIGKILL")
  web?.close()
  await backend.exited
  await rm(temporary, { recursive: true, force: true })
}
