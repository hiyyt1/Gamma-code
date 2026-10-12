import { SessionAgent } from "@opencode-ai/core/session/agent"
import path from "node:path"
import { realpath } from "node:fs/promises"
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { HttpServerResponse } from "effect/unstable/http"
import { AgentMarketService } from "@opencode-ai/core/agent-market"
import { Bitrix24 } from "@/bitrix24/portal"
import { BitrixMcp } from "@/bitrix24/mcp"
import { ProductProjects } from "@/server/product-projects"
import { ServerAuth } from "@/server/auth"
import { InstanceStore } from "@/project/instance-store"
import { InstanceRef } from "@/effect/instance-ref"
import { MCP } from "@/mcp"
import { Authorization } from "./middleware/authorization"

class ConnectionError extends Schema.TaggedErrorClass<ConnectionError>()(
  "Bitrix24ConnectionError",
  { code: Schema.String },
  { httpApiStatus: 409 },
) {}
export const Api = HttpApi.make("bitrix24").add(
  HttpApiGroup.make("bitrix24")
    .add(
      HttpApiEndpoint.get("status", "/product/projects/:project/bitrix24", {
        params: { project: Schema.String },
        success: Schema.Json,
        error: ConnectionError,
      }),
    )
    // Raw body intentionally has no auto-decoded webhook schema: decoder errors
    // must never interpolate a submitted secret into diagnostics or a response.
    .add(
      HttpApiEndpoint.post("connect", "/product/projects/:project/bitrix24/connect", {
        params: { project: Schema.String },
        success: Schema.Json,
        error: ConnectionError,
      }),
    )
    .add(
      HttpApiEndpoint.post("disconnect", "/product/projects/:project/bitrix24/disconnect", {
        params: { project: Schema.String },
        success: Schema.Json,
        error: ConnectionError,
      }),
    )
    .add(
      HttpApiEndpoint.post("check", "/product/projects/:project/bitrix24/check", {
        params: { project: Schema.String },
        success: Schema.Json,
        error: ConnectionError,
      }),
    )
    .add(
      HttpApiEndpoint.post("approve", "/product/projects/:project/bitrix24/plans/:plan", {
        params: { project: Schema.String, plan: Schema.String },
        success: Schema.Json,
        error: ConnectionError,
      }),
    )
    .middleware(Authorization),
)

const handlers = HttpApiBuilder.group(Api, "bitrix24", (group) =>
  Effect.gen(function* () {
    const portal = yield* Bitrix24.Service
    const market = yield* AgentMarketService.Service
    const instances = yield* InstanceStore.Service
    const mcp = yield* MCP.Service
    const auth = yield* ServerAuth.Config
    const project = (name: string) =>
      Effect.gen(function* () {
        const directory = yield* Effect.tryPromise({
          try: async () => {
            const value = path.join(ProductProjects.root(), ProductProjects.identifier(name))
            await ProductProjects.withProject(value, async () => undefined)
            return realpath(value)
          },
          catch: () => new ConnectionError({ code: "project_access_denied" }),
        })
        return directory
      })
    const attempt = <A>(fn: () => Promise<A>) =>
      Effect.tryPromise({
        try: fn,
        catch: (error) =>
          new ConnectionError({ code: error instanceof Bitrix24.Failure ? error.code : "bitrix24_request_failed" }),
      })
    const summary = (directory: string, refresh = false) =>
      Effect.gen(function* () {
        const prepared = yield* Effect.promise(() => SessionAgent.prepare("gamma-bitrix24-developer"))
        const instance = yield* instances.load({ directory })
        const statuses = yield* (refresh ? mcp.refreshProfile() : mcp.status()).pipe(
          Effect.provideService(InstanceRef, instance),
          Effect.provideService(SessionAgent.Current, { sessionID: "", ...prepared }),
        )
        return {
          ...portal.status(directory),
          mcp: {
            portal: statuses[BitrixMcp.name]?.status ?? "disabled",
            docs: statuses[BitrixMcp.docsName]?.status ?? "disabled",
          },
        }
      })
    const authenticated = () =>
      ServerAuth.required(auth) ? Effect.void : Effect.fail(new ConnectionError({ code: "server_auth_required" }))
    return group
      .handleRaw("status", (ctx) =>
        Effect.gen(function* () {
          const directory = yield* project(ctx.params.project)
          return HttpServerResponse.jsonUnsafe(yield* summary(directory), { headers: { "cache-control": "no-store" } })
        }),
      )
      .handleRaw("connect", (ctx) =>
        Effect.gen(function* () {
          yield* authenticated()
          const origin = ctx.request.headers.origin
          if (origin && !origin.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
            return yield* new ConnectionError({ code: "secure_connection_required" })
          const directory = yield* project(ctx.params.project)
          const payload = yield* ctx.request.json.pipe(
            Effect.mapError(() => new ConnectionError({ code: "invalid_connection" })),
          )
          const connect = Effect.gen(function* () {
            // Hold the existing market lease while checking access. A first
            // connection must also work while the agent awaits a client answer.
            yield* project(ctx.params.project)
            return yield* attempt(() => portal.connect(directory, payload))
          })
          yield* (
            portal.status(directory).status === "connected"
              ? market.withIdle(directory, connect)
              : market.withRun(directory, connect)
          ).pipe(
            Effect.mapError((error) =>
              error instanceof ConnectionError ? error : new ConnectionError({ code: "project_busy" }),
            ),
          )
          return HttpServerResponse.jsonUnsafe(yield* summary(directory), { headers: { "cache-control": "no-store" } })
        }),
      )
      .handle("disconnect", (ctx) =>
        Effect.gen(function* () {
          yield* authenticated()
          const directory = yield* project(ctx.params.project)
          yield* attempt(() => portal.disconnect(directory))
          return yield* summary(directory)
        }),
      )
      .handle("check", (ctx) =>
        Effect.gen(function* () {
          const directory = yield* project(ctx.params.project)
          if (portal.status(directory).status === "connected") yield* attempt(() => portal.recheck(directory))
          return yield* market
            .withIdle(directory, summary(directory, true))
            .pipe(Effect.mapError(() => new ConnectionError({ code: "project_busy" })))
        }),
      )
      .handleRaw("approve", (ctx) =>
        Effect.gen(function* () {
          yield* authenticated()
          const directory = yield* project(ctx.params.project)
          const body = yield* ctx.request.json.pipe(
            Effect.mapError(() => new ConnectionError({ code: "invalid_payload" })),
          )
          if (
            !body ||
            typeof body !== "object" ||
            !("approved" in body) ||
            typeof body.approved !== "boolean" ||
            !("approvalKey" in body) ||
            typeof body.approvalKey !== "string"
          )
            return yield* new ConnectionError({ code: "invalid_payload" })
          yield* attempt(() =>
            portal.approve(directory, ctx.params.plan, body.approved as boolean, body.approvalKey as string),
          )
          return HttpServerResponse.jsonUnsafe(yield* summary(directory), { headers: { "cache-control": "no-store" } })
        }),
      )
  }),
)
export const bitrix24Routes = HttpApiBuilder.layer(Api).pipe(Layer.provide(handlers))
