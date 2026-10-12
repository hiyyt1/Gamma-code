import path from "node:path"
import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { mkdir, appendFile, realpath, open } from "node:fs/promises"
import { Context, Effect, Layer } from "effect"
import z from "zod"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { Global } from "@opencode-ai/core/global"
import { hosts, methods } from "./methods"
import type { Category } from "./methods"

export class Failure extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}
type Operation = { method: string; params: unknown }
type Plan = {
  id: string
  key: string
  summary: string
  operations: Operation[]
  risk: string
  state: string
  expires: number
  results: unknown[]
}
type Connection = {
  token: string
  shop: string
  approval: Buffer
  categories: Category[]
  writable: boolean
  sandbox: boolean
  expires: number
  active: boolean
  plans: Map<string, Plan>
  diagnostics: Record<string, string>
  timer?: ReturnType<typeof setTimeout>
  controller: AbortController
}
const digest = (v: string) => createHash("sha256").update(v).digest("hex")
const connectSchema = z
  .object({
    token: z.string().trim().min(20).max(8192),
    mode: z.enum(["sandbox", "personal"]),
    approvalKey: z.string().min(32).max(128),
    categories: z.array(z.enum(Object.keys(hosts) as [Category, ...Category[]])).min(1),
    allowWrites: z.boolean().default(false),
  })
  .strict()
const planSchema = z
  .object({
    key: z.string().min(16).max(100),
    summary: z.string().min(1).max(1000),
    operations: z
      .array(z.object({ method: z.string(), params: z.unknown() }).strict())
      .min(1)
      .max(20),
  })
  .strict()
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new Failure("invalid_arguments")
  return result.data
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

// One store per canonical project. This intentionally reuses Gamma's memory-vault
// lifecycle rather than putting marketplace tokens into the unencrypted credential table.
export class Store {
  private readonly connections = new Map<string, Connection>()
  private readonly slots = new Map<string, number>()
  constructor(
    private readonly options: { auditRoot: string; personal?: boolean; mockOrigin?: string; interval?: number },
  ) {}
  async connect(directory: string, input: unknown) {
    const key = await realpath(directory)
    const body = parse(connectSchema, input)
    if (body.mode === "personal" && !this.options.personal) throw new Failure("personal_requires_on_premise")
    const claims = object(
      await Promise.resolve()
        .then(() => JSON.parse(Buffer.from(body.token.split(".")[1] ?? "", "base64url").toString()))
        .catch(() => {
          throw new Failure("invalid_token")
        }),
    )
    if (
      !claims ||
      typeof claims !== "object" ||
      typeof claims.exp !== "number" ||
      !Number.isFinite(claims.exp) ||
      claims.exp * 1000 <= Date.now()
    )
      throw new Failure("authorization_expired")
    if (
      body.mode === "sandbox"
        ? claims.t !== true || claims.acc !== 2
        : claims.t !== false || claims.acc !== 3 || claims.for !== "self"
    )
      throw new Failure("token_mode_mismatch")
    if (typeof claims.s !== "number" || !Number.isSafeInteger(claims.s) || claims.s < 0)
      throw new Failure("invalid_token")
    // JWT claims are hints only, not trusted authorization. WB verifies each ping/request.
    const c: Connection = {
      token: body.token,
      shop: "",
      approval: Buffer.from(digest(body.approvalKey), "hex"),
      categories: [],
      writable: body.allowWrites && !(BigInt(claims.s ?? 0) & (1n << 30n)),
      sandbox: body.mode === "sandbox",
      expires: Math.min(claims.exp * 1000, Date.now() + 8 * 3600000),
      active: true,
      plans: new Map(),
      diagnostics: {},
      controller: new AbortController(),
    }
    const bits: Record<Category, number> = {
      content: 1,
      analytics: 2,
      prices: 3,
      statistics: 5,
      advertising: 6,
      reviews: 7,
      finance: 13,
    }
    const results: Record<string, string> = {}
    for (const category of [...new Set(body.categories)]) {
      if (!(BigInt(claims.s) & (1n << BigInt(bits[category])))) {
        results[category] = "category_access_denied"
        continue
      }
      if (c.sandbox && ["analytics", "finance"].includes(category)) {
        results[category] = "sandbox_unavailable"
        continue
      }
      const result = await this.send(c, category, "/ping", "GET", {}, true, 1000)
        .then(() => "available")
        .catch((e: unknown) => (e instanceof Failure ? e.code : "probe_failed"))
      results[category] = result
      if (result === "available") c.categories.push(category)
    }
    c.diagnostics = results
    if (!c.categories.length)
      throw new Failure(
        Object.values(results).includes("authorization_expired") ? "authorization_expired" : "no_categories_available",
      )
    // Stable seller identity is required for durable deduplication across reconnects.
    const seller = c.sandbox
      ? { sid: claims.sid }
      : object(await this.send(c, "common", "/api/v1/seller-info", "GET", {}, true, 1000))
    if (typeof seller.sid !== "string" || !seller.sid) throw new Failure("seller_identity_unavailable")
    c.shop = seller.sid
    await this.disconnect(key)
    this.connections.set(key, c)
    c.timer = setTimeout(() => this.forget(key), c.expires - Date.now())
    c.timer.unref()
    await this.audit(key, c, { operation: "connect", result: "connected", categories: results })
    return { ...this.status(key), diagnostics: results }
  }
  status(directory: string) {
    const c = this.connections.get(directory)
    return {
      status: !c ? "disconnected" : c.active && c.expires > Date.now() ? "connected" : "expired",
      shop: c?.shop ?? null,
      mode: c?.sandbox ? "sandbox" : "personal",
      writable: c?.writable ?? false,
      categories: c?.categories ?? [],
      diagnostics: c?.diagnostics ?? {},
      methods: c
        ? Object.keys(methods).filter(
            (m) =>
              c.categories.includes(methods[m].category) &&
              (!c.sandbox || methods[m].sandbox) &&
              (methods[m].risk === "READ" || c.writable),
          )
        : [],
      plans: c
        ? [...c.plans.values()].map((p) => ({
            id: p.id,
            summary: p.summary,
            risk: p.risk,
            operations: p.operations,
            state: p.state,
            expires: p.expires,
          }))
        : [],
    }
  }
  private forget(directory: string) {
    const c = this.connections.get(directory)
    if (c) {
      c.active = false
      c.controller.abort()
      c.token = ""
      clearTimeout(c.timer)
    }
    this.connections.delete(directory)
  }
  async disconnect(directory: string) {
    const c = this.connections.get(directory)
    this.forget(directory)
    if (c) await this.audit(directory, c, { operation: "disconnect", result: "local_access_revoked" })
  }
  close() {
    ;[...this.connections.keys()].forEach((key) => this.forget(key))
  }
  async recheck(directory: string) {
    const c = this.get(directory)
    for (const category of c.categories) await this.send(c, category, "/ping", "GET", {}, true, 1000)
  }
  private get(directory: string) {
    const c = this.connections.get(directory)
    if (!c) throw new Failure("store_not_connected")
    if (!c.active || c.expires <= Date.now()) throw new Failure("authorization_expired")
    return c
  }
  private check(c: Connection, op: Operation, write: boolean) {
    const m = methods[op.method]
    if (
      !m ||
      (m.risk !== "READ") !== write ||
      !c.categories.includes(m.category) ||
      (c.sandbox && !m.sandbox) ||
      (write && !c.writable)
    )
      throw new Failure("method_not_permitted")
    const serialized = JSON.stringify(op.params)
    if (!serialized || serialized.length > 128000 || JSON.stringify(this.clean(c, op.params)) !== serialized)
      throw new Failure("unsafe_parameters")
    return parse(m.schema, op.params)
  }
  private clean(c: Connection, value: unknown): unknown {
    if (typeof value === "string") return c.token ? value.replaceAll(c.token, "[REDACTED]") : value
    if (Array.isArray(value)) return value.map((v) => this.clean(c, v))
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([k]) => !/token|secret|password|authorization|approvalKey/i.test(k))
          .map(([k, v]) => [k, this.clean(c, v)]),
      )
    return value
  }
  async read(directory: string, method: string, params: unknown, pages = 1) {
    const c = this.get(directory)
    if (!Number.isInteger(pages) || pages < 1 || pages > 5) throw new Failure("invalid_page_limit")
    const cursor = { params: this.check(c, { method, params }, false), complete: false }
    const m = methods[method]
    const data: unknown[] = []
    const seen = new Set<string>()
    for (const _ of Array.from({ length: pages })) {
      if (this.get(directory) !== c) throw new Failure("connection_changed")
      const result = await this.send(c, m.category, m.path, m.verb, cursor.params, true, m.interval)
      data.push(result)
      const next = nextPage(method, cursor.params, result)
      if (!next) {
        cursor.complete = true
        break
      }
      const hash = JSON.stringify(next)
      if (seen.has(hash) || hash === JSON.stringify(cursor.params)) throw new Failure("pagination_not_advancing")
      seen.add(hash)
      cursor.params = next
    }
    return {
      shop: c.shop,
      method,
      retrievedAt: new Date().toISOString(),
      untrustedData: true,
      pages: this.clean(c, data),
      complete: cursor.complete,
      next: cursor.complete ? null : cursor.params,
    }
  }
  prepare(directory: string, input: unknown) {
    const c = this.get(directory)
    const body = parse(planSchema, input)
    if (this.clean(c, body.summary) !== body.summary) throw new Failure("unsafe_parameters")
    const operations = body.operations.map((op) => ({ method: op.method, params: this.check(c, op, true) }))
    const previous = [...c.plans.values()].find((p) => p.key === body.key)
    if (previous) {
      if (JSON.stringify(previous.operations) !== JSON.stringify(operations) || previous.summary !== body.summary)
        throw new Failure("idempotency_conflict")
      return { planId: previous.id, status: previous.state }
    }
    if (c.plans.size >= 100) throw new Failure("plan_limit")
    const plan: Plan = {
      id: randomUUID(),
      key: body.key,
      summary: body.summary,
      operations,
      risk:
        operations.length > 1 ||
        operations.some(
          (o) => methods[o.method].risk === "HIGH-RISK" || (Array.isArray(o.params) && o.params.length > 1),
        )
          ? "HIGH-RISK"
          : "WRITE",
      state: "pending",
      expires: Date.now() + 600000,
      results: [],
    }
    c.plans.set(plan.id, plan)
    return {
      planId: plan.id,
      status: plan.state,
      risk: plan.risk,
      next: "Review exact changes in the project's Wildberries connection panel. All writes require approval in this MVP.",
    }
  }
  async approve(directory: string, id: string, approved: boolean, key: string) {
    const c = this.get(directory)
    if (!timingSafeEqual(Buffer.from(digest(key), "hex"), c.approval)) throw new Failure("browser_approval_required")
    const p = c.plans.get(id)
    if (!p || p.state !== "pending" || p.expires < Date.now()) throw new Failure("plan_not_pending")
    p.state = "rejected"
    await this.audit(directory, c, { operation: "approval", plan: id, approved, changes: p.operations })
    p.state = approved ? "approved" : "rejected"
  }
  async execute(directory: string, id: string, signal?: AbortSignal) {
    const c = this.get(directory)
    const p = c.plans.get(id)
    if (!p) throw new Failure("plan_not_found")
    if (["done", "failed"].includes(p.state)) return { status: p.state, results: p.results, replay: true }
    if (p.state !== "approved" || p.expires < Date.now()) throw new Failure("client_approval_required")
    p.state = "running"
    for (const op of p.operations) {
      const result = await (async () => {
        if (signal?.aborted) throw new Failure("operation_cancelled")
        if (this.get(directory) !== c) throw new Failure("connection_changed")
        const params = this.check(c, op, true)
        const m = methods[op.method]
        await mkdir(this.options.auditRoot, { recursive: true, mode: 0o700 })
        // Durable fail-closed intent, before any network write. Even a new plan/key
        // cannot blindly replay an identical mutation after a crash/reconnect.
        const claim = path.join(this.options.auditRoot, digest(directory + c.shop + JSON.stringify(op)) + ".intent")
        const file = await open(claim, "wx", 0o600).catch(() => {
          throw new Failure("mutation_already_attempted_reconcile_required")
        })
        await file.writeFile(
          JSON.stringify({ time: new Date().toISOString(), plan: id, keyHash: digest(p.key), operation: op.method }),
        )
        await file.sync()
        await file.close()
        await this.audit(directory, c, { operation: op.method, plan: id, changes: op.params, result: "started" })
        const response = await this.send(c, m.category, m.path, m.verb, params, false, m.interval, 0, signal)
        // An asynchronous acceptance must never be described as a verified change.
        await this.audit(directory, c, { operation: op.method, plan: id, result: "accepted_unverified" })
        return { ok: true, response, verification: "readback_required" }
      })().catch(async (e: unknown) => {
        const code = e instanceof Failure ? e.code : "write_result_unknown"
        await this.audit(directory, c, { operation: op.method, plan: id, result: code }).catch(() => undefined)
        return { ok: false, error: code }
      })
      p.results.push(result)
      if (!result.ok) {
        p.state = "failed"
        return { status: p.state, results: p.results, reconcileRequired: true }
      }
    }
    p.state = "done"
    return {
      status: "done",
      results: p.results,
      verified: false,
      next: "Read affected objects and compare before reporting success.",
    }
  }
  async verify(directory: string, id: string) {
    const c = this.get(directory)
    const plan = c.plans.get(id)
    if (!plan || !["done", "failed"].includes(plan.state)) throw new Failure("plan_not_executed")
    const results: { method: string; verified: boolean; reason: string }[] = []
    for (const op of plan.operations) {
      const verified = await (async () => {
        if (op.method === "update_cards" && Array.isArray(op.params)) {
          for (const expected of op.params) {
            const read = await this.read(directory, "cards", {
              settings: {
                cursor: { limit: 100 },
                filter: { withPhoto: -1, textSearch: String(object(expected).nmID) },
              },
            })
            const pages = read.pages as unknown[]
            const rows = pages.flatMap((p) => (Array.isArray(object(p).cards) ? (object(p).cards as unknown[]) : []))
            if (!rows.some((row) => matches(row, expected))) return false
          }
          return true
        }
        if (op.method === "update_prices") {
          for (const expected of object(op.params).data as unknown[]) {
            const row = object(expected)
            const read = await this.read(directory, "prices", { filterNmID: row.nmID, limit: 100, offset: 0 })
            const rows = (read.pages as unknown[]).flatMap((p) => object(object(p).data).listGoods as unknown[])
            const actual = rows.map(object).find((r) => r.nmID === row.nmID)
            if (
              !actual ||
              actual.discount !== row.discount ||
              !Array.isArray(actual.sizes) ||
              !actual.sizes.length ||
              !actual.sizes.every((s) => object(s).price === row.price)
            )
              return false
          }
          return true
        }
        if (op.method === "pause_campaign") {
          const read = await this.read(directory, "campaigns", {})
          return (read.pages as unknown[]).some((p) => {
            const adverts = object(p).adverts
            return (
              Array.isArray(adverts) &&
              adverts.some(
                (group) =>
                  object(group).status === 11 &&
                  Array.isArray(object(group).advert_list) &&
                  (object(group).advert_list as unknown[]).some(
                    (item) => object(item).advertId === object(op.params).id,
                  ),
              )
            )
          })
        }
        return false
      })().catch(() => false)
      const result = {
        method: op.method,
        verified,
        reason: verified ? "readback_matches" : "not_verified_check_remote_state",
      }
      await this.audit(directory, c, { operation: "verification", plan: id, ...result })
      results.push(result)
    }
    return { verified: results.every((r) => r.verified), results }
  }
  private async audit(directory: string, c: Connection, entry: object) {
    await mkdir(this.options.auditRoot, { recursive: true, mode: 0o700 })
    await appendFile(
      path.join(this.options.auditRoot, digest(directory) + ".jsonl"),
      JSON.stringify(this.clean(c, { time: new Date().toISOString(), shop: c.shop, ...entry })) + "\n",
      { mode: 0o600 },
    )
  }
  private async send(
    c: Connection,
    category: Category | "common",
    pathname: string,
    verb: string,
    params: unknown,
    read: boolean,
    interval: number,
    attempt = 0,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const slot = (c.shop || digest(c.token)) + (c.sandbox ? "sandbox" : category)
    const now = Date.now()
    const start = Math.max(now, this.slots.get(slot) ?? 0)
    this.slots.set(slot, start + (this.options.interval ?? Math.max(c.sandbox ? 1000 : 0, interval)))
    if (start > now) await new Promise((r) => setTimeout(r, start - now))
    if (!c.active || c.expires <= Date.now()) throw new Failure("authorization_expired")
    if (signal?.aborted) throw new Failure("operation_cancelled")
    const host = category === "common" ? "common-api" : hosts[category]
    const url = new URL(
      pathname,
      this.options.mockOrigin ??
        `https://${host}${c.sandbox && category !== "common" ? "-sandbox" : ""}.wildberries.ru`,
    )
    if (verb === "GET")
      Object.entries(object(params)).forEach(([key, value]) => url.searchParams.set(key, String(value)))
    const response = await fetch(url, {
      method: verb,
      headers: { Authorization: c.token, "content-type": "application/json" },
      body: verb === "GET" ? undefined : JSON.stringify(params),
      redirect: "error",
      signal: AbortSignal.any([c.controller.signal, AbortSignal.timeout(20000), ...(signal ? [signal] : [])]),
    }).catch(() => {
      throw new Failure(read ? "wb_unreachable" : "write_result_unknown")
    })
    if (response.status === 401) {
      c.active = false
      await response.body?.cancel()
      throw new Failure("authorization_expired")
    }
    if (response.status === 403) {
      await response.body?.cancel()
      throw new Failure("category_access_denied")
    }
    if (response.status === 429 || response.status >= 500) {
      const after = response.headers.get("Retry-After")
      const retryAfter =
        after && !Number.isFinite(Number(after))
          ? Math.max(0, Date.parse(after) - Date.now())
          : Number(after ?? 0) * 1000
      const retry = Math.max(
        Number(response.headers.get("X-Ratelimit-Retry") ?? response.headers.get("X-Ratelimit-Reset") ?? 0) * 1000 || 0,
        retryAfter || 0,
        1000 * 2 ** attempt,
      )
      this.slots.set(slot, Math.max(this.slots.get(slot) ?? 0, Date.now() + retry))
      await response.body?.cancel()
      if (read && attempt < 2 && retry <= 60000)
        return this.send(c, category, pathname, verb, params, read, interval, attempt + 1)
      throw new Failure(response.status === 429 ? "wb_rate_limited" : read ? "wb_unavailable" : "write_result_unknown")
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Failure("wb_api_error")
    }
    if (response.status === 204) return null
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    const size = { value: 0 }
    if (reader)
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size.value += chunk.value.byteLength
        if (size.value > 10000000) {
          await reader.cancel()
          throw new Failure("response_too_large")
        }
        chunks.push(chunk.value)
      }
    const text = Buffer.concat(chunks).toString()
    const data: unknown = text
      ? await Promise.resolve()
          .then(() => JSON.parse(text))
          .catch(() => {
            throw new Failure("invalid_wb_response")
          })
      : null
    if (object(data).error === true) throw new Failure("wb_api_error")
    return this.clean(c, data)
  }
}
function nextPage(method: string, params: unknown, result: unknown): unknown {
  const m = methods[method]
  const p = object(params)
  const r = object(result)
  if (!m.pagination || result === null) return null
  if (m.pagination === "cards") {
    const cursor = object(r.cursor)
    const settings = object(p.settings)
    if (Number(cursor.total) < Number(object(settings.cursor).limit)) return null
    if (typeof cursor.updatedAt !== "string" || typeof cursor.nmID !== "number") throw new Failure("invalid_pagination")
    return {
      ...p,
      settings: {
        ...settings,
        cursor: { limit: object(settings.cursor).limit, updatedAt: cursor.updatedAt, nmID: cursor.nmID },
      },
    }
  }
  const rows = Array.isArray(result)
    ? result
    : method === "prices"
      ? object(r.data).listGoods
      : method === "reviews"
        ? object(r.data).feedbacks
        : object(r.data).items
  if (!Array.isArray(rows)) throw new Failure("invalid_pagination")
  if (m.pagination === "finance") return rows.length ? { ...p, rrdId: object(rows.at(-1)).rrdId } : null
  if (m.pagination === "statistics") return rows.length ? { ...p, dateFrom: object(rows.at(-1)).lastChangeDate } : null
  if (rows.length < Number(p.limit ?? p.take)) return null
  return method === "reviews"
    ? { ...p, skip: Number(p.skip) + rows.length }
    : { ...p, offset: Number(p.offset) + rows.length }
}
function matches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return Array.isArray(actual) && expected.length === actual.length && expected.every((v, i) => matches(actual[i], v))
  if (expected && typeof expected === "object")
    return Object.entries(expected).every(([k, v]) => matches(object(actual)[k], v))
  return actual === expected
}
export class Service extends Context.Service<Service, Store>()("@gamma/Wildberries") {}
export const layer = Layer.effect(
  Service,
  Effect.acquireRelease(
    Effect.sync(
      () =>
        new Store({
          auditRoot: path.join(Global.Path.data, "wildberries-audit"),
          personal: process.env.GAMMA_WB_ON_PREMISE === "1",
        }),
    ),
    (store) => Effect.sync(() => store.close()),
  ),
)
export const node = makeGlobalNode({ service: Service, layer, deps: [] })
export * as Wildberries from "./store"
