import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ProductProjects } from "../../src/server/product-projects"
import { WorkspaceUpload } from "../../src/server/workspace-upload"

let fixture: string
let previous: string | undefined
beforeEach(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), "oreshnik-projects-"))
  previous = process.env.ORESHNIK_WORKSPACES_ROOT
  process.env.ORESHNIK_WORKSPACES_ROOT = path.join(fixture, "missing", "workspaces")
})
afterEach(async () => {
  if (previous === undefined) delete process.env.ORESHNIK_WORKSPACES_ROOT
  else process.env.ORESHNIK_WORKSPACES_ROOT = previous
  await rm(fixture, { recursive: true, force: true })
})

test("provisions an absent root and lists only visible direct directories alphabetically", async () => {
  expect(await ProductProjects.list()).toEqual([])
  await ProductProjects.create("Beta")
  const alpha = await ProductProjects.create(" My Cool Site ")
  expect(alpha.name).toBe("my-cool-site")
  await mkdir(path.join(alpha.path, "nested"))
  await mkdir(path.join(ProductProjects.root(), ".hidden"))
  await writeFile(path.join(ProductProjects.root(), "file"), "ignored")
  await symlink(fixture, path.join(ProductProjects.root(), "escape"))
  expect((await ProductProjects.list()).map((project) => project.name)).toEqual(["beta", "my-cool-site"])
})

test.each(["../etc", "/tmp/test", "..", "a/b", "\\", "", "  ", ".hidden", "%2e%2e", "a\\b", "x".repeat(121)])(
  "rejects unsafe project name %s",
  async (name) => {
    expect(() => ProductProjects.create(name)).toThrow()
  },
)

test("exclusive creation detects collisions including concurrent requests", async () => {
  const result = await Promise.allSettled([ProductProjects.create("alpha"), ProductProjects.create("alpha")])
  expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1)
  expect(result.filter((item) => item.status === "rejected")).toHaveLength(1)
})

test("file operations and uploads stay in the selected project", async () => {
  const a = await ProductProjects.create("alpha")
  const b = await ProductProjects.create("beta")
  await ProductProjects.withProject(a.path, (handle) =>
    WorkspaceUpload.saveAt(handle, "a.txt", new TextEncoder().encode("alpha")),
  )
  await ProductProjects.withProject(b.path, (handle) =>
    WorkspaceUpload.saveAt(handle, "b.txt", new TextEncoder().encode("beta")),
  )
  expect((await ProductProjects.files(a.path, "")).map((file) => file.name)).toEqual(["a.txt"])
  expect((await ProductProjects.content(b.path, "b.txt")).content).toBe("beta")
  await expect(ProductProjects.content(a.path, "../beta/b.txt")).rejects.toThrow()
  await expect(ProductProjects.content(a.path, "/etc/passwd")).rejects.toThrow()
  await expect(ProductProjects.files(fixture, "")).rejects.toThrow()
  await symlink(b.path, path.join(a.path, "escape"))
  await symlink(path.join(b.path, "b.txt"), path.join(a.path, "file-link"))
  await expect(ProductProjects.content(a.path, "escape/b.txt")).rejects.toThrow()
  await expect(ProductProjects.content(a.path, "file-link")).rejects.toThrow()
  expect((await ProductProjects.files(a.path, "")).map((file) => file.name)).toEqual(["a.txt"])
})

test("rejects symlink projects and symlink root ancestors", async () => {
  await ProductProjects.list()
  await symlink(fixture, path.join(ProductProjects.root(), "escape"))
  await expect(
    ProductProjects.withProject(path.join(ProductProjects.root(), "escape"), async () => true),
  ).rejects.toThrow()
  await symlink(fixture, path.join(fixture, "alias"))
  process.env.ORESHNIK_WORKSPACES_ROOT = path.join(fixture, "alias", "new-root")
  await expect(ProductProjects.list()).rejects.toThrow()
})

test("default root is fixed and never derived from cwd", () => {
  delete process.env.ORESHNIK_WORKSPACES_ROOT
  expect(ProductProjects.root()).toBe("/home/oreshnik/workspaces")
})
