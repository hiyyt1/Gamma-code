import { expect, test } from "bun:test"
import { responsePhase } from "./response-phase"
import type { Part } from "@opencode-ai/sdk/v2"

const base = { id: "part", sessionID: "session", messageID: "message" }

test("API wait and empty reasoning start are not evidence of thinking", () => {
  expect(responsePhase([])).toBe("waiting")
  expect(responsePhase([{ ...base, type: "reasoning", text: "", time: { start: 1 } }])).toBe("waiting")
})

test("observed reasoning and answer deltas select distinct phases", () => {
  const parts: Part[] = [{ ...base, type: "reasoning", text: "Considering", time: { start: 1 } }]
  expect(responsePhase(parts)).toBe("reasoning")
  parts.push({ ...base, id: "answer", type: "text", text: "Answer", time: { start: 2 } })
  expect(responsePhase(parts)).toBe("generating")
})

test("completed reasoning is not described as ongoing thinking", () => {
  expect(responsePhase([{ ...base, type: "reasoning", text: "Considered", time: { start: 1, end: 2 } }])).toBe(
    "generating",
  )
})
