import path from "node:path"
import type { ServerWebSocket } from "bun"
import { createAuth, loadAuthConfig, type AuthConfig } from "./auth"

type Connection = {
  upstream: WebSocket & { terminate(): void }
  pending: Array<string | Buffer>
  bytes: number
  signal: AbortSignal
  revoke?: () => void
}
const api =
  /^\/(api|product|global|session|project|provider|path|config|agent|command|permission|question|file|find|vcs|mcp|experimental|event|pty|auth|instance|worktree|skill|formatter|lsp|log)(\/|$)/

export async function createGammaServer(options: {
  auth: AuthConfig
  backend: string
  root: string
  port: number
  trustedProxy?: boolean
}) {
  const backend = new URL(options.backend)
  if (backend.hostname !== "127.0.0.1" || backend.protocol !== "http:" || backend.username || backend.password)
    throw new Error("Backend must use HTTP loopback without URL credentials")
  // Fail closed if the internal backend is accidentally left unprotected.
  const health = new URL("/global/health", backend)
  const probe = await fetch(health, { redirect: "manual", signal: AbortSignal.timeout(10000) })
  await probe.body?.cancel()
  if (probe.status !== 401) throw new Error("Internal backend must require authentication")
  const authenticated = await fetch(health, {
    headers: { Authorization: options.auth.backendAuthorization },
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  })
  await authenticated.body?.cancel()
  if (!authenticated.ok) throw new Error("Internal backend authentication failed")
  const root = path.resolve(options.root)
  const auth = createAuth(options.auth)
  const server = Bun.serve<Connection>({
    hostname: "127.0.0.1",
    port: options.port,
    idleTimeout: 0,
    maxRequestBodySize: 21 * 1024 * 1024,
    async fetch(request, server) {
      const url = new URL(request.url)
      if (url.pathname === "/auth/login") server.timeout(request, 15)
      const address = options.trustedProxy
        ? (request.headers.get("x-real-ip") ?? "unknown")
        : (server.requestIP(request)?.address ?? "unknown")
      const authentication = await auth.handle(request, address.slice(0, 64))
      if (authentication) return authentication
      const publicFile =
        url.pathname.startsWith("/assets/") ||
        ["/gamma.svg", "/favicon.ico", "/gamma.webmanifest"].includes(url.pathname)
      const session = auth.lookup(request)
      if (!session && url.pathname !== "/login" && !publicFile) {
        if (api.test(url.pathname) || request.headers.get("upgrade") || !["GET", "HEAD"].includes(request.method))
          return auth.denied()
        return new Response(null, { status: 303, headers: { Location: "/login", "Cache-Control": "no-store" } })
      }
      if (api.test(url.pathname)) {
        if (!session) return auth.denied()
        const websocket = request.headers.get("upgrade")?.toLowerCase() === "websocket"
        if (!auth.originAllowed(request, websocket || !["GET", "HEAD"].includes(request.method)))
          return Response.json({ code: "origin_denied" }, { status: 403, headers: { "Cache-Control": "no-store" } })
        if (url.searchParams.has("auth_token")) return new Response(null, { status: 400 })
        const target = new URL(url.pathname + url.search, backend)
        const headers = new Headers(request.headers)
        for (const key of [
          "host",
          "cookie",
          "authorization",
          "forwarded",
          "x-forwarded-host",
          "x-forwarded-proto",
          "x-forwarded-for",
          "x-real-ip",
        ])
          headers.delete(key)
        headers.set("authorization", options.auth.backendAuthorization)
        if (websocket) {
          for (const key of [
            "connection",
            "upgrade",
            "sec-websocket-key",
            "sec-websocket-version",
            "sec-websocket-extensions",
          ])
            headers.delete(key)
          target.protocol = "ws:"
          // Bun supports request headers and terminate(), beyond the DOM API
          // also present when this module is imported by browser test tooling.
          const UpstreamSocket = WebSocket as unknown as new (
            url: URL,
            options: { headers: Record<string, string> },
          ) => Connection["upstream"]
          const upstream = new UpstreamSocket(target, { headers: Object.fromEntries(headers) })
          const data: Connection = { upstream, pending: [], bytes: 0, signal: session.controller.signal }
          if (server.upgrade(request, { data })) return
          upstream.close()
          return new Response("Upgrade failed", { status: 400 })
        }
        const response = await fetch(target, {
          method: request.method,
          headers,
          body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
          signal: AbortSignal.any([request.signal, session.controller.signal]),
          redirect: "manual",
        })
        const result = new Headers(response.headers)
        for (const key of [
          "content-encoding",
          "content-length",
          "transfer-encoding",
          "connection",
          "set-cookie",
          "www-authenticate",
          "access-control-allow-origin",
          "access-control-allow-credentials",
        ])
          result.delete(key)
        result.set("Cache-Control", "no-store")
        result.set("X-Accel-Buffering", "no")
        return new Response(response.body ? sessionBody(response.body, session.controller.signal) : null, {
          status: response.status,
          headers: result,
        })
      }
      if (request.headers.get("upgrade")) return new Response(null, { status: 404 })
      if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 })
      if (url.pathname === "/login" && session)
        return new Response(null, { status: 303, headers: { Location: "/", "Cache-Control": "no-store" } })
      const decoded = decodeURIComponent(url.pathname)
      const target = path.resolve(root, `.${decoded}`)
      if (!target.startsWith(root + "/") && target !== root) return new Response(null, { status: 403 })
      const file = Bun.file(target)
      const asset = target !== root && !decoded.endsWith("/") && (await file.exists())
      if (!asset && publicFile) return new Response(null, { status: 404 })
      const content = asset ? file : Bun.file(path.join(root, "index.html"))
      return new Response(request.method === "HEAD" ? null : content, {
        headers: {
          "Content-Type": content.type,
          "Cache-Control": asset && decoded.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
        },
      })
    },
    websocket: {
      open(socket: ServerWebSocket<Connection>) {
        const upstream = socket.data.upstream
        socket.data.revoke = () => {
          socket.close(1008, "Session expired")
          upstream.terminate()
        }
        socket.data.signal.addEventListener("abort", socket.data.revoke, { once: true })
        if (socket.data.signal.aborted) return socket.data.revoke()
        upstream.binaryType = "arraybuffer"
        upstream.onopen = () => {
          socket.data.pending.forEach((data) => upstream.send(data))
          socket.data.pending = []
          socket.data.bytes = 0
        }
        upstream.onmessage = (event) => socket.send(event.data)
        upstream.onclose = () => socket.close()
        upstream.onerror = () => socket.close(1011, "Upstream failed")
      },
      message(socket, message) {
        if (socket.data.signal.aborted) return socket.close(1008, "Session expired")
        if (socket.data.upstream.readyState === WebSocket.OPEN) return socket.data.upstream.send(message)
        socket.data.bytes += Buffer.byteLength(message)
        if (socket.data.bytes > 1024 * 1024) return socket.close(1009, "Queue limit")
        socket.data.pending.push(message)
      },
      close(socket) {
        if (socket.data.revoke) socket.data.signal.removeEventListener("abort", socket.data.revoke)
        socket.data.upstream.terminate()
      },
    },
    error() {
      return new Response("Upstream unavailable", { status: 502, headers: { "Cache-Control": "no-store" } })
    },
  })
  return {
    server,
    close: () => {
      auth.close()
      // Bun 1.3.14 closes the sockets/listener but never resolves stop() after
      // a server-initiated WS close: https://github.com/oven-sh/bun/issues/36223.
      void server.stop(true)
      server.unref()
    },
  }
}

function sessionBody(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader()
  let closed = false
  let revoke = () => {}
  return new ReadableStream<Uint8Array>({
    start(controller) {
      revoke = () => {
        if (closed) return
        closed = true
        signal.removeEventListener("abort", revoke)
        controller.close()
        void reader.cancel().catch(() => undefined)
      }
      signal.addEventListener("abort", revoke, { once: true })
      if (signal.aborted) revoke()
    },
    async pull(controller) {
      try {
        const result = await reader.read()
        if (closed) return
        if (result.done) return revoke()
        controller.enqueue(result.value)
      } catch (error) {
        if (closed) return
        closed = true
        signal.removeEventListener("abort", revoke)
        controller.error(error)
      }
    },
    cancel() {
      closed = true
      signal.removeEventListener("abort", revoke)
      return reader.cancel().catch(() => undefined)
    },
  })
}

if (import.meta.main) {
  const instance = await createGammaServer({
    auth: await loadAuthConfig(),
    backend: process.env.GAMMA_BACKEND_URL ?? "http://127.0.0.1:4096",
    root: process.env.GAMMA_WEB_ROOT ?? path.resolve(import.meta.dir, "../packages/app/dist"),
    port: Number(process.env.GAMMA_WEB_PORT ?? 4444),
    trustedProxy: process.env.GAMMA_TRUST_PROXY === "1",
  })
  console.log(`Gamma production web listening on ${instance.server.url}`)
}
