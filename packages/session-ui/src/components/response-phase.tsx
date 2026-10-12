import type { Part } from "@opencode-ai/sdk/v2"

// Only observed output is evidence of generation; busy alone includes API wait time.
export function responsePhase(parts: readonly Part[]) {
  const output = parts.findLast((part) => (part.type === "text" || part.type === "reasoning") && part.text.length > 0)
  if (output?.type === "reasoning" && !output.time.end) return "reasoning"
  if (output) return "generating"
  return "waiting"
}
