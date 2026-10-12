import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { createGammaServer } from "./web"

const password = randomBytes(24).toString("hex")
const hash = await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 })
const cleanup: Array<() => Promise<unknown> | unknown> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "gamma-auth-test-"))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  await Bun.write(path.join(root, "index.html"), "<html>Gamma login fixture</html>")
  const authorization = `Basic ${randomBytes(32).toString("base64")}`
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch(request, server) {
      if (request.headers.get("authorization") !== authorization)
        return new Response(null, { status: 401, headers: { "WWW-Authenticate": "Basic" } })
      if (request.headers.get("upgrade") === "websocket") {
        if (server.upgrade(request)) return
        return new Response(null, { status: 400 })
      }
      if (new URL(request.url).pathname === "/event") {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: connected\n\n"))
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        )
      }
      return Response.json({
        cookie: request.headers.get("cookie"),
        authorization: request.headers.get("authorization"),
        method: request.method,
      })
    },
    websocket: {
      message(socket, message) {
        socket.send(message)
      },
    },
  })
  cleanup.push(() => upstream.stop(true))
  const origin = "http://127.0.0.1:4444"
  const gateway = await createGammaServer({
    auth: { origin, username: "test-admin", passwordHash: hash, backendAuthorization: authorization },
    backend: upstream.url.origin,
    root,
    port: 0,
  })
  cleanup.push(gateway.close)
  const url = gateway.server.url.origin
  const login = async () => {
    const response = await fetch(`${url}/auth/login`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test-admin", password }),
    })
    expect(response.status).toBe(200)
    return response.headers.get("set-cookie")!.split(";")[0]!
  }
  return { url, origin, login, authorization }
}

test("protects pages, every API family, SSE and WebSocket without Basic challenges", async () => {
  const app = await fixture()
  for (const endpoint of ["/", "/knowledge", "/agents", "/anything/session/existing"]) {
    const response = await fetch(app.url + endpoint, { redirect: "manual" })
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/login")
  }
  expect((await fetch(`${app.url}/login`)).status).toBe(200)
  for (const endpoint of [
    "/global/health",
    "/api/v2/session",
    "/product/projects",
    "/session",
    "/file",
    "/event",
    "/pty/test/connect",
    "/mcp",
    "/config",
    "/auth/provider",
  ]) {
    const response = await fetch(app.url + endpoint)
    expect(response.status).toBe(401)
    expect(response.headers.has("www-authenticate")).toBe(false)
  }
  const websocket = await fetch(`${app.url}/pty/test/connect`, {
    headers: { Upgrade: "websocket", Connection: "Upgrade", Origin: app.origin },
  })
  expect(websocket.status).toBe(401)
  expect((await fetch(`${app.url}/product/projects`, { headers: { Authorization: app.authorization } })).status).toBe(
    401,
  )
})

test("requires exact Origin for mutations and strips browser credentials on the internal hop", async () => {
  const app = await fixture()
  const cookie = await app.login()
  for (const origin of [undefined, "null", "https://evil.test", "http://localhost:4444"]) {
    const response = await fetch(`${app.url}/product/projects`, {
      method: "POST",
      headers: { Cookie: cookie, ...(origin ? { Origin: origin } : {}) },
    })
    expect(response.status).toBe(403)
  }
  const response = await fetch(`${app.url}/product/projects`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: app.origin, Authorization: "Basic attacker" },
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ cookie: null, authorization: app.authorization, method: "POST" })
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect((await fetch(`${app.url}/file`, { headers: { Cookie: cookie, Origin: "null" } })).status).toBe(403)
})

test("SSE streams immediately and is revoked on logout", async () => {
  const app = await fixture()
  const cookie = await app.login()
  const response = await fetch(`${app.url}/event`, { headers: { Cookie: cookie } })
  expect(response.status).toBe(200)
  expect(response.headers.get("x-accel-buffering")).toBe("no")
  const reader = response.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: connected\n\n")
  const ended = reader.read().then(
    (result) => result.done,
    () => true,
  )
  expect(
    (await fetch(`${app.url}/auth/logout`, { method: "POST", headers: { Cookie: cookie, Origin: app.origin } })).status,
  ).toBe(200)
  expect(await ended).toBe(true)
  expect((await fetch(`${app.url}/event`, { headers: { Cookie: cookie } })).status).toBe(401)
})

test("WebSocket requires Origin, relays frames and closes on logout", async () => {
  const app = await fixture()
  const cookie = await app.login()
  for (const origin of [undefined, "null", "https://evil.test"]) {
    const response = await fetch(`${app.url}/pty/test/connect`, {
      headers: { Cookie: cookie, Upgrade: "websocket", Connection: "Upgrade", ...(origin ? { Origin: origin } : {}) },
    })
    expect(response.status).toBe(403)
  }
  const socket = new WebSocket(app.url.replace("http:", "ws:") + "/pty/test/connect", {
    headers: { Cookie: cookie, Origin: app.origin },
  })
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => socket.send("hello-gamma")
    socket.onmessage = (event) => {
      expect(event.data).toBe("hello-gamma")
      resolve()
    }
    socket.onerror = reject
  })
  const closed = new Promise<number>((resolve) => {
    socket.onclose = (event) => resolve(event.code)
  })
  await fetch(`${app.url}/auth/logout`, { method: "POST", headers: { Cookie: cookie, Origin: app.origin } })
  expect(await closed).toBe(1008)
})

test("refuses to start against an unprotected backend", async () => {
  const upstream = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ healthy: true }) })
  cleanup.push(() => upstream.stop(true))
  await expect(
    createGammaServer({
      auth: {
        origin: "http://127.0.0.1:4444",
        username: "test",
        passwordHash: hash,
        backendAuthorization: "Basic test",
      },
      backend: upstream.url.origin,
      root: "/tmp",
      port: 0,
    }),
  ).rejects.toThrow("Internal backend must require authentication")
})
