import path from "node:path"
import { createHash } from "node:crypto"
import { ConfigMarkdown } from "../../packages/core/src/config/markdown"

const candidates = (await Bun.file(new URL("./candidates.json", import.meta.url)).json()) as { id: string }[]
const patterns = {
  runtime: /\b(claude(?: code)?|codex|TodoWrite|Task tool|subagent|mcp__|mcp server|hooks?|slash command)\b/i,
  dependencies: /\b(python3?|node|npm|npx|uvx?|pip3?|docker|playwright|gh|wrangler|az|aws|gcloud|curl|wget|dot)\b/i,
  sensitive:
    /\b(sudo|chmod|chown|systemctl|eval|exec|secret|api.key|token|credential)\b|rm\s+-[rf]+|git\s+(reset|clean)|curl.+\|.*(sh|bash)/i,
}
for (const candidate of candidates) {
  const review = process.env.GAMMA_SKILL_MARKET_AUDIT_ROOT ?? "/tmp/gamma-skill-market-audit"
  const root = `${review}/${candidate.id}/source`
  const files = Array.from(new Bun.Glob("**/*").scanSync({ cwd: root, dot: true, onlyFiles: true })).sort()
  const skills = await Promise.all(
    files
      .filter((file) => path.basename(file) === "SKILL.md")
      .map(async (file) => {
        const raw = await Bun.file(path.join(root, file)).text()
        const parsed = ConfigMarkdown.parseOption(raw)
        return {
          path: file,
          name: typeof parsed?.data.name === "string" ? parsed.data.name : "",
          description: typeof parsed?.data.description === "string" ? parsed.data.description : "",
          sha256: createHash("sha256").update(raw).digest("hex"),
          valid:
            !!parsed &&
            typeof parsed.data.name === "string" &&
            (parsed.data.description === undefined || typeof parsed.data.description === "string"),
        }
      }),
  )
  const findings = (
    await Promise.all(
      files
        .filter((file) => /\.(md|py|js|cjs|mjs|ts|sh|json|ya?ml)$/.test(file))
        .map(async (file) => {
          const raw = await Bun.file(path.join(root, file)).text()
          return raw.split("\n").flatMap((line, index) =>
            Object.entries(patterns)
              .filter(([, pattern]) => pattern.test(line))
              .map(([kind]) => ({ path: file, line: index + 1, kind, text: line.slice(0, 300) })),
          )
        }),
    )
  ).flat()
  const result = {
    skills,
    duplicates: skills
      .filter((skill, index) => skills.findIndex((other) => other.name === skill.name) !== index)
      .map((skill) => skill.name),
    findings,
  }
  await Bun.write(`${review}/${candidate.id}/inventory.json`, JSON.stringify(result, null, 2))
  console.log(
    candidate.id,
    skills.length,
    "skills; invalid",
    skills.filter((s) => !s.valid).length,
    "duplicates",
    result.duplicates.length,
    "findings",
    findings.length,
  )
}
