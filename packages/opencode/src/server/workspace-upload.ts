export * as WorkspaceUpload from "./workspace-upload"

import { constants } from "node:fs"
import { open, unlink, type FileHandle } from "node:fs/promises"

export const MAX_BYTES = 20 * 1024 * 1024

export function filename(input: string) {
  const name = input.normalize("NFC")
  if (
    !name ||
    name === "." ||
    name === ".." ||
    /[\\/:\x00-\x1f\x7f]/.test(name) ||
    name !== name.trim() ||
    Buffer.byteLength(name) > 240
  )
    throw new Error("invalid_name")
  return name
}

// Pin the directory inode: neither a replaced ancestor nor a symlink at the
// destination can redirect the write. This product endpoint targets Linux VPSes.
export async function save(root: string, input: string, bytes: Uint8Array) {
  const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    return await saveAt(directory, input, bytes)
  } finally {
    await directory.close()
  }
}

export async function saveAt(directory: FileHandle, input: string, bytes: Uint8Array) {
  const name = filename(input)
  if (process.platform !== "linux") throw new Error("unsupported_platform")
  if (bytes.byteLength > MAX_BYTES) throw new Error("too_large")
  const target = await open(
    `/proc/self/fd/${directory.fd}/${name}`,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await target.writeFile(bytes)
    await target.sync()
  } catch (error) {
    await unlink(`/proc/self/fd/${directory.fd}/${name}`)
    throw error
  } finally {
    await target.close()
  }
  return name
}
