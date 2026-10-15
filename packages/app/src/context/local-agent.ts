export function hasCustomAgent(items: Array<{ native?: boolean }>) {
  return items.some((item) => item.native === false)
}

export function resolveAgent<T extends { name: string }>(items: T[], name?: string) {
  return (
    items.find((item) => item.name === name) ??
    items.find((item) => item.name === "gamma") ??
    items.find((item) => item.name === "build") ??
    items[0]
  )
}

// Session identity wins over browser preferences. Legacy sessions did not persist
// an agent on the session itself; recover it from their latest user/provider turn.
export function sessionAgentName(
  session: { agent?: string } | undefined,
  messages: readonly { agent?: string; role: string }[],
  saved?: string,
) {
  return session?.agent || messages.findLast((message) => message.agent)?.agent || saved || "gamma"
}
