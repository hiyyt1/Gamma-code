export * as AgentMarketService from "./agent-market"

import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema, Scope } from "effect"
import { AgentMarket } from "@opencode-ai/schema/agent-market"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { KeyedMutex } from "./effect/keyed-mutex"
import { AgentMarketSelectionTable, AgentMarketRequestTable } from "./agent-market/sql"
import { AgentCatalog } from "./agent-market/catalog"
import { SkillMarketService } from "./skill-market"
import { systemProfiles } from "./gamma/system"

export class Error extends Schema.TaggedErrorClass<Error>()("AgentMarketError", { code: Schema.String }) {}

export interface Interface {
  readonly lease: (directory: string) => Effect.Effect<void, never, Scope.Scope>
  readonly selection: (directory: string) => Effect.Effect<AgentMarket.Selection, Error>
  readonly catalog: () => Effect.Effect<readonly AgentMarket.Profile[], Error>
  readonly apply: <E, R>(
    directory: string,
    input: AgentMarket.Apply,
    create: Effect.Effect<string, E, R>,
    permitted: (skills: readonly string[]) => Effect.Effect<boolean, E, R>,
  ) => Effect.Effect<AgentMarket.Applied, Error | E, R>
  readonly withRun: <A, E, R>(directory: string, run: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly withIdle: <A, E, R>(directory: string, run: Effect.Effect<A, E, R>) => Effect.Effect<A, E | Error, R>
}
export class Service extends Context.Service<Service, Interface>()("@gamma/AgentMarket") {}
const failure = () => new Error({ code: "storage_failed" })
const operation = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => new Error({ code: "agent_unavailable" }) })

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const skills = yield* SkillMarketService.Service
    const locks = KeyedMutex.makeUnsafe<string>()
    const running = new Map<string, number>()
    const selection = Effect.fn("AgentMarket.selection")(function* (directory: string) {
      const row = yield* database.db
        .select()
        .from(AgentMarketSelectionTable)
        .where(eq(AgentMarketSelectionTable.project_directory, directory))
        .get()
        .pipe(Effect.mapError(failure))
      return {
        agentId: row?.agent_id === "gamma" ? null : (row?.agent_id ?? null),
        version: row?.version ?? 0,
        revision: row?.agent_id === "gamma" ? null : (row?.revision ?? null),
      }
    })
    const catalog = () =>
      operation(async () =>
        Promise.all(
          (await AgentCatalog.profiles()).map(async (profile) => ({
            ...profile,
            available:
              profile.available &&
              (await AgentCatalog.config(profile.id).then(
                () => true,
                () => false,
              )),
          })),
        ).then((profiles) => [...systemProfiles, ...profiles]),
      )
    const withIdle: Interface["withIdle"] = (directory, run) =>
      locks.withLock(directory)(
        Effect.gen(function* () {
          if ((running.get(directory) ?? 0) > 0) return yield* new Error({ code: "project_busy" })
          return yield* run
        }),
      )
    const lease = (directory: string) =>
      Effect.acquireRelease(
        locks.withLock(directory)(
          Effect.sync(() => {
            running.set(directory, (running.get(directory) ?? 0) + 1)
          }),
        ),
        () =>
          Effect.sync(() => {
            const count = (running.get(directory) ?? 1) - 1
            if (count) running.set(directory, count)
            if (!count) running.delete(directory)
          }),
      )
    const withRun: Interface["withRun"] = (directory, run) =>
      Effect.acquireUseRelease(
        locks.withLock(directory)(Effect.sync(() => running.set(directory, (running.get(directory) ?? 0) + 1))),
        () => run,
        () =>
          Effect.sync(() => {
            const count = (running.get(directory) ?? 1) - 1
            if (count) running.set(directory, count)
            if (!count) running.delete(directory)
          }),
      )
    const apply: Interface["apply"] = (directory, input, create, permitted) =>
      locks.withLock(`${directory}:${input.requestId}`)(
        database.db
          .transaction(() =>
            Effect.gen(function* () {
              const previous = yield* database.db
                .select()
                .from(AgentMarketRequestTable)
                .where(
                  and(
                    eq(AgentMarketRequestTable.project_directory, directory),
                    eq(AgentMarketRequestTable.request_id, input.requestId),
                  ),
                )
                .get()
                .pipe(Effect.mapError(failure))
              if (previous) {
                if (previous.agent_id !== input.agentId) return yield* new Error({ code: "request_conflict" })
                return {
                  selection: {
                    agentId: previous.agent_id === "gamma" ? null : previous.agent_id,
                    version: previous.version,
                    revision: previous.agent_id === "gamma" ? null : previous.revision,
                  },
                  sessionId: previous.session_id,
                }
              }
              if (input.agentId === "gamma-guide") return yield* new Error({ code: "guide_requires_help_session" })
              const profile = (yield* catalog()).find((item) => item.id === input.agentId)
              if (!profile?.available || profile.hidden) return yield* new Error({ code: "agent_unavailable" })
              if (!(yield* permitted(profile.skills))) return yield* new Error({ code: "skills_forbidden" })
              const bundled = profile.skillBundle
                ? yield* operation(() => AgentCatalog.bundle(profile.skillBundle!))
                : undefined
              const selected = yield* skills
                .selection(directory)
                .pipe(Effect.mapError(() => new Error({ code: "skills_unavailable" })))
              const packages = [...new Set(profile.skills.map((name) => name.split(":")[0]))].filter(
                (id) => id !== bundled?.id,
              )
              if (!input.connectSkills && packages.some((id) => !selected.enabled.includes(id)))
                return yield* new Error({ code: "skills_required" })
              const legacy = yield* skills
                .resolve(packages, "v1")
                .pipe(Effect.mapError(() => new Error({ code: "skills_unavailable" })))
              const sources = [...legacy, ...(bundled ? [bundled] : [])]
              if (
                profile.skills.some(
                  (name) =>
                    !sources.some((source) => source.skills.some((skill) => `${source.id}:${skill.name}` === name)),
                )
              )
                return yield* new Error({ code: "skills_unavailable" })
              const next = {
                agentId: profile.id,
                version: 0,
                revision: profile.revision,
              }
              const sessionId = yield* create
              yield* database.db
                .insert(AgentMarketRequestTable)
                .values({
                  project_directory: directory,
                  request_id: input.requestId,
                  agent_id: profile.id,
                  version: next.version,
                  revision: profile.revision,
                  session_id: sessionId,
                })
                .run()
                .pipe(Effect.mapError(failure))
              return {
                selection: profile.id === "gamma" ? { agentId: null, version: next.version, revision: null } : next,
                sessionId,
              }
            }),
          )
          .pipe(Effect.catchTag("SqlError", () => Effect.fail(failure()))),
      )
    return Service.of({ selection, catalog, apply, withRun, withIdle, lease })
  }),
)
export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, SkillMarketService.node] })
