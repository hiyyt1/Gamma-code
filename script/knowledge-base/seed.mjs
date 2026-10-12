import { spaceID, name, description, clusters, materials, bridges } from './data.mjs'

// Run on an already open Gamma Vite page, in that browser's own origin/profile:
// await import('/@fs/home/nikita/menti/mvp_platform/script/knowledge-base/seed.mjs').then(m => m.seedKnowledge())
// No direct IndexedDB writes: the app's existing validator and atomic revision-aware save own persistence.
export async function seedKnowledge() {
  const { readKnowledge, saveKnowledge, validateMaterial, validateURL } = await import('../../packages/app/src/utils/knowledge.ts')
  const data = await readKnowledge()
  const existing = data.spaces.find(s => s.id === spaceID)
  if (existing) return { status: 'exists', spaceID, materials: data.sources.filter(s => s.spaceID === spaceID && s.type !== 'entity').length }
  if (data.spaces.some(s => s.name === name)) throw new Error('A space with this name already exists; nothing was changed.')
  if ([...data.sources, ...data.relations, ...data.jobs].some(s => s.id.startsWith(`${spaceID}:`)))
    throw new Error('Seed ID collision; nothing was changed.')
  const now = new Date().toISOString()
  const id = value => `${spaceID}:${value}`
  const common = cluster => ({ spaceID, tags: ['Тестовые данные', clusters.find(c => c[0] === cluster)[1]], createdAt: now, updatedAt: now })
  const files = []
  const sources = materials.map(([key, cluster, format, title, content, annotation]) => {
    const type = format === 'note' ? 'note' : format === 'link' ? 'link' : 'document'
    const source = {
      ...common(cluster), id: id(key), type, name: title,
      description: `Тестовый материал, создан вручную. ${annotation ?? content.replace(/^#+ /gm, '').split('\n').filter(Boolean).slice(0, 2).join(' ').slice(0, 240)}`,
    }
    if (type === 'link') return { ...source, url: validateURL(content) }
    const text = `ТЕСТОВЫЕ ДАННЫЕ · Вымышленный проект, не описание работающих функций Gamma.\n\n${content}\n`
    if (type === 'note') return { ...source, text }
    const file = new File([text], `${key}.${format}`, { type: format === 'md' ? 'text/markdown' : 'text/plain' })
    validateMaterial(file)
    files.push({ id: source.id, file })
    return { ...source, text, filename: file.name, mime: file.type, size: file.size }
  })
  const entities = clusters.map(([key, title]) => ({
    ...common(key), id: id(key), type: 'entity', name: title,
    description: `Тестовая тема «${title}». Связи составлены вручную для учебного проекта; автоматическое извлечение не выполнялось.`,
  }))
  // Existing graph places user nodes deterministically by array index, without community detection.
  // Group nearby angular slots in that layout; no schema/layout changes or fake demo coordinates.
  const count = sources.length + entities.length
  const slots = Array.from({ length: count }, (_, i) => ({
    i, angle: Math.atan2(Math.sin(i * 2.399963), Math.cos(i * 2.399963)),
    x: Math.cos(i * 2.399963) * Math.sqrt(i / (count - 1)),
    y: Math.sin(i * 2.399963) * Math.sqrt(i / (count - 1)),
  })).sort((a, b) => a.angle - b.angle)
  const ordered = Array(count)
  clusters.forEach(([key], index) => {
    const members = sources.filter(s => s.tags[1] === clusters[index][1])
    const group = slots.splice(0, members.length + 1)
    const center = { x: group.reduce((n, s) => n + s.x, 0) / group.length, y: group.reduce((n, s) => n + s.y, 0) / group.length }
    group.sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y))
    ordered[group[0].i] = entities[index]
    members.forEach((source, i) => { ordered[group[i + 1].i] = source })
  })
  const edges = clusters.flatMap(([key]) => {
    const group = materials.filter(m => m[1] === key)
    return [
      ...group.map(m => [key, m[0], 'объединяет материал темы']),
      [group[0][0], group[1][0], 'уточняется материалом'],
      [group[2][0], group[3][0], 'сопоставляется при ревью'],
    ]
  }).concat(bridges)
  const relations = edges.map(([source, target, type], index) => ({
    id: id(`relation-${index + 1}`), spaceID, source: id(source), target: id(target),
    type: `Тест: ${type}`, provenance: 'manual',
    metadata: { test: 'true', seed: spaceID, author: 'manually-curated-test-fixture', rationale: type, extraction: 'none' },
  }))
  const jobs = sources.map(source => ({
    id: `${source.id}:job`, sourceID: source.id, spaceID,
    status: source.text !== undefined ? 'stored' : 'waiting', attempts: 0, updatedAt: now,
  }))
  if (sources.length !== 36 || relations.length !== 64 || ordered.some(s => !s)) throw new Error('Invalid fixture')
  const ids = new Set(ordered.map(s => s.id))
  if (relations.some(r => !ids.has(r.source) || !ids.has(r.target))) throw new Error('Dangling relation')
  await saveKnowledge({
    ...data, spaces: [...data.spaces, { id: spaceID, name, description, createdAt: now, updatedAt: now }],
    sources: [...data.sources, ...ordered], relations: [...data.relations, ...relations], jobs: [...data.jobs, ...jobs],
  }, files)
  const channel = new BroadcastChannel('gamma-knowledge')
  channel.postMessage('updated')
  channel.close()
  return { status: 'created', spaceID, materials: sources.length, nodes: ordered.length, relations: relations.length, files: files.length }
}
