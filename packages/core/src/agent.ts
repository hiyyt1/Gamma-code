import path from "node:path"
import { SessionAgent } from "./session/agent"
import { AgentCatalog } from "./agent-market/catalog"
import { ModelV2 } from "./model"
export * as AgentV2 from "./agent"

import { makeLocationNode } from "./effect/app-node"
import { Array, Context, Effect, Layer, Types } from "effect"
import { Agent } from "@opencode-ai/schema/agent"
import { State } from "./state"
import { guidePrompt, guideSkills } from "./gamma/system"
import { Wildcard } from "./util/wildcard"

export const ID = Agent.ID
export type ID = typeof ID.Type
export const defaultID = ID.make("gamma")

export const Color = Agent.Color

export const Info = Agent.Info
export type Info = Agent.Info

export interface Selection {
  readonly id: ID
  readonly info: Info | undefined
}

type Data = {
  agents: Map<ID, Types.DeepMutable<Info>>
  default?: ID
}

export type Draft = {
  list: () => readonly Info[]
  get: (id: ID) => Info | undefined
  default: (id: ID | undefined) => void
  update: (id: ID, fn: (agent: Types.DeepMutable<Info>) => void) => void
  remove: (id: ID) => void
}

export interface Interface extends State.Transformable<Draft> {
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  readonly default: () => Effect.Effect<Info | undefined>
  readonly resolve: (id?: ID | string) => Effect.Effect<Info | undefined>
  readonly select: (id?: ID | string) => Effect.Effect<Selection>
  readonly all: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Agent") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = State.create<Data, Draft>({
      initial: () => ({ agents: new Map() }),
      draft: (draft) => ({
        list: () => Array.fromIterable(draft.agents.values()) as Info[],
        get: (id) => draft.agents.get(id),
        default: (id) => {
          draft.default = id
        },
        update: (id, fn) => {
          const current = draft.agents.get(id) ?? (Info.empty(id) as Types.DeepMutable<Info>)
          if (!draft.agents.has(id)) draft.agents.set(id, current)
          fn(current)
          current.id = id
        },
        remove: (id) => {
          draft.agents.delete(id)
        },
      }),
    })
    const safe = (agent: Info | undefined): Info | undefined => {
      if (agent?.id !== "gamma-guide") return agent
      const allowed = [
        { action: "question", resource: "*" },
        { action: "gamma_help", resource: "*" },
        ...guideSkills.map((skill) => ({ action: "skill", resource: skill.name })),
      ]
      return {
        ...agent,
        mode: "primary",
        system: guidePrompt,
        permissions: [
          { action: "*", resource: "*", effect: "deny" },
          ...allowed.map((rule) => ({
            ...rule,
            effect:
              agent.permissions.findLast(
                (item) => Wildcard.match(rule.action, item.action) && Wildcard.match(rule.resource, item.resource),
              )?.effect ?? "deny",
          })),
        ],
      }
    }
    const selectable = (agent: Info | undefined) =>
      agent && agent.mode !== "subagent" && !agent.hidden ? agent : undefined
    const selectedDefault = () => {
      const data = state.get()
      const configured = data.default ? selectable(data.agents.get(data.default)) : undefined
      if (configured) return configured
      const gamma = selectable(data.agents.get(defaultID))
      if (gamma) return gamma
      const build = selectable(data.agents.get(ID.make("build")))
      if (build) return build
      for (const agent of data.agents.values()) {
        if (agent.id === "gamma-guide") continue
        const fallback = selectable(agent)
        if (fallback) return fallback
      }
    }

    const lookup = Effect.fn("AgentV2.lookup")(function* (id: ID) {
      if (!id.startsWith("gamma-") || id === "gamma-guide") return safe(state.get().agents.get(id))
      const binding = yield* SessionAgent.Current
      const prepared = yield* Effect.promise(() => SessionAgent.prepare(id, binding?.pin))
      const cfg = yield* Effect.promise(() => AgentCatalog.config(id.slice(6)))
      const catalog = yield* Effect.promise(() => AgentCatalog.profiles())
      const profile = catalog.find((item) => item.id === prepared.pin?.profile)!
      const bundle = profile.skillBundle
        ? yield* Effect.promise(() => AgentCatalog.bundle(profile.skillBundle!))
        : undefined
      const base = state.get().agents.get(ID.make("build")) ?? Info.empty(id)
      const model = cfg.model ? ModelV2.parse(cfg.model) : undefined
      const policy = Object.entries(cfg.permission ?? {}).flatMap(([action, values]) =>
        typeof values === "string"
          ? [{ action, resource: "*", effect: values }]
          : Object.entries(values).map(([resource, effect]) => ({ action, resource, effect })),
      )
      const members =
        (profile.type === "team" || profile.leader) && profile.id === id.slice(6)
          ? profile.members.filter(
              (member) =>
                member !==
                (profile.leader ??
                  (profile.id === "web-team"
                    ? "project-architect"
                    : profile.id === "ai-team"
                      ? "ai-developer"
                      : "code-reviewer")),
            )
          : []
      return {
        ...base,
        id,
        system: cfg.prompt,
        description: cfg.description,
        mode: profile.id === id.slice(6) ? ("primary" as const) : ("subagent" as const),
        hidden: false,
        steps: cfg.steps,
        model: model ? { id: model.modelID, providerID: model.providerID } : base.model,
        request: {
          ...base.request,
          body: {
            ...base.request.body,
            ...cfg.options,
            ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
            ...(cfg.top_p !== undefined ? { top_p: cfg.top_p } : {}),
          },
        },
        permissions: [
          { action: "__gamma_boundary__", resource: "*", effect: "deny" as const },
          ...base.permissions,
          ...(bundle &&
          base.permissions.findLast(
            (rule) =>
              Wildcard.match("external_directory", rule.action) &&
              Wildcard.match(path.join(bundle.directory, "*"), rule.resource),
          )?.effect !== "deny"
            ? [{ action: "external_directory", resource: path.join(bundle.directory, "*"), effect: "allow" as const }]
            : []),
          { action: "__gamma_boundary__", resource: "*", effect: "deny" as const },
          { action: "*", resource: "*", effect: "allow" as const },
          ...policy,
          { action: "task", resource: "*", effect: "deny" as const },
          ...members.map((member) => ({
            action: "task",
            resource: `gamma-${member}`,
            effect:
              typeof cfg.permission?.task === "object"
                ? (cfg.permission.task[`gamma-${member}`] ?? cfg.permission.task["*"] ?? "ask")
                : (cfg.permission?.task ?? "ask"),
          })),
          ...(bundle
            ? [
                { action: "external_directory", resource: "*", effect: "deny" as const },
                { action: "external_directory", resource: path.join(bundle.directory, "*"), effect: "allow" as const },
                { action: "edit", resource: path.join(bundle.directory, "*"), effect: "deny" as const },
              ]
            : []),
          { action: "__gamma_boundary__", resource: "*", effect: "deny" as const },
        ],
      } satisfies Info
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      get: Effect.fn("AgentV2.get")(function* (id) {
        return yield* lookup(id)
      }),
      default: Effect.fn("AgentV2.default")(function* () {
        return safe(selectedDefault())
      }),
      resolve: Effect.fn("AgentV2.resolve")(function* (id) {
        if (id !== undefined) return yield* lookup(ID.make(id))
        return safe(selectedDefault())
      }),
      select: Effect.fn("AgentV2.select")(function* (id) {
        if (id !== undefined) {
          const selected = ID.make(id)
          return { id: selected, info: yield* lookup(selected) }
        }
        const info = safe(selectedDefault())
        return { id: info?.id ?? defaultID, info }
      }),
      all: Effect.fn("AgentV2.all")(function* () {
        const native = Array.fromIterable(state.get().agents.values()).map((agent) => safe(agent)!)
        if (!state.get().agents.has(defaultID)) return native
        const binding = yield* SessionAgent.Current
        if (binding && !binding.pin) return native
        const catalog = yield* Effect.promise(() => AgentCatalog.profiles())
        const profile = catalog.find((item) => item.id === binding?.pin?.profile)
        const selected = catalog.filter(
          (item) =>
            item.available &&
            !item.source.startsWith("builtin:") &&
            (!profile || item.id === profile.id || profile.members.includes(item.id)),
        )
        const profiles = yield* Effect.forEach(selected, (item) =>
          lookup(ID.make(`gamma-${item.id}`)).pipe(
            Effect.map((agent) => ({ ...agent!, ...(item.hidden ? { mode: "subagent" as const, hidden: true } : {}) })),
          ),
        )
        return [...native, ...profiles]
      }),
    })
  }),
)

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [] })
