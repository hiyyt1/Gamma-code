import type { KnowledgeSource, Relation } from "./knowledge"

// A deterministic, bounded spring layout. Only existing relations attract nodes;
// no category centres, containers, synthetic nodes or persisted data are added.
export function knowledgeLayout(sources: KnowledgeSource[], relations: Relation[]) {
  const nodes = sources
    .toSorted((a, b) => a.id.localeCompare(b.id))
    .slice(0, 250)
    .map((source) => {
      const hash = (salt: string) =>
        Array.from(`${salt}:${source.id}`).reduce(
          (value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0,
          2166136261,
        ) / 4294967295
      return { id: source.id, x: (hash("x") - 0.5) * 480, y: (hash("y") - 0.5) * 320, z: (hash("depth") - 0.5) * 90 }
    })
  const indices = new Map(nodes.map((node, index) => [node.id, index]))
  const links = relations
    .flatMap((relation) => {
      const source = indices.get(relation.source)
      const target = indices.get(relation.target)
      return source === undefined || target === undefined || source === target ? [] : [{ source, target }]
    })
    .toSorted((a, b) => a.source - b.source || a.target - b.target)
  // One finite calculation on data changes; orbit/drag never restart a simulation.
  for (let iteration = 0; iteration < 150; iteration++) {
    const force = nodes.map((node) => ({ x: -node.x * 0.006, y: -node.y * 0.006 }))
    nodes.forEach((node, i) => {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = node.x - nodes[j].x || 0.01
        const dy = node.y - nodes[j].y || 0.01
        const distance = Math.max(8, Math.hypot(dx, dy))
        const strength = 1600 / (distance * distance)
        force[i].x += (dx / distance) * strength
        force[i].y += (dy / distance) * strength
        force[j].x -= (dx / distance) * strength
        force[j].y -= (dy / distance) * strength
      }
    })
    links.forEach((link) => {
      const dx = nodes[link.target].x - nodes[link.source].x
      const dy = nodes[link.target].y - nodes[link.source].y
      const distance = Math.max(1, Math.hypot(dx, dy))
      const strength = (distance - 85) * 0.024
      force[link.source].x += (dx / distance) * strength
      force[link.source].y += (dy / distance) * strength
      force[link.target].x -= (dx / distance) * strength
      force[link.target].y -= (dy / distance) * strength
    })
    const step = 1 - iteration / 180
    nodes.forEach((node, i) => {
      node.x += Math.max(-7, Math.min(7, force[i].x)) * step
      node.y += Math.max(-7, Math.min(7, force[i].y)) * step
    })
  }
  const cx = nodes.reduce((sum, node) => sum + node.x, 0) / Math.max(1, nodes.length)
  const cy = nodes.reduce((sum, node) => sum + node.y, 0) / Math.max(1, nodes.length)
  const width = Math.max(100, ...nodes.map((node) => Math.abs(node.x - cx)))
  const height = Math.max(100, ...nodes.map((node) => Math.abs(node.y - cy)))
  return new Map(
    nodes.map((node) => [node.id, { x: ((node.x - cx) / width) * 285, y: ((node.y - cy) / height) * 160, z: node.z }]),
  )
}
