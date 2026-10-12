import { describe, expect, test } from "bun:test"
import { copyKnowledgeDemo, demoKnowledge } from "./knowledge-demo"
import { emptyKnowledge } from "./knowledge"
import { validateRelations } from "./knowledge-edit"
import { knowledgeLayout } from "./knowledge-layout"
import { publishKnowledge } from "./knowledge-sync"

describe("fictional company catalog", () => {
  test("old servers are rejected before any network or storage mutation", async () => {
    await expect(
      publishKnowledge(
        { url: "http://127.0.0.1:1" },
        { version: 0, data: emptyKnowledge(), originals: {}, spaces: [] },
        demoKnowledge,
        [],
      ),
    ).rejects.toThrow("upgrade_required")
  })
  test("has substantive materials, typed valid edges and all requested business types", () => {
    expect(demoKnowledge.sources).toHaveLength(96)
    expect(demoKnowledge.relations.length).toBeGreaterThanOrEqual(120)
    expect(demoKnowledge.relations.length).toBeLessThanOrEqual(180)
    const documents = demoKnowledge.sources.filter((source) => ["document", "note"].includes(source.type))
    expect(documents).toHaveLength(40)
    expect(documents.every((source) => (source.text?.length ?? 0) > 450)).toBe(true)
    expect(demoKnowledge.sources.filter((source) => source.entityType === "Процесс")).toHaveLength(12)
    const types = new Set(demoKnowledge.sources.map((source) => source.entityType))
    expect(types.size).toBe(20)
    expect(() => validateRelations(demoKnowledge)).not.toThrow()
    demoKnowledge.sources.forEach((source) => {
      expect(source.description.length).toBeGreaterThan(25)
      expect(source.tags).toContain("Вымышленная компания")
      expect(demoKnowledge.relations.some((edge) => edge.source === source.id || edge.target === source.id)).toBe(true)
      if (source.documentID) expect(documents.some((document) => document.id === source.documentID)).toBe(true)
    })
    expect(demoKnowledge.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "demo-maria", target: "demo-calibration" }),
        expect.objectContaining({ source: "demo-calibration", target: "demo-beans" }),
        expect.objectContaining({ source: "demo-roaster", target: "demo-beans" }),
        expect.objectContaining({ source: "demo-contract-beans", target: "demo-roaster" }),
      ]),
    )
  })

  test("copy preserves user data, remaps document references and never mutates the catalog", () => {
    const original = structuredClone(demoKnowledge)
    const first = copyKnowledgeDemo(emptyKnowledge(), "copy-a", "2026-10-11")
    const second = copyKnowledgeDemo(first, "copy-b", "2026-10-12")
    expect(second.spaces).toHaveLength(2)
    expect(second.sources.filter((source) => source.spaceID === "copy-a")).toEqual(first.sources)
    expect(first.spaces).toHaveLength(1)
    expect(demoKnowledge).toEqual(original)
    expect(() => validateRelations(second)).not.toThrow()
    expect(() => copyKnowledgeDemo(first, "copy-a", "2026-10-11")).toThrow("duplicate")
    second.sources.forEach((source) => {
      if (source.documentID)
        expect(
          second.sources.some((target) => target.id === source.documentID && target.spaceID === source.spaceID),
        ).toBe(true)
    })
  })

  test("bounded layout is deterministic for 100+ nodes", () => {
    const sources = [
      ...demoKnowledge.sources,
      ...demoKnowledge.sources.slice(0, 24).map((source) => ({ ...source, id: `extra-${source.id}` })),
    ]
    const start = performance.now()
    const layout = knowledgeLayout(sources, demoKnowledge.relations)
    expect(layout.size).toBe(120)
    expect(performance.now() - start).toBeLessThan(2000)
    expect(knowledgeLayout(sources.toReversed(), demoKnowledge.relations.toReversed())).toEqual(layout)
    expect(Array.from(layout.values()).every((position) => Object.values(position).every(Number.isFinite))).toBe(true)
  })
})
