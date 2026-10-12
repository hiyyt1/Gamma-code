import { expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { seedLegacySkillConnection } from "../fixture/legacy-skill-market"
import { SkillMarketService } from "@opencode-ai/core/skill-market"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "../../src/tool/truncate"
import { Skill } from "../../src/skill"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "../../src/tool/registry"
import { Session } from "../../src/session/session"
import { MessageID } from "../../src/session/schema"
import { provideInstance, tmpdirScoped, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(
      LayerNode.group([
        Skill.node,
        SkillMarketService.node,
        Database.node,
        ToolRegistry.node,
        Session.node,
        CrossSpawnSpawner.node,
        Ripgrep.node,
        Agent.node,
        Truncate.node,
      ]),
    ),
    testInstanceStoreLayer,
  ),
)

it.live("real V1 sessions and skill tool honor enable/disable and project isolation", () =>
  Effect.gen(function* () {
    const a = yield* tmpdirScoped({
      init: (dir) =>
        Effect.promise(async () => {
          await Bun.write(
            `${dir}/.opencode/skills/local-check/SKILL.md`,
            "---\nname: local-check\ndescription: Local user skill\n---\nPreserved local instructions.",
          )
        }).pipe(Effect.orDie),
    })
    const b = yield* tmpdirScoped()
    const market = yield* SkillMarketService.Service
    const skill = yield* Skill.Service
    const sessions = yield* Session.Service
    const name = "superpowers:verification-before-completion"
    expect((yield* skill.all().pipe(provideInstance(a))).some((skill) => skill.name === name)).toBe(false)
    yield* seedLegacySkillConnection(a)
    const session = yield* sessions.create({}).pipe(provideInstance(a))
    const toolInfo = yield* SkillTool.pipe(provideInstance(a))
    const tool = yield* toolInfo.init().pipe(provideInstance(a))
    const permissions: string[] = []
    const context = {
      sessionID: session.id,
      messageID: MessageID.make("msg_market_test"),
      callID: "market-test",
      agent: "build",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => Effect.void,
      ask: (request: { permission: string }) =>
        Effect.sync(() => {
          permissions.push(request.permission)
        }),
    }
    const loaded = yield* tool.execute({ name }, context).pipe(provideInstance(a))
    expect(loaded.output).toContain('<skill_content name="superpowers:verification-before-completion">')
    expect(loaded.output).toContain("evidence")
    expect(permissions).toEqual(["skill"])
    yield* sessions.create({}).pipe(provideInstance(b))
    expect((yield* skill.all().pipe(provideInstance(b))).some((skill) => skill.name === name)).toBe(false)
    yield* market.set(a, "superpowers", false, [])
    expect((yield* skill.all().pipe(provideInstance(a))).some((skill) => skill.name === name)).toBe(false)
    expect(Exit.isFailure(yield* tool.execute({ name }, context).pipe(provideInstance(a), Effect.exit))).toBe(true)
    expect(loaded.output).toContain("evidence")
    const local = yield* tool.execute({ name: "local-check" }, context).pipe(provideInstance(a))
    expect(local.output).toContain("Preserved local instructions.")
    expect(yield* market.selection(a)).toEqual({ enabled: [] })
  }),
)
