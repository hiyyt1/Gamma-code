import path from "node:path"
import { constants } from "node:fs"
import { lstat, realpath, open, mkdir, rename } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { unzipSync, zipSync } from "fflate"

export const limit = 50 * 1024 * 1024
export const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex")
export async function local(root: string, relative: string) {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).some((part) => !part || part === "." || part === "..") ||
    /[\x00-\x1f]/.test(relative)
  )
    throw new Error("invalid_path")
  const base = await realpath(root)
  const parts = relative.split("/")
  for (const index of parts.keys()) {
    const target = path.join(base, ...parts.slice(0, index + 1))
    const stat = await lstat(target)
    if (stat.isSymbolicLink()) throw new Error("symlink_forbidden")
  }
  return path.join(base, relative)
}
export async function read(root: string, relative: string, max = limit) {
  const handle = await open(await local(root, relative), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > max || !stat.size) throw new Error("invalid_file_size")
    const bytes = Buffer.alloc(Math.min(stat.size + 1, max + 1))
    const cursor = { read: 0 }
    while (cursor.read < bytes.length) {
      const result = await handle.read(bytes, cursor.read, bytes.length - cursor.read, cursor.read)
      if (!result.bytesRead) break
      cursor.read += result.bytesRead
    }
    if (cursor.read !== stat.size || cursor.read > max) throw new Error("file_changed")
    return bytes.subarray(0, cursor.read)
  } finally {
    await handle.close()
  }
}
export async function write(root: string, relative: string, bytes: Uint8Array | string) {
  const parent = path.dirname(relative)
  const directory = parent === "." ? await realpath(root) : await local(root, parent)
  const name = path.basename(relative)
  if (!name || name === "." || name === ".." || /[\\\x00-\x1f]/.test(name)) throw new Error("invalid_path")
  const temp = path.join(directory, `.presentation-${randomUUID()}`)
  await Bun.write(temp, bytes)
  await rename(temp, path.join(directory, name))
}
export async function folders(root: string, names: string[]) {
  for (const name of names) {
    await mkdir(path.join(root, name), { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e
    })
    await local(root, name)
  }
}
export function unpack(bytes: Uint8Array) {
  if (bytes.length > limit) throw new Error("file_too_large")
  const totals = { bytes: 0, entries: 0 }
  const files = unzipSync(bytes, {
    filter(file) {
      totals.bytes += file.originalSize
      totals.entries++
      if (
        totals.bytes > 200 * 1024 * 1024 ||
        totals.entries > 10000 ||
        file.name.startsWith("/") ||
        file.name.split("/").includes("..")
      )
        throw new Error("archive_limit")
      return true
    },
  })
  if (!Object.keys(files).length) throw new Error("empty_archive")
  for (const [name, bytes] of Object.entries(files)) {
    if (/(\.xml|\.rels)$/.test(name) && /<!DOCTYPE|<!ENTITY/i.test(new TextDecoder().decode(bytes)))
      throw new Error("unsafe_xml")
  }
  return files
}
export const pack = (files: Record<string, Uint8Array>) => zipSync(files, { level: 6 })
export async function run(command: string[], cwd: string, signal?: AbortSignal, timeout = 120000) {
  const child = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8" },
  })
  const stop = () => child.kill()
  if (signal?.aborted) stop()
  signal?.addEventListener("abort", stop, { once: true })
  const timer = setTimeout(stop, timeout)
  try {
    const [stdout, stderr, code] = await Promise.all([
      boundedOutput(child.stdout, 32 * 1024 * 1024, stop),
      boundedOutput(child.stderr, 64 * 1024, stop),
      child.exited,
    ])
    if (code !== 0) throw new Error(`process_failed:${path.basename(command[0])}:${stderr.slice(0, 300)}`)
    return stdout
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", stop)
  }
}

async function boundedOutput(stream: ReadableStream<Uint8Array>, max: number, stop: () => void) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  const size = { value: 0 }
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) return Buffer.concat(chunks).toString()
      size.value += item.value.length
      if (size.value > max) {
        stop()
        throw new Error("process_output_limit")
      }
      chunks.push(item.value)
    }
  } finally {
    reader.releaseLock()
  }
}
