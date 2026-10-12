import { expect, test } from "bun:test"
import { createEmptySessionLifecycle, withSessionInput } from "./empty-session"

const a = { sessionID: "empty-a", server: "local" }
const b = { sessionID: "empty-b", server: "local" }

test("session switch and leaving a project discard the previous session", async () => {
  const discarded: string[] = []
  const lifecycle = createEmptySessionLifecycle({
    discard: async (session) => {
      discarded.push(session.sessionID)
    },
  })
  await lifecycle.visit(a)
  expect(discarded).toEqual([])
  await lifecycle.visit(b)
  expect(discarded).toEqual([a.sessionID])
  await lifecycle.visit()
  expect(discarded).toEqual([a.sessionID, b.sessionID])
})

test("repeated observations do not discard the current chat", async () => {
  const discarded: string[] = []
  const lifecycle = createEmptySessionLifecycle({
    discard: async (session) => {
      discarded.push(session.sessionID)
    },
  })
  await lifecycle.visit(a)
  await lifecycle.visit({ ...a })
  expect(discarded).toEqual([])
  await lifecycle.visit(b)
  await lifecycle.visit({ sessionID: "empty-c", server: "local" })
  expect(discarded).toEqual([a.sessionID, b.sessionID])
})

test("navigation waits for submission, including preparation before HTTP", async () => {
  const ready = Promise.withResolvers<void>()
  const observed: string[] = []
  const lifecycle = createEmptySessionLifecycle({
    discard: async () => {
      observed.push("cleanup")
    },
  })
  await lifecycle.visit(a)
  const sending = withSessionInput(a.sessionID, async () => {
    await ready.promise
    observed.push("persisted")
  })
  const leaving = lifecycle.visit(b)
  await Promise.resolve()
  expect(observed).toEqual([])
  ready.resolve()
  await sending
  await leaving
  expect(observed).toEqual(["persisted", "cleanup"])
})

test("returning while a send is pending cancels cleanup of the current session", async () => {
  const ready = Promise.withResolvers<void>()
  const discarded: string[] = []
  const lifecycle = createEmptySessionLifecycle({
    discard: async (session) => {
      discarded.push(session.sessionID)
    },
  })
  await lifecycle.visit(a)
  const sending = withSessionInput(a.sessionID, () => ready.promise)
  const leaving = lifecycle.visit(b)
  await lifecycle.visit(a)
  ready.resolve()
  await sending
  await leaving
  expect(discarded).toEqual([b.sessionID])
})

test("failed submission releases pending cleanup", async () => {
  const ready = Promise.withResolvers<void>()
  const discarded: string[] = []
  const lifecycle = createEmptySessionLifecycle({
    discard: async (session) => {
      discarded.push(session.sessionID)
    },
  })
  await lifecycle.visit(a)
  const sending = withSessionInput(a.sessionID, () => ready.promise).catch(() => undefined)
  const leaving = lifecycle.visit()
  ready.reject(new Error("offline"))
  await sending
  await leaving
  expect(discarded).toEqual([a.sessionID])
})
