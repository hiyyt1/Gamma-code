import { describe, expect, test } from "bun:test"
import { demoKnowledge, emptyKnowledge, inspectMaterial, validateMaterial, validateURL } from "./knowledge"

describe("knowledge material validation", () => {
  test("accepts supported originals without pretending to parse them", () => {
    for (const name of ["a.pdf", "a.DOCX", "a.txt", "a.md", "a.markdown"])
      expect(() => validateMaterial(new File(["original"], name))).not.toThrow()
    expect(() => validateMaterial(new File(["code"], "a.html"))).toThrow("format")
    expect(() => validateMaterial(new File([new Uint8Array(20 * 1024 * 1024 + 1)], "big.pdf"))).toThrow("size")
  })
  test("only accepts HTTP and HTTPS links", () => {
    expect(validateURL("https://example.com/path")).toBe("https://example.com/path")
    for (const value of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,a", "not a url"])
      expect(() => validateURL(value)).toThrow()
  })
  test("demo is isolated and every relation has endpoints and provenance", () => {
    expect(emptyKnowledge()).toEqual({ spaces: [], sources: [], relations: [], jobs: [] })
    const ids = new Set(demoKnowledge.sources.map((source) => source.id))
    expect(ids.size).toBe(demoKnowledge.sources.length)
    expect(demoKnowledge.sources.every((source) => source.spaceID === "demo")).toBe(true)
    expect(
      demoKnowledge.relations.every((r) => r.provenance === "demo" && ids.has(r.source) && ids.has(r.target)),
    ).toBe(true)
  })
})

test("upload inspection accepts supported content and rejects disguised binary files", async () => {
  for (const extension of ["pdf", "docx"]) {
    const bytes = await Bun.file(
      new URL(`../../e2e/fixtures/knowledge-viewer/research.${extension}`, import.meta.url),
    ).arrayBuffer()
    await expect(inspectMaterial(new File([bytes], `research.${extension}`))).resolves.toBeUndefined()
  }
  for (const name of ["plain.txt", "note.md", "note.markdown"])
    await expect(inspectMaterial(new File(["# Текст"], name, { type: "text/plain" }))).resolves.toBeUndefined()
  await expect(inspectMaterial(new File([], "empty.txt"))).resolves.toBeUndefined()
  for (const file of [
    new File(["text"], "fake.pdf", { type: "application/pdf" }),
    new File(["PK\x03\x04"], "archive.docx", { type: "application/zip" }),
    new File(["text"], "fake.md", { type: "text/html" }),
    new File([new Uint8Array([0, 1, 2])], "binary.txt"),
    new File([new Uint8Array([255, 255])], "binary.md"),
  ])
    await expect(inspectMaterial(file)).rejects.toThrow()
})
