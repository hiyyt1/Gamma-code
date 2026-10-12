import { expect } from "bun:test"
import { Effect, Fiber } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AgentMarketService } from "@opencode-ai/core/agent-market"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Permission } from "../../src/permission"
import { testEffect } from "../lib/effect"
import { provideTmpdirServer } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
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
  "V1 keeps agent instructions fixed across new sessions and executes native team tasks",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir, llm }) {
        const market = yield* AgentMarketService.Service
        const sessions = yield* Session.Service
        const prompt = yield* SessionPrompt.Service
        const permissions = yield* Permission.Service
        const docs = process.env.GAMMA_BITRIX24_DOCS_DISABLED
        process.env.GAMMA_BITRIX24_DOCS_DISABLED = "1"
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (docs === undefined) delete process.env.GAMMA_BITRIX24_DOCS_DISABLED
            if (docs !== undefined) process.env.GAMMA_BITRIX24_DOCS_DISABLED = docs
          }),
        )
        const old = yield* sessions.create({ title: "Existing Gamma conversation" })
        yield* llm.tool("write", { filePath: `${dir}/gamma-check.txt`, content: "Gamma runtime artifact" })
        expect(
          (yield* prompt.prompt({ sessionID: old.id, model, parts: [{ type: "text", text: "Create the file" }] })).info
            .agent,
        ).toBe("gamma")
        const history = yield* sessions.messages({ sessionID: old.id })
        const create = (agentId: string) =>
          market.apply(
            dir,
            { agentId, expectedVersion: 0, confirmed: false, connectSkills: true, requestId: crypto.randomUUID() },
            sessions
              .create({ agent: agentId === "gamma" ? "gamma" : `gamma-${agentId}` })
              .pipe(Effect.map((session) => session.id)),
            () => Effect.succeed(true),
          )
        const website = yield* create("website-builder")
        yield* llm.reset
        yield* llm.text("website result")
        expect(
          (yield* prompt.prompt({
            sessionID: website.sessionId as typeof old.id,
            model,
            parts: [{ type: "text", text: "Build a website" }],
          })).info.agent,
        ).toBe("gamma-website-builder")
        expect(JSON.stringify(yield* llm.inputs)).toContain("Focus on complete responsive websites")
        yield* create("backend-developer")
        yield* llm.reset
        yield* llm.text("still a website")
        yield* prompt.prompt({
          sessionID: website.sessionId as typeof old.id,
          model,
          parts: [{ type: "text", text: "Continue" }],
        })
        expect(JSON.stringify(yield* llm.inputs)).toContain("Focus on complete responsive websites")
        expect(yield* sessions.messages({ sessionID: old.id })).toEqual(history)
        expect((yield* market.selection(dir)).agentId).toBeNull()
        for (const [profile, role] of [
          ["web-team", "qa-engineer"],
          ["1c-developer", "1c-reviewer"],
          ["bitrix24-developer", "bitrix24-reviewer"],
        ]) {
          const created = yield* create(profile)
          yield* llm.reset
          yield* llm.tool("task", {
            description: "Review",
            prompt: "Review the project without modifying files",
            subagent_type: `gamma-${role}`,
          })
          const delegated = yield* prompt
            .prompt({
              sessionID: created.sessionId as typeof old.id,
              model,
              parts: [{ type: "text", text: "Delegate review" }],
            })
            .pipe(Effect.forkChild)
          expect((yield* Fiber.join(delegated)).info.agent).toBe(`gamma-${profile}`)
          expect(yield* permissions.list()).toEqual([])
          const children = (yield* sessions.list()).filter((session) => session.parentID === created.sessionId)
          expect(children).toHaveLength(1)
          expect(children[0].agent).toBe(`gamma-${role}`)
          expect(children[0].directory).toBe(dir)
          expect(
            (yield* sessions.messages({ sessionID: children[0].id })).some(
              (message) => message.info.role === "assistant" && message.info.agent === `gamma-${role}`,
            ),
          ).toBe(true)
        }
        yield* llm.reset
        yield* llm.text("Gamma continues")
        expect(
          (yield* prompt.prompt({ sessionID: old.id, model, parts: [{ type: "text", text: "Continue" }] })).info.agent,
        ).toBe("gamma")
        expect((yield* sessions.messages({ sessionID: old.id })).slice(0, history.length)).toEqual(history)
        expect(yield* Effect.promise(() => Bun.file(`${dir}/gamma-check.txt`).text())).toBe("Gamma runtime artifact")
      }),
      { git: true, config },
    ),
  120000,
)
