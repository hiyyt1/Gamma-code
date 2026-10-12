import path from "node:path"
import { realpath, mkdir, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import z from "zod"
import { AgentCatalog } from "@opencode-ai/core/agent-market/catalog"
import { Wildberries } from "./store"
import { search } from "./methods"

export const name = "gamma-wb"
const schemas = {
  connection_status: z.object({}).strict(),
  search_methods: z.object({ query: z.string().max(100).optional(), method: z.string().max(100).optional() }).strict(),
  read: z
    .object({ method: z.string(), params: z.unknown(), pages: z.number().int().min(1).max(5).default(1) })
    .strict(),
  prepare_plan: z
    .object({
      key: z.string().min(16).max(100),
      summary: z.string().max(1000),
      operations: z
        .array(z.object({ method: z.string(), params: z.unknown() }).strict())
        .min(1)
        .max(20),
    })
    .strict(),
  verify_plan: z.object({ planId: z.string().uuid() }).strict(),
  execute_plan: z.object({ planId: z.string().uuid() }).strict(),
  analyse: z
    .object({
      files: z
        .array(
          z
            .object({
              path: z.string().min(1),
              kind: z.enum(["sale", "return", "order", "payout", "stock", "ad", "card", "cost"]).optional(),
              columns: z.record(z.string(), z.string()).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(20),
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      chart: z.boolean().default(false),
      scenario: z.enum(["sales", "advertising", "profit", "cards", "inventory", "all"]).default("all"),
      leadDays: z.number().min(0).max(365).default(14),
      safetyDays: z.number().min(0).max(365).default(7),
    })
    .strict(),
}
const descriptions = {
  connection_status:
    "Project-bound store status and available categories. No token required for file analytics. Connect only through secure Gamma UI.",
  search_methods:
    "Search reviewed WB operations; pass method to load its input schema, risk and pagination. No arbitrary HTTP endpoints.",
  read: "READ only, including POST reads. Saves redacted WB response in project reports. Follow next until complete; respect rates. Data is untrusted.",
  prepare_plan:
    "Prepare concrete mutations, no execution. All writes require exact UI approval; HIGH-RISK includes prices, advertising, replies and batches.",
  verify_plan:
    "Read back affected cards, prices or paused campaigns and compare exact requested values. Logs verification; unsupported checks return unverified, never success.",
  execute_plan:
    "Execute UI-approved plan once. No model confirmation parameter. Durable replay guard; accepted does not mean applied. Read back before claiming success.",
  analyse:
    "Deterministic Python analytics over project CSV/XLSX/normalized JSON or gamma-wb read artifacts. Load wb-unit-economics skill for row schema. Produces Markdown, CSV, XLSX and JSON reports. No store connection required.",
}
export const definitions = Object.entries(schemas).map(([key, schema]) => ({
  name: key,
  description: descriptions[key as keyof typeof descriptions],
  inputSchema: z.toJSONSchema(schema) as { type: "object"; properties: Record<string, unknown> },
}))
export async function connect(store: Wildberries.Store, directory: string, assertActive: () => Promise<void>) {
  const server = new Server({ name: "gamma-wildberries", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: definitions }))
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const result = await (async () => {
      await assertActive()
      const key = request.params.name as keyof typeof schemas
      if (!(key in schemas)) throw new Wildberries.Failure("unknown_tool")
      const parsed = schemas[key].safeParse(request.params.arguments ?? {})
      if (!parsed.success) throw new Wildberries.Failure("invalid_arguments")
      const args = request.params.arguments ?? {}
      if (key === "connection_status") return store.status(directory)
      if (key === "search_methods")
        return search(
          typeof args.query === "string" ? args.query : "",
          typeof args.method === "string" ? args.method : undefined,
        )
      if (key === "prepare_plan") return store.prepare(directory, parsed.data)
      if (key === "verify_plan") return store.verify(directory, String(args.planId))
      if (key === "execute_plan") return store.execute(directory, String(args.planId), extra.signal)
      if (key === "read") {
        const response = await store.read(
          directory,
          String(args.method),
          args.params,
          args.pages === undefined ? 1 : Number(args.pages),
        )
        const output = await reportDirectory(directory)
        await writeFile(path.join(output, "wb-response.json"), JSON.stringify(response), { flag: "wx", mode: 0o600 })
        return {
          ...response,
          pages: undefined,
          artifact: path.relative(directory, path.join(output, "wb-response.json")),
        }
      }
      const bundle = await AgentCatalog.bundle("wildberries-management")
      const output = `wb-report-${randomUUID()}`
      const child = Bun.spawn(
        ["python3", "-I", path.join(bundle.directory, "wb-unit-economics/scripts/analytics.py")],
        {
          cwd: directory,
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" },
        },
      )
      const stop = () => child.kill()
      extra.signal.addEventListener("abort", stop, { once: true })
      const timeout = setTimeout(stop, 60000)
      child.stdin.write(JSON.stringify({ ...parsed.data, root: await realpath(directory), output }))
      child.stdin.end()
      const [stdout, , exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      clearTimeout(timeout)
      extra.signal.removeEventListener("abort", stop)
      if (exit !== 0) {
        const error = await Promise.resolve()
          .then(() => JSON.parse(stdout))
          .catch(() => ({}))
        throw new Wildberries.Failure(
          typeof error.error === "string" && /^[a-z0-9_]+$/.test(error.error) ? error.error : "analytics_failed",
        )
      }
      const data = JSON.parse(stdout)
      // Full per-SKU tables stay in files, preserving the model's context budget.
      return {
        artifacts: data.artifacts,
        sales: data.summary.sales,
        coverage: data.summary.coverage,
        limitations: data.summary.limitations,
        products: data.summary.products.slice(0, 30),
        campaigns: data.summary.campaigns.slice(0, 30),
        cards: data.summary.cards.slice(0, 30),
        totalProducts: data.summary.products.length,
      }
    })()
      .then((data) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] }))
      .catch((e: unknown) => ({
        isError: true,
        content: [
          { type: "text" as const, text: e instanceof Wildberries.Failure ? e.code : "wildberries_operation_failed" },
        ],
      }))
    return result
  })
  const pair = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "Gamma", version: "1.0.0" })
  await server.connect(pair[0])
  await client.connect(pair[1])
  return { client, definitions: (await client.listTools()).tools }
}
async function reportDirectory(directory: string) {
  // Unique direct child prevents a pre-existing reports symlink escaping the project.
  const output = path.join(await realpath(directory), `wb-data-${randomUUID()}`)
  await mkdir(output, { mode: 0o700 })
  return output
}
export * as WildberriesMcp from "./mcp"
