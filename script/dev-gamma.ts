#!/usr/bin/env bun
import { homedir } from "node:os"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"

// Gamma uses the same authenticated gateway locally and in production.
const repository = fileURLToPath(new URL("../", import.meta.url))
const data = process.env.GAMMA_DEV_DATA_ROOT ?? path.join(homedir(), ".local", "share", "gamma-dev")
const port = process.env.GAMMA_DEV_SERVER_PORT ?? "4108"
const webPort = process.env.GAMMA_DEV_WEB_PORT ?? "4456"
const authDirectory = process.env.GAMMA_DEV_AUTH_DIR ?? path.join(data, "auth")
if (
  !(await Bun.file(path.join(authDirectory, "auth.json")).exists()) ||
  !(await Bun.file(path.join(authDirectory, "backend.env")).exists())
) {
  console.error(`Configure the local administrator first: bun deploy/setup-auth.ts ${authDirectory}`)
  process.exit(1)
}
const env: Record<string, string | undefined> = {
  ...process.env,
  LANG: process.env.LANG ?? "C.UTF-8",
  LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
  NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=4096",
  OPENCODE_CONFIG: process.env.OPENCODE_CONFIG ?? path.join(repository, "deploy/opencode.json"),
  OPENCODE_DISABLE_PROJECT_CONFIG: process.env.OPENCODE_DISABLE_PROJECT_CONFIG ?? "1",
  GAMMA_KNOWLEDGE_ROOT: process.env.GAMMA_KNOWLEDGE_ROOT ?? `${data}/knowledge`,
  GAMMA_WORKSPACES_ROOT: process.env.GAMMA_WORKSPACES_ROOT ?? `${data}/workspaces`,
  OPENCODE_DB: process.env.OPENCODE_DB ?? `${data}/opencode.db`,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME ?? `${data}/data`,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? `${data}/config`,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? `${data}/state`,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? `${data}/cache`,
  GAMMA_PUBLIC_ORIGIN: `http://localhost:${webPort}`,
  GAMMA_AUTH_CONFIG: path.join(authDirectory, "auth.json"),
  GAMMA_BACKEND_URL: `http://127.0.0.1:${port}`,
  GAMMA_WEB_PORT: webPort,
  GAMMA_TRUST_PROXY: "0",
}
// Bun's HTTP client cannot use SOCKS proxy URLs inherited from some desktop shells.
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
  if (!/^socks/i.test(env[key] ?? "")) continue
  throw new Error(`Gamma dev: unsupported SOCKS proxy in ${key}; use an HTTP proxy or explicitly unset it if direct access is permitted`)
}
await mkdir(data, { recursive: true })
const build = Bun.spawn([process.execPath, "run", "build"], {
  cwd: `${repository}/packages/app`,
  env,
  stdout: "inherit",
  stderr: "inherit",
})
if (await build.exited) process.exit(1)
console.log(
  `Gamma dev: http://localhost:${webPort}; backend: http://127.0.0.1:${port}; root: ${env.GAMMA_WORKSPACES_ROOT}; database: ${env.OPENCODE_DB}`,
)
const server = Bun.spawn(
  [
    process.execPath,
    `--env-file=${path.join(authDirectory, "backend.env")}`,
    "run",
    "./src/index.ts",
    "serve",
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    cwd: `${repository}/packages/opencode`,
    env,
    stdout: "inherit",
    stderr: "inherit",
  },
)
const deadline = Date.now() + 60000
while (true) {
  const ready = await fetch(`${env.GAMMA_BACKEND_URL}/global/health`, { signal: AbortSignal.timeout(1000) }).catch(
    () => undefined,
  )
  await ready?.body?.cancel()
  if (ready?.status === 401) break
  if (server.exitCode !== null || Date.now() > deadline) {
    server.kill("SIGTERM")
    throw new Error("Authenticated backend did not become ready")
  }
  await Bun.sleep(100)
}
const app = Bun.spawn(
  [process.execPath, `--env-file=${path.join(authDirectory, "backend.env")}`, "run", "deploy/web.ts"],
  {
    cwd: repository,
    env,
    stdout: "inherit",
    stderr: "inherit",
  },
)
const stop = () => {
  server.kill("SIGTERM")
  app.kill("SIGTERM")
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
const code = await Promise.race([server.exited, app.exited])
stop()
await Promise.all([server.exited, app.exited])
process.exit(code)
