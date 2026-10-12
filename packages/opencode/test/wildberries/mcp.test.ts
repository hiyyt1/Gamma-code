import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir, readFile, readdir } from "node:fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Wildberries } from "../../src/wildberries/store"
import { WildberriesMcp } from "../../src/wildberries/mcp"

const token = (readOnly = false) =>
  `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, t: true, acc: 2, sid: "fixture-seller", s: 8430 + (readOnly ? 2 ** 30 : 0) })).toString("base64url")}.test-secret`
const approvalKey = "browser-only-key-012345678901234567890"

test("MCP initialization, schemas, pagination, UI approvals, verification, reconnect dedup and isolation", async () => {
  await using tmp = await tmpdir()
  const a = path.join(tmp.path, "a")
  const b = path.join(tmp.path, "b")
  await mkdir(a)
  await mkdir(b)
  const state = { writes: 0, price: 100, invalid: false, requests: [] as string[] }
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url)
      state.requests.push(url.pathname)
      if (state.invalid) return new Response("invalid", { status: 401 })
      if (url.pathname === "/ping") return Response.json({ Status: "OK" })
      if (url.pathname.endsWith("seller-info")) return Response.json({ sid: "fixture-seller" })
      if (url.pathname.endsWith("upload/task")) {
        state.writes++
        state.price = (await req.json()).data[0].price
        return Response.json({ data: { id: 42 } })
      }
      if (url.pathname.endsWith("goods/filter"))
        return Response.json({
          data: {
            listGoods:
              url.searchParams.get("offset") === "1" ? [] : [{ nmID: 1, discount: 0, sizes: [{ price: state.price }] }],
          },
        })
      return Response.json({ error: true }, { status: 400 })
    },
  })
  const store = new Wildberries.Store({
    auditRoot: path.join(tmp.path, "audit"),
    mockOrigin: server.url.origin,
    interval: 0,
  })
  const local = await WildberriesMcp.connect(store, a, async () => {})
  try {
    expect(local.definitions).toHaveLength(7)
    expect(JSON.stringify(await local.client.callTool({ name: "connection_status", arguments: {} }))).toContain(
      "disconnected",
    )
    expect(
      JSON.stringify(await local.client.callTool({ name: "search_methods", arguments: { method: "pause_campaign" } })),
    ).toContain("HIGH-RISK")
    await expect(store.read(a, "prices", {})).rejects.toThrow("store_not_connected")
    const input = { token: token(), mode: "sandbox", categories: ["prices"], allowWrites: true, approvalKey }
    await store.connect(a, input)
    expect(store.status(b).status).toBe("disconnected")
    await expect(store.read(b, "prices", {})).rejects.toThrow("store_not_connected")
    await expect(store.read(a, "pause_campaign", { id: 1 })).rejects.toThrow("method_not_permitted")
    await expect(store.read(a, "prices", { url: "https://evil.example" })).rejects.toThrow("invalid_arguments")
    const read = await store.read(a, "prices", { limit: 1, offset: 0 }, 2)
    expect(read.complete).toBe(true)
    const prepared = store.prepare(a, {
      key: "idempotency-test-0001",
      summary: "Price 120",
      operations: [{ method: "update_prices", params: { data: [{ nmID: 1, price: 120, discount: 0 }] } }],
    })
    expect(
      JSON.stringify(
        await local.client.callTool({ name: "execute_plan", arguments: { planId: prepared.planId, confirm: true } }),
      ),
    ).toContain("invalid_arguments")
    await expect(store.execute(a, prepared.planId)).rejects.toThrow("client_approval_required")
    await expect(store.approve(a, prepared.planId, true, "model-key")).rejects.toThrow("browser_approval_required")
    await store.approve(a, prepared.planId, true, approvalKey)
    expect((await store.execute(a, prepared.planId)).status).toBe("done")
    expect((await store.verify(a, prepared.planId)).verified).toBe(true)
    await store.execute(a, prepared.planId)
    expect(state.writes).toBe(1)
    await store.disconnect(a)
    await store.connect(a, input)
    const repeated = store.prepare(a, {
      key: "another-key-after-reconnect",
      summary: "Retry",
      operations: [{ method: "update_prices", params: { data: [{ nmID: 1, price: 120, discount: 0 }] } }],
    })
    await store.approve(a, repeated.planId, true, approvalKey)
    expect(JSON.stringify(await store.execute(a, repeated.planId))).toContain("mutation_already_attempted")
    expect(state.writes).toBe(1)
    const audit = (
      await Promise.all(
        (await readdir(path.join(tmp.path, "audit"))).map((f) => readFile(path.join(tmp.path, "audit", f), "utf8")),
      )
    ).join("")
    expect(audit).toContain("readback_matches")
    expect(audit).not.toContain(input.token)
    expect(audit).not.toContain(approvalKey)
    state.invalid = true
    await expect(store.recheck(a)).rejects.toThrow("authorization_expired")
    expect(store.status(a).status).toBe("expired")
  } finally {
    await local.client.close()
    store.close()
    await server.stop(true)
  }
})

test("offline MCP analytics produces files, rejects outside paths and invalid tokens", async () => {
  await using tmp = await tmpdir()
  const store = new Wildberries.Store({ auditRoot: path.join(tmp.path, "audit") })
  const local = await WildberriesMcp.connect(store, tmp.path, async () => {})
  try {
    await Bun.write(path.join(tmp.path, "sales.csv"), "nmID,date,quantity,revenue\n1,2026-09-15,10,1000\n")
    await Bun.write(path.join(tmp.path, "cost.csv"), "nmID,cost\n1,50\n")
    const call = await local.client.callTool({
      name: "analyse",
      arguments: {
        files: [
          { path: "sales.csv", kind: "sale" },
          { path: "cost.csv", kind: "cost" },
        ],
        start: "2026-09-01",
        end: "2026-09-30",
        scenario: "profit",
      },
    })
    expect(call.isError).not.toBe(true)
    expect(JSON.stringify(call)).toContain("profit_known_costs")
    const output = JSON.parse((call.content as { text: string }[])[0].text)
    expect(output.products[0].profit_known_costs).toBe(500)
    for (const artifact of output.artifacts) expect(await Bun.file(path.join(tmp.path, artifact)).exists()).toBe(true)
    expect(
      JSON.stringify(
        await local.client.callTool({
          name: "analyse",
          arguments: { files: [{ path: "/etc/passwd" }], start: "2026-09-01", end: "2026-09-30" },
        }),
      ),
    ).toContain("invalid_input_file")
    await expect(
      store.connect(tmp.path, {
        token: "not-a-jwt-token-1234567890",
        mode: "sandbox",
        categories: ["prices"],
        approvalKey,
      }),
    ).rejects.toThrow("invalid_token")
    await expect(
      store.connect(tmp.path, { token: token(), mode: "personal", categories: ["prices"], approvalKey }),
    ).rejects.toThrow("personal_requires_on_premise")
  } finally {
    await local.client.close()
    store.close()
  }
})

test("READ backoff honors retry headers, read-only rights and cancelled writes fail closed", async () => {
  await using tmp = await tmpdir()
  const state = { reads: 0, writes: 0, rateTime: 0, retryTime: 0 }
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === "/ping") return Response.json({ Status: "OK" })
      if (url.pathname.endsWith("seller-info")) return Response.json({ sid: "test-seller" })
      if (url.pathname.endsWith("goods/filter")) {
        state.reads++
        if (state.reads === 1) {
          state.rateTime = Date.now()
          return new Response("limited", { status: 429, headers: { "X-Ratelimit-Retry": "1" } })
        }
        state.retryTime = Date.now()
        return Response.json({ data: { listGoods: [] } })
      }
      state.writes++
      return new Response("unknown", { status: 500 })
    },
  })
  const store = new Wildberries.Store({
    auditRoot: path.join(tmp.path, "audit"),
    mockOrigin: server.url.origin,
    interval: 0,
  })
  try {
    await store.connect(tmp.path, {
      token: token(true),
      mode: "sandbox",
      categories: ["prices"],
      allowWrites: true,
      approvalKey,
    })
    expect(store.status(tmp.path).writable).toBe(false)
    expect(() =>
      store.prepare(tmp.path, {
        key: "read-only-plan-0001",
        summary: "Forbidden",
        operations: [{ method: "update_prices", params: { data: [{ nmID: 1, price: 123, discount: 0 }] } }],
      }),
    ).toThrow("method_not_permitted")
    expect((await store.read(tmp.path, "prices", {})).complete).toBe(true)
    expect(state.reads).toBe(2)
    expect(state.retryTime - state.rateTime).toBeGreaterThanOrEqual(990)
    await store.connect(tmp.path, {
      token: token(),
      mode: "sandbox",
      categories: ["prices"],
      allowWrites: true,
      approvalKey,
    })
    const plan = store.prepare(tmp.path, {
      key: "cancelled-plan-0001",
      summary: "Cancelled",
      operations: [{ method: "update_prices", params: { data: [{ nmID: 1, price: 123, discount: 0 }] } }],
    })
    await store.approve(tmp.path, plan.planId, true, approvalKey)
    const abort = new AbortController()
    abort.abort()
    expect(JSON.stringify(await store.execute(tmp.path, plan.planId, abort.signal))).toContain("operation_cancelled")
    expect(state.writes).toBe(0)
    const failed = store.prepare(tmp.path, {
      key: "failed-plan-0000001",
      summary: "Fail",
      operations: [{ method: "update_prices", params: { data: [{ nmID: 1, price: 124, discount: 0 }] } }],
    })
    await store.approve(tmp.path, failed.planId, true, approvalKey)
    expect(JSON.stringify(await store.execute(tmp.path, failed.planId))).toContain("write_result_unknown")
    await store.execute(tmp.path, failed.planId)
    expect(state.writes).toBe(1)
  } finally {
    store.close()
    await server.stop(true)
  }
})
