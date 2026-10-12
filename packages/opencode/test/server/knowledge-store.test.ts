import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { KnowledgeStore } from "../../src/server/knowledge-store"
import { ProductProjects } from "../../src/server/product-projects"
let fixture: string
let previous: (string | undefined)[]
beforeEach(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), "gamma-knowledge-"))
  previous = [process.env.GAMMA_KNOWLEDGE_ROOT, process.env.GAMMA_WORKSPACES_ROOT]
  process.env.GAMMA_KNOWLEDGE_ROOT = path.join(fixture, "knowledge")
  process.env.GAMMA_WORKSPACES_ROOT = path.join(fixture, "projects")
})
afterEach(async () => {
  ;["GAMMA_KNOWLEDGE_ROOT", "GAMMA_WORKSPACES_ROOT"].forEach((key, index) => {
    if (previous[index] === undefined) delete process.env[key]
    else process.env[key] = previous[index]
  })
  await rm(fixture, { recursive: true, force: true })
})
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const source = (id: string) => ({
  id,
  spaceID: "space-a",
  type: "document" as const,
  name: id,
  description: `Description ${id}`,
  tags: [],
  createdAt: "2026-10-09",
  updatedAt: "2026-10-09",
  text: `# ${id}`,
})
const publication = (): KnowledgeStore.Publication => ({
  expectedVersion: 0,
  requestID: "import-a",
  originals: {},
  data: {
    spaces: ["a", "b"].map((id) => ({ id: `space-${id}`, name: id, description: "", createdAt: "", updatedAt: "" })),
    sources: [source("123"), source("456")],
    relations: ["a", "b"].map((id) => ({
      id,
      source: "123",
      target: "456",
      spaceID: "space-a",
      type: "USES",
      provenance: "manual",
      metadata: {},
    })),
    jobs: [],
  },
})
test("compact dictionaries, file edits, edge updates and fresh-process persistence", async () => {
  const first = await KnowledgeStore.publish(publication())
  const folder = path.join(KnowledgeStore.root(), "spaces", first.spaces[0].storageID)
  const index = JSON.parse(await readFile(path.join(folder, "index.json"), "utf8"))
  expect(Object.keys(index)).toEqual(["123", "456"])
  expect(index["123"]).toHaveLength(2)
  expect(index["123"][1]).toBe("Description 123")
  expect(await readFile(path.join(folder, index["123"][0]), "utf8")).toBe("# 123")
  expect(JSON.parse(await readFile(path.join(folder, "links.json"), "utf8"))).toEqual({
    "123": ["456"],
    "456": ["123"],
  })
  const next = await KnowledgeStore.publish({
    ...publication(),
    expectedVersion: 1,
    requestID: "edit",
    data: { ...first.data, sources: first.data.sources.map((item) => ({ ...item, text: "edited" })), relations: [] },
  })
  expect(next.version).toBe(2)
  expect(JSON.parse(await readFile(path.join(folder, "links.json"), "utf8"))).toEqual({ "123": [], "456": [] })
  const child = Bun.spawn(
    [
      "bun",
      "-e",
      'import {KnowledgeStore} from "./src/server/knowledge-store"; console.log(JSON.stringify(await KnowledgeStore.state()))',
    ],
    { cwd: new URL("../..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe", env: { ...process.env } },
  )
  const output = await new Response(child.stdout).text()
  const errors = await new Response(child.stderr).text()
  expect(errors).toBe("")
  const restored = JSON.parse(output)
  expect(await child.exited).toBe(0)
  expect(restored.data).toEqual(next.data)
})
test("business types, properties and source documents survive storage without changing legacy records", async () => {
  const legacy = publication()
  const input = {
    ...legacy,
    data: {
      ...legacy.data,
      sources: legacy.data.sources.map((item) =>
        item.id === "123"
          ? {
              ...item,
              entityType: "Процесс",
              properties: { Ответственный: "Вымышленная Мария" },
              documentID: "456",
            }
          : item,
      ),
    },
  }
  const saved = await KnowledgeStore.publish(input)
  expect((await KnowledgeStore.state()).data).toEqual(saved.data)
  expect(saved.data.sources[1]).toEqual(source("456"))
  const folder = path.join(KnowledgeStore.root(), "spaces", saved.spaces[0].storageID)
  expect(await readFile(path.join(folder, "index.json"), "utf8")).toContain("123")
  for (const documentID of ["123", "missing"]) {
    await expect(
      KnowledgeStore.publish({
        ...input,
        expectedVersion: saved.version,
        requestID: `invalid-${documentID}`,
        data: {
          ...input.data,
          sources: input.data.sources.map((item) => (item.id === "123" ? { ...item, documentID } : item)),
        },
      }),
    ).rejects.toThrow()
    expect((await KnowledgeStore.state()).data).toEqual(saved.data)
  }
  await expect(
    KnowledgeStore.publish({
      ...input,
      expectedVersion: saved.version,
      requestID: "invalid-url",
      data: { ...input.data, sources: input.data.sources.map((item) => ({ ...item, url: "https://" })) },
    }),
  ).rejects.toThrow()
  expect((await KnowledgeStore.state()).data).toEqual(saved.data)
})
test("original hash checks and failed publication preserve the last complete snapshot", async () => {
  const bytes = new TextEncoder().encode("original\u0000binary")
  await KnowledgeStore.upload(hash(bytes), bytes)
  const input = publication()
  const data = { ...input.data, sources: [{ ...source("123"), filename: "sample.pdf" }, source("456")] }
  const originals = { "123": { hash: hash(bytes), size: bytes.length, mime: "application/pdf" } }
  const first = await KnowledgeStore.publish({ ...input, data, originals })
  expect((await KnowledgeStore.original("123")).bytes).toEqual(Buffer.from(bytes))
  await expect(
    KnowledgeStore.publish({
      ...input,
      expectedVersion: 1,
      requestID: "bad",
      data,
      originals: { "123": { ...originals["123"], size: 1 } },
    }),
  ).rejects.toThrow("integrity")
  expect((await KnowledgeStore.state()).data).toEqual(first.data)
  await expect(KnowledgeStore.upload("0".repeat(64), bytes)).rejects.toThrow("integrity")
  const changed = new TextEncoder().encode("changed")
  await KnowledgeStore.upload(hash(changed), changed)
  await expect(
    KnowledgeStore.publish({
      ...input,
      expectedVersion: 1,
      requestID: "changed",
      data,
      originals: { "123": { hash: hash(changed), size: changed.length, mime: "application/pdf" } },
    }),
  ).rejects.toThrow("original_changed")
})
test("idempotent import, stale conflicts and concurrent writers", async () => {
  const input = publication()
  await KnowledgeStore.publish(input)
  expect((await KnowledgeStore.publish(input)).version).toBe(1)
  await expect(KnowledgeStore.publish({ ...input, requestID: "stale" })).rejects.toThrow("conflict")
  await expect(KnowledgeStore.publish({ ...input, data: { ...input.data, relations: [] } })).rejects.toThrow("conflict")
  const results = await Promise.allSettled(
    ["one", "two"].map((requestID) => KnowledgeStore.publish({ ...input, expectedVersion: 1, requestID })),
  )
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
  expect((await KnowledgeStore.state()).version).toBe(2)
})
test("many-to-many connections, disconnect and project deletion preserve space files", async () => {
  const first = await KnowledgeStore.publish(publication())
  const alpha = await ProductProjects.create("alpha")
  await ProductProjects.create("beta")
  const initial = await KnowledgeStore.projects()
  expect(initial[0].id).not.toBe(initial[1].id)
  await KnowledgeStore.projects({ projectID: initial[0].id, spaces: ["space-a", "space-b"] })
  const connected = await KnowledgeStore.projects({ projectID: initial[1].id, spaces: ["space-a"] })
  expect(connected.map((project) => project.spaces)).toEqual([["space-a", "space-b"], ["space-a"]])
  const target = path.join(KnowledgeStore.root(), "spaces", first.spaces[0].storageID, "index.json")
  const before = await stat(target)
  await KnowledgeStore.projects({ projectID: initial[0].id, spaces: [] })
  expect((await stat(target)).ino).toBe(before.ino)
  expect((await KnowledgeStore.state()).data).toEqual(first.data)
  await rm(alpha.path, { recursive: true })
  expect(await KnowledgeStore.projects()).toHaveLength(1)
  expect((await KnowledgeStore.state()).spaces).toHaveLength(2)
  await expect(KnowledgeStore.projects({ projectID: initial[0].id, spaces: ["space-a"] })).rejects.toThrow("not_found")
  await expect(KnowledgeStore.projects({ projectID: initial[1].id, spaces: ["unknown"] })).rejects.toThrow("not_found")
})
test("deleting a space removes its connections only", async () => {
  await KnowledgeStore.publish(publication())
  await ProductProjects.create("alpha")
  const projects = await KnowledgeStore.projects()
  await KnowledgeStore.projects({ projectID: projects[0].id, spaces: ["space-a", "space-b"] })
  const data = publication().data
  await KnowledgeStore.publish({
    expectedVersion: 1,
    requestID: "remove",
    originals: {},
    data: { ...data, spaces: data.spaces.filter((space) => space.id !== "space-a"), sources: [], relations: [] },
  })
  expect((await KnowledgeStore.projects())[0].spaces).toEqual(["space-b"])
})
test("unsafe roots, symlinks, dangling edges and missing originals are rejected", async () => {
  const input = publication()
  await expect(KnowledgeStore.publish({ ...input, data: { ...input.data, sources: [] } })).rejects.toThrow("integrity")
  await expect(
    KnowledgeStore.publish({
      ...input,
      data: { ...input.data, sources: [{ ...source("123"), filename: "missing.pdf" }, source("456")] },
    }),
  ).rejects.toThrow("missing_original")
  await mkdir(ProductProjects.root())
  process.env.GAMMA_KNOWLEDGE_ROOT = path.join(ProductProjects.root(), "bad")
  expect(() => KnowledgeStore.root()).toThrow("invalid_root")
  await symlink(ProductProjects.root(), path.join(fixture, "alias"))
  process.env.GAMMA_KNOWLEDGE_ROOT = path.join(fixture, "alias", "bad")
  await expect(KnowledgeStore.state()).rejects.toThrow()
})

test("physical verification reads originals, URL descriptions and detects corruption", async () => {
  const bytes = new Uint8Array(
    await Bun.file(new URL("../../../app/e2e/fixtures/knowledge-viewer/research.pdf", import.meta.url)).arrayBuffer(),
  )
  const blob = await KnowledgeStore.upload(hash(bytes), bytes)
  const input = publication()
  const data = {
    ...input.data,
    sources: [
      { ...source("123"), filename: "original.pdf", text: "", size: bytes.length, description: "" },
      {
        ...source("456"),
        type: "link" as const,
        text: undefined,
        url: "https://example.org/source",
        description: "Source description",
      },
    ],
  }
  const published = await KnowledgeStore.publish({
    ...input,
    data,
    originals: { "123": { ...blob, mime: "application/pdf" } },
  })
  const checked = await KnowledgeStore.verify()
  expect(checked.errors).toEqual([])
  expect(checked.originals).toEqual([{ id: "123", size: bytes.length, sha256: hash(bytes) }])
  const folder = path.join(KnowledgeStore.root(), "spaces", published.spaces[0].storageID)
  const index = await Bun.file(path.join(folder, "index.json")).json()
  expect(index["123"][0]).toEndWith(".pdf")
  expect(index["123"][1]).toBe("123")
  expect(await Bun.file(path.join(folder, index["456"][0])).text()).toContain(
    "Source description\n\nhttps://example.org/source",
  )
  await Bun.write(path.join(folder, index["456"][0]), "damaged")
  expect((await KnowledgeStore.verify()).errors).toContainEqual({ id: "456", reason: "material_content" })
})

test("dynamic context follows Gamma identity and connections without changing material files", async () => {
  await ProductProjects.create("first")
  await ProductProjects.create("second")
  const input = publication()
  const published = await KnowledgeStore.publish({
    ...input,
    data: {
      ...input.data,
      spaces: input.data.spaces.map((space) => ({ ...space, description: "Long description ".repeat(1000) })),
    },
  })
  const projects = await KnowledgeStore.projects()
  const first = projects.find((item) => item.name === "first")!
  const second = projects.find((item) => item.name === "second")!
  expect(await KnowledgeStore.context(first.path)).toBeUndefined()
  await KnowledgeStore.projects({ projectID: first.id, spaces: ["space-a", "space-b"] })
  await KnowledgeStore.projects({ projectID: second.id, spaces: ["space-b"] })
  const context = await KnowledgeStore.context(first.path)
  expect(context).toContain('"a"')
  expect(context).toContain('"b"')
  expect(context).toContain(path.join(KnowledgeStore.root(), "spaces", published.spaces[0].storageID))
  expect(context).not.toContain("# 123")
  expect(context).not.toContain("Description 123")
  expect(context!.length).toBeLessThan(3000)
  expect(await KnowledgeStore.context(second.path)).not.toContain('"a"')
  expect(await KnowledgeStore.context(path.join(first.path, "src"))).toBe(context)
  expect(await KnowledgeStore.context(fixture)).toBeUndefined()
  await KnowledgeStore.projects({ projectID: first.id, spaces: [] })
  expect(await KnowledgeStore.context(first.path)).toBeUndefined()
  expect(await KnowledgeStore.context(second.path)).toContain('"b"')
  expect(await KnowledgeStore.state()).toMatchObject({
    data: published.data,
    originals: published.originals,
    spaces: published.spaces,
    version: published.version,
  })
  await rm(second.path, { recursive: true })
  await ProductProjects.create("second")
  expect(await KnowledgeStore.context(second.path)).toBeUndefined()
})
