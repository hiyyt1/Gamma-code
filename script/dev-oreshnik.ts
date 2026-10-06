#!/usr/bin/env bun
import { mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"

// An explicit product dev pair avoids connecting fresh UI code to a stale server.
const repository = fileURLToPath(new URL("../", import.meta.url))
const data = process.env.ORESHNIK_DEV_DATA_ROOT ?? "/tmp/oreshnik-dev"
const port = process.env.ORESHNIK_DEV_SERVER_PORT ?? "4108"
const webPort = process.env.ORESHNIK_DEV_WEB_PORT ?? "4456"
const env = {
  ...process.env,
  ORESHNIK_WORKSPACES_ROOT: process.env.ORESHNIK_WORKSPACES_ROOT ?? `${data}/workspaces`,
  OPENCODE_DB: process.env.OPENCODE_DB ?? `${data}/opencode.db`,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME ?? `${data}/data`,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? `${data}/config`,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? `${data}/state`,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? `${data}/cache`,
  VITE_OPENCODE_SERVER_HOST: "127.0.0.1",
  VITE_OPENCODE_SERVER_PORT: port,
}
// Bun's HTTP client cannot use SOCKS proxy URLs inherited from some desktop shells.
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
  if (!/^socks/i.test(env[key] ?? "")) continue
  console.log(`Oreshnik dev: ignoring unsupported SOCKS proxy variable ${key}`)
  delete env[key]
}
await mkdir(data, { recursive: true })
console.log(
  `Oreshnik dev: http://localhost:${webPort}; backend: http://127.0.0.1:${port}; root: ${env.ORESHNIK_WORKSPACES_ROOT}`,
)
const server = Bun.spawn([process.execPath, "run", "./src/index.ts", "serve", "--port", port], {
  cwd: `${repository}/packages/opencode`,
  env,
  stdout: "inherit",
  stderr: "inherit",
})
const app = Bun.spawn(
  [process.execPath, "run", "dev", "--", "--host", "127.0.0.1", "--port", webPort, "--strictPort"],
  {
    cwd: `${repository}/packages/app`,
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
