import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink, link } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ProductProjects } from "../../src/server/product-projects"
import { configuration, createPreview, discover } from "../../src/server/site-preview"

let fixture: string
let previous: string | undefined
beforeEach(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), "gamma-preview-"))
  previous = process.env.GAMMA_WORKSPACES_ROOT
  process.env.GAMMA_WORKSPACES_ROOT = path.join(fixture, "projects")
})
afterEach(async () => {
  if (previous === undefined) delete process.env.GAMMA_WORKSPACES_ROOT
  else process.env.GAMMA_WORKSPACES_ROOT = previous
  await rm(fixture, { recursive: true, force: true })
})
const config = { domain: "preview.example.net", main: "https://gamma.example.com" }

test("SPA navigations fall back within the selected root without masking asset or API errors", async () => {
  const project = await ProductProjects.create("spa")
  await Bun.write(
    path.join(project.path, "dist/index.html"),
    '<html><head></head><body>SPA shell<script src="assets/app.js"></script></body></html>',
  )
  const service = createPreview(config)
  const lease = await service.start("session", project.path, "dist")
  await Bun.write(path.join(project.path, "dist/private-key"), "PRIVATE FILE")
  const navigate = (relative: string) =>
    service.fetch(new Request(lease.url + relative, { headers: { accept: "text/html" } }))
  expect(await (await navigate("dashboard/users")).text()).toContain('<base href="/">')
  expect((await navigate("dashboard/users/")).headers.get("content-type")).toContain("text/html")
  expect(await (await navigate("private-key")).text()).not.toContain("PRIVATE FILE")
  for (const relative of [
    "missing.js",
    "product/projects",
    "api/config",
    "etc/passwd",
    ".env",
    "%2e%2e%2fsecret",
    "%ZZ",
  ])
    expect((await navigate(relative)).status).toBeGreaterThanOrEqual(400)
  expect((await service.fetch(new Request(lease.url + "unknown"))).status).toBe(404)
})

test("labels ready static builds from real package dependencies", async () => {
  const project = await ProductProjects.create("frameworks")
  for (const name of ["vite", "react"]) {
    await Bun.write(
      path.join(project.path, name, "package.json"),
      JSON.stringify({ scripts: { build: "never-run" }, dependencies: { [name]: "*" } }),
    )
    await Bun.write(path.join(project.path, name, "dist/index.html"), "Build")
  }
  expect((await discover(project.path)).filter((site) => site.kind === "static")).toEqual([
    { path: "react/dist", kind: "static", framework: "React" },
    { path: "vite/dist", kind: "static", framework: "Vite" },
  ])
})

test("discovers static roots, nested sites, dev projects and existing builds without executing scripts", async () => {
  const project = await ProductProjects.create("sites")
  expect(await discover(project.path)).toEqual([])
  await mkdir(path.join(project.path, "app", "dist"), { recursive: true })
  await Bun.write(path.join(project.path, "index.html"), "Root")
  await Bun.write(path.join(project.path, "app", "index.html"), '<script type="module" src="/src/main.tsx"></script>')
  await Bun.write(
    path.join(project.path, "app", "package.json"),
    JSON.stringify({ scripts: { dev: "touch NEVER_EXECUTE" } }),
  )
  await Bun.write(path.join(project.path, "app", "dist", "index.html"), "Build")
  await symlink(fixture, path.join(project.path, "escape"))
  expect(await discover(project.path)).toEqual([
    { path: "", kind: "static" },
    { path: "app", kind: "dynamic" },
    { path: "app/dist", kind: "static" },
  ])
  await expect(createPreview(config).start("session", project.path, "app")).rejects.toThrow("dynamic_unavailable")
  expect(await Bun.file(path.join(project.path, "app", "NEVER_EXECUTE")).exists()).toBe(false)
})

test("serves selected assets with isolation headers and reflects file changes", async () => {
  const project = await ProductProjects.create("site")
  await Bun.write(path.join(project.path, "site", "index.html"), '<link href="/style.css" rel="stylesheet">')
  await Bun.write(path.join(project.path, "site", "style.css"), "body{color:red}")
  const service = createPreview(config)
  const lease = await service.start("session", project.path, "site")
  expect(await (await service.fetch(new Request(lease.url))).text()).toContain("/style.css")
  const response = await service.fetch(new Request(`${lease.url}style.css`))
  expect(response.headers.get("content-type")).toContain("text/css")
  expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts allow-forms;")
  expect(response.headers.get("content-security-policy")).not.toContain("allow-same-origin")
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(response.headers.get("set-cookie")).toBeNull()
  await Bun.write(path.join(project.path, "site", "style.css"), "body{color:blue}")
  expect(await (await service.fetch(new Request(`${lease.url}style.css`))).text()).toContain("blue")
  service.stop("session", lease.id)
  expect((await service.fetch(new Request(lease.url))).status).toBe(404)
})

test("rejects traversal, symlinks, hardlinks, credentials, arbitrary proxy paths and foreign leases", async () => {
  const a = await ProductProjects.create("alpha")
  const b = await ProductProjects.create("beta")
  await Bun.write(path.join(a.path, "index.html"), "Alpha")
  await Bun.write(path.join(b.path, "secret.js"), "secret")
  await Bun.write(path.join(a.path, ".env"), "SECRET=123")
  await Bun.write(path.join(a.path, "gamma.json"), "{}")
  await symlink(b.path, path.join(a.path, "escape"))
  await symlink(path.join(b.path, "secret.js"), path.join(a.path, "link.js"))
  await link(path.join(b.path, "secret.js"), path.join(a.path, "hard.js"))
  const service = createPreview(config)
  const lease = await service.start("alpha-session", a.path, "")
  for (const relative of [
    ".env",
    "gamma.json",
    "escape/secret.js",
    "link.js",
    "hard.js",
    "%2e%2e%2fbeta/secret.js",
    "etc/passwd",
    "http://localhost:4096/config",
    "product/projects",
  ])
    expect((await service.fetch(new Request(lease.url + relative))).status).toBeGreaterThanOrEqual(400)
  expect(() => service.renew("beta-session", lease.id)).toThrow("expired")
  service.stop("beta-session", lease.id)
  expect((await service.fetch(new Request(lease.url))).status).toBe(200)
  expect((await service.fetch(new Request(lease.url, { method: "POST" }))).status).toBe(405)
  expect((await service.fetch(new Request("https://unknown.preview.example.net/"))).status).toBe(404)
})

test("bounds leases, expires abandoned previews and keeps other sessions alive", async () => {
  const project = await ProductProjects.create("site")
  await Bun.write(path.join(project.path, "index.html"), "Site")
  const clock = { time: 0 }
  const service = createPreview(config, () => clock.time)
  const leases = await Promise.all(
    Array.from({ length: 32 }, (_, index) => service.start(String(index), project.path, "")),
  )
  await expect(service.start("extra", project.path, "")).rejects.toThrow("preview_limit")
  clock.time = 90_000
  service.renew("0", leases[0].id)
  clock.time = 121_000
  expect((await service.fetch(new Request(leases[0].url))).status).toBe(200)
  expect((await service.fetch(new Request(leases[1].url))).status).toBe(404)
  service.clear()
  expect((await service.fetch(new Request(leases[0].url))).status).toBe(404)
})

test("local preview keeps capability origins without external DNS or TLS", async () => {
  const project = await ProductProjects.create("local")
  await Bun.write(path.join(project.path, "index.html"), "Local site")
  const service = createPreview({ domain: "localhost", main: "http://localhost:4456", localPort: 4109 })
  const lease = await service.start("session", project.path, "")
  expect(lease.url).toMatch(/^http:\/\/[a-f0-9]{48}\.localhost:4109\/$/)
  const response = await service.fetch(new Request(lease.url))
  expect(await response.text()).toBe("Local site")
  expect(response.headers.get("content-security-policy")).toContain(`connect-src ${new URL(lease.url).origin};`)
  expect((await service.fetch(new Request(lease.url.replace(":4109", ":4110")))).status).toBe(404)
  service.stop("session", lease.id)
  expect((await service.fetch(new Request(lease.url))).status).toBe(404)
})

test("local mode only accepts an explicit loopback HTTP origin on a separate port", () => {
  const keys = ["GAMMA_PREVIEW_LOCAL", "GAMMA_PREVIEW_DOMAIN", "GAMMA_PUBLIC_ORIGIN", "GAMMA_PREVIEW_PORT"]
  const saved = keys.map((key) => process.env[key])
  try {
    process.env.GAMMA_PREVIEW_LOCAL = "1"
    delete process.env.GAMMA_PREVIEW_DOMAIN
    process.env.GAMMA_PREVIEW_PORT = "4109"
    process.env.GAMMA_PUBLIC_ORIGIN = "http://localhost:4456"
    expect(configuration()).toEqual({ domain: "localhost", main: "http://localhost:4456", localPort: 4109 })
    for (const origin of [
      "http://gamma.example.com",
      "https://localhost:4456",
      "http://localhost:4109",
      "http://localhost:4456/path",
    ]) {
      process.env.GAMMA_PUBLIC_ORIGIN = origin
      expect(configuration).toThrow()
    }
    process.env.GAMMA_PUBLIC_ORIGIN = "http://localhost:4456"
    for (const port of ["0", "65536", "no", "1.5"]) {
      process.env.GAMMA_PREVIEW_PORT = port
      expect(configuration).toThrow()
    }
    process.env.GAMMA_PREVIEW_PORT = "4109"
    process.env.GAMMA_PREVIEW_DOMAIN = "preview.example.net"
    expect(configuration).toThrow()
  } finally {
    keys.forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key]
      else process.env[key] = saved[index]
    })
  }
})

test("embedded snapshots are bounded, revisioned and confined to the selected build", async () => {
  const { snapshot } = await import("../../src/server/site-preview")
  const project = await ProductProjects.create("snapshot")
  await Bun.write(path.join(project.path, "dist/index.html"), '<script src="assets/app.js"></script>')
  await Bun.write(path.join(project.path, "dist/assets/app.js"), "console.log('ready')")
  await Bun.write(path.join(project.path, "dist/.env"), "SECRET")
  await Bun.write(path.join(project.path, "dist/package.json"), "{}")
  await Bun.write(path.join(project.path, "secret.js"), "OUTSIDE BUILD")
  await symlink(path.join(project.path, "secret.js"), path.join(project.path, "dist/escape.js"))
  const first = await snapshot(project.path, "dist")
  expect(first.files.map((file) => file.path).sort()).toEqual(["assets/app.js", "index.html"])
  expect((await snapshot(project.path, "dist")).revision).toBe(first.revision)
  await Bun.write(path.join(project.path, "dist/assets/app.js"), "console.log('updated')")
  expect((await snapshot(project.path, "dist")).revision).not.toBe(first.revision)
  for (const root of ["../", "/etc", "dist/..", "dist/%2e%2e", "dist\\.."])
    await expect(snapshot(project.path, root)).rejects.toThrow("site_missing")
  await link(path.join(project.path, "secret.js"), path.join(project.path, "dist/hardlink.js"))
  await expect(snapshot(project.path, "dist")).rejects.toThrow("invalid_path")
  await rm(path.join(project.path, "dist/hardlink.js"))
  await Bun.write(path.join(project.path, "dist/large.js"), Buffer.alloc(8 * 1024 * 1024 + 1))
  await expect(snapshot(project.path, "dist")).rejects.toThrow("preview_limit")
})

test("embedded snapshots bound total bytes and file count, and never execute source projects", async () => {
  const { snapshot } = await import("../../src/server/site-preview")
  const project = await ProductProjects.create("snapshot-limits")
  await Bun.write(path.join(project.path, "index.html"), "static")
  await Promise.all(Array.from({ length: 512 }, (_, index) => Bun.write(path.join(project.path, `${index}.css`), "x")))
  await expect(snapshot(project.path, "")).rejects.toThrow("preview_limit")
  await Promise.all(Array.from({ length: 512 }, (_, index) => rm(path.join(project.path, `${index}.css`))))
  await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      Bun.write(path.join(project.path, `${index}.js`), Buffer.alloc(7 * 1024 * 1024)),
    ),
  )
  await expect(snapshot(project.path, "")).rejects.toThrow("preview_limit")
  await Bun.write(path.join(project.path, "package.json"), JSON.stringify({ scripts: { build: "touch NEVER" } }))
  await expect(snapshot(project.path, "")).rejects.toThrow("dynamic_unavailable")
  expect(await Bun.file(path.join(project.path, "NEVER")).exists()).toBe(false)
})
