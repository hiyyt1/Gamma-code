import { expect } from "bun:test"
import path from "node:path"
import { cp, writeFile } from "node:fs/promises"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Database } from "../src/database/database"
import { AgentMarketService } from "../src/agent-market"
import { AgentCatalog } from "../src/agent-market/catalog"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

it.live("all market and child configurations validate as native OpenCode agents", () =>
  Effect.gen(function* () {
    const catalog = yield* Effect.promise(() => AgentCatalog.profiles())
    expect(catalog.filter((item) => item.type === "specialist" && !item.hidden)).toHaveLength(16)
    expect(catalog.filter((item) => item.hidden)).toHaveLength(16)
    expect(catalog.filter((item) => item.type === "team")).toHaveLength(3)
    for (const profile of catalog) {
      const config = yield* Effect.promise(() => AgentCatalog.config(profile.id))
      expect(config.prompt?.length).toBeGreaterThan(500)
      expect(config.permission).toBeDefined()
      expect(profile.revision).toMatch(/^[a-f0-9]{40}$/)
    }
  }),
)

it.live("persistent binding and idempotent result survive fresh database/service layers", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    const directory = path.join(tmp.path, "project-a")
    const layer = () =>
      AppNodeBuilder.build(AgentMarketService.node, [
        [Database.node, Database.layerFromPath(path.join(tmp.path, "state.db"))],
      ]).pipe(Layer.fresh)
    const input = {
      agentId: "website-builder",
      expectedVersion: 0,
      confirmed: false,
      connectSkills: false,
      requestId: crypto.randomUUID(),
    }
    const first = yield* Effect.gen(function* () {
      const market = yield* AgentMarketService.Service
      return yield* market.apply(directory, input, Effect.succeed("persisted-session"), () => Effect.succeed(true))
    }).pipe(Effect.provide(layer()), Effect.scoped)
    yield* Effect.gen(function* () {
      const market = yield* AgentMarketService.Service
      expect(yield* market.selection(directory)).toEqual({ agentId: null, version: 0, revision: null })
      expect(yield* market.selection(path.join(tmp.path, "project-b"))).toEqual({
        agentId: null,
        version: 0,
        revision: null,
      })
      expect(
        yield* market.apply(directory, input, Effect.die("must not create duplicate session"), () =>
          Effect.succeed(true),
        ),
      ).toEqual(first)
      const writes = yield* Effect.all(
        ["backend-developer", "ui-ux-designer"].map((agentId) =>
          market
            .apply(
              directory,
              {
                ...input,
                agentId,
                expectedVersion: 1,
                confirmed: true,
                connectSkills: true,
                requestId: crypto.randomUUID(),
              },
              Effect.succeed(`session-${agentId}`),
              () => Effect.succeed(true),
            )
            .pipe(Effect.result),
        ),
        { concurrency: "unbounded" },
      )
      expect(writes.filter((result) => result._tag === "Success")).toHaveLength(2)
      expect(writes.filter((result) => result._tag === "Failure")).toHaveLength(0)
      expect((yield* market.selection(directory)).version).toBe(0)
    }).pipe(Effect.provide(layer()), Effect.scoped)
  }),
)

it.live("tampered profile is unavailable and cannot create a partial project binding", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    const original = AgentCatalog.root()
    const override = process.env.GAMMA_AGENT_MARKET_ROOT
    yield* Effect.promise(() => cp(original, path.join(tmp.path, "catalog"), { recursive: true }))
    process.env.GAMMA_AGENT_MARKET_ROOT = path.join(tmp.path, "catalog")
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (override === undefined) delete process.env.GAMMA_AGENT_MARKET_ROOT
        if (override !== undefined) process.env.GAMMA_AGENT_MARKET_ROOT = override
      }),
    )
    yield* Effect.promise(() => writeFile(path.join(AgentCatalog.root(), "profiles", "website-builder.json"), "{}"))
    const bundled = yield* Effect.promise(() => AgentCatalog.bundle("1c-development"))
    expect(bundled.skills).toHaveLength(30)
    yield* Effect.promise(() => writeFile(path.join(bundled.directory, "1c-environment/scripts/check.py"), "modified"))
    yield* Effect.promise(async () => {
      await expect(AgentCatalog.bundle("1c-development")).rejects.toThrow("integrity_failed")
    })
    yield* Effect.gen(function* () {
      const market = yield* AgentMarketService.Service
      expect((yield* market.catalog()).find((profile) => profile.id === "website-builder")?.available).toBe(false)
      const result = yield* market
        .apply(
          tmp.path,
          {
            agentId: "website-builder",
            expectedVersion: 0,
            confirmed: false,
            connectSkills: false,
            requestId: crypto.randomUUID(),
          },
          Effect.die("must not create a session"),
          () => Effect.succeed(true),
        )
        .pipe(Effect.flip)
      expect(result.code).toBe("agent_unavailable")
      expect(yield* market.selection(tmp.path)).toEqual({ agentId: null, version: 0, revision: null })
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(AgentMarketService.node, [
          [Database.node, Database.layerFromPath(path.join(tmp.path, "state.db"))],
        ]),
      ),
      Effect.scoped,
    )
  }),
)
