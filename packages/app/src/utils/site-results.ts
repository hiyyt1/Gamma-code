import type { Message, Part } from "@opencode-ai/sdk/v2"

export type PreviewSite = { path: string; kind: "static" | "dynamic"; framework?: "HTML" | "Vite" | "React" }
export type PreviewState = "loading" | "ready" | "unconfigured" | "forbidden" | "offline" | "error"
export type SiteResult = { site: PreviewSite; partID: string; available: boolean; status: PreviewState | "missing" }

export function previewFailure(error: unknown): PreviewState {
  const code = error instanceof Error ? error.message : ""
  if (["http_401", "http_403", "access_denied"].includes(code)) return "forbidden"
  return code === "network_error" ? "offline" : "error"
}

// Accept only local workspace paths. Never turn an external URL into a file link.
export function siteFilePath(value: string, directory: string) {
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(value)) return
  const decoded = (() => {
    try {
      return decodeURIComponent(value.split(/[?#]/, 1)[0])
    } catch {
      return ""
    }
  })()
  const relative = decoded.startsWith(`${directory}/`)
    ? decoded.slice(directory.length + 1)
    : decoded.replace(/^\.\//, "")
  if (
    !relative ||
    relative.startsWith("/") ||
    /[\\:%\x00-\x1f]/.test(relative) ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  )
    return
  return relative
}

function mutationPaths(part: Part) {
  if (part.type === "patch") return part.files
  if (part.type !== "tool" || part.state.status !== "completed") return []
  if (["write", "edit", "multiedit"].includes(part.tool))
    return [part.state.input.path, part.state.input.filePath].filter(
      (value): value is string => typeof value === "string",
    )
  if (part.tool !== "apply_patch") return []
  const files = part.state.metadata.files
  if (!Array.isArray(files)) return []
  return files.flatMap((file: unknown) => {
    if (
      !file ||
      typeof file !== "object" ||
      ("type" in file && file.type === "delete") ||
      ("status" in file && file.status === "deleted")
    )
      return []
    const value =
      ("movePath" in file ? file.movePath : undefined) ??
      ("filePath" in file ? file.filePath : undefined) ??
      ("relativePath" in file ? file.relativePath : undefined) ??
      ("file" in file ? file.file : undefined)
    return typeof value === "string" ? [value] : []
  })
}

// Derive ownership from durable history, never from model prose or a workspace-wide diff.
// One card per site, attached to its latest successful modifying turn.
export function siteResults(input: {
  sessionID: string
  directory: string
  messages: readonly Message[]
  parts: (messageID: string) => readonly Part[]
  sites: readonly PreviewSite[]
  available: readonly PreviewSite[]
  state: PreviewState
}) {
  const results = new Map<string, SiteResult>()
  const turns = new Map<string, Extract<Message, { role: "assistant" }>[]>()
  for (const message of input.messages) {
    if (message.sessionID !== input.sessionID || message.role !== "assistant" || message.summary) continue
    const turn = turns.get(message.parentID) ?? []
    turn.push(message)
    turns.set(message.parentID, turn)
  }
  const sites = input.sites.filter((site) => site.kind === "static").toSorted((a, b) => b.path.length - a.path.length)
  for (const turn of turns.values()) {
    const final = turn.at(-1)!
    if (!final.time.completed || final.error || final.finish !== "stop") continue
    const text = input
      .parts(final.id)
      .findLast(
        (part) =>
          part.sessionID === input.sessionID &&
          part.messageID === final.id &&
          part.type === "text" &&
          !part.ignored &&
          part.text.trim(),
      )
    if (!text) continue
    const parent = input.messages.find(
      (message) => message.id === final.parentID && message.sessionID === input.sessionID && message.role === "user",
    )
    const diffs = parent?.role === "user" ? (parent.summary?.diffs ?? []) : []
    const files = [
      ...turn.flatMap((message) =>
        input
          .parts(message.id)
          .filter((part) => part.sessionID === input.sessionID && part.messageID === message.id)
          .flatMap(mutationPaths),
      ),
      ...diffs.flatMap((diff) => (diff.file ? [diff.file] : [])),
    ]
      .map((file) => siteFilePath(file, input.directory))
      .filter((file): file is string => !!file)
    for (const file of files) {
      if (!/\.(html?|css|[cm]?js|jsx|tsx?|svg|png|jpe?g|webp|gif|woff2?)$/i.test(file)) continue
      const site = sites.find((site) => !site.path || file.startsWith(`${site.path}/`))
      if (!site) continue
      // A dynamic source directory must not accidentally match a static ancestor.
      if (
        input.sites.some(
          (other) =>
            other.kind === "dynamic" &&
            (other.path ? file.startsWith(`${other.path}/`) : true) &&
            other.path.length > site.path.length,
        )
      )
        continue
      const status =
        input.state !== "ready" && input.state !== "unconfigured"
          ? input.state
          : input.available.some((current) => current.kind === "static" && current.path === site.path)
            ? input.state
            : "missing"
      results.set(site.path, {
        site,
        partID: text.id,
        available: status === "ready",
        status,
      })
    }
  }
  return [...results.values()]
}
