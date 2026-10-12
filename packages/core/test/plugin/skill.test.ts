import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { SkillPlugin } from "@opencode-ai/core/plugin/skill"
import { SkillV2 } from "@opencode-ai/core/skill"
import { testEffect } from "../lib/effect"
import { host } from "./host"
import { Location } from "@opencode-ai/core/location"
import { tempLocationLayer } from "../fixture/location"

const it = testEffect(AppNodeBuilder.build(SkillV2.node, [[Location.node, tempLocationLayer]]))

describe("SkillPlugin.Plugin", () => {
  it.effect("registers the built-in customize-opencode skill", () =>
    Effect.gen(function* () {
      const skill = yield* SkillV2.Service
      yield* SkillPlugin.Plugin.effect(host({ skill: { ...skill, reload: skill.reload } }))

      const guides = (yield* skill.list()).filter((item) => item.name.startsWith("gamma-"))
      expect(guides).toHaveLength(5)
      expect(guides.every((item) => item.content.includes("Проверенные сведения"))).toBe(true)
      expect(yield* skill.list()).toContainEqual(
        expect.objectContaining({
          name: "customize-opencode",
          description: expect.stringContaining("opencode's own configuration"),
        }),
      )
    }),
  )
})
