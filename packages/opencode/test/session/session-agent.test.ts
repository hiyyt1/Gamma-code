import { expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { SessionAgent } from "@opencode-ai/core/session/agent"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { AgentMarketService } from "@opencode-ai/core/agent-market"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Agent } from "../../src/agent/agent"
import { Skill } from "../../src/skill"
import { MCP } from "../../src/mcp"
import { testEffect } from "../lib/effect"
import { provideTmpdirInstance } from "../fixture/fixture"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Session.node,
      SessionPrompt.node,
      Agent.node,
      Skill.node,
      MCP.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      Database.node,
      AgentMarketService.node,
    ]),
  ),
)

it.live("sessions in one directory keep independent Gamma, 1C and Bitrix profiles", () =>
  provideTmpdirInstance(
    Effect.fnUntraced(function* (directory) {
      const sessions = yield* Session.Service
      const agents = yield* Agent.Service
      const skills = yield* Skill.Service
      const mcp = yield* MCP.Service
      const market = yield* AgentMarketService.Service
      const previous = process.env.GAMMA_BITRIX24_DOCS_DISABLED
      process.env.GAMMA_BITRIX24_DOCS_DISABLED = "1"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.GAMMA_BITRIX24_DOCS_DISABLED
          if (previous !== undefined) process.env.GAMMA_BITRIX24_DOCS_DISABLED = previous
        }),
      )
      const gamma = yield* sessions.create()
      const bsl = yield* sessions.create({ agent: "gamma-1c-developer" })
      const bitrix = yield* sessions.create({ agent: "gamma-bitrix24-developer" })
      expect(gamma.agent).toBe("gamma")
      expect(new Set([gamma.directory, bsl.directory, bitrix.directory])).toEqual(new Set([directory]))
      const inspect = (session: Session.Info) =>
        Effect.gen(function* () {
          const binding = yield* SessionAgent.load(session.id)
          return yield* SessionAgent.provide(
            binding,
            Effect.gen(function* () {
              return {
                agent: yield* agents.resolve(binding.agent),
                skills: yield* skills.all(),
                status: yield* mcp.status(),
              }
            }),
          )
        })
      const [a, b, c] = yield* Effect.all([inspect(gamma), inspect(bsl), inspect(bitrix)], { concurrency: "unbounded" })
      expect(a.agent.prompt).toContain("Ты Gamma")
      expect(b.agent.prompt).toContain("1С")
      expect(c.agent.prompt).toContain("Битрикс24")
      expect(a.skills.some((skill) => skill.name.startsWith("1c-development:"))).toBe(false)
      expect(b.skills.some((skill) => skill.name.startsWith("1c-development:"))).toBe(true)
      expect(c.skills.some((skill) => skill.name.startsWith("1c-development:"))).toBe(false)
      expect(a.status["gamma-bsl"]).toBeUndefined()
      expect(b.status["gamma-bsl"]).toBeDefined()
      expect(c.status["gamma-bsl"]).toBeUndefined()
      expect(Object.keys(c.status).some((key) => key.includes("b24"))).toBe(true)
      expect((yield* inspect(gamma)).status).toEqual(a.status)
      expect((yield* inspect(bsl)).agent.prompt).toBe(b.agent.prompt)
      expect((yield* market.selection(directory)).agentId).toBeNull()
      expect((yield* sessions.get(bsl.id)).metadata?.gammaAgent).toEqual(bsl.metadata?.gammaAgent)
      yield* sessions.setMetadata({
        sessionID: bsl.id,
        metadata: { gammaAgent: { profile: "bitrix24-developer" }, note: "kept" },
      })
      expect((yield* sessions.get(bsl.id)).metadata).toMatchObject({
        note: "kept",
        gammaAgent: bsl.metadata!.gammaAgent,
      })
      const fork = yield* sessions.fork({ sessionID: bsl.id })
      expect(fork.agent).toBe(bsl.agent)
      const child = yield* sessions.create({ parentID: bsl.id, agent: "gamma-1c-reviewer" })
      expect((yield* inspect(child)).agent.mode).toBe("subagent")
      expect((yield* SessionAgent.load(child.id)).pin?.profile).toBe("1c-developer")
    }),
  ),
)

it.live("prompt, shell and command reject a different agent before changing history", () =>
  provideTmpdirInstance(
    Effect.fnUntraced(function* () {
      const sessions = yield* Session.Service
      const prompts = yield* SessionPrompt.Service
      const session = yield* sessions.create()
      const results = yield* Effect.all([
        prompts
          .prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "do not execute" }] })
          .pipe(Effect.exit),
        prompts.shell({ sessionID: session.id, agent: "build", command: "exit 1" }).pipe(Effect.exit),
        prompts.command({ sessionID: session.id, agent: "build", command: "unknown", arguments: "" }).pipe(Effect.exit),
      ])
      expect(results.map((exit) => exit._tag)).toEqual(["Failure", "Failure", "Failure"])
      expect(yield* sessions.messages({ sessionID: session.id })).toEqual([])
      expect((yield* sessions.get(session.id)).agent).toBe("gamma")
    }),
  ),
)
