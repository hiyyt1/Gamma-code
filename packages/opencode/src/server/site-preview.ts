import path from "node:path"
import { randomBytes } from "node:crypto"
import { ProductProjects } from "./product-projects"

export type PreviewApp = { path: string; kind: "static" | "dynamic"; framework?: "HTML" | "Vite" | "React" }
const excluded = new Set(["node_modules", "vendor", "coverage"])
const extensions = new Set(
  ".html .htm .css .js .mjs .json .svg .png .jpg .jpeg .gif .webp .avif .ico .woff .woff2 .ttf .otf .mp4 .webm .mp3 .ogg .wav .wasm".split(
    " ",
  ),
)
const ttl = 120_000

function visible(value: string) {
  return value.split("/").every((part) => part && !part.startsWith(".") && !excluded.has(part))
}

export async function discover(directory: string) {
  const apps: PreviewApp[] = []
  const budget = { remaining: 2000 }
  const visit = async (relative: string, depth: number, inherited: "HTML" | "Vite" | "React" = "HTML") => {
    if (depth > 6 || budget.remaining <= 0 || apps.length >= 50) return
    const entries = await ProductProjects.files(directory, relative)
    budget.remaining -= entries.length
    if (budget.remaining < 0) throw new Error("scan_limit")
    const manifest = entries.find((entry) => entry.name === "package.json" && entry.type === "file")
    const packageInfo =
      manifest &&
      (await ProductProjects.content(directory, manifest.path)
        .then((file) => {
          const data: unknown = JSON.parse(file.content)
          const dependency = (name: string) =>
            data &&
            typeof data === "object" &&
            ["dependencies", "devDependencies"].some((key) => {
              const value: unknown = Reflect.get(data, key)
              return value && typeof value === "object" && name in value
            })
          const framework = dependency("vite")
            ? ("Vite" as const)
            : dependency("react")
              ? ("React" as const)
              : inherited
          if (
            !data ||
            typeof data !== "object" ||
            !("scripts" in data) ||
            !data.scripts ||
            typeof data.scripts !== "object"
          )
            return { dynamic: false, framework }
          return {
            dynamic: ["dev", "start", "build"].some(
              (key) => typeof Reflect.get(data.scripts as object, key) === "string",
            ),
            framework,
          }
        })
        .catch(() => ({ dynamic: true, framework: inherited })))
    const dynamic = packageInfo?.dynamic
    const framework = packageInfo?.framework ?? inherited
    if (dynamic) apps.push({ path: relative, kind: "dynamic" })
    if (!dynamic && entries.some((entry) => entry.name === "index.html" && entry.type === "file"))
      apps.push({ path: relative, kind: "static", ...(framework !== "HTML" ? { framework } : {}) })
    for (const entry of entries.filter((entry) => entry.type === "directory" && visible(entry.name)))
      await visit(entry.path, depth + 1, framework)
  }
  await visit("", 0)
  return apps
}

export function configuration() {
  const domain = process.env.GAMMA_PREVIEW_DOMAIN
  const main = process.env.GAMMA_PUBLIC_ORIGIN
  if (!domain || !main) return
  const origin = new URL(main)
  if (
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(domain) ||
    domain.includes("..") ||
    origin.protocol !== "https:" ||
    origin.origin !== main
  )
    throw new Error("invalid_preview_config")
  // A separate cookie domain is required; never nest preview under the application host.
  if (domain === origin.hostname || domain.endsWith(`.${origin.hostname}`) || origin.hostname.endsWith(`.${domain}`))
    throw new Error("invalid_preview_config")
  return { domain, main }
}

export function createPreview(config: { domain: string; main: string }, now = Date.now) {
  const leases = new Map<string, { session: string; directory: string; root: string; expires: number }>()
  const sweep = () => {
    for (const [id, lease] of leases) if (lease.expires <= now()) leases.delete(id)
  }
  const owned = (session: string, id: string) => {
    sweep()
    const lease = leases.get(id)
    if (!lease || lease.session !== session) throw new Error("expired")
    return lease
  }
  return {
    sweep,
    clear: () => leases.clear(),
    async start(session: string, directory: string, root: string) {
      sweep()
      if (leases.size >= 32) throw new Error("preview_limit")
      const app = (await discover(directory)).find((app) => app.path === root)
      if (!app) throw new Error("site_missing")
      if (app.kind !== "static") throw new Error("dynamic_unavailable")
      // Recheck after asynchronous discovery to enforce the global admission limit.
      if (leases.size >= 32) throw new Error("preview_limit")
      const id = randomBytes(24).toString("hex")
      leases.set(id, { session, directory, root, expires: now() + ttl })
      return { id, url: `https://${id}.${config.domain}/` }
    },
    renew(session: string, id: string) {
      owned(session, id).expires = now() + ttl
    },
    stop(session: string, id: string) {
      const lease = leases.get(id)
      if (lease?.session === session) leases.delete(id)
    },
    async fetch(request: Request) {
      sweep()
      const url = new URL(request.url)
      const host = request.headers.get("host") ?? url.host
      const id = host.endsWith(`.${config.domain}`) ? host.slice(0, -config.domain.length - 1) : ""
      const lease = leases.get(id)
      const headers = {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin",
        "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
        "content-security-policy": `sandbox allow-scripts allow-forms; default-src https://${host}; script-src https://${host} 'unsafe-inline'; style-src https://${host} 'unsafe-inline'; img-src https://${host} data: blob:; font-src https://${host} data:; connect-src https://${host}; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri https://${host}; form-action https://${host}; frame-ancestors ${config.main}`,
      }
      if (!lease || !/^[a-f0-9]{48}$/.test(id)) return new Response("Preview expired", { status: 404, headers })
      if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers })
      const relative = decodeURIComponent(url.pathname).slice(1) + (url.pathname.endsWith("/") ? "index.html" : "")
      if (
        !visible(relative) ||
        /[\\:%\x00-\x1f\x7f]/.test(relative) ||
        !extensions.has(path.extname(relative).toLowerCase()) ||
        /(^|\/)(package(-lock)?\.json|.*lock\.json|gamma\.json|opencode\.json)$/i.test(relative)
      )
        return new Response(null, { status: 404, headers })
      return ProductProjects.withFile(lease.directory, path.posix.join(lease.root, relative), false, async (handle) => {
        const stat = await handle.stat()
        if (stat.size > 8 * 1024 * 1024 || stat.nlink !== 1) return new Response(null, { status: 413, headers })
        if (request.method === "HEAD")
          return new Response(null, { headers: { ...headers, "content-type": Bun.file(relative).type } })
        const bytes = Buffer.alloc(stat.size + 1)
        const cursor = { read: 0 }
        while (cursor.read < bytes.length) {
          const result = await handle.read(bytes, cursor.read, bytes.length - cursor.read, cursor.read)
          if (!result.bytesRead) break
          cursor.read += result.bytesRead
        }
        if (cursor.read !== stat.size) return new Response(null, { status: 409, headers })
        return new Response(request.method === "HEAD" ? null : bytes.subarray(0, cursor.read), {
          headers: { ...headers, "content-type": Bun.file(relative).type },
        })
      }).catch(() => new Response(null, { status: 404, headers }))
    },
  }
}
