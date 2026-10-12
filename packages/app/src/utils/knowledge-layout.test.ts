import { expect, test } from "bun:test"
import { knowledgeLayout } from "./knowledge-layout"
import type { KnowledgeSource, Relation } from "./knowledge"

const sources: KnowledgeSource[] = Array.from({ length: 44 }, (_, i) => ({
  id: `source-${i}`,
  spaceID: "test",
  type: "note",
  name: `Material ${i}`,
  description: "",
  tags: [],
  createdAt: "2026-10-09",
  updatedAt: "2026-10-09",
}))
const relations: Relation[] = sources
  .slice(1)
  .map((source, i) => ({
    id: `edge-${i}`,
    spaceID: "test",
    source: sources[i].id,
    target: source.id,
    type: "related",
    provenance: "manual",
    metadata: {},
  }))

test("free layout is deterministic, finite, and contains only actual nodes", () => {
  const original = structuredClone(sources)
  const layout = knowledgeLayout(sources, relations)
  const reversed = knowledgeLayout(sources.toReversed(), relations.toReversed())
  expect(layout.size).toBe(sources.length)
  layout.forEach((position, id) => {
    expect(position).toEqual(reversed.get(id)!)
    expect(Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)).toBe(true)
    expect(Math.abs(position.x)).toBeLessThanOrEqual(285.0001)
    expect(Math.abs(position.y)).toBeLessThanOrEqual(160.0001)
  })
  expect(sources).toEqual(original)
})

test("layout responds to relationships and handles empty and disconnected data", () => {
  expect(knowledgeLayout([], []).size).toBe(0)
  expect(knowledgeLayout(sources.slice(0, 1), []).get(sources[0].id)?.x).toBe(0)
  expect([...knowledgeLayout(sources, relations).values()]).not.toEqual([...knowledgeLayout(sources, []).values()])
  const dangling = { ...relations[0], target: "missing" }
  expect(knowledgeLayout(sources, [dangling])).toEqual(knowledgeLayout(sources, []))
})
