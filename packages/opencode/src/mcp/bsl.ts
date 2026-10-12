export * as BslMcp from "./bsl"

import path from "node:path"
import { lstat, readdir, realpath, stat } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"

export const name = "gamma-bsl"
export const required = [
  "register_workspace_folder",
  "unregister_workspace_folder",
  "list_workspace_folders",
  "document_symbols",
  "definition",
  "find_references",
  "analyze_file",
  "type_info",
  "global_member_info",
]
export const analysis = [
  "list_workspace_folders",
  "document_symbols",
  "definition",
  "find_references",
  "analyze_file",
  "type_info",
  "global_member_info",
  "global_member_search",
  "hover",
  "call_hierarchy",
  "type_at_position",
]

export async function sourceTools() {
  return promisify(execFile)(
    process.env.GAMMA_1C_PYTHON ?? "python3",
    ["-c", "import sys; import lxml.etree; assert sys.version_info >= (3, 10)"],
    { timeout: 10_000 },
  ).then(
    () => ({ sourceTools: true }),
    () => ({
      sourceTools: false,
      sourceError:
        "1c_python_missing: Configure GAMMA_1C_PYTHON with Python 3.10+ and lxml. Source generators are unavailable.",
    }),
  )
}

export async function configuration(directory: string): Promise<ConfigMCPV1.Info> {
  const jar = process.env.GAMMA_BSL_JAR
  if (!jar) throw new Error("bsl_jar_missing: Set GAMMA_BSL_JAR to the local BSL Language Server 1.1.0-rc.6 exec.jar.")
  if (!path.isAbsolute(jar) || !jar.endsWith(".jar") || !(await stat(jar).catch(() => undefined))?.isFile())
    throw new Error("bsl_jar_invalid: GAMMA_BSL_JAR must be an existing absolute .jar file path.")
  const java = process.env.GAMMA_BSL_JAVA ?? "java"
  const version = await promisify(execFile)(java, ["-version"], { timeout: 10_000, maxBuffer: 65536 }).catch(() => {
    throw new Error("bsl_java_missing: Java 21+ is required. Check GAMMA_BSL_JAVA or PATH.")
  })
  const major = Number(/version\s+"(\d+)/.exec(version.stderr + version.stdout)?.[1] ?? 0)
  if (major < 21) throw new Error("bsl_java_version: BSL Language Server requires Java 21 or newer.")
  return {
    type: "local",
    command: [java, "-Xmx1g", "-jar", await realpath(jar), "mcp", "--protocol", "stdio"],
    cwd: directory,
    timeout: 120_000,
  }
}

export async function verify(client: Client, tools: readonly string[], directory: string) {
  const missing = required.filter((name) => !tools.includes(name))
  if (missing.length)
    throw new Error(`bsl_tools_missing: ${missing.join(", ")}. Use a release with explicit workspace registration.`)
  const registered = await client.callTool(
    { name: "register_workspace_folder", arguments: { path: directory, name: path.basename(directory) } },
    undefined,
    { timeout: 120_000 },
  )
  if (registered.isError) throw new Error(`bsl_registration_failed: ${JSON.stringify(registered.content)}`)
  const listed = await client.callTool({ name: "list_workspace_folders", arguments: {} }, undefined, {
    timeout: 120_000,
  })
  if (listed.isError || !JSON.stringify(listed).includes(pathToFileURL(directory).href))
    throw new Error("bsl_registration_failed: Project directory was not returned by list_workspace_folders.")
}

export async function validateCall(directory: string, tool: string, input: unknown) {
  if (!analysis.includes(tool)) throw new Error("bsl_tool_forbidden: Workspace management is owned by Gamma.")
  if (!input || typeof input !== "object") return
  for (const [key, value] of Object.entries(input)) {
    if (key !== "file" && key !== "workspaceFolder") continue
    if (typeof value !== "string") throw new Error("bsl_path_invalid")
    const target = await realpath(value.startsWith("file:") ? fileURLToPath(value) : path.resolve(directory, value))
    const base = await realpath(directory)
    const relative = path.relative(base, target)
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      (key === "workspaceFolder" && relative)
    )
      throw new Error("bsl_path_forbidden: Only the active project directory may be analyzed.")
  }
}

// rc.6 keeps semantic indexes between requests, even after disk edits. Watchers
// may miss atomic replacements or bash writes; compare source metadata on use.
export async function fingerprint(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true })
  const stamps = await Promise.all(
    entries
      .filter((entry) => ![".git", "node_modules", ".opencode"].includes(entry.name))
      .map(async (entry) => {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) return fingerprint(file)
        if (!/\.(bsl|os|xml|mdo)$|^\.bsl-language-server\.json$/i.test(entry.name)) return ""
        const stats = await lstat(file, { bigint: true })
        return `${file}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`
      }),
  )
  return stamps.sort().join("\n")
}

export async function refresh(client: Client, directory: string) {
  const removed = await client.callTool(
    { name: "unregister_workspace_folder", arguments: { workspaceFolder: pathToFileURL(directory).href } },
    undefined,
    { timeout: 120_000 },
  )
  if (removed.isError) throw new Error(`bsl_refresh_failed: ${JSON.stringify(removed.content)}`)
  await verify(client, required, directory)
}
