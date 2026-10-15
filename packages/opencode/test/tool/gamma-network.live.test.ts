import { expect, test } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Truncate } from "../../src/tool/truncate"
import { WebFetchTool } from "../../src/tool/webfetch"
import { WebSearchTool } from "../../src/tool/websearch"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

// Explicit opt-in: external availability must not make the normal suite flaky.
if (process.env.GAMMA_NETWORK_SMOKE !== "1") test.skip("Gamma native public web smoke (opt-in)", () => {})
else {
  if (process.env.EXA_API_KEY || process.env.PARALLEL_API_KEY)
    throw new Error("Keyless smoke test requires EXA_API_KEY and PARALLEL_API_KEY to be unset")
  const it = testEffect(LayerNode.compile(LayerNode.group([httpClient, Truncate.node, Agent.node, RuntimeFlags.node])))
  it.instance(
    "Gamma native public fetch and keyless search return sources",
    () =>
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const gamma = yield* agents.get("gamma")
        expect(gamma).toBeDefined()
        const ctx = {
          sessionID: SessionID.make("ses_gamma_network_smoke"),
          messageID: MessageID.make("msg_gamma_network_smoke"),
          callID: "network-smoke",
          agent: "gamma",
          abort: AbortSignal.timeout(60_000),
          messages: [],
          metadata: () => Effect.void,
          ask: (request: { permission: string; patterns: readonly string[] }) =>
            Effect.sync(() => {
              for (const pattern of request.patterns)
                expect(Permission.evaluate(request.permission, pattern, gamma!.permission).action).toBe("allow")
            }),
        }
        const fetchDefinition = yield* WebFetchTool
        const fetch = yield* fetchDefinition.init()
        const fetched = yield* fetch.execute({ url: "https://example.com", format: "text", timeout: 20 }, ctx)
        expect(fetched.output).toContain("Example Domain")
        const searchDefinition = yield* WebSearchTool
        const search = yield* searchDefinition.init()
        const result = yield* search.execute(
          { query: `Moscow weather ${new Date().toISOString().slice(0, 10)}`, numResults: 3 },
          ctx,
        )
        expect(result.metadata.provider).toBe(
          process.env.OPENCODE_WEBSEARCH_PROVIDER === "parallel" ? "parallel" : "exa",
        )
        expect(result.output).not.toMatch(/rate limit|API key|quota exceeded/i)
        expect(result.output).toMatch(/https?:\/\//)
        expect(result.output.toLowerCase()).toMatch(/moscow|москв/)
      }),
    { config: { permission: { "*": "allow", external_directory: "deny" } } },
    65_000,
  )
}
