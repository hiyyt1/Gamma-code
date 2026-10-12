import { expect, test } from "bun:test"
import type { AssistantMessage, Message, Part } from "@opencode-ai/sdk/v2"
import { siteFilePath, siteResults, previewFailure, type PreviewSite } from "./site-results"

function fixture(paths = ["coffee/index.html"], sites: PreviewSite[] = [{ path: "coffee", kind: "static" }]) {
  const message: AssistantMessage = {
    id: "assistant",
    sessionID: "session",
    role: "assistant",
    parentID: "user",
    agent: "gamma",
    mode: "gamma",
    modelID: "test",
    providerID: "test",
    path: { cwd: "/workspace", root: "/workspace" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, completed: 2 },
    finish: "stop",
  }
  const parts: Part[] = [
    ...paths.map(
      (path, index): Part => ({
        id: `tool-${index}`,
        type: "tool",
        sessionID: "session",
        messageID: message.id,
        callID: `call-${index}`,
        tool: "write",
        state: {
          status: "completed",
          input: { path },
          metadata: {},
          output: "Created",
          title: path,
          time: { start: 1, end: 2 },
        },
      }),
    ),
    { id: "answer", type: "text", messageID: message.id, sessionID: "session", text: "Done" },
  ]
  return {
    sessionID: "session",
    directory: "/workspace",
    messages: [message],
    parts: () => parts,
    sites,
    available: sites,
    state: "ready" as const,
  }
}

test("durable mutations produce one card on the final answer and survive reconstruction", () => {
  const input = fixture(["coffee/index.html", "/workspace/coffee/style.css"])
  expect(siteResults(input)).toEqual([{ site: input.sites[0], partID: "answer", available: true, status: "ready" }])
  expect(
    siteResults({ ...input, messages: structuredClone(input.messages), parts: () => structuredClone(input.parts()) }),
  ).toEqual(siteResults(input))
})
test("ordinary prose, reads, pending and failed turns never claim existing sites", () => {
  expect(siteResults(fixture([]))).toEqual([])
  const input = fixture()
  const tool = input.parts()[0]
  if (tool.type !== "tool") throw new Error("fixture")
  tool.tool = "read"
  expect(siteResults(input)).toEqual([])
  tool.tool = "write"
  input.messages[0].time.completed = undefined
  expect(siteResults(input)).toEqual([])
  input.messages[0].time.completed = 2
  input.messages[0].error = { name: "UnknownError", data: { message: "failed" } }
  expect(siteResults(input)).toEqual([])
})
test("session/project isolation and exact directory boundaries", () => {
  expect(siteResults({ ...fixture(), sessionID: "neighbor" })).toEqual([])
  expect(siteResults(fixture(["/another/project/coffee/index.html"]))).toEqual([])
  expect(siteResults(fixture(["coffee-other/index.html"]))).toEqual([])
  const input = fixture()
  input.parts()[0].sessionID = "neighbor"
  expect(siteResults(input)).toEqual([])
})
test("unsupported source projects do not create cards; static builds use the right path", () => {
  const sites: PreviewSite[] = [
    { path: "react", kind: "dynamic" },
    { path: "react/dist", kind: "static", framework: "Vite" },
  ]
  expect(siteResults(fixture(["react/index.html"], sites))).toEqual([])
  expect(siteResults(fixture(["react/dist/index.html"], sites))[0].site.path).toBe("react/dist")
})
test("multiple sites match individually, with no duplicate root ancestor card", () => {
  const sites: PreviewSite[] = [
    { path: "", kind: "static" },
    { path: "coffee", kind: "static" },
    { path: "shop", kind: "static" },
  ]
  expect(siteResults(fixture(["coffee/index.html", "shop/index.html"], sites)).map((item) => item.site.path)).toEqual([
    "coffee",
    "shop",
  ])
})
test("removed sites become unavailable and disabled deployment cannot open cards", () => {
  expect(siteResults({ ...fixture(), available: [] })[0].available).toBe(false)
  expect(siteResults({ ...fixture(), state: "unconfigured" })[0].available).toBe(false)
})
test("latest modifying turn owns the single card", () => {
  const input = fixture()
  const next = { ...input.messages[0], id: "next", parentID: "next-user" }
  const parts = input.parts().map((part) => ({ ...part, id: `${part.id}-next`, messageID: next.id }))
  const result = siteResults({
    ...input,
    messages: [...input.messages, next],
    parts: (id) => (id === next.id ? parts : input.parts()),
  })
  expect(result).toHaveLength(1)
  expect(result[0].partID).toBe("answer-next")
})
test("patch metadata uses destination or original path and excludes deletions", () => {
  const input = fixture()
  const part = input.parts()[0]
  if (part.type !== "tool" || part.state.status !== "completed") throw new Error("fixture")
  part.tool = "apply_patch"
  part.state.metadata.files = [{ filePath: "/workspace/coffee/index.html", movePath: undefined, type: "add" }]
  expect(siteResults(input)).toHaveLength(1)
  part.state.metadata.files = [{ filePath: "/workspace/coffee/index.html", type: "delete" }]
  expect(siteResults(input)).toHaveLength(0)
  part.state.metadata.files = [{ filePath: "old/index.html", movePath: "coffee/index.html", type: "move" }]
  expect(siteResults(input)).toHaveLength(1)
  part.state.metadata.files = [{ file: "coffee/index.html", status: "added" }]
  expect(siteResults(input)).toHaveLength(1)
  part.state.metadata.files = [{ file: "coffee/index.html", status: "deleted" }]
  expect(siteResults(input)).toHaveLength(0)
})
test("durable per-turn diffs support shell output without trusting shell text", () => {
  const input = fixture([])
  const parent: Message = {
    id: "user",
    sessionID: "session",
    role: "user",
    time: { created: 0 },
    agent: "gamma",
    model: { modelID: "test", providerID: "test" },
    summary: { diffs: [{ file: "coffee/index.html", patch: "+<h1>Hi</h1>", additions: 1, deletions: 0 }] },
  }
  expect(siteResults({ ...input, messages: [parent, ...input.messages] })).toHaveLength(1)
  expect(siteResults({ ...input, messages: [{ ...parent, sessionID: "neighbor" }, ...input.messages] })).toHaveLength(0)
  input.messages[0].finish = "length"
  expect(siteResults({ ...input, messages: [parent, ...input.messages] })).toHaveLength(0)
})
test("only local file hrefs are eligible; external URLs and traversal stay untouched", () => {
  expect(siteFilePath("coffee/index.html", "/workspace")).toBe("coffee/index.html")
  expect(siteFilePath("/workspace/coffee/index.html#intro", "/workspace")).toBe("coffee/index.html")
  for (const link of [
    "https://example.com/index.html",
    "//example.com/index.html",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "../index.html",
    "%2e%2e/index.html",
    "/etc/index.html",
    "#section",
  ])
    expect(siteFilePath(link, "/workspace")).toBeUndefined()
})

test("discovery errors never claim files were deleted", () => {
  for (const state of ["loading", "forbidden", "offline", "error"] as const) {
    const result = siteResults({ ...fixture(), available: [], state })[0]
    expect(result.status).toBe(state)
    expect(result.available).toBe(false)
  }
  expect(siteResults({ ...fixture(), available: [] })[0].status).toBe("missing")
  expect(siteResults({ ...fixture(), state: "unconfigured" })[0].status).toBe("unconfigured")
  expect(siteResults({ ...fixture(), state: "unconfigured", available: [] })[0].status).toBe("missing")
  expect(previewFailure(new Error("http_403"))).toBe("forbidden")
  expect(previewFailure(new Error("http_401"))).toBe("forbidden")
  expect(previewFailure(new Error("network_error"))).toBe("offline")
  expect(previewFailure(new Error("http_500"))).toBe("error")
})
