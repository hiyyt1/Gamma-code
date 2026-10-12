import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import http from "node:http"
import https from "node:https"
import { mkdir, appendFile, realpath } from "node:fs/promises"
import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { Global } from "@opencode-ai/core/global"
import { TokenBucket } from "./vendor/token-bucket"
import catalog from "./vendor/methods.json"

export class Failure extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}
export const methods: Record<string, { scope: string; write: boolean }> = catalog
export const scopes = ["crm", "task", "user", "bizproc", "event"]
type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Operation = { method: string; params: Record<string, Json> }
type Plan = {
  id: string
  summary: string
  operations: Operation[]
  state: "pending" | "approved" | "running" | "done" | "failed" | "rejected"
  expires: number
  results: Json[]
}
type Connection = {
  webhook: URL
  approvalHash: string
  version: string
  scopes: string[]
  remote: string[]
  available: string[]
  expires: number
  limiter: TokenBucket
  plans: Map<string, Plan>
  keys: Map<string, string>
  status: "connected" | "expired"
  timer?: ReturnType<typeof setTimeout>
}

// Single-owner, process-memory vault. No credential getter, serialization or environment export.
export class Portal {
  private readonly connections = new Map<string, Connection>()
  constructor(
    private readonly options: {
      auditRoot: string
      allowedOrigins?: string[]
      mockOrigin?: string
      interval?: number
      lifetime?: number
    },
  ) {}

  async connect(directory: string, input: unknown) {
    const key = await realpath(directory)
    const body = object(input)
    if (typeof body.approvalKey !== "string" || body.approvalKey.length < 32 || body.approvalKey.length > 128)
      throw new Failure("invalid_approval_key")
    if (
      typeof body.webhook !== "string" ||
      !Array.isArray(body.scopes) ||
      body.scopes.some((s) => typeof s !== "string" || !scopes.includes(s))
    )
      throw new Failure("invalid_connection")
    const webhook = new URL(body.webhook.trim(), "https://invalid.invalid")
    if (
      webhook.username ||
      webhook.password ||
      webhook.search ||
      webhook.hash ||
      !/^\/rest\/\d+\/[A-Za-z0-9_-]+\/$/.test(webhook.pathname)
    )
      throw new Failure("invalid_webhook")
    const approved = this.options.allowedOrigins?.includes(webhook.origin)
    const mock = this.options.mockOrigin === webhook.origin
    if (
      !mock &&
      (webhook.protocol !== "https:" ||
        (!approved && !/^[a-z0-9-]+\.bitrix24\.(ru|com|de|eu|es|com\.br|in|kz|by)$/.test(webhook.hostname)))
    )
      throw new Failure("portal_origin_not_allowed")
    const connection: Connection = {
      webhook,
      approvalHash: createHash("sha256").update(body.approvalKey).digest("hex"),
      version: randomUUID(),
      scopes: body.scopes as string[],
      remote: [],
      available: [],
      expires: Date.now() + (this.options.lifetime ?? 8 * 3600_000),
      limiter: new TokenBucket(1, 1 / (this.options.interval ?? 500)),
      plans: new Map(),
      keys: new Map(),
      status: "connected",
    }
    const remote = await this.send(connection, "scope", {}, true)
    const available = await this.send(connection, "methods", {}, true)
    if (
      !Array.isArray(remote.result) ||
      !remote.result.every((s) => typeof s === "string") ||
      !Array.isArray(available.result) ||
      !available.result.every((s) => typeof s === "string")
    )
      throw new Failure("capability_probe_failed")
    connection.remote = remote.result
    connection.available = available.result
    await this.send(connection, "user.current", {}, true)
    await this.audit(key, "connection", "connected")
    this.forget(key)
    this.connections.set(key, connection)
    connection.timer = setTimeout(() => this.forget(key), Math.max(0, connection.expires - Date.now()))
    connection.timer.unref()
    return this.status(key)
  }

  async disconnect(directory: string) {
    const key = await realpath(directory)
    this.forget(key)
    await this.audit(key, "connection", "disconnected")
  }

  close() {
    for (const key of this.connections.keys()) this.forget(key)
  }

  private forget(directory: string) {
    const connection = this.connections.get(directory)
    if (connection) connection.status = "expired"
    clearTimeout(connection?.timer)
    this.connections.delete(directory)
  }

  status(directory: string) {
    const connection = this.connections.get(directory)
    if (!connection) return { status: "disconnected", portal: null, version: null, scopes: [], methods: [], plans: [] }
    return {
      status: connection.expires < Date.now() ? "expired" : connection.status,
      portal: connection.webhook.origin,
      version: connection.version,
      scopes: connection.scopes.filter((s) => this.granted(connection, s)),
      methods: Object.keys(methods).filter((m) => this.allowed(connection, m)),
      plans: [...connection.plans.values()].map((p) => ({
        id: p.id,
        summary: this.clean(connection, p.summary),
        operations: this.clean(connection, p.operations),
        state: p.state,
        expires: p.expires,
      })),
    }
  }

  documentationSafe(directory: string, value: unknown) {
    const c = this.connections.get(directory)
    return !c || JSON.stringify(this.clean(c, value)) === JSON.stringify(value)
  }

  async recheck(directory: string) {
    const c = this.get(directory)
    const remote = await this.send(c, "scope", {}, true)
    const available = await this.send(c, "methods", {}, true)
    await this.send(c, "user.current", {}, true)
    if (
      !Array.isArray(remote.result) ||
      !remote.result.every((s) => typeof s === "string") ||
      !Array.isArray(available.result) ||
      !available.result.every((s) => typeof s === "string")
    )
      throw new Failure("capability_probe_failed")
    c.remote = remote.result
    c.available = available.result
  }

  private get(directory: string) {
    const connection = this.connections.get(directory)
    if (!connection) throw new Failure("portal_not_connected")
    if (connection.expires < Date.now() || connection.status === "expired") throw new Failure("authorization_expired")
    return connection
  }
  private granted(c: Connection, scope: string) {
    return (
      c.remote.includes(scope) ||
      (scope === "user" && c.remote.some((s) => ["user_basic", "user_brief"].includes(s))) ||
      (scope === "event" && c.available.includes("event.get"))
    )
  }
  private allowed(c: Connection, method: string) {
    const rule = methods[method]
    return Boolean(rule && c.scopes.includes(rule.scope) && this.granted(c, rule.scope) && c.available.includes(method))
  }
  private check(c: Connection, operation: Operation, write: boolean) {
    if (!this.allowed(c, operation.method) || methods[operation.method].write !== write)
      throw new Failure("method_not_permitted")
    if (
      JSON.stringify(this.clean(c, operation.params)) !== JSON.stringify(operation.params) ||
      JSON.stringify(operation.params).length > 64_000 ||
      /"(?:auth|access_token|refresh_token|webhook|client_secret)"\s*:/i.test(JSON.stringify(operation.params))
    )
      throw new Failure("unsafe_parameters")
  }

  async read(directory: string, method: string, params: Record<string, Json>, pages = 1) {
    const c = this.get(directory)
    this.check(c, { method, params }, false)
    if (!Number.isInteger(pages) || pages < 1 || pages > 10) throw new Failure("invalid_page_limit")
    const results: Json[] = []
    const cursor = { value: params.start ?? 0, seen: new Set<string>() }
    for (const index of Array.from({ length: pages }, (_, i) => i)) {
      if (this.get(directory) !== c) throw new Failure("connection_changed")
      const result = await this.send(c, method, { ...params, ...(index ? { start: cursor.value } : {}) }, true)
      results.push(result)
      if (result.next === undefined || result.next === null) break
      if ((typeof result.next !== "number" && typeof result.next !== "string") || cursor.seen.has(String(result.next)))
        throw new Failure("invalid_pagination")
      cursor.seen.add(String(result.next))
      cursor.value = result.next
    }
    await this.audit(directory, method, "read")
    return { untrustedPortalData: true, pages: this.clean(c, results) }
  }

  prepare(directory: string, input: unknown) {
    const c = this.get(directory)
    const body = object(input)
    if (
      typeof body.summary !== "string" ||
      !body.summary.trim() ||
      body.summary.length > 1000 ||
      typeof body.key !== "string" ||
      body.key.length < 16 ||
      body.key.length > 100 ||
      !Array.isArray(body.operations) ||
      !body.operations.length ||
      body.operations.length > 20
    )
      throw new Failure("invalid_plan")
    const operations = body.operations.map((item) => {
      const operation = object(item)
      if (typeof operation.method !== "string") throw new Failure("invalid_plan")
      const params = object(operation.params) as Record<string, Json>
      this.check(c, { method: operation.method, params }, true)
      return { method: operation.method, params: structuredClone(params) }
    })
    const existing = c.keys.get(body.key)
    if (existing) {
      const plan = c.plans.get(existing)!
      if (JSON.stringify(plan.operations) !== JSON.stringify(operations) || plan.summary !== body.summary)
        throw new Failure("idempotency_conflict")
      return { planId: plan.id, status: plan.state }
    }
    if (c.plans.size >= 100) throw new Failure("plan_limit")
    const plan: Plan = {
      id: randomUUID(),
      summary: body.summary,
      operations,
      state: "pending",
      expires: Date.now() + 600_000,
      results: [],
    }
    c.plans.set(plan.id, plan)
    c.keys.set(body.key, plan.id)
    return {
      planId: plan.id,
      status: plan.state,
      next: "Ask the client to review the change plan in the project Bitrix24 connection panel. Never request credentials in chat.",
    }
  }

  async approve(directory: string, id: string, approved: boolean, approvalKey: string) {
    const c = this.get(directory)
    if (createHash("sha256").update(approvalKey).digest("hex") !== c.approvalHash)
      throw new Failure("browser_approval_required")
    const plan = c.plans.get(id)
    if (!plan || plan.expires < Date.now() || plan.state !== "pending") throw new Failure("plan_not_pending")
    // Reserve the decision synchronously; concurrent requests cannot reverse it.
    plan.state = "rejected"
    await this.audit(directory, "plan", approved ? "approved" : "rejected", id)
    plan.state = approved ? "approved" : "rejected"
  }

  async execute(directory: string, id: string, signal?: AbortSignal) {
    const c = this.get(directory)
    const plan = c.plans.get(id)
    if (!plan) throw new Failure("plan_not_found")
    if (plan.state === "done" || plan.state === "failed")
      return { status: plan.state, results: this.clean(c, plan.results), replay: true }
    if (plan.state !== "approved" || plan.expires < Date.now()) throw new Failure("client_approval_required")
    plan.state = "running"
    for (const operation of plan.operations) {
      const result = await (async () => {
        if (signal?.aborted) throw new Failure("operation_cancelled")
        if (this.get(directory) !== c) throw new Failure("connection_changed")
        this.check(c, operation, true)
        await this.audit(directory, operation.method, "started", id)
        // Never retry writes: a lost response may still mean a committed remote operation.
        return this.send(c, operation.method, operation.params, false)
      })()
        .then(async (data) => {
          await this.audit(directory, operation.method, "succeeded", id)
          return { ok: true, data } as const
        })
        .catch(async (error: unknown) => {
          const code = error instanceof Failure ? error.code : "operation_failed"
          await this.audit(directory, operation.method, "failed_or_unknown", id).catch(() => undefined)
          return { ok: false, error: code } as const
        })
      plan.results.push(result)
      if (!result.ok) {
        plan.state = "failed"
        return { status: plan.state, results: this.clean(c, plan.results), verifyBeforeRetry: true }
      }
    }
    plan.state = "done"
    return { status: plan.state, results: this.clean(c, plan.results), verifyWithRead: true }
  }

  private async audit(directory: string, method: string, outcome: string, plan?: string) {
    await mkdir(this.options.auditRoot, { recursive: true, mode: 0o700 })
    await appendFile(
      path.join(this.options.auditRoot, `${createHash("sha256").update(directory).digest("hex")}.jsonl`),
      JSON.stringify({ time: new Date().toISOString(), method, outcome, plan }) + "\n",
      { mode: 0o600 },
    )
  }

  private clean(c: Connection, value: unknown): Json {
    if (typeof value === "string")
      return value
        .replaceAll(c.webhook.href, "[REDACTED]")
        .replaceAll(c.webhook.pathname.split("/")[3], "[REDACTED]")
        .replace(/https?:\/\/[^\s"<>]+\/rest\/\d+\/[^\s"<>]+/gi, "[REDACTED_WEBHOOK]")
    if (Array.isArray(value)) return value.map((v) => this.clean(c, v))
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !/token|secret|password|authorization|webhook|^auth$/i.test(key))
          .map(([key, v]) => [key, this.clean(c, v)]),
      )
    return typeof value === "number" || typeof value === "boolean" ? value : null
  }

  private async send(
    c: Connection,
    method: string,
    params: Record<string, Json>,
    retry: boolean,
    attempt = 0,
  ): Promise<Record<string, Json>> {
    await c.limiter.acquire()
    // A disconnect/expiry can happen while a request waits for its rate slot.
    if (c.status === "expired" || c.expires < Date.now()) throw new Failure("authorization_expired")
    const origin = c.webhook.origin
    const addresses = await lookup(c.webhook.hostname, { all: true }).catch(() => {
      throw new Failure("portal_dns_failed")
    })
    if (
      !addresses.length ||
      (!this.options.allowedOrigins?.includes(origin) &&
        this.options.mockOrigin !== origin &&
        addresses.some((a) => !publicAddress(a.address)))
    )
      throw new Failure("private_address_denied")
    const response = await request(c.webhook, method, params, addresses[0]).catch(() => {
      throw new Failure(retry ? "portal_unreachable" : "write_result_unknown")
    })
    const data = object(response.data)
    if (
      response.status === 401 ||
      ["expired_token", "invalid_token", "INVALID_CREDENTIALS", "NO_AUTH_FOUND"].includes(String(data.error))
    ) {
      c.status = "expired"
      throw new Failure("authorization_expired")
    }
    if (
      retry &&
      attempt < 2 &&
      (response.status === 429 || data.error === "QUERY_LIMIT_EXCEEDED" || response.status >= 500)
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(5000, Math.max(response.retryAfter * 1000, 500 * 2 ** attempt))),
      )
      return this.send(c, method, params, retry, attempt + 1)
    }
    if (response.status >= 400 || data.error)
      throw new Failure(
        response.status === 403 || data.error === "ACCESS_DENIED"
          ? "portal_access_denied"
          : response.status === 429
            ? "portal_rate_limited"
            : "portal_api_error",
      )
    return this.clean(c, data) as Record<string, Json>
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Failure("invalid_payload")
  return value as Record<string, unknown>
}
function publicAddress(address: string) {
  if (isIP(address) === 6) return !/^(::|fc|fd|fe8|fe9|fea|feb|ff)/i.test(address)
  const parts = address.split(".").map(Number)
  return (
    parts[0] !== 0 &&
    parts[0] !== 10 &&
    parts[0] !== 127 &&
    parts[0] < 224 &&
    !(parts[0] === 169 && parts[1] === 254) &&
    !(parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) &&
    !(parts[0] === 192 && parts[1] === 168) &&
    !(parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
  )
}
function request(url: URL, method: string, params: Record<string, Json>, address: { address: string; family: number }) {
  return new Promise<{ status: number; retryAfter: number; data: unknown }>((resolve, reject) => {
    const payload = JSON.stringify(params)
    const send = url.protocol === "https:" ? https.request : http.request
    const req = send(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + method + ".json",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
        lookup: (_host, _options, cb) => cb(null, address.address, address.family),
        timeout: 20_000,
      },
      (res) => {
        const chunks: Buffer[] = []
        const size = { value: 0 }
        res.on("data", (chunk: Buffer) => {
          size.value += chunk.length
          if (size.value > 2_000_000) {
            req.destroy()
            reject(new Failure("response_too_large"))
            return
          }
          chunks.push(chunk)
        })
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode ?? 500,
              retryAfter: Number(res.headers["retry-after"] ?? 0) || 0,
              data: JSON.parse(Buffer.concat(chunks).toString()),
            })
          } catch {
            reject(new Failure("invalid_portal_response"))
          }
        })
        res.on("error", () => reject(new Failure("portal_unreachable")))
      },
    )
    req.on("timeout", () => req.destroy(new Error("timeout")))
    req.on("error", () => reject(new Failure("portal_unreachable")))
    req.end(payload)
  })
}

export class Service extends Context.Service<Service, Portal>()("@opencode/Bitrix24") {}
export const layer = Layer.effect(
  Service,
  Effect.acquireRelease(
    Effect.sync(
      () =>
        new Portal({
          auditRoot: path.join(Global.Path.data, "bitrix24-audit"),
          allowedOrigins: (process.env.GAMMA_BITRIX24_PORTAL_ORIGINS ?? "").split(",").filter(Boolean),
        }),
    ),
    (portal) => Effect.sync(() => portal.close()),
  ),
)
export const node = makeGlobalNode({ service: Service, layer, deps: [] })
export * as Bitrix24 from "./portal"
