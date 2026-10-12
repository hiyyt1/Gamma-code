import { expect, test } from "bun:test"
import {
  nodePresets,
  nodeIcons,
  nodePalette,
  nodeSizes,
  nodeStyles,
  editKnowledge,
  knowledgeExportPlan,
  suggestedFilename,
  validateRelations,
} from "./knowledge-edit"
import { emptyKnowledge, type KnowledgeSource, type Relation } from "./knowledge"
const node = (id: string, spaceID = "space"): KnowledgeSource => ({
  id,
  spaceID,
  type: "document",
  name: id,
  description: "Use for planning",
  tags: [],
  createdAt: "2026-10-09",
  updatedAt: "2026-10-09",
})
const edge = (source: string, target: string, type = "USES"): Relation => ({
  id: `${source}:${target}:${type}`,
  source,
  target,
  spaceID: "space",
  type,
  origin: "manual",
  provenance: "manual",
  createdAt: "2026-10-09",
  metadata: {},
})
const data = () => ({
  ...emptyKnowledge(),
  spaces: [{ id: "space", name: "Space", description: "", createdAt: "", updatedAt: "" }],
  sources: [node("a"), node("b"), node("c", "other")],
})
test("rejects self, missing and cross-space relations", () => {
  for (const target of ["a", "missing", "c"])
    expect(() => validateRelations({ ...data(), relations: [edge("a", target)] })).toThrow()
})
test("directed reversals are distinct; symmetric reversals and duplicates are rejected", () => {
  expect(() => validateRelations({ ...data(), relations: [edge("a", "b"), edge("b", "a")] })).not.toThrow()
  expect(() =>
    validateRelations({ ...data(), relations: [edge("a", "b"), { ...edge("a", "b"), id: "second" }] }),
  ).toThrow()
  expect(() =>
    validateRelations({ ...data(), relations: [edge("a", "b", "RELATED_TO"), edge("b", "a", "RELATED_TO")] }),
  ).toThrow()
})
test("authors Markdown blobs without modifying unrelated materials", async () => {
  const original = data()
  const source = {
    ...node("new"),
    authored: true,
    filename: "plan.md",
    text: "# Plan\n\nReal content",
    visual: { color: "#a8d2f3", size: "featured" as const },
  }
  const result = editKnowledge(original, source, [edge("new", "a")])
  expect(await result.files[0].file.text()).toBe(source.text)
  expect(result.data.sources.slice(0, 3)).toEqual(original.sources)
  expect(original.sources).toHaveLength(3)
  expect(result.data.sources[3].visual).toEqual(source.visual)
  expect(result.data.jobs[0].status).toBe("stored")
})
test("editing uploaded text preserves originals and incoming direction", () => {
  const original = data()
  original.sources[0] = { ...original.sources[0], filename: "uploaded.md", text: "original" }
  original.relations = [edge("b", "a")]
  const result = editKnowledge(original, { ...original.sources[0], text: "edited" }, [
    { ...original.relations[0], type: "DESCRIBES" },
  ])
  expect(result.files).toEqual([])
  expect(result.data.relations[0].source).toBe("b")
  expect(result.data.relations[0].type).toBe("DESCRIBES")
})
test("validates filenames and titles", () => {
  for (const filename of ["../plan.md", "folder/plan.md", ".hidden.md", "bad.txt"])
    expect(() => editKnowledge(data(), { ...node("new"), filename, authored: true }, [])).toThrow()
  const original = data()
  original.sources[0].filename = "PLAN.md"
  expect(() => editKnowledge(original, { ...node("new"), filename: "plan.md", authored: true }, [])).toThrow()
  expect(() => editKnowledge(data(), { ...node("new"), name: " " }, [])).toThrow()
  expect(suggestedFilename("Architecture / APIs")).toBe("Architecture - APIs.md")
})
test("export plan uses bounded paths and preserves typed relations", () => {
  const original = data()
  original.sources[0].filename = "../../input.md"
  original.relations = [edge("a", "b")]
  const plan = knowledgeExportPlan(original, "space")
  expect(plan.files[0].path).toBe("knowledge/INDEX.md")
  expect(plan.files[0].text).toContain("materials/a.md")
  expect(JSON.parse(plan.files.at(-1)!.text)[0].type).toBe("USES")
  expect(plan.originals[0].path).not.toContain("../")
})

test("appearance presets preserve content, relationships and legacy visuals", () => {
  const original = data()
  original.relations = [edge("a", "b")]
  for (const visual of [
    undefined,
    { color: "#b69af0", icon: "document", size: "featured" } as const,
    ...Object.values(nodePresets),
  ]) {
    const source = { ...original.sources[0], text: "unchanged", visual }
    const saved = editKnowledge(original, source, original.relations)
    expect(saved.data.sources[0].visual).toEqual(visual)
    expect(saved.data.sources[0].text).toBe("unchanged")
    expect(saved.data.relations).toEqual(original.relations)
    expect(saved.data.sources.slice(1)).toEqual(original.sources.slice(1))
    expect(saved.files).toEqual([])
  }
})

test("all appearance choices save and invalid sizes and styles are rejected", () => {
  for (const color of nodePalette)
    for (const icon of nodeIcons)
      for (const size of Object.keys(nodeSizes) as (keyof typeof nodeSizes)[])
        for (const style of nodeStyles) {
          const visual = { color, icon, size, style }
          expect(editKnowledge(data(), { ...node("a"), visual }, []).data.sources[0].visual).toEqual(visual)
        }
  for (const visual of [{ style: "unknown" }, { size: "enormous" }])
    expect(() => editKnowledge(data(), { ...node("a"), visual: visual as KnowledgeSource["visual"] }, [])).toThrow(
      "visual",
    )
})
