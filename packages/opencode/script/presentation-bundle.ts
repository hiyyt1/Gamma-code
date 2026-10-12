// Refresh the presentation bundle pins after intentional resource/profile edits.
import path from "node:path"
import { createHash } from "node:crypto"
import { AgentCatalog } from "@opencode-ai/core/agent-market/catalog"

const root = AgentCatalog.root()
const bundle = path.join(root, "bundles/presentation-creation")
const manifest = await Bun.file(path.join(bundle, "manifest.json")).json()
const digest = async (filename: string) =>
  createHash("sha256")
    .update(await Bun.file(filename).bytes())
    .digest("hex")
for (const filename of Object.keys(manifest.files)) manifest.files[filename] = await digest(path.join(bundle, filename))
for (const skill of manifest.skills) skill.sha256 = manifest.files[skill.path]
await Bun.write(path.join(bundle, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
const pins = await Bun.file(path.join(root, "files.json")).json()
pins["bundle:presentation-creation"] = await digest(path.join(bundle, "manifest.json"))
for (const id of [
  "presentation-creator",
  "presentation-researcher",
  "presentation-storyteller",
  "presentation-designer",
  "presentation-reviewer",
])
  pins[id] = await digest(path.join(root, "profiles", `${id}.json`))
await Bun.write(path.join(root, "files.json"), JSON.stringify(pins, null, 2) + "\n")
console.log(
  `Verified ${(await AgentCatalog.bundle("presentation-creation")).skills.length} presentation skills and all resource hashes`,
)
