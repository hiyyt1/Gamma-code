import { constants } from "node:fs"
import { open, mkdir, readdir, link, rm, rename, type FileHandle } from "node:fs/promises"
import path from "node:path"
import { homedir } from "node:os"
import { createHash, randomUUID } from "node:crypto"
import { Schema } from "effect"
import { KnowledgeData, KnowledgeBlob, KnowledgePublish } from "@opencode-ai/schema/knowledge"
import { ProductProjects } from "./product-projects"

const empty = () => ({ spaces: [], sources: [], relations: [], jobs: [] })
const PublicationState = Schema.Struct({
  version: Schema.Number,
  requestID: Schema.String,
  digest: Schema.String,
  data: KnowledgeData,
  originals: Schema.Record(Schema.String, KnowledgeBlob),
  spaces: Schema.Array(Schema.Struct({ id: Schema.String, storageID: Schema.String, version: Schema.Number })),
})
const Registry = Schema.Struct({
  publication: Schema.optional(PublicationState),
  projects: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      path: Schema.String,
      inode: Schema.String,
      spaces: Schema.Array(Schema.String),
    }),
  ),
})
type RegistryData = typeof Registry.Type
export type Publication = typeof KnowledgePublish.Type
export class KnowledgeError extends Error {}
const fail = (code: string): never => {
  throw new KnowledgeError(code)
}
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
export function root() {
  const value = process.env.GAMMA_KNOWLEDGE_ROOT ?? path.join(homedir(), ".local/share/gamma/knowledge")
  if (!path.isAbsolute(value)) return fail("invalid_root")
  const resolved = path.resolve(value)
  const projects = ProductProjects.root()
  if (within(projects, resolved) || within(resolved, projects)) return fail("invalid_root")
  return resolved
}
function within(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

// Pin every ancestor: no caller-controlled path or symlink can redirect storage.
async function directory(parent: FileHandle, name: string) {
  await mkdir(`/proc/self/fd/${parent.fd}/${name}`, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error
  })
  return open(`/proc/self/fd/${parent.fd}/${name}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
}
async function withRoot<T>(run: (handle: FileHandle) => Promise<T>) {
  if (process.platform !== "linux") return fail("unsupported_platform")
  const handles = [await open("/", constants.O_RDONLY | constants.O_DIRECTORY)]
  try {
    for (const part of root().split("/").filter(Boolean)) handles.push(await directory(handles.at(-1)!, part))
    return await run(handles.at(-1)!)
  } finally {
    await Promise.all(handles.map((handle) => handle.close()))
  }
}
async function readRegistry(handle: FileHandle): Promise<RegistryData> {
  const file = await open(`/proc/self/fd/${handle.fd}/_registry.json`, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    return Schema.decodeUnknownSync(Schema.fromJsonString(Registry))(await file.readFile("utf8"))
  } finally {
    await file.close()
  }
}
async function writeFile(target: string, bytes: string | Uint8Array) {
  const file = await open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await file.writeFile(bytes)
    await file.sync()
  } finally {
    await file.close()
  }
}
async function clone(from: string, to: string) {
  await mkdir(to, { mode: 0o700 })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) return fail("invalid_path")
    if (entry.name === "_registry.json") continue
    if (entry.isDirectory()) await clone(path.join(from, entry.name), path.join(to, entry.name))
    if (entry.isFile()) await link(path.join(from, entry.name), path.join(to, entry.name))
  }
}
async function syncDirectories(target: string) {
  for (const entry of await readdir(target, { withFileTypes: true }))
    if (entry.isDirectory()) await syncDirectories(path.join(target, entry.name))
  const handle = await open(target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  await handle.sync().finally(() => handle.close())
}
// A whole directory (including its catalog) is exchanged in one Linux syscall.
// Readers pin that directory; neither a crash nor an overlapping request can mix revisions.
async function atomic<T>(
  run: (catalog: RegistryData, stage: string, root: FileHandle) => Promise<{ catalog: RegistryData; value: T }>,
) {
  return withRoot(async (handle) => {
    const { dlopen } = await import("bun:ffi")
    const native = dlopen("libc.so.6", {
      flock: { args: ["i32", "i32"], returns: "i32" },
      renameat2: { args: ["i32", "cstring", "i32", "cstring", "u32"], returns: "i32" },
    })
    const lock = await open(
      `/proc/self/fd/${handle.fd}/.lock`,
      constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    )
    const stageName = `.publish-${randomUUID()}`
    const stage = `/proc/self/fd/${handle.fd}/${stageName}`
    try {
      if (native.symbols.flock(lock.fd, 6) !== 0) return fail("busy")
      const active = await directory(handle, "spaces")
      try {
        const catalog = await readRegistry(active).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return { projects: [] }
          throw error
        })
        await clone(`/proc/self/fd/${active.fd}`, stage)
        const result = await run(catalog, stage, handle)
        await writeFile(`${stage}/_registry.json`, JSON.stringify(result.catalog))
        await syncDirectories(stage)
        if (
          native.symbols.renameat2(handle.fd, Buffer.from(`${stageName}\0`), handle.fd, Buffer.from("spaces\0"), 2) !==
          0
        )
          return fail("publication_failed")
        await handle.sync()
        return result.value
      } finally {
        await active.close()
      }
    } finally {
      await rm(stage, { recursive: true, force: true }).catch(() => {})
      native.symbols.flock(lock.fd, 8)
      await lock.close()
      native.close()
    }
  })
}
async function read<T>(run: (catalog: RegistryData, directory: FileHandle) => Promise<T>) {
  return withRoot(async (handle) => {
    const { dlopen } = await import("bun:ffi")
    const native = dlopen("libc.so.6", { flock: { args: ["i32", "i32"], returns: "i32" } })
    const lock = await open(
      `/proc/self/fd/${handle.fd}/.lock`,
      constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      if (native.symbols.flock(lock.fd, 5) !== 0) return fail("busy")
      const active = await directory(handle, "spaces")
      try {
        const catalog = await readRegistry(active).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return { projects: [] }
          throw error
        })
        return await run(catalog, active)
      } finally {
        await active.close()
      }
    } finally {
      native.symbols.flock(lock.fd, 8)
      await lock.close()
      native.close()
    }
  })
}
export function state() {
  return read(async (catalog) => {
    const item = catalog.publication
    return {
      modelVersion: 2,
      version: item?.version ?? 0,
      data: item?.data ?? empty(),
      originals: item?.originals ?? {},
      spaces: item?.spaces ?? [],
    }
  })
}
export async function upload(digest: string, bytes: Uint8Array) {
  if (!/^[a-f0-9]{64}$/.test(digest) || bytes.length > 20 * 1024 * 1024 || hash(bytes) !== digest)
    return fail("integrity")
  return withRoot(async (handle) => {
    const blobs = await directory(handle, "_blobs")
    try {
      const temporary = `/proc/self/fd/${blobs.fd}/.${randomUUID()}`
      await writeFile(temporary, bytes)
      await rename(temporary, `/proc/self/fd/${blobs.fd}/${digest}`)
      await blobs.sync()
      return { hash: digest, size: bytes.length }
    } finally {
      await blobs.close()
    }
  })
}
function validate(input: Publication) {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) return fail("integrity")
  if (
    [...input.data.spaces, ...input.data.sources].some((item) =>
      ["__proto__", "constructor", "prototype"].includes(item.id),
    )
  )
    return fail("integrity")
  const spaces = new Set(input.data.spaces.map((space) => space.id))
  const sources = new Map(input.data.sources.map((source) => [source.id, source]))
  if (
    spaces.size !== input.data.spaces.length ||
    sources.size !== input.data.sources.length ||
    new Set(input.data.relations.map((edge) => edge.id)).size !== input.data.relations.length
  )
    return fail("integrity")
  input.data.sources.forEach((source) => {
    if (!spaces.has(source.spaceID) || (source.filename && !input.originals[source.id])) return fail("missing_original")
    if (source.url && (!URL.canParse(source.url) || !["http:", "https:"].includes(new URL(source.url).protocol)))
      return fail("integrity")
    if (source.documentID) {
      const document = sources.get(source.documentID)
      if (
        !document ||
        document.id === source.id ||
        document.spaceID !== source.spaceID ||
        !["document", "note", "link"].includes(document.type)
      )
        return fail("integrity")
    }
  })
  input.data.relations.forEach((edge) => {
    if (!edge.type.trim() || edge.type.length > 120) return fail("integrity")
    if (
      edge.source === edge.target ||
      sources.get(edge.source)?.spaceID !== edge.spaceID ||
      sources.get(edge.target)?.spaceID !== edge.spaceID
    )
      return fail("integrity")
  })
  input.data.jobs.forEach((job) => {
    if (sources.get(job.sourceID)?.spaceID !== job.spaceID) return fail("integrity")
  })
  Object.keys(input.originals).forEach((id) => {
    if (!sources.has(id)) return fail("integrity")
  })
}
export async function publish(input: Publication) {
  validate(input)
  const digest = hash(JSON.stringify({ data: input.data, originals: input.originals }))
  return atomic(async (catalog, stage, handle) => {
    const previous = catalog.publication
    if (previous?.requestID === input.requestID) {
      if (previous.digest !== digest) return fail("conflict")
      return { catalog, value: { ...previous, modelVersion: 2 } }
    }
    if ((previous?.version ?? 0) !== input.expectedVersion) return fail("conflict")
    for (const source of input.data.sources) {
      const old = previous?.data.sources.find((item) => item.id === source.id)
      if (old?.filename && !old.authored && previous?.originals[source.id]?.hash !== input.originals[source.id]?.hash)
        return fail("original_changed")
    }
    const spaces = [] as { id: string; storageID: string; version: number }[]
    for (const space of input.data.spaces) {
      const old = previous?.spaces.find((item) => item.id === space.id)
      const storageID = old?.storageID ?? randomUUID()
      const target = `${stage}/${storageID}`
      await rm(target, { recursive: true, force: true })
      await mkdir(`${target}/materials`, { recursive: true, mode: 0o700 })
      await mkdir(`${target}/originals`, { mode: 0o700 })
      const index: Record<string, [string, string]> = Object.create(null)
      const links: Record<string, string[]> = Object.create(null)
      for (const source of input.data.sources.filter((item) => item.spaceID === space.id)) {
        const fileID = hash(source.id)
        const original = input.originals[source.id]
        const extension = source.filename?.match(/\.(pdf|docx|txt|md|markdown)$/i)?.[1].toLowerCase() ?? "bin"
        if (original) {
          const bytes = await open(
            `/proc/self/fd/${handle.fd}/_blobs/${original.hash}`,
            constants.O_RDONLY | constants.O_NOFOLLOW,
          )
            .then(async (file) => {
              try {
                return await file.readFile()
              } finally {
                await file.close()
              }
            })
            .catch(() => fail("missing_original"))
          if (hash(bytes) !== original.hash || bytes.length !== original.size) return fail("integrity")
          await link(`/proc/self/fd/${handle.fd}/_blobs/${original.hash}`, `${target}/originals/${fileID}.${extension}`)
        }
        const materialPath =
          (source.text !== undefined && (!/^(pdf|docx)$/.test(extension) || source.text.trim())) || !original
            ? `materials/${fileID}.md`
            : `originals/${fileID}.${extension}`
        if (materialPath.startsWith("materials/"))
          await writeFile(
            `${target}/${materialPath}`,
            source.url
              ? `# ${source.name}\n\n${source.description}\n\n${source.url}\n`
              : (source.text ?? `# ${source.name}\n\n${source.description}\n`),
          )
        index[source.id] = [materialPath, source.description.trim().slice(0, 300) || source.name]
        links[source.id] = []
      }
      input.data.relations
        .filter((edge) => edge.spaceID === space.id)
        .forEach((edge) => {
          if (!links[edge.source].includes(edge.target)) links[edge.source].push(edge.target)
          if (!links[edge.target].includes(edge.source)) links[edge.target].push(edge.source)
        })
      await writeFile(`${target}/index.json`, JSON.stringify(index, null, 2))
      await writeFile(`${target}/links.json`, JSON.stringify(links, null, 2))
      spaces.push({ id: space.id, storageID, version: (old?.version ?? 0) + 1 })
    }
    for (const old of previous?.spaces ?? [])
      if (!spaces.some((space) => space.id === old.id))
        await rm(`${stage}/${old.storageID}`, { recursive: true, force: true })
    const next = {
      version: (previous?.version ?? 0) + 1,
      requestID: input.requestID,
      digest,
      data: { ...input.data, revision: (previous?.version ?? 0) + 1 },
      originals: input.originals,
      spaces,
    }
    return {
      catalog: {
        publication: next,
        projects: catalog.projects.map((project) => ({
          ...project,
          spaces: project.spaces.filter((id) => spaces.some((space) => space.id === id)),
        })),
      },
      value: { ...next, modelVersion: 2 },
    }
  })
}
// Read the published files, not just catalog metadata, before reporting success.
export function verify() {
  return read(async (catalog, handle) => {
    const publication = catalog.publication
    const errors: { id: string; reason: string }[] = []
    const originals: { id: string; size: number; sha256: string }[] = []
    const readFile = async (relative: string) => {
      const file = await open(`/proc/self/fd/${handle.fd}/${relative}`, constants.O_RDONLY | constants.O_NOFOLLOW)
      return file.readFile().finally(() => file.close())
    }
    for (const space of publication?.spaces ?? []) {
      try {
        const index = JSON.parse((await readFile(`${space.storageID}/index.json`)).toString()) as Record<
          string,
          [string, string]
        >
        const links = JSON.parse((await readFile(`${space.storageID}/links.json`)).toString()) as Record<
          string,
          string[]
        >
        const sources = publication!.data.sources.filter((source) => source.spaceID === space.id)
        if (Object.keys(index).length !== sources.length || Object.keys(links).length !== sources.length)
          errors.push({ id: space.id, reason: "dictionary_count" })
        for (const source of sources) {
          try {
            const entry = index[source.id]
            const extension = source.filename?.match(/\.(pdf|docx|txt|md|markdown)$/i)?.[1].toLowerCase() ?? "bin"
            const original = publication!.originals[source.id]
            const expectedPath =
              (source.text !== undefined && (!/^(pdf|docx)$/.test(extension) || source.text.trim())) || !original
                ? `materials/${hash(source.id)}.md`
                : `originals/${hash(source.id)}.${extension}`
            if (
              !Array.isArray(entry) ||
              entry.length !== 2 ||
              entry[0] !== expectedPath ||
              !/^(materials|originals)\/[a-f0-9]{64}\.[a-z]+$/.test(entry[0])
            )
              throw new Error("index_path")
            if (entry[1] !== (source.description.trim().slice(0, 300) || source.name)) throw new Error("description")
            const content = await readFile(`${space.storageID}/${entry[0]}`)
            if (entry[0].startsWith("materials/")) {
              const expected = source.url
                ? `# ${source.name}\n\n${source.description}\n\n${source.url}\n`
                : (source.text ?? `# ${source.name}\n\n${source.description}\n`)
              if (content.toString() !== expected) throw new Error("material_content")
            }
            if (original) {
              const extension = source.filename?.match(/\.(pdf|docx|txt|md|markdown)$/i)?.[1].toLowerCase() ?? "bin"
              const bytes = await readFile(`${space.storageID}/originals/${hash(source.id)}.${extension}`)
              if (hash(bytes) !== original.hash || bytes.length !== original.size) throw new Error("original_integrity")
              originals.push({ id: source.id, size: bytes.length, sha256: hash(bytes) })
            }
            const neighbors = [
              ...new Set(
                publication!.data.relations
                  .filter((edge) => edge.spaceID === space.id)
                  .flatMap((edge) =>
                    edge.source === source.id ? [edge.target] : edge.target === source.id ? [edge.source] : [],
                  ),
              ),
            ].sort()
            if (
              !Array.isArray(links[source.id]) ||
              JSON.stringify([...links[source.id]].sort()) !== JSON.stringify(neighbors)
            )
              throw new Error("links")
          } catch (error) {
            errors.push({ id: source.id, reason: error instanceof Error ? error.message : "read_failed" })
          }
        }
      } catch {
        errors.push({ id: space.id, reason: "dictionary_read" })
      }
    }
    return {
      root: root(),
      version: publication?.version ?? 0,
      spaces: publication?.data.spaces.length ?? 0,
      materials: publication?.data.sources.length ?? 0,
      relations: publication?.data.relations.length ?? 0,
      originals,
      errors,
    }
  })
}
export function original(id: string) {
  return read(async (catalog, handle) => {
    const item = catalog.publication
    if (!item) return fail("not_found")
    const source = item.data.sources.find((source) => source.id === id)
    const file = source && item.originals[id]
    const space = source && item.spaces.find((space) => space.id === source.spaceID)
    if (!file || !source || !space) return fail("not_found")
    const extension = source.filename?.match(/\.(pdf|docx|txt|md|markdown)$/i)?.[1].toLowerCase() ?? "bin"
    const input = await open(
      `/proc/self/fd/${handle.fd}/${space.storageID}/originals/${hash(id)}.${extension}`,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    )
    try {
      return { bytes: await input.readFile(), mime: file.mime }
    } finally {
      await input.close()
    }
  })
}
export async function projects(change?: { projectID: string; spaces: readonly string[] }) {
  const available = await ProductProjects.list()
  const identities = await Promise.all(
    available.map(async (project) => ({
      ...project,
      inode: await ProductProjects.withProject(project.path, async (handle) => {
        const stat = await handle.stat()
        return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`
      }),
    })),
  )
  return atomic(async (catalog) => {
    const registered = identities.map((project) => {
      const old = catalog.projects.find((item) => item.inode === project.inode)
      return { ...project, id: old?.id ?? randomUUID(), spaces: [...(old?.spaces ?? [])] }
    })
    if (change) {
      const project = registered.find((item) => item.id === change.projectID)
      if (!project) return fail("not_found")
      if (change.spaces.some((id) => !catalog.publication?.spaces.some((space) => space.id === id)))
        return fail("not_found")
      project.spaces = [...new Set(change.spaces)]
    }
    return {
      catalog: { ...catalog, projects: registered },
      value: registered.map(({ id, name, path, spaces }) => ({ id, name, path, spaces })),
    }
  })
}

// Resolve Gamma's registered filesystem identity, never OpenCode's shared project ID.
// Read afresh for each model request so existing sessions see connection changes.
export async function context(directory: string) {
  const relative = path.relative(ProductProjects.root(), directory)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return
  const projectPath = path.join(ProductProjects.root(), relative.split(path.sep)[0])
  const inode = await ProductProjects.withProject(projectPath, async (handle) => {
    const stat = await handle.stat()
    return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`
  })
  return read(async (catalog) => {
    const project = catalog.projects.find((item) => item.inode === inode)
    const publication = catalog.publication
    if (!project?.spaces.length || !publication) return
    const spaces = publication.spaces.filter((space) => project.spaces.includes(space.id))
    if (!spaces.length) return
    return [
      "Knowledge Base",
      "",
      "К текущему проекту подключены пространства знаний:",
      ...spaces.flatMap((space) => {
        const item = publication.data.spaces.find((item) => item.id === space.id)!
        return [
          `- ${JSON.stringify(item.name)}: ${JSON.stringify(item.description.length > 500 ? `${item.description.slice(0, 500)}…` : item.description)}`,
          `  Путь: ${path.join(root(), "spaces", space.storageID)}`,
        ]
      }),
      "",
      "Каждое пространство содержит:",
      "- index.json — ID → [относительный путь, описание].",
      "- links.json — ID → массив связанных ID.",
      "- materials/ — файлы знаний.",
      "- originals/ — оригиналы.",
      "",
      "При необходимости используй существующие файловые инструменты для поиска и чтения знаний.",
      "Можешь сначала посмотреть структуру через ls, затем найти подходящий материал по index.json.",
      "Если полезно, проверь связанные ID в links.json.",
      "Не нужно читать всю базу при каждом запросе.",
    ].join("\n")
  })
}
export * as KnowledgeStore from "./knowledge-store"
