import { AgentMarketService } from "@opencode-ai/core/agent-market"
import path from "node:path"
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { SkillMarket } from "@opencode-ai/schema/skill-market"
import { SkillMarketService } from "@opencode-ai/core/skill-market"
import { ProductProjects } from "@/server/product-projects"
import { InstanceStore } from "@/project/instance-store"
import { InstanceRef } from "@/effect/instance-ref"
import { Skill } from "@/skill"
import { Authorization } from "./middleware/authorization"

class MarketError extends Schema.TaggedErrorClass<MarketError>()(
  "MarketError",
  {
    code: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export const Api = HttpApi.make("skillMarket").add(
  HttpApiGroup.make("skillMarket")
    .add(
      HttpApiEndpoint.get("packages", "/product/skill-market/packages", {
        success: Schema.Array(SkillMarket.Package),
        error: MarketError,
      }),
    )
    .add(
      HttpApiEndpoint.get("package", "/product/skill-market/packages/:id", {
        params: { id: Schema.String },
        success: SkillMarket.Package,
        error: MarketError,
      }),
    )
    .add(
      HttpApiEndpoint.get("selection", "/product/projects/:project/skills", {
        params: { project: Schema.String },
        success: SkillMarket.Selection,
        error: MarketError,
      }),
    )
    .add(
      HttpApiEndpoint.post("set", "/product/projects/:project/skills/:id", {
        params: { project: Schema.String, id: Schema.String },
        payload: Schema.Struct({ enabled: Schema.Boolean }),
        success: SkillMarket.Selection,
        error: MarketError,
      }),
    )
    .middleware(Authorization),
)

// Server authentication is the existing single-user Gamma access boundary.
// Only direct projects in its configured workspace root may be selected.
const project = (name: string) =>
  Effect.tryPromise({
    try: async () => {
      const directory = path.join(ProductProjects.root(), ProductProjects.identifier(name))
      await ProductProjects.withProject(directory, async () => undefined)
      return directory
    },
    catch: () => new MarketError({ code: "project_access_denied" }),
  })
const failure = (error: SkillMarketService.Error) => new MarketError({ code: error.code })

export const handlers = HttpApiBuilder.group(Api, "skillMarket", (group) =>
  Effect.gen(function* () {
    const agents = yield* AgentMarketService.Service
    const market = yield* SkillMarketService.Service
    const skills = yield* Skill.Service
    const instances = yield* InstanceStore.Service
    return group
      .handle("packages", () => market.catalog().pipe(Effect.mapError(failure)))
      .handle("package", (ctx) =>
        Effect.gen(function* () {
          const pkg = (yield* market.catalog()).find((pkg) => pkg.id === ctx.params.id)
          if (!pkg) return yield* new SkillMarketService.Error({ code: "package_not_found" })
          return pkg
        }).pipe(Effect.mapError(failure)),
      )
      .handle("selection", (ctx) =>
        Effect.gen(function* () {
          const directory = yield* project(ctx.params.project)
          return yield* market.selection(directory).pipe(Effect.mapError(failure))
        }),
      )
      .handle("set", (ctx) =>
        Effect.gen(function* () {
          const directory = yield* project(ctx.params.project)
          const instance = yield* instances.load({ directory })
          const existing = ctx.payload.enabled
            ? yield* skills.all().pipe(Effect.provideService(InstanceRef, instance))
            : []
          const own = path.resolve(SkillMarketService.root(), "packages", ctx.params.id, "skills") + path.sep
          return yield* agents
            .withIdle(
              directory,
              market
                .set(
                  directory,
                  ctx.params.id,
                  ctx.payload.enabled,
                  existing.filter((skill) => !skill.location.startsWith(own)).map((skill) => skill.name),
                )
                .pipe(Effect.mapError(failure)),
            )
            .pipe(Effect.mapError((error) => new MarketError({ code: error.code })))
        }),
      )
  }),
)

export const skillMarketRoutes = HttpApiBuilder.layer(Api).pipe(Layer.provide(handlers))
