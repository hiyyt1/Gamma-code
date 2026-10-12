import { expect } from "bun:test"
import path from "node:path"
import { mkdir, symlink } from "node:fs/promises"
import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AgentMarketService } from "@opencode-ai/core/agent-market"
import { SkillMarketService } from "@opencode-ai/core/skill-market"
import { Skill } from "../../src/skill"
import { InstanceStore } from "../../src/project/instance-store"
import { ServerAuth } from "../../src/server/auth"
import { skillMarketRoutes } from "../../src/server/routes/instance/httpapi/skill-market"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { tmpdirScoped, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const runtime = LayerNode.compile(
  LayerNode.group([
    AgentMarketService.node,
    SkillMarketService.node,
    Skill.node,
    InstanceStore.node,
    CrossSpawnSpawner.node,
  ]),
  [[InstanceStore.node, testInstanceStoreLayer]],
)
const it = testEffect(
  HttpRouter.serve(
    skillMarketRoutes.pipe(
      Layer.provide(authorizationLayer),
      Layer.provide(ServerAuth.Config.configLayer({ username: "gamma", password: Option.some("test-secret") })),
      Layer.provide(runtime),
    ),
    { disableListenLog: true, disableLogger: true },
  ).pipe(Layer.provideMerge(NodeHttpServer.layerTest), Layer.provideMerge(LayerNode.compile(CrossSpawnSpawner.node))),
)
const auth = HttpClientRequest.setHeader(
  "authorization",
  ServerAuth.header({ username: "gamma", password: "test-secret" })!,
)

it.live("market API authenticates, confines projects and blocks retired packages", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    const previous = process.env.GAMMA_WORKSPACES_ROOT
    process.env.GAMMA_WORKSPACES_ROOT = root
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.GAMMA_WORKSPACES_ROOT
        if (previous !== undefined) process.env.GAMMA_WORKSPACES_ROOT = previous
      }),
    )
    yield* Effect.promise(async () => {
      await mkdir(path.join(root, "project-a"))
      await mkdir(path.join(root, "project-b"))
      await symlink("/tmp", path.join(root, "escape"))
    })
    const unauthorized = yield* HttpClient.get("/product/skill-market/packages")
    expect(unauthorized.status).toBe(401)
    const catalog = yield* HttpClientRequest.get("/product/skill-market/packages").pipe(auth, HttpClient.execute)
    expect(catalog.status).toBe(200)
    expect(yield* catalog.json).toHaveLength(0)
    const get = (project: string) =>
      HttpClientRequest.get(`/product/projects/${project}/skills`).pipe(auth, HttpClient.execute)
    const set = (project: string, pkg: string, enabled: boolean) =>
      HttpClientRequest.post(`/product/projects/${project}/skills/${pkg}`).pipe(
        auth,
        HttpClientRequest.bodyJsonUnsafe({ enabled }),
        HttpClient.execute,
      )
    expect(yield* (yield* get("project-a")).json).toEqual({ enabled: [] })
    expect((yield* set("escape", "superpowers", true)).status).toBe(400)
    expect((yield* set("..%2Foutside", "superpowers", true)).status).toBe(400)
    expect((yield* set("missing-project", "superpowers", true)).status).toBe(400)
    const incompatible = yield* set("project-a", "better-auth", true)
    expect(incompatible.status).toBe(400)
    expect(yield* incompatible.json).toMatchObject({ code: "package_not_published" })
    expect((yield* set("project-a", "missing", true)).status).toBe(400)
    expect(yield* (yield* set("project-a", "superpowers", true)).json).toMatchObject({ code: "package_not_published" })
    expect(yield* (yield* set("project-a", "superpowers", true)).json).toMatchObject({ code: "package_not_published" })
    expect(yield* (yield* get("project-a")).json).toEqual({ enabled: [] })
    expect(yield* (yield* get("project-b")).json).toEqual({ enabled: [] })
    const unauthorizedWrite = yield* HttpClientRequest.post("/product/projects/project-a/skills/superpowers").pipe(
      HttpClientRequest.bodyJsonUnsafe({ enabled: false }),
      HttpClient.execute,
    )
    expect(unauthorizedWrite.status).toBe(401)
    expect(yield* (yield* get("project-a")).json).toEqual({ enabled: [] })
    expect(yield* (yield* set("project-a", "superpowers", false)).json).toEqual({ enabled: [] })
    const detail = yield* HttpClientRequest.get("/product/skill-market/packages/superpowers").pipe(
      auth,
      HttpClient.execute,
    )
    expect(detail.status).toBe(400)
    expect(yield* detail.json).toMatchObject({ code: "package_not_found" })
  }),
)
