import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { stat } from "node:fs/promises"

export type AuthConfig = {
  origin: string
  username: string
  passwordHash: string
  backendAuthorization: string
  lifetime?: number
}

type Session = { expires: number; controller: AbortController; timer: ReturnType<typeof setTimeout> }

export async function loadAuthConfig(): Promise<AuthConfig> {
  const origin = new URL(process.env.GAMMA_PUBLIC_ORIGIN ?? "")
  if (origin.origin !== process.env.GAMMA_PUBLIC_ORIGIN || origin.username || origin.password)
    throw new Error("GAMMA_PUBLIC_ORIGIN must be an exact origin")
  if (
    origin.protocol !== "https:" &&
    !(origin.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))
  )
    throw new Error("Gamma authentication requires HTTPS outside loopback")
  const filename = process.env.GAMMA_AUTH_CONFIG
  if (!filename) throw new Error("GAMMA_AUTH_CONFIG is required")
  const info = await stat(filename)
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error("Auth configuration must be a private file (0600)")
  const config: unknown = await Bun.file(filename).json()
  if (
    !config ||
    typeof config !== "object" ||
    !("username" in config) ||
    !("passwordHash" in config) ||
    typeof config.username !== "string" ||
    !config.username.trim() ||
    config.username.length > 128 ||
    typeof config.passwordHash !== "string" ||
    !/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/.test(config.passwordHash)
  )
    throw new Error("Auth configuration must contain a username and an Argon2id password hash")
  const parameters = /\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(config.passwordHash)!
  if (Number(parameters[1]) < 65536 || Number(parameters[2]) < 3 || Number(parameters[3]) < 1)
    throw new Error("Argon2id requires at least 64 MiB and three iterations")
  await Bun.password.verify(randomBytes(32).toString("hex"), config.passwordHash).catch(() => {
    throw new Error("Auth configuration contains an invalid Argon2id hash")
  })
  const password = process.env.OPENCODE_SERVER_PASSWORD
  if (!password || password.length < 32)
    throw new Error("An internal OPENCODE_SERVER_PASSWORD of at least 32 characters is required")
  return {
    origin: origin.origin,
    username: config.username,
    passwordHash: config.passwordHash,
    backendAuthorization: `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME ?? "opencode"}:${password}`).toString("base64")}`,
  }
}

export function createAuth(config: AuthConfig) {
  const sessions = new Map<string, Session>()
  const attempts = new Map<string, { tokens: number; time: number }>()
  let verifying = 0
  const lifetime = config.lifetime ?? 12 * 60 * 60 * 1000
  const secure = config.origin.startsWith("https:")
  const cookieName = secure ? "__Host-gamma_session" : "gamma_session"
  const cookie = (token: string, age: number) =>
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`
  const digest = (value: string) => createHash("sha256").update(value).digest()
  const revoke = (key: string) => {
    const session = sessions.get(key)
    if (!session) return
    sessions.delete(key)
    clearTimeout(session.timer)
    session.controller.abort()
  }
  const lookup = (request: Request) => {
    const cookies = (request.headers.get("cookie") ?? "").split(";").map((item) => item.trim())
    const tokens = cookies.filter((item) => item.startsWith(`${cookieName}=`))
    if (tokens.length !== 1) return
    const token = tokens[0]!.slice(cookieName.length + 1)
    if (!/^[a-f0-9]{64}$/.test(token)) return
    const key = digest(token).toString("hex")
    const session = sessions.get(key)
    if (!session) return
    if (session.expires <= Date.now()) {
      revoke(key)
      return
    }
    return { key, ...session }
  }
  const consume = (key: string, capacity: number, refill: number) => {
    const now = Date.now()
    const previous = attempts.get(key) ?? { tokens: capacity, time: now }
    const tokens = Math.min(capacity, previous.tokens + (now - previous.time) / refill)
    attempts.set(key, { tokens: Math.max(0, tokens - 1), time: now })
    return tokens >= 1
  }
  const json = (value: object, status = 200, headers?: Record<string, string>) =>
    Response.json(value, {
      status,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
    })
  const denied = () => json({ code: "unauthorized" }, 401)
  const originAllowed = (request: Request, required = false) => {
    const origin = request.headers.get("origin")
    const site = request.headers.get("sec-fetch-site")
    if (site === "cross-site" || site === "same-site") return false
    return origin ? origin === config.origin : !required
  }
  return {
    lookup,
    denied,
    originAllowed,
    close: () => Array.from(sessions.keys()).forEach(revoke),
    async handle(request: Request, address: string) {
      const url = new URL(request.url)
      if (url.pathname === "/auth/session") {
        if (request.method !== "GET") return json({ code: "method_not_allowed" }, 405)
        if (!originAllowed(request)) return json({ code: "origin_denied" }, 403)
        return lookup(request) ? json({ username: config.username }) : denied()
      }
      if (url.pathname !== "/auth/login" && url.pathname !== "/auth/logout") return
      if (request.method !== "POST") return json({ code: "method_not_allowed" }, 405)
      // Exact, configured Origin is mandatory, even with a valid cookie. No CORS
      // allowance or Referer fallback: sandboxed Preview has Origin: null.
      if (!originAllowed(request, true)) return json({ code: "origin_denied" }, 403)
      if (url.pathname === "/auth/logout") {
        const session = lookup(request)
        if (session) revoke(session.key)
        return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) })
      }
      // A global bucket also bounds hash work when clients rotate addresses.
      if (attempts.size > 10000) {
        Array.from(attempts.entries())
          .filter(([, value]) => Date.now() - value.time > 15 * 60 * 1000)
          .forEach(([key]) => attempts.delete(key))
        if (attempts.size > 10000) return json({ code: "rate_limited" }, 429, { "Retry-After": "180" })
      }
      if (!consume("global", 20, 3000) || !consume(`ip:${address}`, 5, 180000))
        return json({ code: "rate_limited" }, 429, { "Retry-After": "180" })
      if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
        return json({ code: "invalid_request" }, 400)
      const body = await readLogin(request)
      if (!body) return json({ code: "invalid_request" }, 400)
      if (verifying >= 2) return json({ code: "rate_limited" }, 429, { "Retry-After": "180" })
      verifying++
      const valid = await Bun.password.verify(body.password, config.passwordHash).finally(() => verifying--)
      if (!valid || !timingSafeEqual(digest(body.username), digest(config.username)))
        return json({ code: "invalid_credentials" }, 401)
      const previous = lookup(request)
      if (previous) revoke(previous.key)
      if (sessions.size >= 32) revoke(sessions.keys().next().value!)
      const token = randomBytes(32).toString("hex")
      const key = digest(token).toString("hex")
      const controller = new AbortController()
      const timer = setTimeout(() => revoke(key), lifetime)
      timer.unref()
      sessions.set(key, { expires: Date.now() + lifetime, controller, timer })
      return json({ username: config.username }, 200, { "Set-Cookie": cookie(token, Math.floor(lifetime / 1000)) })
    },
  }
}

async function readLogin(request: Request): Promise<{ username: string; password: string } | undefined> {
  if (!request.body) return
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      length += result.value.byteLength
      if (length > 4096) {
        await reader.cancel()
        return
      }
      chunks.push(result.value)
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString())
    if (
      !body ||
      typeof body !== "object" ||
      !("username" in body) ||
      !("password" in body) ||
      typeof body.username !== "string" ||
      body.username.length > 128 ||
      typeof body.password !== "string" ||
      !body.password ||
      body.password.length > 1024
    )
      return
    return { username: body.username, password: body.password }
  } catch {
    return
  } finally {
    reader.releaseLock()
  }
}
