// Built Gamma UI through a real local TLS reverse proxy; no preview hostname.
// Run from packages/app after bun run build. All data and listeners are disposable.
import { chromium, expect } from "@playwright/test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { createGammaServer } from "../../../deploy/web"

const root = path.resolve(import.meta.dir, "../../..")
const temporary = await mkdtemp(path.join(tmpdir(), "gamma-preview-browser-"))
const ports = { backend: 14696, web: 14697, tls: 14699 }
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
  const panel = page.getByRole("complementary", { name: "Предпросмотр", exact: true })
  const frame = panel.locator("iframe").contentFrame().locator("iframe").contentFrame()
  await page.getByRole("button", { name: "Предпросмотр", exact: true }).click()
  await expect(frame.getByRole("heading", { name: "Preview fixture" })).toBeVisible()
  await frame.getByRole("button", { name: "Count 0" }).click()
  await expect(frame.getByRole("button", { name: "Count 1" })).toBeVisible()
  await expect(frame.getByRole("heading")).toHaveCSS("color", "rgb(120, 30, 90)")
  await expect.poll(() => frame.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(10)
  await panel.getByRole("button", { name: "Телефон", exact: true }).click()
  await expect.poll(() => frame.locator("body").evaluate(() => innerWidth)).toBe(390)
  await panel.getByRole("button", { name: "Планшет", exact: true }).click()
  await expect.poll(() => frame.locator("body").evaluate(() => innerWidth)).toBe(768)
  await panel.getByRole("button", { name: "Развернуть предпросмотр" }).click()
  await expect(panel).toHaveClass(/gamma-site-preview-expanded/)
  await panel.getByRole("button", { name: "Вернуть прежний размер" }).click()
  await panel.getByRole("button", { name: "Компьютер", exact: true }).click()
  await panel.getByRole("button", { name: "Обновить", exact: true }).click()
  await expect(frame.getByRole("button", { name: "Count 0" })).toBeVisible()
  await Bun.write(`${project.path}/style.css`, "h1{color:rgb(0,128,0)}")
  await expect(frame.getByRole("heading")).toHaveCSS("color", "rgb(0, 128, 0)", { timeout: 20_000 })
  await Bun.write(`${project.path}/about.html`, '<h1>About page</h1><a href="index.html">Home</a>')
  await Bun.write(
    `${project.path}/index.html`,
    '<h1>Updated site</h1><a href="about.html">About</a><a href="#route">SPA route</a>',
  )
  await expect(frame.getByRole("heading", { name: "Updated site" })).toBeVisible({ timeout: 20_000 })
  await frame.getByRole("link", { name: "About", exact: true }).click()
  await expect(frame.getByRole("heading", { name: "About page" })).toBeVisible()
  await panel.getByRole("button", { name: "Обновить", exact: true }).click()
  await expect(frame.getByRole("heading", { name: "About page" })).toBeVisible()
  await frame.getByRole("link", { name: "Home", exact: true }).click()
  await frame.getByRole("link", { name: "SPA route", exact: true }).click()
  await expect.poll(() => frame.locator("body").evaluate(() => location.hash)).toBe("#route")
  await panel.getByRole("button", { name: "Обновить", exact: true }).click()
  await expect.poll(() => frame.locator("body").evaluate(() => location.hash)).toBe("#route")
  expect(
    await frame.locator("body").evaluate(() => {
      try {
        return document.cookie
      } catch {
        return "blocked"
      }
    }),
  ).toBe("blocked")
  expect(
    await frame.locator("body").evaluate(() => {
      try {
        return localStorage.length
      } catch {
        return "blocked"
      }
    }),
  ).toBe("blocked")
  expect(
    await frame.locator("body").evaluate(async (origin) => {
      return fetch(`${origin}/product/projects`, { credentials: "include" })
        .then(() => "unexpected")
        .catch(() => "blocked")
    }, main),
  ).toBe("blocked")
  const response = await page.request.post(`${main}/product/session/${session.id}/preview/snapshot`, {
    headers: { Origin: main },
    data: { path: "../" },
  })
  expect(response.status()).toBe(400)
  const denied = await page.request.post(`${main}/product/session/${session.id}/preview/snapshot`, {
    headers: { Origin: "null" },
    data: { path: "" },
  })
  expect(denied.status()).toBe(403)
  await panel.getByRole("button", { name: "Закрыть", exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Предпросмотр", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "Предпросмотр", exact: true }).click()
  await expect(frame.getByRole("heading", { name: "Updated site" })).toBeVisible()
  await panel.getByRole("button", { name: "Закрыть", exact: true }).click()

  const { build } = await import("vite")
  const source = `${temporary}/vite-fixture`
  await Bun.write(
    `${source}/index.html`,
    '<h1>Vite build</h1><button>Vite 0</button><img alt="Vite image"><script type="module" src="/src/main.js"></script>',
  )
  await Bun.write(
    `${source}/src/main.js`,
    'import image from "./pixel.svg";import "./style.css";document.querySelector("img").src=image;document.querySelector("button").onclick=async()=>{const m=await import("./lazy.js");document.querySelector("button").textContent=m.label}',
  )
  await Bun.write(`${source}/src/style.css`, "h1{color:rgb(12,34,56)}")
  await Bun.write(`${source}/src/lazy.js`, 'export const label="Vite 1"')
  await Bun.write(
    `${source}/src/pixel.svg`,
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>',
  )
  await build({
    configFile: false,
    root: source,
    build: { outDir: `${project.path}/dist`, assetsInlineLimit: 0, emptyOutDir: true },
    logLevel: "error",
  })
  await page.reload()
  await page.getByRole("button", { name: "Предпросмотр", exact: true }).click()
  await expect(frame.getByRole("heading", { name: "Vite build" })).toBeVisible()
  await frame.getByRole("button", { name: "Vite 0" }).click()
  await expect(frame.getByRole("button", { name: "Vite 1" })).toBeVisible()
  await expect(frame.getByRole("heading")).toHaveCSS("color", "rgb(12, 34, 56)")
  await expect.poll(() => frame.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(20)
  await page.screenshot({ path: "/tmp/gamma-embedded-preview.png" })
  console.log(
    "PASS: Gamma over single HTTPS reverse-proxy origin, snapshot authorization/CSRF, static assets, Vite build with lazy import, auto-update, refresh, multi-page and hash navigation, widths, expand, close/reopen, cookie/storage/API isolation",
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
