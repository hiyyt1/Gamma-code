import { expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { readUpload } from "../../src/server/routes/instance/httpapi/workspace-files"

function parse(data: FormData) {
  return Effect.runPromise(
    readUpload(
      HttpServerRequest.fromWeb(
        new Request("http://localhost/product/session/test/files", { method: "POST", body: data }),
      ),
    ),
  )
}

test.each(["text/plain", "application/json", "image/png", "application/pdf", "application/octet-stream"])(
  "parses multipart files with %s MIME",
  async (type) => {
    const data = new FormData()
    data.append("file", new File(["content"], "example.txt", { type }))
    const file = await parse(data)
    expect(file.name).toBe("example.txt")
    expect(new TextDecoder().decode(file.bytes)).toBe("content")
  },
)

test("rejects fields instead of files", async () => {
  const data = new FormData()
  data.append("file", "some text")
  await expect(parse(data)).rejects.toBeDefined()
})

test("rejects multiple files in a single request before writing", async () => {
  const data = new FormData()
  data.append("file", new File(["first"], "same.txt"))
  data.append("file", new File(["second"], "same.txt"))
  await expect(parse(data)).rejects.toBeDefined()
})

test("enforces the streaming size limit", async () => {
  const data = new FormData()
  data.append("file", new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.bin"))
  await expect(parse(data)).rejects.toBeDefined()
})

test.each(["Требования из договора.txt", "my file.pdf", "отчёт (финал).xlsx", "результат — 🚀.v1..txt"])(
  "preserves multipart filename %s",
  async (name) => {
    const data = new FormData()
    data.append("file", new File(["content"], name, { type: "text/plain" }))
    expect((await parse(data)).name).toBe(name)
  },
)

test.each(["../evil.txt", "a/b.txt", "a\\b.txt"])(
  "multipart parsing does not strip unsafe filename %s",
  async (name) => {
    const data = new FormData()
    data.append("file", new File(["content"], name, { type: "text/plain" }))
    await expect(parse(data)).rejects.toMatchObject({ code: "invalid_name" })
  },
)
