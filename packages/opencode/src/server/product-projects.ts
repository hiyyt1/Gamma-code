export * as ProductProjects from "./product-projects"

import { constants } from "node:fs"
import { open, mkdir, readdir, type FileHandle } from "node:fs/promises"
import path from "node:path"

export function root() {
  const value = process.env.GAMMA_WORKSPACES_ROOT ?? "/home/gamma/workspaces"
  if (!path.isAbsolute(value)) throw new Error("invalid_root")
  return path.resolve(value)
}

export function identifier(value: string) {
  if (
    !value ||
    value.startsWith(".") ||
    value.includes("..") ||
    /[\\/:%\x00-\x1f\x7f]/.test(value) ||
    value !== value.trim() ||
    Buffer.byteLength(value) > 120
  )
    throw new Error("invalid_name")
  return value
}

export function slug(value: string) {
  const name = identifier(value.normalize("NFKC").trim())
  return identifier(
    name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}-]+/gu, "-")
      .replace(/^-+|-+$/g, ""),
  )
}

// Walk using pinned directory handles. Every component is opened without
// following symlinks, including ancestors of the configured product root.
async function descend(parent: FileHandle, name: string, provision = false) {
  const target = `/proc/self/fd/${parent.fd}/${name}`
  if (provision)
    await mkdir(target, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error
    })
  return open(target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
}

export async function withRoot<T>(run: (directory: FileHandle) => Promise<T>) {
  if (process.platform !== "linux") throw new Error("unsupported_platform")
  const handles = [await open("/", constants.O_RDONLY | constants.O_DIRECTORY)]
  try {
    for (const name of root().split("/").filter(Boolean)) handles.push(await descend(handles.at(-1)!, name, true))
    return await run(handles.at(-1)!)
  } finally {
    await Promise.all(handles.map((handle) => handle.close()))
  }
}

export function list() {
  return withRoot(async (directory) =>
    (await readdir(`/proc/self/fd/${directory.fd}`, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          !/[\\:%\x00-\x1f\x7f]/.test(entry.name) &&
          !entry.name.includes(".."),
      )
      .map((entry) => ({ name: entry.name, path: path.join(root(), entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )
}

export function create(input: string) {
  const name = slug(input)
  return withRoot(async (directory) => {
    // Exclusive mkdir: a collision, including a symlink, is never adopted.
    await mkdir(`/proc/self/fd/${directory.fd}/${name}`, { mode: 0o700 })
    return { name, path: path.join(root(), name) }
  })
}

export async function withProject<T>(directory: string, run: (handle: FileHandle) => Promise<T>) {
  const name = identifier(path.relative(root(), directory))
  return withRoot(async (parent) => {
    const handle = await descend(parent, name)
    try {
      return await run(handle)
    } finally {
      await handle.close()
    }
  })
}

export async function withFile<T>(
  directory: string,
  relative: string,
  folder: boolean,
  run: (handle: FileHandle) => Promise<T>,
) {
  if (path.isAbsolute(relative) || /[\\:%\x00-\x1f\x7f]/.test(relative)) throw new Error("invalid_path")
  const names = relative === "." || relative === "" ? [] : relative.split("/")
  if (names.some((name) => !name || name === "." || name === "..")) throw new Error("invalid_path")
  return withProject(directory, async (parent) => {
    const handles: FileHandle[] = []
    try {
      for (const [index, name] of names.entries()) {
        const current = handles.at(-1) ?? parent
        handles.push(
          index === names.length - 1 && !folder
            ? await open(
                `/proc/self/fd/${current.fd}/${name}`,
                constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
              )
            : await descend(current, name),
        )
      }
      const handle = handles.at(-1) ?? parent
      if (!folder && !(await handle.stat()).isFile()) throw new Error("invalid_path")
      return await run(handle)
    } finally {
      await Promise.all(handles.map((handle) => handle.close()))
    }
  })
}

export function files(directory: string, relative: string) {
  return withFile(directory, relative, true, async (handle) =>
    (await readdir(`/proc/self/fd/${handle.fd}`, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => ({
        name: entry.name,
        path: path.posix.join(relative, entry.name),
        absolute: path.join(directory, relative, entry.name),
        type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
        ignored: false,
      })),
  )
}

export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024

export function download(directory: string, relative: string) {
  return withFile(directory, relative, false, async (handle) => {
    const limit = 50 * 1024 * 1024
    const size = (await handle.stat()).size
    if (size > limit) throw new Error("too_large")
    const bytes = Buffer.alloc(size + 1)
    const cursor = { read: 0 }
    while (cursor.read < bytes.length) {
      const result = await handle.read(bytes, cursor.read, bytes.length - cursor.read, cursor.read)
      if (!result.bytesRead) break
      cursor.read += result.bytesRead
    }
    if (cursor.read !== size) throw new Error("file_changed")
    return bytes.subarray(0, cursor.read)
  })
}

export function content(directory: string, relative: string) {
  return withFile(directory, relative, false, async (handle) => {
    if ((await handle.stat()).size > MAX_PREVIEW_BYTES) throw new Error("too_large")
    // Bound the read itself as well: a file can grow after stat().
    const buffer = Buffer.alloc(MAX_PREVIEW_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, null)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    if (length > MAX_PREVIEW_BYTES) throw new Error("too_large")
    const bytes = buffer.subarray(0, length)
    const text = bytes.includes(0)
      ? undefined
      : await Promise.resolve()
          .then(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes))
          .catch(() => undefined)
    if (text !== undefined) return { type: "text" as const, content: text }
    return {
      type: "binary" as const,
      content: bytes.toString("base64"),
      encoding: "base64" as const,
      mimeType: Bun.file(relative).type || "application/octet-stream",
    }
  })
}

export async function find(directory: string, query: string, kind: string, limit: number) {
  const results: string[] = []
  const visit = async (relative: string, depth: number) => {
    if (depth > 20 || results.length >= limit) return
    const entries = await files(directory, relative)
    for (const entry of entries) {
      if (results.length >= limit) return
      if (entry.name.startsWith(".")) continue
      if (entry.type === kind && entry.path.toLowerCase().includes(query.toLowerCase())) results.push(entry.path)
      if (entry.type === "directory") await visit(entry.path, depth + 1)
    }
  }
  await visit("", 0)
  return results
}
