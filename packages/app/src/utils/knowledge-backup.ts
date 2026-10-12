import { emptyKnowledge, openKnowledge, type KnowledgeData } from "./knowledge"

export async function knowledgeInventory() {
  const db = await openKnowledge()
  const snapshot = await new Promise<{
    records: { key: IDBValidKey; value: unknown }[]
    files: { key: IDBValidKey; file: Blob }[]
  }>((resolve, reject) => {
    const tx = db.transaction(["data", "files"], "readonly")
    const keys = tx.objectStore("data").getAllKeys()
    const values = tx.objectStore("data").getAll()
    const fileKeys = tx.objectStore("files").getAllKeys()
    const files = tx.objectStore("files").getAll()
    tx.oncomplete = () =>
      resolve({
        records: keys.result.map((key, index) => ({ key, value: values.result[index] })),
        files: fileKeys.result.map((key, index) => ({ key, file: files.result[index] as Blob })),
      })
    tx.onerror = tx.onabort = () => reject(tx.error)
  }).finally(() => db.close())
  const data = (snapshot.records.find((record) => record.key === "current")?.value ?? emptyKnowledge()) as KnowledgeData
  const files = [] as { key: IDBValidKey; file: Blob; size: number; sha256: string }[]
  for (const entry of snapshot.files) {
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", await entry.file.arrayBuffer())),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("")
    files.push({ ...entry, size: entry.file.size, sha256 })
  }
  const missing = data.sources.filter((source) => source.filename && !files.some((file) => file.key === source.id))
  const mismatched = data.sources.filter(
    (source) =>
      source.filename &&
      source.size !== undefined &&
      files.some((file) => file.key === source.id && file.size !== source.size),
  )
  return { data, records: snapshot.records, files, missing, mismatched }
}
export type KnowledgeInventory = Awaited<ReturnType<typeof knowledgeInventory>>

// Portable full snapshot: binary originals are embedded, not just referenced.
// Sequential FileReader calls avoid argument limits on large byte arrays.
export async function knowledgeBackup(inventory: KnowledgeInventory) {
  const parts: BlobPart[] = [
    JSON.stringify({
      format: "gamma-knowledge-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      records: inventory.records,
      missing: inventory.missing.map((source) => ({ id: source.id, name: source.name, filename: source.filename })),
      mismatched: inventory.mismatched.map((source) => source.id),
    }).slice(0, -1),
    ',"files":[',
  ]
  for (const [index, entry] of inventory.files.entries()) {
    const bytes = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1])
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(entry.file)
    })
    parts.push(
      (index ? "," : "") +
        JSON.stringify({
          key: entry.key,
          mime: entry.file.type,
          size: entry.size,
          sha256: entry.sha256,
          base64: bytes,
        }),
    )
  }
  parts.push("]}")
  return new Blob(parts, { type: "application/json" })
}
