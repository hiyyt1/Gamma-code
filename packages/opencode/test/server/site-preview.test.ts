import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink, link } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ProductProjects } from "../../src/server/product-projects"
import { createPreview, discover } from "../../src/server/site-preview"

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
