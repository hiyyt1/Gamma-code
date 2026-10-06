import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WorkspaceUpload } from "../../src/server/workspace-upload"

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "workspace-upload-"))
  await mkdir(join(root, "workspace"))
  await Bun.write(join(root, "source"), "uploaded content\n")
  return {
    root,
    directory: join(root, "workspace"),
    source: join(root, "source"),
    bytes: new TextEncoder().encode("uploaded content\n"),
    [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }),
  }
}

describe("workspace upload", () => {
  test.each([
    "",
    ".",
    "..",
    "../escape.txt",
    "sub/file.txt",
    "sub\\file.txt",
    "/tmp/file.txt",
    "C:\\file.txt",
    "bad\0.txt",
    "bad\n.txt",
    " hidden.txt",
    "a".repeat(241),
  ])("rejects unsafe filename %j", (name) => {
    expect(() => WorkspaceUpload.filename(name)).toThrow("invalid_name")
  })
  test("normalizes unicode and preserves ordinary names", () => {
    expect(WorkspaceUpload.filename("cafe\u0301.txt")).toBe("café.txt")
    expect(WorkspaceUpload.filename("my file.json")).toBe("my file.json")
  })
  test("writes bytes in the root and refuses overwrite", async () => {
    await using data = await fixture()
    expect(await WorkspaceUpload.save(data.directory, "test.txt", data.bytes)).toBe("test.txt")
    expect(await Bun.file(join(data.directory, "test.txt")).text()).toBe("uploaded content\n")
    await expect(WorkspaceUpload.save(data.directory, "test.txt", data.bytes)).rejects.toMatchObject({ code: "EEXIST" })
  })
  test("rejects a symlink destination without modifying its target", async () => {
    await using data = await fixture()
    await symlink(data.source, join(data.directory, "link.txt"))
    await expect(WorkspaceUpload.save(data.directory, "link.txt", data.bytes)).rejects.toMatchObject({ code: "EEXIST" })
    expect(await Bun.file(data.source).text()).toBe("uploaded content\n")
  })
  test("rejects a symlink workspace root", async () => {
    await using data = await fixture()
    await symlink(data.directory, join(data.root, "alias"))
    await expect(WorkspaceUpload.save(join(data.root, "alias"), "test.txt", data.bytes)).rejects.toBeDefined()
    expect(await Bun.file(join(data.directory, "test.txt")).exists()).toBe(false)
  })
  test("concurrent writes never overwrite each other", async () => {
    await using data = await fixture()
    const results = await Promise.allSettled([
      WorkspaceUpload.save(data.directory, "same.txt", data.bytes),
      WorkspaceUpload.save(data.directory, "same.txt", data.bytes),
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
  })
  test("oversize uploads leave no destination", async () => {
    await using data = await fixture()
    await expect(
      WorkspaceUpload.save(data.directory, "large.bin", new Uint8Array(WorkspaceUpload.MAX_BYTES + 1)),
    ).rejects.toThrow("too_large")
    expect(await Bun.file(join(data.directory, "large.bin")).exists()).toBe(false)
  })
})

test.each(["Требования из договора.txt", "my file.pdf", "отчёт (финал).xlsx", "результат — 🚀.v1..txt"])(
  "writes ordinary Unicode filename %s unchanged",
  async (name) => {
    await using data = await fixture()
    expect(await WorkspaceUpload.save(data.directory, name, data.bytes)).toBe(name)
    expect(await Bun.file(join(data.directory, name)).text()).toBe("uploaded content\n")
  },
)

test.each(["../evil.txt", "a/b.txt", "a\\b.txt"])("never writes unsafe upload name %s", async (name) => {
  await using data = await fixture()
  await expect(WorkspaceUpload.save(data.directory, name, data.bytes)).rejects.toThrow("invalid_name")
})

test("NFC normalization preserves accents and refuses canonical duplicate overwrite", async () => {
  await using data = await fixture()
  expect(await WorkspaceUpload.save(data.directory, "cafe\u0301.txt", data.bytes)).toBe("café.txt")
  await expect(WorkspaceUpload.save(data.directory, "café.txt", data.bytes)).rejects.toMatchObject({ code: "EEXIST" })
})
