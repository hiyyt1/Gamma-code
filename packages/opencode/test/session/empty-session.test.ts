import { expect } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { Session } from "@/session/session"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { BackgroundJob } from "@/background/job"
import { Database } from "@opencode-ai/core/database/database"
import { MessageTable, PartTable } from "@opencode-ai/core/session/sql"
import { eq } from "drizzle-orm"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Session.node,
      Database.node,
      BackgroundJob.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
    ]),
    [
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      [
        InstanceBootstrap.node,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

function user(sessionID: SessionID): SessionV1.User {
  return {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
  }
}

it.instance("leaving an empty session deletes storage and emits the existing deletion event", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const events = yield* EventV2Bridge.Service
    const a = yield* sessions.create({})
    const b = yield* sessions.create({})
    const deleted: string[] = []
    const unsubscribe = yield* events.listen((event) => {
      if (event.type === Session.Event.Deleted.type)
        deleted.push((event.data as typeof Session.Event.Deleted.data.Type).sessionID)
      return Effect.void
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    expect(yield* sessions.discardEmpty(a.id)).toBe(true)
    expect(Exit.isFailure(yield* sessions.get(a.id).pipe(Effect.exit))).toBe(true)
    expect(deleted).toContain(a.id)
    expect((yield* sessions.get(b.id)).id).toBe(b.id)
    expect(yield* sessions.discardEmpty(a.id)).toBe(true)
    yield* sessions.remove(b.id)
  }),
)

it.instance("user messages permanently initialize a session, regardless of its title", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const a = yield* sessions.create({})
    const message = user(a.id)
    yield* sessions.updateMessage(message)
    expect(yield* sessions.discardEmpty(a.id)).toBe(false)
    yield* sessions.removeMessage({ sessionID: a.id, messageID: message.id })
    expect(yield* sessions.discardEmpty(a.id)).toBe(false)
    expect((yield* sessions.get(a.id)).id).toBe(a.id)
    yield* sessions.remove(a.id)
  }),
)

it.instance("consecutive new chats leave only the latest empty session", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const a = yield* sessions.create({})
    const b = yield* sessions.create({})
    expect(yield* sessions.discardEmpty(a.id)).toBe(true)
    const c = yield* sessions.create({})
    expect(yield* sessions.discardEmpty(b.id)).toBe(true)
    const ids = (yield* sessions.list()).map((session) => session.id)
    expect(ids).not.toContain(a.id)
    expect(ids).not.toContain(b.id)
    expect(ids).toContain(c.id)
    yield* sessions.remove(c.id)
  }),
)

it.instance("assistant and tool records do not initialize a session", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const database = yield* Database.Service
    const a = yield* sessions.create({ title: "Custom name" })
    const message: SessionV1.Assistant = {
      id: MessageID.ascending(),
      sessionID: a.id,
      role: "assistant",
      parentID: MessageID.ascending(),
      time: { created: Date.now() },
      modelID: ModelV2.ID.make("test"),
      providerID: ProviderV2.ID.make("test"),
      mode: "build",
      agent: "build",
      path: { cwd: a.directory, root: a.directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }
    yield* sessions.updateMessage(message)
    yield* sessions.updatePart({
      id: PartID.ascending(),
      sessionID: a.id,
      messageID: message.id,
      type: "tool",
      callID: "technical",
      tool: "test",
      state: { status: "pending", input: {}, raw: "" },
    })
    expect(yield* sessions.discardEmpty(a.id)).toBe(true)
    expect(Exit.isFailure(yield* sessions.get(a.id).pipe(Effect.exit))).toBe(true)
    expect(yield* database.db.select().from(MessageTable).where(eq(MessageTable.session_id, a.id))).toEqual([])
    expect(yield* database.db.select().from(PartTable).where(eq(PartTable.session_id, a.id))).toEqual([])
  }),
)

it.instance("cleanup waits for first user message persistence", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const a = yield* sessions.create({})
    const started = yield* Deferred.make<void>()
    const persist = yield* Deferred.make<void>()
    const admission = yield* sessions
      .withUserInput(
        a.id,
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(persist)
          yield* sessions.updateMessage(user(a.id))
        }),
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(started)
    const cleanup = yield* sessions.discardEmpty(a.id).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* Deferred.succeed(persist, undefined)
    yield* Fiber.join(admission)
    expect(yield* Fiber.join(cleanup)).toBe(false)
    expect((yield* sessions.get(a.id)).id).toBe(a.id)
    yield* sessions.remove(a.id)
  }),
)

it.instance("failed admission releases cleanup and leaves no empty session", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const a = yield* sessions.create({})
    yield* sessions.withUserInput(a.id, Effect.fail("send failed")).pipe(Effect.exit)
    expect(yield* sessions.discardEmpty(a.id)).toBe(true)
  }),
)

it.instance("cleanup cancels technical jobs before taking the database transaction", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const jobs = yield* BackgroundJob.Service
    const session = yield* sessions.create({})
    const started = yield* Deferred.make<void>()
    yield* jobs.start({
      id: session.id,
      type: "technical",
      run: Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined)
        return yield* Effect.never
      }).pipe(Effect.ensuring(sessions.touch(session.id))),
    })
    yield* Deferred.await(started)
    expect(yield* sessions.discardEmpty(session.id)).toBe(true)
    expect((yield* jobs.get(session.id))?.status).toBe("cancelled")
  }),
)
