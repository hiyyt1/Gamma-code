import { expect } from "bun:test"
import path from "node:path"
import { cp, symlink, unlink } from "node:fs/promises"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Database } from "../src/database/database"
import { Location } from "../src/location"
import { AbsolutePath } from "../src/schema"
import { SkillV2 } from "../src/skill"
import { SkillMarketService } from "../src/skill-market"
import { seedLegacySkillConnection } from "./fixture/legacy-skill-market"
import { location, tempLocationLayer } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it, testEffect } from "./lib/effect"

const services = LayerNode.group([SkillV2.node, SkillMarketService.node, Database.node, Location.node])
const kit = testEffect(AppNodeBuilder.build(services, [[Location.node, tempLocationLayer]]))

kit.live("V2 excludes packages whose required delegation runtime is unavailable", () =>
  Effect.gen(function* () {
    const market = yield* SkillMarketService.Service
    const skills = yield* SkillV2.Service
    const current = yield* Location.Service
    expect(yield* market.selection(current.directory)).toEqual({ enabled: [] })
    yield* seedLegacySkillConnection(current.directory)
    expect(yield* market.sources(current.directory)).toHaveLength(1)
    expect(yield* market.sources(current.directory, "v2")).toEqual([])
    expect(yield* skills.list()).toEqual([])
    yield* market.set(current.directory, "superpowers", false, [])
    expect(yield* market.sources(current.directory)).toEqual([])
  }),
)

kit.live("all retired packages reject new connections, regardless of legacy compatibility", () =>
  Effect.gen(function* () {
    const market = yield* SkillMarketService.Service
    const current = yield* Location.Service
    expect(yield* market.catalog()).toEqual([])
    const legacy = yield* Effect.promise(() =>
      Bun.file(path.join(SkillMarketService.root(), "legacy-catalog.json")).json(),
    )
    for (const id of [...legacy.map((pkg: { id: string }) => pkg.id), "missing"])
      expect((yield* market.set(current.directory, id, true, []).pipe(Effect.flip)).code).toBe("package_not_published")
    expect(yield* market.selection(current.directory)).toEqual({ enabled: [] })
    yield* seedLegacySkillConnection(current.directory)
    expect(yield* market.set(current.directory, "superpowers", true, ["superpowers:brainstorming"])).toEqual({
      enabled: ["superpowers"],
    })
    expect(yield* market.sources(current.directory)).toHaveLength(1)
    yield* market.set(current.directory, "superpowers", false, [])
    expect((yield* market.set(current.directory, "superpowers", true, []).pipe(Effect.flip)).code).toBe(
      "package_not_published",
    )
  }),
)

it.live("selection survives fresh database and loader layers and remains isolated from project B", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    const a = AbsolutePath.make(path.join(tmp.path, "project-a"))
    const b = AbsolutePath.make(path.join(tmp.path, "project-b"))
    const fresh = (directory: AbsolutePath) =>
      AppNodeBuilder.build(services, [
        [Database.node, Database.layerFromPath(path.join(tmp.path, "state.db"))],
        [Location.node, Layer.succeed(Location.Service, Location.Service.of(location({ directory })))],
      ]).pipe(Layer.fresh)
    yield* Effect.gen(function* () {
      const market = yield* SkillMarketService.Service
      yield* seedLegacySkillConnection(a)
    }).pipe(Effect.provide(fresh(a)), Effect.scoped)
    yield* Effect.gen(function* () {
      const market = yield* SkillMarketService.Service
      const skills = yield* SkillV2.Service
      expect(yield* market.selection(a)).toEqual({ enabled: ["superpowers"] })
      expect(yield* market.sources(a)).toHaveLength(1)
      expect(yield* skills.list()).toEqual([])
    }).pipe(Effect.provide(fresh(a)), Effect.scoped)
    yield* Effect.gen(function* () {
      const skills = yield* SkillV2.Service
      expect(yield* skills.list()).toEqual([])
      const market = yield* SkillMarketService.Service
      yield* market.set(a, "superpowers", false, [])
    }).pipe(Effect.provide(fresh(b)), Effect.scoped)
    yield* Effect.gen(function* () {
      const skills = yield* SkillV2.Service
      expect(yield* skills.list()).toEqual([])
    }).pipe(Effect.provide(fresh(a)), Effect.scoped)
  }),
)

kit.live("rejects modified resources, symlinks and path traversal", () =>
  Effect.gen(function* () {
    const market = yield* SkillMarketService.Service
    const current = yield* Location.Service
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    const original = process.env.GAMMA_SKILL_MARKET_ROOT
    const source = SkillMarketService.root()
    yield* Effect.promise(async () => {
      await cp(path.join(source, "legacy-catalog.json"), path.join(tmp.path, "legacy-catalog.json"))
      await cp(path.join(source, "packages/superpowers"), path.join(tmp.path, "packages/superpowers"), {
        recursive: true,
      })
    })
    process.env.GAMMA_SKILL_MARKET_ROOT = tmp.path
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (original === undefined) delete process.env.GAMMA_SKILL_MARKET_ROOT
        if (original !== undefined) process.env.GAMMA_SKILL_MARKET_ROOT = original
      }),
    )
    const relative = "packages/superpowers/skills/brainstorming/SKILL.md"
    yield* Effect.promise(() => Bun.write(path.join(tmp.path, relative), "tampered"))
    expect((yield* market.resolve(["superpowers"], "v1").pipe(Effect.flip)).code).toBe("integrity_failed")
    yield* Effect.promise(async () => {
      await unlink(path.join(tmp.path, relative))
      await symlink(path.join(source, relative), path.join(tmp.path, relative))
      await expect(SkillMarketService.asset(relative)).rejects.toMatchObject({ code: "invalid_asset" })
      await expect(SkillMarketService.asset("../catalog.json")).rejects.toMatchObject({ code: "invalid_asset" })
      await expect(SkillMarketService.asset("/etc/passwd")).rejects.toMatchObject({ code: "invalid_asset" })
    })
    expect(yield* market.selection(current.directory)).toEqual({ enabled: [] })
  }),
)
