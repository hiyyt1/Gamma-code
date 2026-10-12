import { expect, test } from "bun:test"
import { visibleWorkspaceNode } from "./visibility"

test("only excludes dependency directories and OS metadata, not user dotfiles or build output", () => {
  const visible = (name: string, type: "file" | "directory") =>
    visibleWorkspaceNode({ name, type, path: name, absolute: `/${name}`, ignored: false })
  for (const name of [".git", "node_modules", ".cache"]) expect(visible(name, "directory")).toBe(false)
  for (const name of [".env", ".gitignore", "node_modules", "notes.tmp"]) expect(visible(name, "file")).toBe(true)
  for (const name of ["dist", "build", ".vscode", "src"]) expect(visible(name, "directory")).toBe(true)
  for (const name of [".DS_Store", "Thumbs.db"]) expect(visible(name, "file")).toBe(false)
})
