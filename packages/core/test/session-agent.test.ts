import { expect } from "bun:test"
import { MessageID } from "../src/v1/session"
import path from "node:path"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { SessionV2 } from "../src/session"
import { SessionAgent } from "../src/session/agent"
import { SessionProjector } from "../src/session/projector"
import { SessionExecution } from "../src/session/execution"
import { SessionTable, MessageTable } from "../src/session/sql"
import { AgentV2 } from "../src/agent"
import { Location } from "../src/location"
import { AbsolutePath } from "../src/schema"
import { it } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

it.live("fixed agent and revision survive fresh service layers without changing history", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    const layer = () =>
      AppNodeBuilder.build(LayerNode.group([SessionV2.node, SessionProjector.node, Database.node]), [
        [Database.node, Database.layerFromPath(path.join(tmp.path, "state.db"))],
        [SessionExecution.node, SessionExecution.noopLayer],
      ]).pipe(Layer.fresh)
    const first = yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const session = yield* sessions.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }),
        agent: AgentV2.ID.make("gamma-1c-developer"),
      })
      return { session, binding: yield* SessionAgent.load(session.id) }
    }).pipe(Effect.provide(layer()), Effect.scoped)
    yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      expect(yield* sessions.get(first.session.id)).toEqual(first.session)
      expect(yield* SessionAgent.load(first.session.id)).toEqual(first.binding)
      expect(first.binding.pin?.profile).toBe("1c-developer")
      expect(
        (yield* sessions.switchAgent({ sessionID: first.session.id, agent: "gamma" }).pipe(Effect.exit))._tag,
      ).toBe("Failure")
      expect(yield* sessions.messages({ sessionID: first.session.id })).toEqual([])
      const database = yield* Database.Service
      yield* database.db
        .update(SessionTable)
        .set({
          metadata: {
            gammaAgent: {
              ...first.binding.pin!,
              revisions: { ...first.binding.pin!.revisions, "1c-developer": "retired-revision" },
            },
          },
        })
        .where(eq(SessionTable.id, first.session.id))
        .run()
        .pipe(Effect.orDie)
      expect((yield* SessionAgent.load(first.session.id).pipe(Effect.exit))._tag).toBe("Failure")
      expect((yield* sessions.get(first.session.id)).agent).toBe(AgentV2.ID.make("gamma-1c-developer"))
      expect(yield* sessions.messages({ sessionID: first.session.id })).toEqual([])
    }).pipe(Effect.provide(layer()), Effect.scoped)
  }),
)

it.live("ambiguous legacy history is retained and is not assigned a guessed agent", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const database = yield* Database.Service
      const session = yield* sessions.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }),
      })
      yield* database.db
        .update(SessionTable)
        .set({ agent: null })
        .where(eq(SessionTable.id, session.id))
        .run()
        .pipe(Effect.orDie)
      // Historical JSON comes from the legacy storage format; no model is run.
      yield* database.db
        .run(
          `INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES
      ('msg_first', '${session.id}', 1, 1, '{"role":"user","agent":"build","time":{"created":1},"model":{"providerID":"test","modelID":"test"}}'),
      ('msg_second', '${session.id}', 2, 2, '{"role":"user","agent":"plan","time":{"created":2},"model":{"providerID":"test","modelID":"test"}}')`,
        )
        .pipe(Effect.orDie)
      const before = yield* database.db.select().from(MessageTable).all().pipe(Effect.orDie)
      expect((yield* SessionAgent.load(session.id).pipe(Effect.exit))._tag).toBe("Failure")
      expect(yield* database.db.select().from(MessageTable).all().pipe(Effect.orDie)).toEqual(before)
      expect(
        (yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, session.id)).get().pipe(Effect.orDie))
          ?.agent,
      ).toBeNull()
      expect((yield* sessions.get(session.id)).agent).toBeUndefined()
      const known = yield* sessions.create({ location: Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }) })
      yield* database.db
        .update(SessionTable)
        .set({ agent: null })
        .where(eq(SessionTable.id, known.id))
        .run()
        .pipe(Effect.orDie)
      yield* database.db
        .insert(MessageTable)
        .values({ ...before[0]!, id: MessageID.make("msg_known"), session_id: known.id })
        .run()
        .pipe(Effect.orDie)
      expect((yield* sessions.get(known.id)).agent).toBe(AgentV2.ID.make("build"))
      expect((yield* SessionAgent.load(known.id)).agent).toBe("build")
      expect(
        yield* database.db
          .select()
          .from(MessageTable)
          .where(eq(MessageTable.session_id, session.id))
          .all()
          .pipe(Effect.orDie),
      ).toEqual(before)
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(LayerNode.group([SessionV2.node, SessionProjector.node, Database.node]), [
          [Database.node, Database.layerFromPath(path.join(tmp.path, "state.db"))],
          [SessionExecution.node, SessionExecution.noopLayer],
        ]),
      ),
      Effect.scoped,
    )
  }),
)
