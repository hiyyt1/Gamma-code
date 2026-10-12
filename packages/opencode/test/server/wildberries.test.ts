import { expect } from "bun:test"
import path from "node:path"
import { createServer } from "node:http"
import { writeFile } from "node:fs/promises"
import { NodeHttpServer } from "@effect/platform-node"
import { Context, Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer, FetchHttpClient } from "effect/unstable/http"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AgentMarketService } from "@opencode-ai/core/agent-market"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Database } from "@opencode-ai/core/database/database"
import { Agent } from "../../src/agent/agent"
import { Skill } from "../../src/skill"
import { Permission } from "../../src/permission"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MCP } from "../../src/mcp"
import { Wildberries } from "../../src/wildberries/store"
import { WildberriesMcp } from "../../src/wildberries/mcp"
import { InstanceStore } from "../../src/project/instance-store"
import { ServerAuth } from "../../src/server/auth"
import { wildberriesRoutes } from "../../src/server/routes/instance/httpapi/wildberries"
import { agentMarketRoutes } from "../../src/server/routes/instance/httpapi/agent-market"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { testInstanceStoreLayer, provideInstance } from "../fixture/fixture"
import { wildberriesFixture } from "../fixture/wildberries"
import { testEffect } from "../lib/effect"

class Fixture extends Context.Service<Fixture, Awaited<ReturnType<typeof wildberriesFixture>>>()(
  "@test/BitrixFixture",
) {}
const fixture = Layer.effect(
  Fixture,
  Effect.acquireRelease(
    Effect.promise(() => wildberriesFixture()),
    (f) => Effect.promise(() => f[Symbol.asyncDispose]()),
  ),
)
const runtime = LayerNode.compile(
  LayerNode.group([
    SessionProjector.node,
    Database.node,
    Permission.node,
    Wildberries.node,
    AgentMarketService.node,
    Agent.node,
    Skill.node,
    MCP.node,
    Session.node,
    SessionPrompt.node,
    InstanceStore.node,
    CrossSpawnSpawner.node,
  ]),
  [
    [InstanceStore.node, testInstanceStoreLayer],
    [
      Wildberries.node,
      Layer.effect(
        Wildberries.Service,
        Effect.map(Fixture, (f) => f.store),
      ).pipe(Layer.provide(fixture)),
    ],
  ],
)
// Isolated Node HTTP harness. Close owned sockets before layer finalization;
// Bun may otherwise retain connections after the streamed provider responses.
const httpServer = createServer()
const http = HttpServer.layerTestClient.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provideMerge(NodeHttpServer.layer(() => httpServer, { port: 0 })),
)
const it = testEffect(
  HttpRouter.serve(
    Layer.merge(wildberriesRoutes, agentMarketRoutes).pipe(
      Layer.provide(authorizationLayer),
      Layer.provide(ServerAuth.Config.configLayer({ username: "gamma", password: Option.some("test-secret") })),
    ),
    { disableListenLog: true, disableLogger: true },
  ).pipe(Layer.provideMerge(http), Layer.provideMerge(runtime), Layer.provideMerge(fixture)),
)
const auth = HttpClientRequest.setHeader(
  "authorization",
  ServerAuth.header({ username: "gamma", password: "test-secret" })!,
)

it.live(
  "WB secure HTTP binding, connection, exact approvals, readback, isolation and disconnect",
  () =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.sync(() => httpServer.closeAllConnections()))
      const f = yield* Fixture
      const previous = process.env.GAMMA_WORKSPACES_ROOT
      process.env.GAMMA_WORKSPACES_ROOT = f.root
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.GAMMA_WORKSPACES_ROOT
          else process.env.GAMMA_WORKSPACES_ROOT = previous
        }),
      )
      const post = (url: string, body: object) =>
        HttpClientRequest.post(`/product/projects/${url}`).pipe(
          auth,
          HttpClientRequest.setHeader("connection", "close"),
          HttpClientRequest.bodyJsonUnsafe(body),
          HttpClient.execute,
        )
      const select = (project: string, agentId = "wildberries-manager", expectedVersion = 0) =>
        post(`${project}/active-agent`, {
          agentId,
          expectedVersion,
          confirmed: true,
          connectSkills: true,
          requestId: crypto.randomUUID(),
        })
      const denied = yield* HttpClient.get("/product/projects/a/wildberries")
      expect(denied.status).toBe(401)
      yield* denied.arrayBuffer
      const wrongProfile = yield* post("a/wildberries/connect", f.input)
      expect(wrongProfile.status).toBe(409)
      yield* wrongProfile.arrayBuffer
      const selected = yield* select("a")
      expect(selected.status).toBe(200)
      yield* selected.arrayBuffer
      const second = yield* select("b")
      expect(second.status).toBe(200)
      yield* second.arrayBuffer
      const connected = yield* post("a/wildberries/connect", f.input)
      expect(connected.status).toBe(200)
      const status = JSON.stringify(yield* connected.json)
      expect(status).toContain("fixture-store")
      expect(status).not.toContain(f.input.token)
      expect(f.store.status(f.b).status).toBe("disconnected")
      const plan = f.store.prepare(f.a, {
        key: "http-price-plan-00001",
        summary: "Set price 120",
        operations: [{ method: "update_prices", params: { data: [{ nmID: 1, price: 120, discount: 0 }] } }],
      })
      const fake = yield* post(`a/wildberries/plans/${plan.planId}`, {
        approved: true,
        approvalKey: "model-cannot-approve",
      })
      expect(fake.status).toBe(409)
      yield* fake.arrayBuffer
      const foreign = yield* post(`b/wildberries/plans/${plan.planId}`, { approved: true, approvalKey: f.approvalKey })
      expect(foreign.status).toBe(409)
      yield* foreign.arrayBuffer
      const approved = yield* post(`a/wildberries/plans/${plan.planId}`, { approved: true, approvalKey: f.approvalKey })
      expect(approved.status).toBe(200)
      yield* approved.arrayBuffer
      expect((yield* Effect.promise(() => f.store.execute(f.a, plan.planId))).status).toBe("done")
      expect((yield* Effect.promise(() => f.store.verify(f.a, plan.planId))).verified).toBe(true)
      expect(f.state.writes).toBe(1)
      const disconnected = yield* post("a/wildberries/disconnect", {})
      expect(disconnected.status).toBe(200)
      yield* disconnected.arrayBuffer
      expect(f.store.status(f.a).status).toBe("disconnected")
      const replaced = yield* select("a", "website-builder", 1)
      expect(replaced.status).toBe(200)
      yield* replaced.arrayBuffer
      const wrong = yield* post("a/wildberries/check", {})
      expect(wrong.status).toBe(409)
      yield* wrong.arrayBuffer
      yield* InstanceStore.Service.use((store) => store.disposeAll())
    }),
  60000,
)
