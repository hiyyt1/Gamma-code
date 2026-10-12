import { expect, test } from "bun:test"
import path from "node:path"
import { readdir, readFile } from "node:fs/promises"
import { Bitrix24 } from "../../src/bitrix24/portal"
import { BitrixMcp } from "../../src/bitrix24/mcp"
import { bitrixFixture } from "../fixture/bitrix24"

test("real local MCP handshake, missing credentials, scoped read, approved create/update and verified readback", async () => {
  await using f = await bitrixFixture()
  const active = { value: true }
  const local = await BitrixMcp.connect(f.portal, f.a, async () => {
    if (!active.value) throw new Bitrix24.Failure("profile_changed")
  })
  try {
    expect(local.definitions.map((t) => t.name)).toEqual(BitrixMcp.definitions.map((t) => t.name))
    expect(JSON.stringify(await local.client.callTool({ name: "connection_status", arguments: {} }))).toContain(
      "disconnected",
    )
    expect(
      JSON.stringify(
        await local.client.callTool({ name: "rest_read", arguments: { method: "crm.deal.get", params: { id: 1 } } }),
      ),
    ).toContain("portal_not_connected")
    await f.portal.connect(f.a, f.input)
    expect(f.portal.status(f.a).methods).toContain("crm.deal.add")
    const plan = f.portal.prepare(f.a, {
      key: "unique-business-request",
      summary: "Create deal and rename task",
      operations: [
        { method: "crm.deal.add", params: { fields: { TITLE: "Gamma fixture" } } },
        { method: "tasks.task.update", params: { taskId: 8, fields: { TITLE: "After" } } },
      ],
    })
    expect(
      JSON.stringify(await local.client.callTool({ name: "execute_plan", arguments: { planId: plan.planId } })),
    ).toContain("client_approval_required")
    expect(f.state.deals).toHaveLength(0)
    await expect(f.portal.approve(f.a, plan.planId, true, "model-cannot-confirm")).rejects.toThrow(
      "browser_approval_required",
    )
    await f.portal.approve(f.a, plan.planId, true, f.approvalKey)
    const result = await local.client.callTool({ name: "execute_plan", arguments: { planId: plan.planId } })
    expect(JSON.stringify(result)).toContain("done")
    expect(f.state.deals).toHaveLength(1)
    expect(f.state.task.title).toBe("After")
    await local.client.callTool({ name: "execute_plan", arguments: { planId: plan.planId } })
    expect(f.state.deals).toHaveLength(1)
    const read = JSON.stringify(
      await local.client.callTool({ name: "rest_read", arguments: { method: "crm.deal.get", params: { id: 1 } } }),
    )
    expect(read).toContain("Gamma fixture")
    expect(read).toContain("untrustedPortalData")
    expect(read).not.toContain(f.secret)
    expect(JSON.stringify(await f.portal.read(f.a, "tasks.task.get", { taskId: 8 }))).toContain("After")
    active.value = false
    expect(JSON.stringify(await local.client.callTool({ name: "connection_status", arguments: {} }))).toContain(
      "profile_changed",
    )
    const audit = (
      await Promise.all(
        (await readdir(path.join(f.root, "audit"))).map((name) => readFile(path.join(f.root, "audit", name), "utf8")),
      )
    ).join("")
    expect(audit).toContain('"outcome":"succeeded"')
    expect(audit).not.toContain(f.secret)
    expect(audit).not.toContain(f.approvalKey)
    expect(audit).not.toContain("Gamma fixture")
  } finally {
    await local.client.close()
  }
})

test("REST pagination, bounded rate-limit retry, exact scopes, write classification and auth expiry", async () => {
  await using f = await bitrixFixture()
  await f.portal.connect(f.a, f.input)
  const read = await f.portal.read(f.a, "crm.deal.list", {}, 2)
  expect(read.pages).toHaveLength(2)
  expect(f.calls.filter((x) => x.method === "crm.deal.list")).toHaveLength(3)
  await expect(f.portal.read(f.a, "user.get", {})).rejects.toThrow("method_not_permitted")
  await expect(f.portal.read(f.a, "crm.deal.delete", {})).rejects.toThrow("method_not_permitted")
  await expect(f.portal.read(f.a, "crm.deal.get", { auth: "secret" })).rejects.toThrow("unsafe_parameters")
  await expect(f.portal.read(f.a, "crm.deal.list", {}, 11)).rejects.toThrow("invalid_page_limit")
  f.state.fail = "crm.deal.get"
  await expect(f.portal.read(f.a, "crm.deal.get", { id: 1 })).rejects.toThrow("authorization_expired")
  expect(f.portal.status(f.a).status).toBe("expired")
  await expect(f.portal.read(f.a, "tasks.task.get", {})).rejects.toThrow("authorization_expired")
})

test("project isolation, idempotency, rejected plans, disconnect and safe endpoint validation", async () => {
  await using f = await bitrixFixture()
  await f.portal.connect(f.a, f.input)
  const input = {
    key: "idempotency-key-123",
    summary: "One change",
    operations: [{ method: "crm.deal.add", params: { fields: { TITLE: "A" } } }],
  }
  const plan = f.portal.prepare(f.a, input)
  expect(f.portal.prepare(f.a, input).planId).toBe(plan.planId)
  expect(() => f.portal.prepare(f.a, { ...input, summary: "Different" })).toThrow("idempotency_conflict")
  await expect(f.portal.execute(f.b, plan.planId)).rejects.toThrow("portal_not_connected")
  await f.portal.connect(f.b, { ...f.input, approvalKey: crypto.randomUUID() })
  await expect(f.portal.execute(f.b, plan.planId)).rejects.toThrow("plan_not_found")
  await expect(f.portal.approve(f.b, plan.planId, true, f.approvalKey)).rejects.toThrow("browser_approval_required")
  await f.portal.approve(f.a, plan.planId, false, f.approvalKey)
  await expect(f.portal.execute(f.a, plan.planId)).rejects.toThrow("client_approval_required")
  await f.portal.disconnect(f.a)
  await expect(f.portal.execute(f.a, plan.planId)).rejects.toThrow("portal_not_connected")
  const safe = new Bitrix24.Portal({ auditRoot: path.join(f.root, "other-audit") })
  await expect(safe.connect(f.a, f.input)).rejects.toThrow("portal_origin_not_allowed")
  await expect(safe.connect(f.a, { ...f.input, webhook: "https://evil.example/rest/1/secret/" })).rejects.toThrow(
    "portal_origin_not_allowed",
  )
  await expect(
    safe.connect(f.a, { ...f.input, webhook: "https://example.bitrix24.ru/rest/1/secret/?redirect=1" }),
  ).rejects.toThrow("invalid_webhook")
  expect(f.state.deals).toHaveLength(0)
})

test("failed writes stop the plan and are never replayed automatically", async () => {
  await using f = await bitrixFixture()
  await f.portal.connect(f.a, f.input)
  f.state.fail = "crm.deal.add"
  f.state.failStatus = 500
  const plan = f.portal.prepare(f.a, {
    key: "no-retry-business-request",
    summary: "Two changes",
    operations: [
      { method: "crm.deal.add", params: {} },
      { method: "tasks.task.update", params: {} },
    ],
  })
  await f.portal.approve(f.a, plan.planId, true, f.approvalKey)
  expect((await f.portal.execute(f.a, plan.planId)).status).toBe("failed")
  expect((await f.portal.execute(f.a, plan.planId)).status).toBe("failed")
  expect(f.calls.filter((x) => x.method === "crm.deal.add")).toHaveLength(1)
  expect(f.calls.filter((x) => x.method === "tasks.task.update")).toHaveLength(0)
})

test("cancellation before execution performs no writes; documentation cannot exfiltrate the stored credential", async () => {
  await using f = await bitrixFixture()
  await f.portal.connect(f.a, f.input)
  expect(f.portal.documentationSafe(f.a, { query: f.secret })).toBe(false)
  expect(f.portal.documentationSafe(f.a, { query: "OAuth access_token documentation" })).toBe(true)
  expect(() =>
    f.portal.prepare(f.a, {
      key: "secret-in-business-request",
      summary: "Unsafe",
      operations: [{ method: "crm.deal.add", params: { fields: { TITLE: f.secret } } }],
    }),
  ).toThrow("unsafe_parameters")
  const plan = f.portal.prepare(f.a, {
    key: "cancel-business-request",
    summary: "One change",
    operations: [{ method: "crm.deal.add", params: {} }],
  })
  await f.portal.approve(f.a, plan.planId, true, f.approvalKey)
  const cancelled = new AbortController()
  cancelled.abort()
  expect((await f.portal.execute(f.a, plan.planId, cancelled.signal)).status).toBe("failed")
  expect(f.calls.filter((x) => x.method === "crm.deal.add")).toHaveLength(0)
  const queued = f.portal.read(f.a, "crm.deal.get", { id: 1 })
  f.portal.close()
  await expect(queued).rejects.toThrow("authorization_expired")
  expect(f.calls.filter((x) => x.method === "crm.deal.get")).toHaveLength(0)
})

test("connection lifetime actively removes the vault entry without a subsequent tool call", async () => {
  await using f = await bitrixFixture({ lifetime: 500 })
  await f.portal.connect(f.a, f.input)
  expect(f.portal.status(f.a).status).toBe("connected")
  await new Promise((resolve) => setTimeout(resolve, 550))
  expect(f.portal.status(f.a).status).toBe("disconnected")
  await expect(f.portal.read(f.a, "crm.deal.get", { id: 1 })).rejects.toThrow("portal_not_connected")
})
