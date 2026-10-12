export * as AgentCatalog from "./catalog"

import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFile, realpath, lstat } from "node:fs/promises"
import { createHash } from "node:crypto"
import { Schema } from "effect"
import { AgentMarket } from "@opencode-ai/schema/agent-market"
import { ConfigAgentV1 } from "../v1/config/agent"
import { SkillMarket } from "@opencode-ai/schema/skill-market"

export const root = () =>
  process.env.GAMMA_AGENT_MARKET_ROOT ?? fileURLToPath(new URL("../../../../gamma-agent-market/", import.meta.url))
const decode = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)

export async function profiles() {
  const catalog = Schema.decodeUnknownSync(Schema.Array(AgentMarket.Profile))(
    decode(await readFile(path.join(root(), "catalog.json"), "utf8")),
  )
  if (new Set(catalog.map((item) => item.id)).size !== catalog.length) throw new Error("invalid_catalog")
  return catalog
}

export async function config(id: string) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("invalid_agent")
  const profile = (await profiles()).find((item) => item.id === id)
  if (!profile?.available || profile.license !== "MIT" || !/^[a-f0-9]{40}$/.test(profile.revision))
    throw new Error("agent_unavailable")
  const target = path.join(root(), "profiles", `${id}.json`)
  if ((await lstat(target)).isSymbolicLink() || (await realpath(target)) !== target) throw new Error("integrity_failed")
  const bytes = await readFile(target)
  const files = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String))(
    decode(await readFile(path.join(root(), "files.json"), "utf8")),
  )
  if (files[id] !== createHash("sha256").update(bytes).digest("hex")) throw new Error("integrity_failed")
  return Schema.decodeUnknownSync(ConfigAgentV1.Info)(decode(bytes.toString("utf8")))
}

const Bundle = Schema.Struct({
  id: Schema.String,
  revision: Schema.String,
  skills: Schema.Array(SkillMarket.Skill),
  files: Schema.Record(Schema.String, Schema.String),
})

// Bundles belong to agent profiles, never to the retired public Skill Market.
export async function bundle(id: string) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("invalid_bundle")
  const base = await realpath(root())
  const asset = async (relative: string) => {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => !part || part === "." || part === ".."))
      throw new Error("invalid_bundle_path")
    const target = path.join(base, "bundles", id, relative)
    const parts = ["bundles", id, ...relative.split("/")]
    for (const index of parts.keys())
      if ((await lstat(path.join(base, ...parts.slice(0, index + 1)))).isSymbolicLink())
        throw new Error("invalid_bundle_path")
    if ((await realpath(target)) !== target || !(await lstat(target)).isFile()) throw new Error("invalid_bundle_path")
    return readFile(target)
  }
  const bytes = await asset("manifest.json")
  const pins = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String))(
    decode(await readFile(path.join(base, "files.json"), "utf8")),
  )
  if (pins[`bundle:${id}`] !== createHash("sha256").update(bytes).digest("hex")) throw new Error("integrity_failed")
  const manifest = Schema.decodeUnknownSync(Bundle)(decode(bytes.toString("utf8")))
  if (manifest.id !== id || new Set(manifest.skills.map((skill) => skill.name)).size !== manifest.skills.length)
    throw new Error("invalid_bundle")
  for (const [file, hash] of Object.entries(manifest.files))
    if (
      createHash("sha256")
        .update(await asset(file))
        .digest("hex") !== hash
    )
      throw new Error("integrity_failed")
  if (manifest.skills.some((skill) => manifest.files[skill.path] !== skill.sha256)) throw new Error("invalid_bundle")
  return {
    id,
    revision: manifest.revision,
    directory: path.join(base, "bundles", id, "skills"),
    skills: manifest.skills,
  }
}
