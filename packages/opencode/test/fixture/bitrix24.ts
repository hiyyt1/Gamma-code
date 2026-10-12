import path from "node:path"
import { createServer } from "node:http"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { Bitrix24 } from "../../src/bitrix24/portal"

export async function bitrixFixture(options?: { lifetime?: number }) {
  const root = await mkdtemp(path.join(tmpdir(), "gamma-b24-test-"))
  const a = path.join(root, "a")
  const b = path.join(root, "b")
  await Promise.all([mkdir(a), mkdir(b)])
  const secret = "fixture_secret_never_log_123456"
  const approvalKey = crypto.randomUUID() + crypto.randomUUID()
  const calls: { method: string; params: Record<string, unknown> }[] = []
  const state = { fail: "", failStatus: 401, rate: 0, deals: [] as object[], task: { id: 8, title: "Before" } }
  const replies: ({ tool: string; args: object } | { text: string })[] = []
  const inputs: object[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const params = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>
    if (req.url === "/v1/chat/completions") {
      inputs.push(params)
      const reply = replies.shift() ?? { text: "ok" }
      res.setHeader("content-type", "text/event-stream")
      const delta =
        "tool" in reply
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: crypto.randomUUID(),
                  type: "function",
                  function: { name: reply.tool, arguments: JSON.stringify(reply.args) },
                },
              ],
            }
          : { role: "assistant", content: reply.text }
      res.end(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool" in reply ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\ndata: [DONE]\n\n`,
      )
      return
    }
    const method = req
      .url!.split("/")
      .at(-1)!
      .replace(/\.json$/, "")
    calls.push({ method, params })
    res.setHeader("content-type", "application/json")
    if (method === state.fail) {
      res.statusCode = state.failStatus
      res.end(
        JSON.stringify({
          error: state.failStatus === 401 ? "expired_token" : "INTERNAL_SERVER_ERROR",
          error_description: secret,
        }),
      )
      return
    }
    if (method === "crm.deal.list" && state.rate++ === 0) {
      res.statusCode = 429
      res.end(JSON.stringify({ error: "QUERY_LIMIT_EXCEEDED" }))
      return
    }
    const result = (() => {
      if (method === "scope") return ["crm", "task", "user"]
      if (method === "methods") return Object.keys(Bitrix24.methods)
      if (method === "user.current") return { ID: "1" }
      if (method === "crm.deal.add") {
        state.deals.push(params)
        return state.deals.length
      }
      if (method === "tasks.task.update") {
        state.task.title = String((params.fields as { TITLE: string }).TITLE)
        return { task: state.task }
      }
      if (method === "tasks.task.get") return { task: state.task }
      if (method === "crm.deal.get")
        return { ID: "1", ...state.deals[0], token: secret, description: `untrusted ${secret}` }
      if (method === "crm.deal.list") return [{ ID: params.start ? "2" : "1" }]
      return true
    })()
    res.end(JSON.stringify({ result, ...(method === "crm.deal.list" && !params.start ? { next: 50 } : {}) }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No mock address")
  const origin = `http://127.0.0.1:${address.port}`
  const portal = new Bitrix24.Portal({
    auditRoot: path.join(root, "audit"),
    mockOrigin: origin,
    interval: 1,
    lifetime: options?.lifetime,
  })
  const input = { webhook: `${origin}/rest/1/${secret}/`, scopes: ["crm", "task"], approvalKey }
  return {
    root,
    a,
    b,
    portal,
    input,
    calls,
    state,
    secret,
    approvalKey,
    llm: { url: `${origin}/v1`, replies, inputs },
    async [Symbol.asyncDispose]() {
      portal.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    },
  }
}
