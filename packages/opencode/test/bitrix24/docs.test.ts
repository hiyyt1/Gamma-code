import { expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AgentMarketService } from "@opencode-ai/core/agent-market"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { MCP } from "../../src/mcp"
import { McpCatalog } from "../../src/mcp/catalog"
import { BitrixMcp } from "../../src/bitrix24/mcp"
import { testEffect } from "../lib/effect"
import { provideTmpdirInstance } from "../fixture/fixture"

const it = testEffect(LayerNode.compile(LayerNode.group([MCP.node, AgentMarketService.node, CrossSpawnSpawner.node])))
;(process.env.GAMMA_BITRIX24_LIVE_DOCS === "1" ? it.live : it.live.skip)(
  "official docs MCP through native runtime: five tools, details, secret guard and profile isolation",
  () =>
    provideTmpdirInstance(
      Effect.fnUntraced(function* (directory) {
        const market = yield* AgentMarketService.Service
        const mcp = yield* MCP.Service
        const apply = (agentId: string, expectedVersion: number) =>
          market.apply(
            directory,
            { agentId, expectedVersion, confirmed: true, connectSkills: true, requestId: crypto.randomUUID() },
            Effect.succeed("live-docs"),
            () => Effect.succeed(true),
          )
        yield* apply("bitrix24-developer", 0)
        expect((yield* mcp.status())[BitrixMcp.docsName]).toEqual({ status: "connected" })
        const tools = yield* mcp.tools()
        expect(Object.keys(tools).filter((name) => name.startsWith("gamma-b24"))).toHaveLength(9)
        const entry = tools["gamma-b24-docs_bitrix-method-details"]
        const tool = McpCatalog.convertTool(entry.def, entry.client, entry.timeout)
        const call = (args: object) =>
          tool.execute!(args, { toolCallId: "docs-probe", messages: [], abortSignal: new AbortController().signal })
        expect(
          JSON.stringify(
            yield* Effect.promise(() => Promise.resolve(call({ method: "crm.item.add", field: "params" }))),
          ),
        ).toContain("entityTypeId")
        yield* Effect.promise(async () => {
          await expect(
            Promise.resolve(call({ method: "https://example.bitrix24.com/rest/1/fixture-secret/" })),
          ).rejects.toThrow("secrets_not_allowed_in_docs")
        })
        yield* apply("website-builder", 1)
        expect(Object.keys(yield* mcp.tools()).some((name) => name.startsWith("gamma-b24"))).toBe(false)
      }),
    ),
  60000,
)
