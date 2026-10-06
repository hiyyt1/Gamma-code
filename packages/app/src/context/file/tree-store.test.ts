import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { FileNode } from "@opencode-ai/sdk/v2"
import { createFileTreeStore } from "./tree-store"

test("refresh after upload fetches a fresh snapshot even when initial listing is pending", async () => {
  const initial = Promise.withResolvers<FileNode[]>()
  const state = { calls: 0 }
  const uploaded: FileNode = { name: "a.txt", path: "a.txt", absolute: "/project/a.txt", type: "file", ignored: false }
  const store = createRoot((dispose) => ({
    dispose,
    tree: createFileTreeStore({
      scope: () => "/project",
      normalizeDir: (path) => path,
      list: () => (++state.calls === 1 ? initial.promise : Promise.resolve([uploaded])),
      onError: (message) => {
        throw new Error(message)
      },
    }),
  }))
  try {
    const first = store.tree.listDir("")
    const refresh = store.tree.listDir("", { force: true })
    initial.resolve([])
    await Promise.all([first, refresh])
    expect(state.calls).toBe(2)
    expect(store.tree.children("")).toEqual([uploaded])
  } finally {
    store.dispose()
  }
})
