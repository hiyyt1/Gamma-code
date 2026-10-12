import path from "node:path"
import { mkdir, open } from "node:fs/promises"

const destination = process.argv[2]
if (!destination || !path.isAbsolute(destination) || !destination.endsWith(".jar")) {
  throw new Error(
    "Usage: bun script/1c-agent/download-bsl.ts /absolute/path/bsl-language-server-1.1.0-rc.6-exec.jar [--verify]",
  )
}
const url =
  "https://github.com/1c-syntax/bsl-language-server/releases/download/v1.1.0-rc.6/bsl-language-server-1.1.0-rc.6-exec.jar"
const expected = "bf07373101c3f41d5e164c296f8ab06c0c39b8fbd5d21e34eddd48cb581b4357"
const bytes = process.argv[3] === "--verify" ? await Bun.file(destination).arrayBuffer() : await download()
if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== expected)
  throw new Error("BSL release checksum mismatch")
if (process.argv[3] !== "--verify") {
  await mkdir(path.dirname(destination), { recursive: true })
  const file = await open(destination, "wx")
  await file.writeFile(new Uint8Array(bytes)).finally(() => file.close())
}
console.log(`Verified BSL Language Server v1.1.0-rc.6 (LGPL-3.0): ${destination}`)
console.log("Set GAMMA_BSL_JAR for the Gamma backend. This script does not install or activate any MCP.")

async function download() {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`BSL download failed: ${response.status}`)
  return response.arrayBuffer()
}
