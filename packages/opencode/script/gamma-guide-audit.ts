// Run after reviewing guide resources against changed product code.
import path from "node:path"
import { createHash } from "node:crypto"
import { guideSkills } from "@opencode-ai/core/gamma/system"

const root = path.resolve(import.meta.dir, "../../..")
const target = path.join(root, "packages/core/src/gamma/knowledge-sources.json")
const sources = [
  ...new Set(
    guideSkills.flatMap((skill) => [...skill.content.matchAll(/packages\/[\w/.-]+\.tsx?/g)].map((match) => match[0])),
  ),
].sort()
const current = Object.fromEntries(
  await Promise.all(
    sources.map(async (file) => [
      file,
      createHash("sha256")
        .update(new Uint8Array(await Bun.file(path.join(root, file)).arrayBuffer()))
        .digest("hex"),
    ]),
  ),
)
if (process.argv.includes("--refresh")) {
  await Bun.write(
    target,
    JSON.stringify({ reviewed: new Date().toISOString().slice(0, 10), sources: current }, null, 2) + "\n",
  )
  console.log(`Recorded ${sources.length} reviewed product sources`)
} else {
  const saved = (await Bun.file(target).json()) as { sources: Record<string, string> }
  const changed = [...new Set([...Object.keys(saved.sources), ...sources])].filter(
    (file) => saved.sources[file] !== current[file],
  )
  if (changed.length) throw new Error(`Review Gamma Guide knowledge, then refresh audit:\n${changed.join("\n")}`)
  console.log(`Gamma Guide knowledge matches ${sources.length} audited product sources`)
}
