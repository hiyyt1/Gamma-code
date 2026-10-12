import type { nodeIconNames, nodeSizes, nodeStyles } from "./knowledge-edit"

export type KnowledgeSpace = { id: string; name: string; description: string; createdAt: string; updatedAt: string }
export type KnowledgeSource = {
  id: string
  spaceID: string
  type: "document" | "note" | "link" | "entity" | "project"
  name: string
  description: string
  entityType?: string
  properties?: Record<string, string>
  documentID?: string
  tags: string[]
  createdAt: string
  updatedAt: string
  text?: string
  url?: string
  filename?: string
  mime?: string
  size?: number
  authored?: boolean
  visual?: {
    color?: string
    icon?: keyof typeof nodeIconNames
    size?: keyof typeof nodeSizes
    style?: (typeof nodeStyles)[number]
  }
}
export type Document = KnowledgeSource & { type: "document"; filename: string }
export type Note = KnowledgeSource & { type: "note"; text: string }
export type Entity = KnowledgeSource & { type: "entity" }
export type Relation = {
  id: string
  spaceID: string
  source: string
  target: string
  type: string
  provenance: "manual" | "demo" | "extracted"
  origin?: "manual" | "generated"
  createdAt?: string
  metadata: Record<string, string>
}
export type IngestionJob = {
  id: string
  sourceID: string
  spaceID: string
  status: "stored" | "processing" | "waiting" | "error"
  attempts: number
  error?: string
  updatedAt: string
}
export type KnowledgeData = {
  revision?: number
  spaces: KnowledgeSpace[]
  sources: KnowledgeSource[]
  relations: Relation[]
  jobs: IngestionJob[]
}
export const emptyKnowledge = (): KnowledgeData => ({ spaces: [], sources: [], relations: [], jobs: [] })

export function validateMaterial(file: File) {
  if (!/\.(pdf|docx|txt|md|markdown)$/i.test(file.name)) throw new Error("format")
  if (file.size > 20 * 1024 * 1024) throw new Error("size")
}
// Sniff supported uploads before opening the existing editor; viewing is still
// responsible for reporting documents whose internal content is damaged.
export async function inspectMaterial(file: File) {
  validateMaterial(file)
  const extension = file.name.split(".").pop()!.toLowerCase()
  const mime = file.type.toLowerCase().split(";")[0]
  const expected =
    extension === "pdf"
      ? ["application/pdf"]
      : extension === "docx"
        ? [
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/zip",
            "application/x-zip-compressed",
          ]
        : ["text/plain", "text/markdown", "text/x-markdown"]
  if (mime && mime !== "application/octet-stream" && !expected.includes(mime)) throw new Error("format")
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (extension === "pdf") {
    if (!new TextDecoder().decode(bytes.subarray(0, 8)).startsWith("%PDF-")) throw new Error("format")
    return
  }
  if (extension === "docx") {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) throw new Error("format")
    const directory = new TextDecoder("latin1").decode(bytes)
    if (!directory.includes("[Content_Types].xml") || !directory.includes("word/document.xml"))
      throw new Error("format")
    return
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  if (text.includes("\0")) throw new Error("format")
}

export function validateURL(value: string) {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("url")
  return url.href
}

// One transaction commits metadata and original blobs together. Knowledge data is
// independent of Gamma project directories and never modifies legacy skill data.
export async function openKnowledge() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("gamma-knowledge-v1", 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore("data")
      request.result.createObjectStore("files")
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error("blocked"))
  })
}
export async function readKnowledge(): Promise<KnowledgeData> {
  const db = await openKnowledge()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("data", "readonly")
    const request = tx.objectStore("data").get("current")
    tx.oncomplete = () => {
      db.close()
      resolve(request.result ?? emptyKnowledge())
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}
export async function saveKnowledge(
  data: KnowledgeData,
  files: { id: string; file: Blob }[] = [],
  removed: string[] = [],
) {
  const db = await openKnowledge()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["data", "files"], "readwrite")
    const current = tx.objectStore("data").get("current")
    current.onsuccess = () => {
      // Reject stale writes from another tab instead of overwriting its materials.
      if ((current.result?.revision ?? 0) !== (data.revision ?? 0)) {
        tx.abort()
        return
      }
      tx.objectStore("data").put({ ...structuredClone(data), revision: (data.revision ?? 0) + 1 }, "current")
      files.forEach((item) => tx.objectStore("files").put(item.file, item.id))
      removed.forEach((id) => tx.objectStore("files").delete(id))
    }
    tx.oncomplete = () => {
      data.revision = (data.revision ?? 0) + 1
      db.close()
      resolve()
    }
    tx.onabort = () => {
      db.close()
      reject(tx.error ?? new Error("aborted"))
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}
let remoteReader: ((id: string) => Promise<Blob>) | undefined
export function setKnowledgeFileReader(reader?: (id: string) => Promise<Blob>) {
  remoteReader = reader
}
export function readKnowledgeFile(id: string) {
  return remoteReader ? remoteReader(id) : readLocalKnowledgeFile(id)
}

export async function readLocalKnowledgeFile(id: string) {
  const db = await openKnowledge()
  return new Promise<Blob>((resolve, reject) => {
    const tx = db.transaction("files", "readonly")
    const request = tx.objectStore("files").get(id)
    tx.oncomplete = () => {
      db.close()
      request.result ? resolve(request.result) : reject(new Error("missing"))
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}

export { demoKnowledge } from "./knowledge-demo"
