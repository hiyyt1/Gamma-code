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
import { Bitrix24 } from "../../src/bitrix24/portal"
import { BitrixMcp } from "../../src/bitrix24/mcp"
import { InstanceStore } from "../../src/project/instance-store"
import { ServerAuth } from "../../src/server/auth"
import { bitrix24Routes } from "../../src/server/routes/instance/httpapi/bitrix24"
import { agentMarketRoutes } from "../../src/server/routes/instance/httpapi/agent-market"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { testInstanceStoreLayer, provideInstance } from "../fixture/fixture"
import { bitrixFixture } from "../fixture/bitrix24"
import { testEffect } from "../lib/effect"

class Fixture extends Context.Service<Fixture, Awaited<ReturnType<typeof bitrixFixture>>>()("@test/BitrixFixture") {}
const fixture = Layer.effect(
  Fixture,
  Effect.acquireRelease(
    Effect.promise(() => bitrixFixture()),
    (f) => Effect.promise(() => f[Symbol.asyncDispose]()),
  ),
)
const runtime = LayerNode.compile(
  LayerNode.group([
    SessionProjector.node,
    Database.node,
    Permission.node,
    Bitrix24.node,
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
      Bitrix24.node,
      Layer.effect(
        Bitrix24.Service,
        Effect.map(Fixture, (f) => f.portal),
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
    Layer.merge(bitrix24Routes, agentMarketRoutes).pipe(
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
  "HTTP selection and secure connection → V1 agent → local MCP → mock REST → readback; scopes, roles and revocation",
  () =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.sync(() => httpServer.closeAllConnections()))
      const f = yield* Fixture
      const llm = {
        url: f.llm.url,
        tool: (tool: string, args: object) => Effect.sync(() => f.llm.replies.push({ tool, args })),
        text: (text: string) => Effect.sync(() => f.llm.replies.push({ text })),
        inputs: Effect.sync(() => f.llm.inputs),
      }
      yield* Effect.promise(() => Bun.spawn(["git", "init", "--quiet", f.a]).exited)
      const previous = { root: process.env.GAMMA_WORKSPACES_ROOT, docs: process.env.GAMMA_BITRIX24_DOCS_DISABLED }
      process.env.GAMMA_WORKSPACES_ROOT = f.root
      process.env.GAMMA_BITRIX24_DOCS_DISABLED = "1"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (previous.root === undefined) delete process.env.GAMMA_WORKSPACES_ROOT
          if (previous.root !== undefined) process.env.GAMMA_WORKSPACES_ROOT = previous.root
          if (previous.docs === undefined) delete process.env.GAMMA_BITRIX24_DOCS_DISABLED
          if (previous.docs !== undefined) process.env.GAMMA_BITRIX24_DOCS_DISABLED = previous.docs
        }),
      )
      yield* Effect.promise(() =>
        writeFile(
          path.join(f.a, "opencode.json"),
          JSON.stringify({
            provider: {
              test: {
                name: "Test",
                id: "test",
                env: [],
                npm: "@ai-sdk/openai-compatible",
                models: {
                  "test-model": {
                    id: "test-model",
                    name: "Test model",
                    attachment: false,
                    reasoning: false,
                    temperature: false,
                    tool_call: true,
                    release_date: "2025-01-01",
                    limit: { context: 100000, output: 10000 },
                    cost: { input: 0, output: 0 },
                    options: {},
                  },
                },
                options: { apiKey: "fixture", baseURL: llm.url, headers: { connection: "close" } },
              },
            },
          }),
        ),
      )
      const post = (url: string, body: object) =>
        Effect.gen(function* () {
          const response = yield* HttpClientRequest.post(`/product/projects/${url}`).pipe(
            auth,
            HttpClientRequest.setHeader("connection", "close"),
            HttpClientRequest.bodyJsonUnsafe(body),
            HttpClient.execute,
          )
          const json = yield* response.json
          return { status: response.status, json: Effect.succeed(json) }
        })
      const select = (project: string, agentId: string, expectedVersion: number) =>
        post(`${project}/active-agent`, {
          agentId,
          expectedVersion,
          confirmed: true,
          connectSkills: true,
          requestId: crypto.randomUUID(),
        })
      const denied = yield* HttpClientRequest.get("/product/projects/a/bitrix24").pipe(
        HttpClientRequest.setHeader("connection", "close"),
        HttpClient.execute,
      )
      expect(denied.status).toBe(401)
      yield* denied.arrayBuffer
      expect((yield* post("a/bitrix24/connect", f.input)).status).toBe(409)
      expect((yield* select("a", "bitrix24-developer", 0)).status).toBe(200)
      const invalid = yield* post("a/bitrix24/connect", {
        ...f.input,
        webhook: "https://evil.example/rest/1/do-not-echo/",
      })
      expect(invalid.status).toBe(409)
      expect(JSON.stringify(yield* invalid.json)).not.toContain("do-not-echo")
      const market = yield* AgentMarketService.Service
      const connected = yield* market.withRun(f.a, post("a/bitrix24/connect", f.input))
      expect(connected.status).toBe(200)
      const body = JSON.stringify(yield* connected.json)
      expect(body).toContain('"portal":"connected"')
      expect(body).not.toContain(f.secret)
      expect(body).not.toContain(f.approvalKey)
      expect((yield* select("b", "bitrix24-developer", 0)).status).toBe(200)
      const other = yield* HttpClientRequest.get("/product/projects/b/bitrix24").pipe(
        auth,
        HttpClientRequest.setHeader("connection", "close"),
        HttpClient.execute,
      )
      expect(JSON.stringify(yield* other.json)).toContain('"status":"disconnected"')
      yield* Effect.gen(function* () {
        const skills = yield* Skill.Service
        const agents = yield* Agent.Service
        const mcp = yield* MCP.Service
        const sessions = yield* Session.Service
        const prompts = yield* SessionPrompt.Service
        expect((yield* skills.all()).filter((s) => s.name.startsWith("bitrix24-development:")).length).toBe(6)
        expect((yield* skills.require("bitrix24-development:bitrix24-crm")).content).toContain("CRM")
        const primary = yield* agents.resolve("build")
        for (const role of ["analyst", "backend-developer", "app-developer", "reviewer"]) {
          const child = yield* agents.resolve(`gamma-bitrix24-${role}`, true)
          expect(child.mode).toBe("subagent")
          expect(Permission.evaluate("gamma-b24_execute_plan", "*", child.permission).action).toBe("deny")
          expect(Permission.evaluate("gamma-b24_prepare_plan", "*", child.permission).action).toBe("deny")
        }
        expect(Permission.evaluate("gamma-b24_execute_plan", "*", primary.permission).action).toBe("allow")
        expect(Object.keys(yield* mcp.tools()).filter((n) => n.startsWith("gamma-b24_")).length).toBe(4)
        const session = yield* sessions.create({ title: "Bitrix mock REST" })
        const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") }
        const prompt = (text: string) =>
          prompts.prompt({ sessionID: session.id, agent: "build", model, parts: [{ type: "text", text }] })
        yield* llm.tool("skill", { name: "bitrix24-development:bitrix24-crm" })
        yield* llm.tool("read", {
          filePath: path.join(
            path.dirname((yield* skills.require("bitrix24-development:bitrix24-crm")).location),
            "references/catalog-core.md",
          ),
          limit: 10,
        })
        yield* llm.tool("gamma-b24_prepare_plan", {
          key: "business-ui-native-mcp",
          summary: "Create a test deal and update task",
          operations: [
            { method: "crm.deal.add", params: { fields: { TITLE: "Native pipeline" } } },
            { method: "tasks.task.update", params: { taskId: 8, fields: { TITLE: "Native task" } } },
          ],
        })
        yield* llm.text("Approve the prepared plan in Gamma.")
        expect((yield* prompt("Create deal and update task")).info.agent).toBe("gamma-bitrix24-developer")
        const plan = f.portal.status(f.a).plans[0]
        expect(plan?.state).toBe("pending")
        expect(f.state.deals.length).toBe(0)
        expect(
          (yield* post(`b/bitrix24/plans/${plan.id}`, { approved: true, approvalKey: f.approvalKey })).status,
        ).toBe(409)
        expect(
          (yield* post(`a/bitrix24/plans/${plan.id}`, { approved: true, approvalKey: "guessed-by-model" })).status,
        ).toBe(409)
        expect(
          (yield* post(`a/bitrix24/plans/${plan.id}`, { approved: true, approvalKey: f.approvalKey })).status,
        ).toBe(200)
        yield* llm.tool("gamma-b24_execute_plan", { planId: plan.id })
        yield* llm.tool("gamma-b24_rest_read", { method: "crm.deal.get", params: { id: 1 } })
        yield* llm.tool("gamma-b24_rest_read", { method: "tasks.task.get", params: { taskId: 8 } })
        yield* llm.text("Changes verified on mock API.")
        yield* prompt("Approved; continue and verify")
        expect(f.state.deals.length).toBe(1)
        expect(f.state.task.title).toBe("Native task")
        const messages = JSON.stringify(yield* sessions.messages({ sessionID: session.id }))
        expect(messages).toContain("Native pipeline")
        expect(messages).toContain("catalog-core.md")
        expect(messages).toContain("<skill_content")
        expect(messages).not.toContain(f.secret)
        expect(messages).not.toContain(f.approvalKey)
        expect(JSON.stringify(yield* llm.inputs)).not.toContain(f.secret)
        expect((yield* post("a/bitrix24/disconnect", {})).status).toBe(200)
        expect(f.portal.status(f.a).status).toBe("disconnected")
        expect((yield* select("a", "website-builder", 1)).status).toBe(200)
        expect((yield* mcp.status())[BitrixMcp.name]).toBeUndefined()
        expect((yield* skills.all()).some((s) => s.name.startsWith("bitrix24-development:"))).toBe(false)
      }).pipe(provideInstance(f.a))
      yield* InstanceStore.Service.use((store) => store.disposeAll())
    }),
  120000,
)
