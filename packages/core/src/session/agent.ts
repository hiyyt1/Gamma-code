export * as SessionAgent from "./agent"

import { Context, Effect, Schema } from "effect"
import { eq } from "drizzle-orm"
import { AgentCatalog } from "../agent-market/catalog"
import { AgentMarketRequestTable } from "../agent-market/sql"
import { Database } from "../database/database"
import { MessageTable, SessionTable, SessionMessageTable } from "./sql"
import { SessionID } from "@opencode-ai/schema/session-id"

const Pin = Schema.Struct({
  profile: Schema.String,
  revisions: Schema.Record(Schema.String, Schema.String),
  bundle: Schema.optional(Schema.String),
  packages: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
export type Pin = typeof Pin.Type
export interface Binding {
  sessionID: string
  agent: string
  pin?: Pin
}
export const Current = Context.Reference<Binding | undefined>("@gamma/SessionAgent", { defaultValue: () => undefined })

export const name = (id: string) =>
  id === "gamma" || id === "gamma-guide" || id.startsWith("gamma-") ? id : `gamma-${id}`

export async function prepare(agent = "gamma", inherited?: Pin) {
  if (agent === "gamma" || agent === "gamma-guide") return { agent }
  const catalog = await AgentCatalog.profiles()
  const id = agent.replace(/^gamma-/, "")
  const profile = catalog.find((item) => item.id === (inherited?.profile ?? id))
  if (!profile) {
    if (agent.startsWith("gamma-")) throw new Error("agent_unavailable")
    return { agent }
  }
  if (!profile.available || (profile.id !== id && !profile.members.includes(id))) throw new Error("agent_unavailable")
  const revisions = Object.fromEntries(
    await Promise.all(
      [profile.id, ...profile.members].map(async (member) => {
        // The review-team leader is an existing native role, not a catalog asset.
        if (member === "code-reviewer" && !catalog.some((item) => item.id === member)) return [member, "builtin"]
        await AgentCatalog.config(member)
        const item = catalog.find((entry) => entry.id === member)!
        if (inherited && inherited.revisions[member] !== item.revision) throw new Error("agent_revision_changed")
        return [member, item.revision]
      }),
    ),
  )
  const bundle = profile.skillBundle ? (await AgentCatalog.bundle(profile.skillBundle)).revision : undefined
  if (inherited && inherited.bundle !== bundle) throw new Error("agent_revision_changed")
  const dependencies = [...new Set(profile.skills.map((skill) => skill.split(":")[0]))].filter(
    (id) => id !== profile.skillBundle,
  )
  const packages: Record<string, string> = {}
  if (dependencies.length) {
    const { SkillMarketService } = await import("../skill-market")
    const catalog = await SkillMarketService.readCatalogFile("legacy-catalog.json")
    for (const id of dependencies) {
      const item = catalog.find((item) => item.id === id)
      if (!item?.revision) throw new Error("missing_dependency")
      if (inherited?.packages && inherited.packages[id] !== item.revision) throw new Error("agent_revision_changed")
      packages[id] = item.revision
    }
  }
  return { agent: name(id), pin: { profile: profile.id, revisions, packages, ...(bundle ? { bundle } : {}) } }
}

export function pin(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata?.gammaAgent) return undefined
  return Schema.decodeUnknownSync(Pin)(metadata.gammaAgent)
}

// Old transcripts are never rewritten. Missing bindings are adopted only when
// the recorded agent or an unambiguous creation/history record identifies one.
export const load = Effect.fn("SessionAgent.load")(function* (sessionID: string) {
  const database = yield* Database.Service
  const id = SessionID.make(sessionID)
  return yield* database.db
    .transaction(() =>
      Effect.gen(function* () {
        const row = yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, id)).get()
        if (!row) return yield* Effect.die(new Error("session_not_found"))
        const messages = row.agent
          ? []
          : yield* database.db.select().from(MessageTable).where(eq(MessageTable.session_id, id)).all()
        const requests = pin(row.metadata)
          ? []
          : yield* database.db
              .select()
              .from(AgentMarketRequestTable)
              .where(eq(AgentMarketRequestTable.session_id, sessionID))
              .all()
        const projected = row.agent
          ? []
          : yield* database.db.select().from(SessionMessageTable).where(eq(SessionMessageTable.session_id, id)).all()
        const candidates = [
          ...new Set([
            ...messages.flatMap((message) => (message.data.role === "user" ? [message.data.agent] : [])),
            ...projected.flatMap((message) =>
              message.type === "assistant" && "agent" in message.data && typeof message.data.agent === "string"
                ? [message.data.agent]
                : [],
            ),
          ]),
        ]
        if (!row.agent && candidates.length > 1) return yield* Effect.die(new Error("session_agent_ambiguous"))
        const requested = row.agent ?? candidates[0] ?? (requests[0] ? name(requests[0].agent_id) : "gamma")
        if (!row.agent && !candidates.length && !requests.length && (messages.length || projected.length))
          return yield* Effect.die(new Error("session_agent_ambiguous"))
        const prepared =
          requested.startsWith("gamma-") && requested !== "gamma-guide"
            ? yield* Effect.promise(() => prepare(requested, pin(row.metadata)))
            : { agent: requested, pin: undefined }
        const original = requests.find((request) => name(request.agent_id) === prepared.agent)
        if (original && prepared.pin && original.revision !== prepared.pin.revisions[prepared.pin.profile])
          return yield* Effect.die(new Error("agent_revision_changed"))
        if (!row.agent || (prepared.pin && !pin(row.metadata)?.packages)) {
          yield* database.db
            .update(SessionTable)
            .set({
              agent: prepared.agent,
              metadata: { ...row.metadata, ...(prepared.pin ? { gammaAgent: prepared.pin } : {}) },
            })
            .where(eq(SessionTable.id, id))
            .run()
        }
        return { sessionID, ...prepared } satisfies Binding
      }),
    )
    .pipe(Effect.orDie)
})

export function assert(binding: Binding, requested?: string) {
  if (requested !== undefined && requested !== binding.agent) throw new Error("session_agent_locked")
}

export const selection = Effect.gen(function* () {
  const current = yield* Current
  return {
    agentId: current?.pin?.profile ?? null,
    revision: current?.pin ? current.pin.revisions[current.pin.profile] : null,
    version: 0,
  }
})

export function provide<A, E, R>(binding: Binding, effect: Effect.Effect<A, E, R>) {
  return effect.pipe(Effect.provideService(Current, binding))
}
