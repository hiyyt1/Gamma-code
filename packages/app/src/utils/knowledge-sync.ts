import { knowledgeInventory } from "./knowledge-backup"
import { isDeepEqual } from "remeda"
import type { KnowledgeState, KnowledgeVerification } from "@opencode-ai/schema/knowledge"
import type { ServerConnection } from "@/context/server"
import { productRequest } from "./product"
import { authTokenFromCredentials } from "./server"
import { openKnowledge, type KnowledgeData } from "./knowledge"

export type RemoteKnowledge = typeof KnowledgeState.Type
export const knowledgeCacheKey = (server: ServerConnection.HttpBase) => `server:${server.url.replace(/\/$/, "")}`
export async function knowledgeCache(server: ServerConnection.HttpBase, value?: RemoteKnowledge) {
  const db = await openKnowledge()
  return new Promise<RemoteKnowledge | undefined>((resolve, reject) => {
    const tx = db.transaction("data", value ? "readwrite" : "readonly")
    const store = tx.objectStore("data")
    const request = value
      ? store.put(structuredClone(value), knowledgeCacheKey(server))
      : store.get(knowledgeCacheKey(server))
    tx.oncomplete = () => {
      db.close()
      resolve(value ?? request.result)
    }
    tx.onabort = tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}
export async function digest(file: Blob) {
  const bytes = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
}
export async function publishKnowledge(
  server: ServerConnection.HttpBase,
  remote: RemoteKnowledge,
  data: KnowledgeData,
  files: { id: string; file: Blob }[],
  verify = false,
) {
  // Older servers strip unknown source fields during decoding. Reject before
  // uploading or publishing, otherwise an apparently failed save loses metadata.
  if (
    (remote.modelVersion ?? 1) < 2 &&
    data.sources.some((source) => source.entityType || source.properties || source.documentID)
  )
    throw new Error("upgrade_required")
  const originals = Object.fromEntries(
    Object.entries(remote.originals).filter(([id]) => data.sources.some((source) => source.id === id)),
  )
  for (const item of files) {
    const hash = await digest(item.file)
    if (originals[item.id]?.hash !== hash) {
      const response = await fetch(`${server.url.replace(/\/$/, "")}/product/knowledge/blob/${hash}`, {
        method: "POST",
        body: item.file,
        headers: {
          "Content-Type": "application/octet-stream",
          ...(server.password
            ? {
                Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
              }
            : {}),
        },
      })
      if (!response.ok) throw new Error("upload_failed")
      const result = await response.json()
      if (result.hash !== hash || result.size !== item.file.size) throw new Error("integrity")
    }
    originals[item.id] = { hash, size: item.file.size, mime: item.file.type }
  }
  const payload = { expectedVersion: remote.version, data, originals }
  const requestID = await digest(new Blob([JSON.stringify(payload)]))
  const result = await productRequest<RemoteKnowledge>(server, "knowledge/publish", { ...payload, requestID })
  if (
    result.version !== remote.version + 1 ||
    !isDeepEqual(result.originals, originals) ||
    !isDeepEqual({ ...result.data, revision: 0 }, { ...data, revision: 0 })
  )
    throw new Error("integrity")
  if (verify) {
    const checked = await productRequest<typeof KnowledgeVerification.Type>(server, "knowledge/verify")
    if (
      checked.version !== result.version ||
      checked.errors.length ||
      Object.entries(originals).some(
        ([id, original]) =>
          !checked.originals.some(
            (file) => file.id === id && file.sha256 === original.hash && file.size === original.size,
          ),
      )
    )
      throw new Error("integrity", { cause: { id: checked.errors[0]?.id, name: checked.errors[0]?.reason } })
  }
  // Only acknowledged publications become a server binding. The original
  // IndexedDB current/files records are intentionally never cleared or replaced.
  await knowledgeCache(server, result)
  return result
}
export async function importKnowledge(
  server: ServerConnection.HttpBase,
  remote: RemoteKnowledge,
  local: KnowledgeData,
) {
  const snapshot = await knowledgeInventory()
  if (!isDeepEqual(snapshot.data, local)) throw new Error("conflict")
  const merge = <T extends { id: string }>(existing: readonly T[], incoming: T[]) => {
    incoming.forEach((item) => {
      const old = existing.find((entry) => entry.id === item.id)
      if (old && !isDeepEqual(old, item)) throw new Error("conflict")
    })
    return [...existing, ...incoming.filter((item) => !existing.some((old) => old.id === item.id))]
  }
  const data = {
    revision: remote.version,
    spaces: merge(remote.data.spaces, local.spaces),
    sources: merge(remote.data.sources, local.sources),
    relations: merge(remote.data.relations, local.relations),
    jobs: merge(remote.data.jobs, local.jobs),
  } as KnowledgeData
  const files = [] as { id: string; file: Blob }[]
  for (const source of local.sources) {
    if (!source.filename) continue
    const file = snapshot.files.find((file) => file.key === source.id)?.file
    if (!file)
      throw new Error("missing_original", { cause: { id: source.id, name: source.name, filename: source.filename } })
    if (source.size !== undefined && source.size !== file.size)
      throw new Error("integrity", { cause: { id: source.id, name: source.name, filename: source.filename } })
    const hash = await digest(file)
    if (remote.originals[source.id] && remote.originals[source.id].hash !== hash) throw new Error("conflict")
    files.push({ id: source.id, file })
  }
  return publishKnowledge(server, remote, data, files, true)
}
export async function remoteKnowledgeFile(server: ServerConnection.HttpBase, remote: RemoteKnowledge, id: string) {
  const expected = remote.originals[id]
  if (!expected) throw new Error("missing_original")
  const db = await openKnowledge()
  const key = `remote:${expected.hash}`
  const cached = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction("files", "readonly")
    const request = tx.objectStore("files").get(key)
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = () => reject(tx.error)
  }).finally(() => db.close())
  if (cached) return cached
  const result = await productRequest<{ bytes: string; mime: string }>(
    server,
    `knowledge/original?id=${encodeURIComponent(id)}`,
  )
  const file = new Blob([Uint8Array.from(atob(result.bytes), (letter) => letter.charCodeAt(0))], { type: result.mime })
  if (file.size !== expected.size || (await digest(file)) !== expected.hash) throw new Error("integrity")
  const cache = await openKnowledge()
  await new Promise<void>((resolve, reject) => {
    const tx = cache.transaction("files", "readwrite")
    tx.objectStore("files").put(file, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }).finally(() => cache.close())
  return file
}
