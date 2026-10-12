import type { FileNode } from "@opencode-ai/sdk/v2"

// Unlike the search/watcher ignore list, do not hide output, dotfiles or
// user configuration. Only omit well-known dependency/cache directories.
export function visibleWorkspaceNode(node: FileNode) {
  if (node.type === "directory") return ![".git", "node_modules", ".cache"].includes(node.name)
  return ![".DS_Store", "Thumbs.db"].includes(node.name)
}
