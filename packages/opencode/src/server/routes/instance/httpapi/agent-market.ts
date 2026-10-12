import { SessionAgent } from "@opencode-ai/core/session/agent"
import path from "node:path"
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { AgentMarket } from "@opencode-ai/schema/agent-market"
import { AgentMarketService } from "@opencode-ai/core/agent-market"
import { ProductProjects } from "@/server/product-projects"
import { InstanceStore } from "@/project/instance-store"
import { InstanceRef } from "@/effect/instance-ref"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Authorization } from "./middleware/authorization"
import { MCP } from "@/mcp"
import { BslMcp } from "@/mcp/bsl"
import { PresentationMcp } from "@/presentation/mcp"
import { Global } from "@opencode-ai/core/global"
import { mkdir } from "node:fs/promises"
import { guidePermissions } from "@opencode-ai/core/gamma/system"

class MarketError extends Schema.TaggedErrorClass<MarketError>()(
  "AgentMarketHttpError",
  { code: Schema.String },
  { httpApiStatus: 409 },
) {}
export const Api = HttpApi.make("agentMarket").add(
  HttpApiGroup.make("agentMarket")
    .add(HttpApiEndpoint.post("help", "/product/help/session", { success: Session.Info, error: MarketError }))
    .add(
      HttpApiEndpoint.get("catalog", "/product/agent-market/agents", {
        success: Schema.Array(AgentMarket.Profile),
        error: MarketError,
      }),
    )
    .add(
      HttpApiEndpoint.get("detail", "/product/agent-market/agents/:id", {
        params: { id: Schema.String },
        success: AgentMarket.Profile,
        error: MarketError,
      }),
    )
    .add(
      HttpApiEndpoint.get("selection", "/product/projects/:project/active-agent", {
        params: { project: Schema.String },
        success: AgentMarket.Selection,
        error: MarketError,
      }),
    )
    .add(
      HttpApiEndpoint.post("check", "/product/projects/:project/agent-check", {
        payload: Schema.Struct({ agentId: Schema.String }),
        params: { project: Schema.String },
        success: AgentMarket.Runtime,
        error: MarketError,
      }),
    )
    .add(
      HttpApiEndpoint.post("apply", "/product/projects/:project/sessions", {
        params: { project: Schema.String },
        payload: AgentMarket.Apply,
        success: AgentMarket.Applied,
        error: MarketError,
      }),
    )
    .middleware(Authorization),
)
const project = (name: string) =>
  Effect.tryPromise({
    try: async () => {
      const directory = path.join(ProductProjects.root(), ProductProjects.identifier(name))
      await ProductProjects.withProject(directory, async () => undefined)
      return directory
    },
    catch: () => new MarketError({ code: "project_access_denied" }),
  })
const failure = (error: AgentMarketService.Error) => new MarketError({ code: error.code })
export const handlers = HttpApiBuilder.group(Api, "agentMarket", (group) =>
  Effect.gen(function* () {
    const market = yield* AgentMarketService.Service
    const instances = yield* InstanceStore.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const mcp = yield* MCP.Service
    return group
      .handle("help", () =>
        Effect.gen(function* () {
          const directory = path.join(Global.Path.data, "gamma-help")
          yield* Effect.tryPromise({
            try: () => mkdir(directory, { recursive: true, mode: 0o700 }),
            catch: () => new MarketError({ code: "help_unavailable" }),
          })
          const instance = yield* instances.load({ directory })
          return yield* sessions
            .create({
              agent: "gamma-guide",
              title: "Gamma Guide",
              permission: Permission.intersect(Permission.fromConfig(guidePermissions)),
            })
            .pipe(Effect.provideService(InstanceRef, instance))
        }),
      )
      .handle("catalog", () =>
        market.catalog().pipe(
          Effect.map((profiles) => profiles.filter((profile) => !profile.hidden)),
          Effect.mapError(failure),
        ),
      )
      .handle("detail", (ctx) =>
        Effect.gen(function* () {
          const profile = (yield* market.catalog().pipe(Effect.mapError(failure))).find(
            (item) => item.id === ctx.params.id,
          )
          if (!profile) return yield* new MarketError({ code: "agent_not_found" })
          return profile
        }),
      )
      .handle("selection", (ctx) =>
        Effect.gen(function* () {
          return yield* market.selection(yield* project(ctx.params.project)).pipe(Effect.mapError(failure))
        }),
      )
      .handle("check", (ctx) =>
        Effect.gen(function* () {
          const directory = yield* project(ctx.params.project)
          const instance = yield* instances.load({ directory })
          const prepared = yield* Effect.promise(() => SessionAgent.prepare(SessionAgent.name(ctx.payload.agentId)))
          return yield* market
            .withIdle(
              directory,
              Effect.gen(function* () {
                const statuses = yield* mcp.refreshProfile()
                const presentation = statuses[PresentationMcp.name]
                if (presentation)
                  return {
                    status: presentation.status === "connected" ? ("ready" as const) : ("failed" as const),
                    sourceTools: !!Bun.which("python3"),
                    tools:
                      presentation.status === "connected"
                        ? Object.keys(yield* mcp.tools()).filter((name) => name.startsWith(`${PresentationMcp.name}_`))
                        : [],
                    error: presentation.status === "failed" ? presentation.error : undefined,
                  }
                const status = statuses[BslMcp.name]
                if (!status) return { status: "disabled" as const, tools: [], sourceTools: false }
                const sources = yield* Effect.promise(() => BslMcp.sourceTools())
                if (status.status !== "connected")
                  return {
                    ...sources,
                    status: "failed" as const,
                    tools: [],
                    error: status.status === "failed" ? status.error : status.status,
                  }
                return {
                  ...sources,
                  status: "ready" as const,
                  tools: Object.keys(yield* mcp.tools()).filter((name) => name.startsWith(`${BslMcp.name}_`)),
                }
              }),
            )
            .pipe(
              Effect.provideService(InstanceRef, instance),
              Effect.provideService(SessionAgent.Current, { sessionID: "", ...prepared }),
              Effect.mapError(failure),
            )
        }),
      )
      .handle("apply", (ctx) =>
        Effect.gen(function* () {
          const directory = yield* project(ctx.params.project)
          const instance = yield* instances.load({ directory })
          return yield* market
            .apply(
              directory,
              ctx.payload,
              sessions
                .create({ agent: SessionAgent.name(ctx.payload.agentId) })
                .pipe(Effect.map((session) => session.id)),
              (skills) =>
                Effect.gen(function* () {
                  const base = yield* agents.get("build")
                  return skills.every((skill) => Permission.evaluate("skill", skill, base.permission).action !== "deny")
                }),
            )
            .pipe(Effect.provideService(InstanceRef, instance), Effect.mapError(failure))
        }),
      )
  }),
)
export const agentMarketRoutes = HttpApiBuilder.layer(Api).pipe(Layer.provide(handlers))
