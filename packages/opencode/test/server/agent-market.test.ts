import { SessionAgent } from "@opencode-ai/core/session/agent"
import { expect } from "bun:test"
import path from "node:path"
import { mkdir, symlink, writeFile, readFile } from "node:fs/promises"
import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer, Option, Deferred, Fiber } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AgentMarketService } from "@opencode-ai/core/agent-market"
import { Database } from "@opencode-ai/core/database/database"
import { seedLegacySkillConnection } from "../fixture/legacy-skill-market"
import { SkillMarketService } from "@opencode-ai/core/skill-market"
import { Agent } from "../../src/agent/agent"
import { MCP } from "../../src/mcp"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Session } from "../../src/session/session"
import { Permission } from "../../src/permission"
import { InstanceRef } from "../../src/effect/instance-ref"
import { InstanceStore } from "../../src/project/instance-store"
import { ServerAuth } from "../../src/server/auth"
import { agentMarketRoutes } from "../../src/server/routes/instance/httpapi/agent-market"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { tmpdirScoped, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const runtime = LayerNode.compile(
  LayerNode.group([
    SessionProjector.node,
    SkillMarketService.node,
    Database.node,
    AgentMarketService.node,
    Agent.node,
    MCP.node,
    Session.node,
    InstanceStore.node,
    CrossSpawnSpawner.node,
  ]),
  [[InstanceStore.node, testInstanceStoreLayer]],
)
const it = testEffect(
  HttpRouter.serve(
    agentMarketRoutes.pipe(
      Layer.provide(authorizationLayer),
      Layer.provide(ServerAuth.Config.configLayer({ username: "gamma", password: Option.some("test-secret") })),
    ),
    { disableListenLog: true, disableLogger: true },
  ).pipe(Layer.provideMerge(NodeHttpServer.layerTest), Layer.provideMerge(runtime)),
)
const auth = HttpClientRequest.setHeader(
  "authorization",
  ServerAuth.header({ username: "gamma", password: "test-secret" })!,
)

it.live(
  "real HTTP/SQLite: catalog creates independent fixed sessions, preserves files and retries atomically",
  () =>
    Effect.gen(function* () {
      const instances = yield* InstanceStore.Service
      const sessions = yield* Session.Service
      const agents = yield* Agent.Service
      const market = yield* AgentMarketService.Service
      const skillMarket = yield* SkillMarketService.Service
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
        await mkdir(path.join(root, "a"))
        await mkdir(path.join(root, "b"))
        await writeFile(path.join(root, "b", "opencode.json"), JSON.stringify({ permission: { skill: "deny" } }))
        await symlink("/tmp", path.join(root, "escape"))
        await writeFile(path.join(root, "a", "keep.txt"), "preserved")
      })
      const get = (url: string) => HttpClientRequest.get(`/product/${url}`).pipe(auth, HttpClient.execute)
      const body = (
        agentId: string,
        expectedVersion: number,
        confirmed = false,
        connectSkills = false,
        requestId = crypto.randomUUID(),
      ) => ({ agentId, expectedVersion, confirmed, connectSkills, requestId })
      const set = (project: string, input: ReturnType<typeof body>) =>
        HttpClientRequest.post(`/product/projects/${project}/sessions`).pipe(
          auth,
          HttpClientRequest.bodyJsonUnsafe(input),
          HttpClient.execute,
        )
      expect((yield* HttpClient.get("/product/agent-market/agents")).status).toBe(401)
      expect((yield* HttpClientRequest.post("/product/help/session").pipe(HttpClient.execute)).status).toBe(401)
      const catalog = yield* (yield* get("agent-market/agents")).json
      expect(Array.isArray(catalog) && catalog.length).toBe(21)
      expect(JSON.stringify(catalog)).not.toContain('"available":false')
      expect(yield* (yield* get("projects/a/active-agent")).json).toEqual({ agentId: null, version: 0, revision: null })
      expect((yield* set("escape", body("website-builder", 0))).status).toBe(409)
      expect((yield* set("..%2Foutside", body("website-builder", 0))).status).toBe(409)
      expect((yield* set("missing", body("website-builder", 0))).status).toBe(409)
      expect((yield* set("a", body("missing", 0))).status).toBe(409)
      const first = body("website-builder", 0)
      const firstResponse = yield* set("a", first)
      expect(firstResponse.status).toBe(200)
      const applied = yield* firstResponse.json
      expect(applied).toMatchObject({ selection: { agentId: "website-builder" } })
      expect(yield* (yield* set("a", first)).json).toEqual(applied)
      expect(yield* (yield* set("a", body("backend-developer", 0))).json).toMatchObject({ code: "skills_required" })
      const instance = yield* instances.load({ directory: path.join(root, "a") })
      const before = yield* sessions.list().pipe(Effect.provideService(InstanceRef, instance))
      expect(before).toHaveLength(1)
      expect(before[0].agent).toBe("gamma-website-builder")
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const run = yield* market
        .withRun(instance.directory, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))
        .pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      expect((yield* set("a", body("backend-developer", 0, false, true))).status).toBe(200)
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(run)
      expect((yield* sessions.get(before[0].id).pipe(Effect.provideService(InstanceRef, instance))).agent).toBe(
        "gamma-website-builder",
      )
      expect(yield* market.selection(instance.directory)).toEqual({ agentId: null, version: 0, revision: null })
      expect(yield* skillMarket.sources(instance.directory)).toEqual([])
      expect(yield* (yield* set("b", body("backend-developer", 0, false, true))).json).toMatchObject({
        code: "skills_forbidden",
      })
      expect(yield* Effect.promise(() => readFile(path.join(root, "a", "keep.txt"), "utf8"))).toBe("preserved")
      const failed = market.apply(
        instance.directory,
        body("backend-developer", 0, false, true),
        Effect.fail(new Error("session_failed")),
        () => Effect.succeed(true),
      )
      expect(yield* failed.pipe(Effect.flip)).toMatchObject({ message: "session_failed" })
      const help = yield* HttpClientRequest.post("/product/help/session").pipe(auth, HttpClient.execute)
      expect(help.status).toBe(200)
      expect(yield* help.json).toMatchObject({ agent: "gamma-guide", title: "Gamma Guide" })
      for (const id of ["web-team", "ai-team", "review-team"]) {
        expect((yield* set("a", body(id, 0, false, true))).status).toBe(200)
        const binding = { sessionID: "", ...(yield* Effect.promise(() => SessionAgent.prepare(`gamma-${id}`))) }
        const primary = yield* SessionAgent.provide(binding, agents.resolve(`gamma-${id}`)).pipe(
          Effect.provideService(InstanceRef, instance),
        )
        expect(primary.name).toBe(`gamma-${id}`)
        expect(Permission.evaluate("task", "gamma-qa-engineer", primary.permission).action).toBe("allow")
        expect(Permission.evaluate("task", "general", primary.permission).action).toBe("deny")
        const child = yield* SessionAgent.provide(binding, agents.resolve("gamma-qa-engineer", true)).pipe(
          Effect.provideService(InstanceRef, instance),
        )
        expect(child.mode).toBe("subagent")
      }
      const reset = body("gamma", 0)
      const returned = yield* (yield* set("a", reset)).json
      expect(returned).toMatchObject({ selection: { agentId: null } })
      expect(yield* (yield* set("a", reset)).json).toEqual(returned)
      expect(yield* sessions.get(before[0].id).pipe(Effect.provideService(InstanceRef, instance))).toEqual(before[0])
    }),
  60000,
)
