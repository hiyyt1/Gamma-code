import { SessionAgent } from "./session/agent"
export * as SkillMarketService from "./skill-market"

import path from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { lstat, readFile, realpath } from "node:fs/promises"
import { and, eq } from "drizzle-orm"
import which from "which"
import { Context, Effect, Layer, Schema } from "effect"
import { SkillMarket } from "@opencode-ai/schema/skill-market"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { SkillMarketSelectionTable } from "./skill-market/sql"
import { AgentCatalog } from "./agent-market/catalog"

export class Error extends Schema.TaggedErrorClass<Error>()("SkillMarketError", { code: Schema.String }) {}

export interface Source {
  readonly id: string
  readonly revision: string
  readonly directory: string
  readonly skills: SkillMarket.Package["skills"]
}

export interface Interface {
  readonly resolve: (ids: readonly string[], runtime: "v1" | "v2") => Effect.Effect<Source[], Error>
  readonly catalog: () => Effect.Effect<readonly SkillMarket.Package[], Error>
  readonly selection: (directory: string) => Effect.Effect<{ enabled: string[] }, Error>
  readonly set: (
    directory: string,
    id: string,
    enabled: boolean,
    existingNames: readonly string[],
  ) => Effect.Effect<{ enabled: string[] }, Error>
  readonly sources: (directory: string, runtime?: "v1" | "v2") => Effect.Effect<Source[], Error>
}

export class Service extends Context.Service<Service, Interface>()("@gamma/SkillMarket") {}

export const root = () =>
  process.env.GAMMA_SKILL_MARKET_ROOT ?? fileURLToPath(new URL("../../../gamma-skill-market/", import.meta.url))

const operation = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => (error instanceof Error ? error : new Error({ code: "catalog_unavailable" })),
  })
const decodeJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)

// Refuse symlinks at every component and verify the real target. Request input
// never supplies these paths; only the shipped, schema-validated manifest does.
export async function asset(relative: string) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => !part || part === ".." || part === "."))
    throw new Error({ code: "invalid_asset" })
  const base = await realpath(root())
  const target = path.join(base, relative)
  const parts = relative.split("/")
  for (const index of parts.keys()) {
    if ((await lstat(path.join(base, ...parts.slice(0, index + 1)))).isSymbolicLink())
      throw new Error({ code: "invalid_asset" })
  }
  if ((await realpath(target)) !== target || !(await lstat(target)).isFile()) throw new Error({ code: "invalid_asset" })
  return target
}

export async function readCatalogFile(file: "catalog.json" | "legacy-catalog.json") {
  const result = Schema.decodeUnknownSync(Schema.Array(SkillMarket.Package))(
    decodeJson(await readFile(await asset(file), "utf8")),
  )
  if (new Set(result.map((pkg) => pkg.id)).size !== result.length || result.some((pkg) => !/^[a-z0-9-]+$/.test(pkg.id)))
    throw new Error({ code: "invalid_catalog" })
  return result
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const readCatalog = Effect.fn("SkillMarket.readCatalog")((file: "catalog.json" | "legacy-catalog.json") =>
      operation(() => readCatalogFile(file)),
    )
    const catalog = () => readCatalog("catalog.json")
    // Frozen V1 dependencies: never expose these through the public catalog.
    const legacy = () => readCatalog("legacy-catalog.json")
    const rows = (directory: string) =>
      database.db
        .select()
        .from(SkillMarketSelectionTable)
        .where(eq(SkillMarketSelectionTable.project_directory, directory))
        .all()
        .pipe(Effect.mapError(() => new Error({ code: "storage_failed" })))
    const selection = Effect.fn("SkillMarket.selection")(function* (directory: string) {
      return { enabled: (yield* rows(directory)).map((row) => row.package_id).sort() }
    })
    const validate = Effect.fn("SkillMarket.validate")(function* (pkg: SkillMarket.Package) {
      if (pkg.compatibility !== "verified" || !pkg.revision || !pkg.license || pkg.skills.length === 0)
        return yield* new Error({ code: "incompatible" })
      if (pkg.id === "superpowers" && !which.sync("git", { nothrow: true }))
        return yield* new Error({ code: "missing_dependency" })
      yield* operation(async () => {
        const files = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String))(
          decodeJson(await readFile(await asset(`packages/${pkg.id}/files.json`), "utf8")),
        )
        if (
          pkg.skills.some((skill) => files[skill.path] !== skill.sha256) ||
          new Set(pkg.skills.map((skill) => skill.name)).size !== pkg.skills.length
        )
          throw new Error({ code: "invalid_catalog" })
        for (const [file, checksum] of Object.entries(files)) {
          const bytes = await readFile(await asset(`packages/${pkg.id}/${file}`))
          if (createHash("sha256").update(bytes).digest("hex") !== checksum)
            throw new Error({ code: "integrity_failed" })
        }
      })
      return {
        id: pkg.id,
        revision: pkg.revision,
        directory: path.resolve(root(), "packages", pkg.id, "skills"),
        skills: pkg.skills,
      }
    })
    const sources = Effect.fn("SkillMarket.sources")(function* (directory: string, runtime: "v1" | "v2" = "v1") {
      const manual = yield* rows(directory)
      const binding = yield* SessionAgent.Current
      const profile = binding?.pin
        ? (yield* operation(() => AgentCatalog.profiles())).find((item) => item.id === binding.pin!.profile)
        : undefined
      if (profile && binding?.pin?.revisions[profile.id] !== profile.revision)
        return yield* new Error({ code: "revision_changed" })
      const bundled = profile?.skillBundle
        ? yield* operation(() => AgentCatalog.bundle(profile.skillBundle!))
        : undefined
      if (bundled && binding?.pin?.bundle !== bundled.revision) return yield* new Error({ code: "revision_changed" })
      const dependencies = profile
        ? [...new Set(profile.skills.map((skill) => skill.split(":")[0]))].filter((id) => id !== bundled?.id)
        : []
      const resolved = dependencies.length ? yield* resolve(dependencies, runtime) : []
      if (binding?.pin?.packages && resolved.some((item) => binding.pin!.packages?.[item.id] !== item.revision))
        return yield* new Error({ code: "revision_changed" })
      const selected = manual.filter(
        (item) => item.package_id !== bundled?.id && !dependencies.includes(item.package_id),
      )
      if (!selected.length) return [...resolved, ...(bundled ? [bundled] : [])]
      const packages = yield* legacy()
      const sources = yield* Effect.forEach(selected, (row) => {
        const pkg = packages.find((pkg) => pkg.id === row.package_id && pkg.revision === row.revision)
        if (!pkg) return Effect.fail(new Error({ code: "revision_changed" }))
        if (!pkg.runtimes.includes(runtime)) return Effect.succeed(undefined)
        return validate(pkg)
      })
      return [
        ...sources.filter((source): source is Source => source !== undefined),
        ...resolved,
        ...(bundled ? [bundled] : []),
      ]
    })
    const set = Effect.fn("SkillMarket.set")(function* (
      directory: string,
      id: string,
      enabled: boolean,
      _existingNames: readonly string[],
    ) {
      // Publication is paused. An exact retry preserves an existing pin; it
      // must never upgrade it or create a new connection to a retired package.
      if (enabled) {
        const selected = yield* selection(directory)
        if (selected.enabled.includes(id)) return selected
        return yield* new Error({ code: "package_not_published" })
      }
      if (!enabled)
        yield* database.db
          .delete(SkillMarketSelectionTable)
          .where(
            and(
              eq(SkillMarketSelectionTable.project_directory, directory),
              eq(SkillMarketSelectionTable.package_id, id),
            ),
          )
          .run()
          .pipe(Effect.mapError(() => new Error({ code: "storage_failed" })))
      return yield* selection(directory)
    })
    const resolve = Effect.fn("SkillMarket.resolve")(function* (ids: readonly string[], runtime: "v1" | "v2") {
      const packages = yield* legacy()
      return yield* Effect.forEach(ids, (id) => {
        const pkg = packages.find((item) => item.id === id)
        if (!pkg || !pkg.runtimes.includes(runtime)) return Effect.fail(new Error({ code: "incompatible" }))
        return validate(pkg)
      })
    })
    return Service.of({ catalog, selection, set, sources, resolve })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
