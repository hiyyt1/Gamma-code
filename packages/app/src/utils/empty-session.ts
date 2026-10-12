const sending = new Map<string, Set<Promise<void>>>()

// Register before attachment encoding, worktree readiness or the HTTP request.
// A prompt_async response only acknowledges dispatch; the backend also protects
// the interval before the first user message is persisted.
export async function withSessionInput<T>(sessionID: string, run: () => Promise<T>): Promise<T> {
  const pending = Promise.withResolvers<void>()
  const entries = sending.get(sessionID) ?? new Set<Promise<void>>()
  entries.add(pending.promise)
  sending.set(sessionID, entries)
  try {
    return await run()
  } finally {
    entries.delete(pending.promise)
    if (!entries.size) sending.delete(sessionID)
    pending.resolve()
  }
}

export function createEmptySessionLifecycle<T extends { sessionID: string; server: string }>(input: {
  discard: (session: T) => Promise<void>
}) {
  let current: T | undefined
  const same = (a: T | undefined, b: T | undefined) => a?.sessionID === b?.sessionID && a?.server === b?.server
  const discard = async (session: T) => {
    while (sending.has(session.sessionID)) await Promise.all(sending.get(session.sessionID) ?? [])
    if (same(current, session)) return
    await input.discard(session)
  }
  return {
    visit(next?: T) {
      const previous = current
      current = next
      if (!previous || same(previous, next)) return Promise.resolve()
      return discard(previous)
    },
  }
}
