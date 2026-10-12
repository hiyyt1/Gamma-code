import { describe, expect, test } from "bun:test"
import { QueryClient, QueryObserver } from "@tanstack/solid-query"
import type { Session, SessionV2Info } from "@opencode-ai/sdk/v2/client"
import {
  applyHomeSessionEvent,
  appendHomeSessionEvent,
  createHomeSessionIndexCache,
  HOME_V2_SESSION_PAGE_LIMIT,
  loadHomeSessionIndex,
  homeSessionIndexSessions,
  homeSessionIndexRefresh,
  parseHomeSessionIndex,
  retainHomeSessions,
} from "./home-session-index"

const session = (input: {
  id: string
  directory?: string
  parentID?: string
  archived?: number
  updated?: number
}) => ({
  id: input.id,
  parentID: input.parentID,
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: input.updated ?? 1, archived: input.archived },
  title: input.id,
  location: { directory: input.directory ?? "/project" },
})

describe("Home V2 session index", () => {
  test("retains legacy sessions without an agent or profile metadata beside specialist sessions", () => {
    const result = parseHomeSessionIndex([
      session({ id: "legacy" }),
      { ...session({ id: "gamma" }), agent: "gamma" },
      { ...session({ id: "1c" }), agent: "gamma-1c-developer" },
      { ...session({ id: "bitrix" }), agent: "gamma-bitrix24-developer" },
    ])
    expect(result.map((item) => item.id).sort()).toEqual(["1c", "bitrix", "gamma", "legacy"])
    expect(result.find((item) => item.id === "legacy")?.agent).toBeUndefined()
  })

  test("Home observers share the SSE cache even beneath a different QueryProvider", () => {
    const serverClient = new QueryClient()
    const shellClient = new QueryClient()
    const cache = createHomeSessionIndexCache(serverClient, "server")
    const initial = { sessions: [] as Session[], eventSequence: 0 }
    serverClient.setQueryData(cache.indexKey, initial)
    shellClient.setQueryData(cache.indexKey, initial)

    expect(cache.queryClient).toBe(serverClient)
    const observer = new QueryObserver(cache.queryClient, {
      queryKey: cache.indexKey,
      enabled: false,
    })
    const updates: unknown[] = []
    const unsubscribe = observer.subscribe((result) => updates.push(result.data))
    const first = parseHomeSessionIndex([session({ id: "chat-a", updated: 2 })])[0]
    cache.apply({ type: "session.created", properties: { sessionID: first.id, info: first } })
    const titled = { ...first, title: "First message", time: { created: 1, updated: 3 } }
    cache.apply({ type: "session.updated", properties: { sessionID: first.id, info: titled } })
    const continued = { ...titled, time: { created: 1, updated: 4 } }
    cache.apply({ type: "session.updated", properties: { sessionID: first.id, info: continued } })
    expect(observer.getCurrentResult().data).toEqual({ sessions: [continued], eventSequence: 3 })

    const second = parseHomeSessionIndex([session({ id: "chat-b", updated: 5 })])[0]
    cache.apply({ type: "session.created", properties: { sessionID: second.id, info: second } })
    expect(observer.getCurrentResult().data).toEqual({ sessions: [continued, second], eventSequence: 4 })
    expect(updates).toHaveLength(4)
    expect(shellClient.getQueryData<typeof initial>(cache.indexKey)).toEqual(initial)
    unsubscribe()
    serverClient.clear()
    shellClient.clear()
  })

  test("loads the Home index with one global V2 request", async () => {
    const calls: unknown[] = []
    const result = await loadHomeSessionIndex(async (input) => {
      calls.push(input)
      return { data: { data: [session({ id: "root" })], cursor: {} } }
    })

    expect(result.sessions).toHaveLength(1)
    expect(calls).toEqual([{ limit: HOME_V2_SESSION_PAGE_LIMIT, order: "desc" }])
  })

  test("loads subsequent pages until the session index is complete", async () => {
    const calls: unknown[] = []
    const controller = new AbortController()
    const result = await loadHomeSessionIndex(
      async (input, options) => {
        calls.push({ input, signal: options.signal })
        if (!("cursor" in input)) {
          return {
            data: {
              data: Array.from({ length: HOME_V2_SESSION_PAGE_LIMIT }, (_, index) =>
                session({ id: `page-1-${index}` }),
              ),
              cursor: { next: "next-page" },
            },
          }
        }
        return { data: { data: [session({ id: "page-2" })], cursor: {} } }
      },
      0,
      controller.signal,
    )

    expect(result.sessions).toHaveLength(HOME_V2_SESSION_PAGE_LIMIT + 1)
    expect(calls).toEqual([
      { input: { limit: HOME_V2_SESSION_PAGE_LIMIT, order: "desc" }, signal: controller.signal },
      {
        input: { limit: HOME_V2_SESSION_PAGE_LIMIT, order: "desc", cursor: "next-page" },
        signal: controller.signal,
      },
    ])
  })

  test("maps visible roots to Home session summaries", () => {
    const activeNull = {
      ...session({ id: "active-null", updated: 20 }),
      time: { created: 1, updated: 20, archived: null },
    } as unknown as SessionV2Info
    const result = parseHomeSessionIndex([
      session({ id: "root", updated: 30 }),
      activeNull,
      session({ id: "child", parentID: "root", updated: 40 }),
      session({ id: "archived", archived: 50, updated: 50 }),
    ])

    expect(result).toEqual([
      expect.objectContaining({
        id: "root",
        slug: "root",
        version: "",
        directory: "/project",
        projectID: "project",
        title: "root",
        time: { created: 1, updated: 30 },
      }),
      expect.objectContaining({
        id: "active-null",
        time: { created: 1, updated: 20, archived: null },
      }),
    ])
  })

  test("preserves the per-directory Home retention limit", () => {
    const now = 10 * 60 * 60 * 1000
    const sessions = Array.from({ length: 80 }, (_, index) => ({
      ...parseHomeSessionIndex([session({ id: `session-${index}`, updated: index + 1 })])[0],
      directory: index % 2 === 0 ? "/one" : "/two",
    }))

    const retained = retainHomeSessions(sessions, 10, now)
    expect(retained.filter((item) => item.directory === "/one")).toHaveLength(10)
    expect(retained.filter((item) => item.directory === "/two")).toHaveLength(10)
  })

  test("replays session events over the loaded index", () => {
    const initial = parseHomeSessionIndex([session({ id: "old" })])
    const created = { ...initial[0], id: "new", slug: "new", title: "new", time: { created: 2, updated: 2 } }

    const afterCreate = applyHomeSessionEvent(initial, {
      type: "session.created",
      properties: { sessionID: created.id, info: created },
    })
    expect(
      applyHomeSessionEvent(afterCreate, {
        type: "session.deleted",
        properties: { sessionID: initial[0]!.id, info: initial[0]! },
      }),
    ).toEqual([created])
  })

  test("applies only events newer than the index baseline", () => {
    const initial = parseHomeSessionIndex([session({ id: "old" })])
    const stale = { ...initial[0], title: "stale" }
    const current = { ...initial[0], title: "current" }
    const first = appendHomeSessionEvent(undefined, {
      type: "session.updated",
      properties: { sessionID: stale.id, info: stale },
    })
    const events = appendHomeSessionEvent(first, {
      type: "session.updated",
      properties: { sessionID: current.id, info: current },
    })

    expect(homeSessionIndexSessions({ sessions: initial, eventSequence: 1 }, events)[0]?.title).toBe("current")
  })

  test("refetches after reconnect, disposal, and session moves", () => {
    expect(homeSessionIndexRefresh("server.connected", false)).toEqual({ connected: true, refetch: false })
    expect(homeSessionIndexRefresh("server.connected", true)).toEqual({ connected: true, refetch: true })
    expect(homeSessionIndexRefresh("global.disposed", true).refetch).toBe(true)
    expect(homeSessionIndexRefresh("session.next.moved", true).refetch).toBe(true)
  })

  test("removes a session from the loaded Home index", () => {
    const queryClient = new QueryClient()
    const cache = createHomeSessionIndexCache(queryClient, "server")
    const sessions = [
      { id: "a", time: { created: 1, updated: 1 } },
      { id: "b", time: { created: 1, updated: 1 } },
    ] as Session[]
    queryClient.setQueryData(cache.indexKey, { sessions, eventSequence: 0 })

    cache.remove("a")

    const index = queryClient.getQueryData<{ sessions: Session[] }>(cache.indexKey)
    expect(index?.sessions.map((item) => item.id)).toEqual(["b"])
  })

  test("keeps the session out of the Home list when the index is not mounted", () => {
    const queryClient = new QueryClient()
    const cache = createHomeSessionIndexCache(queryClient, "server")
    const sessions = [
      { id: "a", time: { created: 1, updated: 1 } },
      { id: "b", time: { created: 1, updated: 1 } },
    ] as Session[]

    cache.remove("a")

    expect(queryClient.getQueryData(cache.indexKey)).toBeUndefined()
    expect(cache.sessions({ sessions, eventSequence: 0 }, undefined).map((item) => item.id)).toEqual(["b"])
  })
})
