import { expect } from "bun:test"
import path from "node:path"
import { createHash } from "node:crypto"
import { Effect, Schema } from "effect"
import { SkillMarket } from "@opencode-ai/schema/skill-market"
import { SkillV2 } from "../src/skill"
import { AbsolutePath } from "../src/schema"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { testEffect } from "./lib/effect"
import { Location } from "../src/location"
import { tempLocationLayer } from "./fixture/location"

const it = testEffect(AppNodeBuilder.build(SkillV2.node, [[Location.node, tempLocationLayer]]))
const root = path.resolve(import.meta.dirname, "../../../gamma-skill-market")

it.live("retired catalog remains reproducible and Superpowers loads with the native engine", () =>
  Effect.gen(function* () {
    const catalog = yield* Effect.promise(async () =>
      Schema.decodeUnknownSync(Schema.Array(SkillMarket.Package))(
        await Bun.file(path.join(root, "legacy-catalog.json")).json(),
      ),
    )
    expect(yield* Effect.promise(() => Bun.file(path.join(root, "catalog.json")).json())).toEqual([])
    expect(catalog).toHaveLength(20)
    expect(new Set(catalog.map((pkg) => pkg.id)).size).toBe(20)
    for (const pkg of catalog) {
      expect(pkg.revision).toMatch(/^[a-f0-9]{40}$/)
      expect(new Set(pkg.skills.map((skill) => skill.name)).size).toBe(pkg.skills.length)
      const manifest = yield* Effect.promise(() =>
        Bun.file(path.join(root, "packages", pkg.id, "manifest.json")).json(),
      )
      expect(manifest).toEqual(pkg)
    }
    const pkg = catalog.find((pkg) => pkg.id === "superpowers")!
    for (const skill of pkg.skills) {
      const content = yield* Effect.promise(() => Bun.file(path.join(root, "packages", pkg.id, skill.path)).text())
      expect(createHash("sha256").update(content).digest("hex")).toBe(skill.sha256)
      expect(content).toContain("Gamma / OpenCode adaptation")
    }
    const skills = yield* SkillV2.Service
    yield* skills.transform((draft) =>
      draft.source({ type: "directory", path: AbsolutePath.make(path.join(root, "packages/superpowers/skills")) }),
    )
    const loaded = yield* skills.list()
    expect(loaded.map((skill) => skill.name).sort()).toEqual(pkg.skills.map((skill) => skill.name).sort())
    expect(loaded.every((skill) => !!skill.content && !!skill.description)).toBe(true)
    expect(loaded.find((skill) => skill.name === "verification-before-completion")?.content).toContain("evidence")
  }),
)
