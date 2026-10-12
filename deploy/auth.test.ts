import { afterEach, describe, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { createAuth } from "./auth"

const password = randomBytes(24).toString("hex")
const config = {
  origin: "https://gamma.example.test",
  username: "test-admin",
  passwordHash: await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 }),
  backendAuthorization: "Basic internal-test-only",
}
const open: Array<ReturnType<typeof createAuth>> = []
afterEach(() => {
  open.splice(0).forEach((auth) => auth.close())
})
function fixture(lifetime?: number) {
  const auth = createAuth({ ...config, lifetime })
  open.push(auth)
  return auth
}
function login(body = { username: config.username, password }, origin: string | null = config.origin) {
  return new Request(`${config.origin}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  })
}
async function cookie(auth: ReturnType<typeof createAuth>) {
  const response = await auth.handle(login(), "test")
  expect(response?.status).toBe(200)
  return response!.headers.get("set-cookie")!.split(";")[0]!
}
function request(path: string, value: string, method = "GET", origin = config.origin) {
  return new Request(`${config.origin}${path}`, { method, headers: { Cookie: value, Origin: origin } })
}

describe("Gamma server sessions", () => {
  test("issues a host-only, HTTPS, HttpOnly cookie and never returns the token in JSON", async () => {
    const auth = fixture()
    const response = (await auth.handle(login(), "test"))!
    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toMatch(
      /^__Host-gamma_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure$/,
    )
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ username: config.username })
    expect(response.headers.has("www-authenticate")).toBe(false)
  })
  test("uses a persistent browser cookie on loopback HTTP without an invalid Secure prefix", async () => {
    const auth = createAuth({ ...config, origin: "http://127.0.0.1:4444" })
    open.push(auth)
    const req = login()
    req.headers.set("origin", "http://127.0.0.1:4444")
    const response = (await auth.handle(req, "test"))!
    expect(response.headers.get("set-cookie")).toMatch(/^gamma_session=/)
    expect(response.headers.get("set-cookie")).not.toContain("Secure")
  })
  test("rejects incorrect passwords and unknown users with the same response", async () => {
    const auth = fixture()
    const wrongPassword = (await auth.handle(login({ username: config.username, password: "wrong-password" }), "test"))!
    const wrongUser = (await auth.handle(login({ username: "someone-else", password }), "test"))!
    expect(wrongPassword.status).toBe(401)
    expect(wrongUser.status).toBe(401)
    expect(await wrongPassword.json()).toEqual(await wrongUser.json())
    expect(wrongPassword.headers.has("set-cookie")).toBe(false)
  })
  test.each([null, "null", "https://evil.example.test", "https://gamma.example.test.evil.test"])(
    "rejects login CSRF origin %s",
    async (origin) => {
      expect((await fixture().handle(login(undefined, origin), "test"))?.status).toBe(403)
    },
  )
  test("blocks same-site cross-origin metadata even with a forged Origin header", async () => {
    const req = login()
    req.headers.set("sec-fetch-site", "same-site")
    expect((await fixture().handle(req, "test"))?.status).toBe(403)
  })
  test("limits attempts before expensive hash verification", async () => {
    const auth = fixture()
    for (const index of [0, 1, 2, 3, 4]) {
      expect(
        (await auth.handle(login({ username: config.username, password: `wrong-${index}` }), "same-client"))?.status,
      ).toBe(401)
    }
    const response = (await auth.handle(login(), "same-client"))!
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("180")
    expect((await auth.handle(login(), "different-client"))?.status).toBe(200)
  })
  test("rejects malformed, oversized and non-JSON login bodies", async () => {
    const auth = fixture()
    for (const [type, body] of [
      ["application/json", "{"],
      ["application/json", "x".repeat(5000)],
      ["text/plain", JSON.stringify({ username: config.username, password })],
    ] as const) {
      const req = new Request(`${config.origin}/auth/login`, {
        method: "POST",
        headers: { Origin: config.origin, "Content-Type": type },
        body,
      })
      expect((await auth.handle(req, "test"))?.status).toBe(400)
    }
  })
  test("session reload succeeds, logout revokes old cookies and signals open streams", async () => {
    const auth = fixture()
    const value = await cookie(auth)
    const req = request("/auth/session", value)
    expect((await auth.handle(req, "test"))?.status).toBe(200)
    const session = auth.lookup(req)!
    expect(session.controller.signal.aborted).toBe(false)
    const response = (await auth.handle(request("/auth/logout", value, "POST"), "test"))!
    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
    expect(session.controller.signal.aborted).toBe(true)
    expect((await auth.handle(req, "test"))?.status).toBe(401)
  })
  test("cross-origin logout does not revoke a valid session", async () => {
    const auth = fixture()
    const value = await cookie(auth)
    expect((await auth.handle(request("/auth/logout", value, "POST", "https://evil.test"), "test"))?.status).toBe(403)
    expect(auth.lookup(request("/auth/session", value))).toBeDefined()
  })
  test("a new login rotates the existing session", async () => {
    const auth = fixture()
    const value = await cookie(auth)
    const req = login()
    req.headers.set("cookie", value)
    const response = (await auth.handle(req, "test"))!
    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")!.split(";")[0]!).not.toBe(value)
    expect(auth.lookup(request("/auth/session", value))).toBeUndefined()
  })
  test("rejects forged and duplicate cookies, Basic credentials and URL tokens", async () => {
    const auth = fixture()
    const value = await cookie(auth)
    expect(auth.lookup(request("/auth/session", value + "; " + value))).toBeUndefined()
    expect(auth.lookup(request("/auth/session", "__Host-gamma_session=" + "a".repeat(64)))).toBeUndefined()
    const req = new Request(`${config.origin}/auth/session?auth_token=${value}`, {
      headers: { Authorization: config.backendAuthorization },
    })
    expect((await auth.handle(req, "test"))?.status).toBe(401)
  })
  test("absolute expiry revokes live sessions without waiting for another request", async () => {
    const auth = fixture(100)
    const value = await cookie(auth)
    const req = request("/auth/session", value)
    const session = auth.lookup(req)!
    await new Promise<void>((resolve) =>
      session.controller.signal.addEventListener("abort", () => resolve(), { once: true }),
    )
    expect(auth.lookup(req)).toBeUndefined()
    expect((await auth.handle(req, "test"))?.status).toBe(401)
  })
})
