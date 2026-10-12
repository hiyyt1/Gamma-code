import { validateURL, type KnowledgeData, type KnowledgeSource, type Relation } from "./knowledge"

export const relationTypes = [
  "RELATED_TO",
  "DEPENDS_ON",
  "USES",
  "PART_OF",
  "DESCRIBES",
  "COMPLEMENTS",
  "WORKS_IN",
  "HAS_ROLE",
  "BELONGS_TO",
  "VISITS",
  "SUPPLIES",
  "STORED_IN",
  "LOCATED_IN",
  "RESPONSIBLE_FOR",
  "CONTAINS",
  "REGULATES",
  "AGREEMENT_WITH",
] as const
export const nodePalette = [
  "#b69af0",
  "#aa83ee",
  "#a8d2f3",
  "#c0abeb",
  "#bac6e7",
  "#7455f6",
  "#a4d9c8",
  "#b8d9ae",
  "#f3bea5",
  "#e6b5d3",
] as const
export const nodeIconNames = {
  document: "code-lines",
  note: "edit",
  link: "link",
  entity: "models",
  project: "folder",
  idea: "brain",
  code: "code",
  database: "server",
  settings: "settings-gear",
  users: "subagent",
  chart: "branch",
  image: "photo",
  shield: "shield",
  important: "circle-check",
  task: "checklist",
  tool: "sliders",
} as const
export const nodeIcons = Object.keys(nodeIconNames) as (keyof typeof nodeIconNames)[]
export const nodeSizes = { compact: 0.8, standard: 1, large: 1.1, featured: 1.2 } as const
export const nodeStyles = ["glow", "outline", "glass"] as const
export const nodePresets = {
  document: { color: "#b69af0", icon: "document", size: "standard", style: "glow" },
  note: { color: "#a8d2f3", icon: "note", size: "compact", style: "glow" },
  link: { color: "#a4d9c8", icon: "link", size: "standard", style: "outline" },
  idea: { color: "#f3bea5", icon: "idea", size: "large", style: "glass" },
  important: { color: "#e6b5d3", icon: "important", size: "featured", style: "glow" },
  technical: { color: "#bac6e7", icon: "code", size: "standard", style: "glass" },
} as const
export function nodeColor(source: KnowledgeSource) {
  return (
    source.visual?.color ??
    (source.type === "project"
      ? "#aa83ee"
      : source.type === "note"
        ? "#a8d2f3"
        : source.type === "entity"
          ? "#c0abeb"
          : "#b69af0")
  )
}

export function suggestedFilename(name: string) {
  return `${
    name
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\.+$/g, "")
      .slice(0, 100) || "material"
  }.md`
}

export function validateRelations(data: KnowledgeData) {
  const nodes = new Map(data.sources.map((source) => [source.id, source]))
  const keys = new Set<string>()
  const ids = new Set<string>()
  data.relations.forEach((relation) => {
    if (!relation.type.trim() || relation.type.length > 120) throw new Error("relation")
    const source = nodes.get(relation.source)
    const target = nodes.get(relation.target)
    if (
      !source ||
      !target ||
      source.id === target.id ||
      source.spaceID !== target.spaceID ||
      source.spaceID !== relation.spaceID
    )
      throw new Error("relation")
    const ends = relation.type === "RELATED_TO" ? [source.id, target.id].sort() : [source.id, target.id]
    const key = JSON.stringify([relation.spaceID, relation.type, ...ends])
    if (keys.has(key) || ids.has(relation.id)) throw new Error("duplicate")
    keys.add(key)
    ids.add(relation.id)
  })
}

// Produces one atomic metadata/blob update. Uploaded originals are immutable;
// edited text is a material revision in metadata, not a replacement original.
export function editKnowledge(data: KnowledgeData, source: KnowledgeSource, relations: Relation[], original?: File) {
  const next = structuredClone(data)
  const previous = next.sources.find((item) => item.id === source.id)
  if (!next.spaces.some((space) => space.id === source.spaceID)) throw new Error("space")
  if (!source.name.trim() || source.name.length > 120) throw new Error("name")
  if (source.url) validateURL(source.url)
  if (source.type === "link" && !source.url) throw new Error("url")
  if (source.entityType !== undefined && (!source.entityType.trim() || source.entityType.length > 120))
    throw new Error("type")
  if (
    source.documentID &&
    !data.sources.some(
      (item) =>
        item.id === source.documentID &&
        item.spaceID === source.spaceID &&
        item.id !== source.id &&
        ["document", "note", "link"].includes(item.type),
    )
  )
    throw new Error("document")
  if (previous && previous.spaceID !== source.spaceID) throw new Error("space")
  if (
    source.authored &&
    (!source.filename || !/^[^<>:"/\\|?*\u0000-\u001f]+\.md$/i.test(source.filename) || source.filename.startsWith("."))
  )
    throw new Error("filename")
  if (source.visual?.color && !nodePalette.includes(source.visual.color as (typeof nodePalette)[number]))
    throw new Error("visual")
  if (source.visual?.icon && !nodeIcons.includes(source.visual.icon)) throw new Error("visual")
  if (source.visual?.size && !Object.hasOwn(nodeSizes, source.visual.size)) throw new Error("visual")
  if (source.visual?.style && !nodeStyles.includes(source.visual.style)) throw new Error("visual")
  if (
    source.filename &&
    next.sources.some(
      (item) =>
        item.id !== source.id &&
        item.spaceID === source.spaceID &&
        item.filename?.toLocaleLowerCase() === source.filename?.toLocaleLowerCase(),
    )
  )
    throw new Error("filename")
  const now = new Date().toISOString()
  const material = { ...source, name: source.name.trim(), updatedAt: now }
  if (previous) next.sources = next.sources.map((item) => (item.id === source.id ? material : item))
  if (!previous) next.sources.push(material)
  const existing = next.relations.filter((edge) => edge.source === source.id || edge.target === source.id)
  if (
    relations.some(
      (edge) =>
        (edge.source !== source.id && edge.target !== source.id) ||
        (!relationTypes.includes(edge.type as (typeof relationTypes)[number]) &&
          !existing.some((old) => old.id === edge.id && old.type === edge.type)),
    )
  )
    throw new Error("relation")
  next.relations = [
    ...next.relations.filter((edge) => edge.source !== source.id && edge.target !== source.id),
    ...relations,
  ]
  validateRelations(next)
  const blob = source.authored ? new Blob([source.text ?? ""], { type: "text/markdown" }) : original
  if (blob) material.size = blob.size
  if (!previous)
    next.jobs.push({
      id: crypto.randomUUID(),
      sourceID: source.id,
      spaceID: source.spaceID,
      status: source.text === undefined ? "waiting" : "stored",
      attempts: 0,
      updatedAt: now,
    })
  if (source.text !== undefined)
    next.jobs
      .filter((job) => job.sourceID === source.id)
      .forEach((job) => Object.assign(job, { status: "stored", updatedAt: now }))
  return { data: next, files: blob ? [{ id: source.id, file: blob }] : [] }
}

// Export contract for the existing file tools. No disk access or permissions
// are granted here. Callers can later write these paths inside an allowed root.
export function knowledgeExportPlan(data: KnowledgeData, spaceID: string) {
  const space = data.spaces.find((item) => item.id === spaceID)
  if (!space) throw new Error("space")
  const escape = (text: string) => text.replace(/[\\\[\]<>`*#]/g, "\\$&").replace(/[\r\n]+/g, " ")
  const sources = data.sources.filter((item) => item.spaceID === spaceID)
  const materials = sources.map((source) => ({
    path: `knowledge/materials/${encodeURIComponent(source.id)}.md`,
    text: `# ${escape(source.name)}\n\n${escape(source.description)}\n\n${source.text ?? source.url ?? ""}\n`,
  }))
  return {
    files: [
      {
        path: "knowledge/INDEX.md",
        text: `# ${escape(space.name)}\n\n${sources.map((source, index) => `- [${escape(source.name)}](${materials[index].path.slice(10)}): ${escape(source.description)}`).join("\n")}\n`,
      },
      ...materials,
      {
        path: "knowledge/relations.json",
        text: JSON.stringify(
          data.relations.filter((edge) => edge.spaceID === spaceID),
          null,
          2,
        ),
      },
    ],
    originals: sources
      .filter((source) => source.filename)
      .map((source) => ({
        id: source.id,
        path: `knowledge/sources/${encodeURIComponent(source.id)}-${encodeURIComponent(source.filename!)}`,
      })),
  }
}
