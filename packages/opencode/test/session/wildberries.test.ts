import { SessionAgent } from "@opencode-ai/core/session/agent"
import { expect } from "bun:test"
import { Effect, Fiber, Schedule } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AgentMarketService } from "@opencode-ai/core/agent-market"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import path from "node:path"
import fixture from "../wildberries/scenarios.json"
import { Agent } from "../../src/agent/agent"
import { Skill } from "../../src/skill"
import { MCP } from "../../src/mcp"
import { SessionID } from "../../src/session/schema"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Permission } from "../../src/permission"
import { testEffect } from "../lib/effect"
import { provideTmpdirServer } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Agent.node,
      Skill.node,
      MCP.node,
      SessionPrompt.node,
      Session.node,
      Permission.node,
      AgentMarketService.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
  ),
)
const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") }
const config = (url: string) => ({
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
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
      options: { apiKey: "test-key", baseURL: url },
    },
  },
})

it.live(
  "WB binding, skill discovery, all four native TaskTools and five offline chat scenarios",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir, llm }) {
        const binding = {
          sessionID: "wb-fixture",
          ...(yield* Effect.promise(() => SessionAgent.prepare("gamma-wildberries-manager"))),
        }
        return yield* SessionAgent.provide(
          binding,
          Effect.gen(function* () {
            const market = yield* AgentMarketService.Service
            const sessions = yield* Session.Service
            const prompt = yield* SessionPrompt.Service
            const agents = yield* Agent.Service
            const skills = yield* Skill.Service
            const mcp = yield* MCP.Service
            const applied = yield* market.apply(
              dir,
              {
                agentId: "wildberries-manager",
                expectedVersion: 0,
                confirmed: false,
                connectSkills: true,
                requestId: crypto.randomUUID(),
              },
              sessions.create({ title: "WB", agent: "gamma-wildberries-manager" }).pipe(Effect.map((s) => s.id)),
              () => Effect.succeed(true),
            )
            expect(applied.selection.agentId).toBe("wildberries-manager")
            expect((yield* skills.all()).filter((s) => s.name.startsWith("wildberries-management:")).length).toBe(8)
            expect((yield* mcp.status())["gamma-wb"].status).toBe("connected")
            yield* llm.reset
            yield* llm.tool("skill", { name: "wildberries-management:wb-unit-economics" })
            yield* llm.text("Financial skill loaded")
            yield* prompt.prompt({
              sessionID: SessionID.make(applied.sessionId),
              agent: "gamma-wildberries-manager",
              model,
              parts: [{ type: "text", text: "Prepare to calculate product profit" }],
            })
            expect(
              JSON.stringify(yield* sessions.messages({ sessionID: SessionID.make(applied.sessionId) })),
            ).toContain("<skill_content")
            for (const member of [
              "wb-sales-analyst",
              "wb-advertising-manager",
              "wb-product-manager",
              "wb-financial-analyst",
            ]) {
              const agent = yield* agents.get(`gamma-${member}`)
              expect(agent).toBeDefined()
              expect(Permission.evaluate("gamma-wb_execute_plan", "*", agent!.permission).action).toBe("deny")
              expect(Permission.evaluate("bash", "curl https://example.com", agent!.permission).action).toBe("deny")
              yield* llm.reset
              yield* llm.tool("task", {
                description: "Analyze WB data",
                prompt: "Inspect available files and report limitations",
                subagent_type: `gamma-${member}`,
              })
              yield* llm.text("No fabricated metrics; available files inspected")
              const response = yield* prompt.prompt({
                sessionID: SessionID.make(applied.sessionId),
                agent: "gamma-wildberries-manager",
                model,
                parts: [{ type: "text", text: `Delegate ${member}` }],
              })
              expect(response.info.agent).toBe("gamma-wildberries-manager")
              expect(
                (yield* sessions.list()).some((s) => s.parentID === applied.sessionId && s.agent === `gamma-${member}`),
              ).toBe(true)
            }
            yield* Effect.promise(() => Bun.write(path.join(dir, "wb.json"), JSON.stringify(fixture)))
            yield* Effect.promise(() => Bun.write(path.join(dir, "cost.csv"), "vendorCode,cost\n001,50\n"))
            for (const scenario of ["sales", "advertising", "profit", "cards", "inventory"]) {
              yield* llm.reset
              yield* llm.tool("gamma-wb_analyse", {
                files: [{ path: "wb.json" }, { path: "cost.csv", kind: "cost" }],
                start: "2026-09-15",
                end: "2026-09-28",
                scenario,
              })
              yield* llm.text("Report created; missing inputs disclosed")
              const response = yield* prompt.prompt({
                sessionID: SessionID.make(applied.sessionId),
                agent: "gamma-wildberries-manager",
                model,
                parts: [{ type: "text", text: `Perform ${scenario} from uploaded files` }],
              })
              const messages = yield* sessions.messages({ sessionID: SessionID.make(applied.sessionId) })
              expect(
                messages
                  .flatMap((m) => m.parts)
                  .some(
                    (p) =>
                      p.type === "tool" &&
                      p.tool === "gamma-wb_analyse" &&
                      p.state.status === "completed" &&
                      p.state.input.scenario === scenario,
                  ),
              ).toBe(true)
            }
            const current = yield* market.selection(dir)
            yield* market.apply(
              dir,
              {
                agentId: "website-builder",
                expectedVersion: current.version,
                confirmed: true,
                connectSkills: true,
                requestId: crypto.randomUUID(),
              },
              sessions.create({ agent: "gamma-website-builder" }).pipe(Effect.map((s) => s.id)),
              () => Effect.succeed(true),
            )
            expect((yield* mcp.status())["gamma-wb"].status).toBe("connected")
            expect(
              (yield* mcp.status().pipe(Effect.provideService(SessionAgent.Current, undefined)))["gamma-wb"],
            ).toBeUndefined()
          }),
        )
      }),
      { git: true, config },
    ),
  90000,
)
