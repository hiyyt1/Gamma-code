import { expect } from "bun:test"
import { Effect, Fiber } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderWait } from "@opencode-ai/core/session/provider-wait"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { testEffect } from "../lib/effect"
import { TestLLMServer, reply, raw } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"
import { provideTmpdirServer } from "../fixture/fixture"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Session.node,
      SessionPrompt.node,
      SessionStatus.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
  ),
)
const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") }
const unavailable = {
  type: "http-error" as const,
  status: 503,
  body: { error: { message: "Upstream maintenance" } },
  headers: { "retry-after-ms": "0" },
}

for (const scenario of [
  "stream",
  "retry-success",
  "retry-exhausted",
  "budget-backoff",
  "headers",
  "manual-abort",
  "reasoning",
  "network-retry",
] as const) {
  it.live(
    `provider availability: ${scenario}`,
    () =>
      provideTmpdirServer(
        ({ llm }) =>
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const prompts = yield* SessionPrompt.Service
            const status = yield* SessionStatus.Service
            const events = yield* EventV2Bridge.Service
            const observed: string[] = []
            const off = yield* events.listen((event) =>
              Effect.sync(() => {
                observed.push(event.type)
              }),
            )
            yield* Effect.addFinalizer(() => off)
            const session = yield* sessions.create({ title: "Provider diagnostic", agent: "gamma" })
            const input = { sessionID: session.id, model, parts: [{ type: "text" as const, text: "Hello" }] }
            const release = Promise.withResolvers<void>()
            yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
            if (scenario === "stream") yield* llm.text("Hello back")
            if (scenario === "retry-success") yield* llm.push(unavailable, reply().text("Recovered").stop())
            if (scenario === "retry-exhausted") yield* llm.push(...Array.from({ length: 7 }, () => unavailable))
            if (scenario === "budget-backoff")
              yield* llm.push({ ...unavailable, headers: { "retry-after-ms": "60000" } })
            if (scenario === "headers") yield* llm.push({ ...unavailable, wait: release.promise })
            if (scenario === "manual-abort") yield* llm.hang
            if (scenario === "network-retry")
              yield* llm.push(raw({ reset: true }), reply().text("Network recovered").stop())
            if (scenario === "reasoning")
              yield* llm.push(
                raw({
                  head: [{ id: "reason", choices: [{ delta: { reasoning_content: "Considering the answer" } }] }],
                  wait: release.promise,
                  tail: [
                    { id: "reason", choices: [{ delta: { content: "Done" } }] },
                    { id: "reason", choices: [{ delta: {}, finish_reason: "stop" }] },
                  ],
                }),
              )
            const fiber = yield* prompts.prompt(input).pipe(Effect.forkChild)
            yield* llm.wait(1)
            if (scenario === "manual-abort") yield* prompts.cancel(session.id)
            if (scenario === "reasoning") {
              // Deliberately exceed the first-output budget while reasoning has already arrived.
              yield* Effect.sleep("1200 millis")
              yield* Effect.sync(() => release.resolve())
            }
            const result = yield* Fiber.join(fiber)
            if (result.info.role !== "assistant") throw new Error("Expected an assistant response")
            const apiError = result.info.error?.name === "APIError" ? result.info.error.data : undefined
            expect((yield* status.get(session.id)).type).toBe("idle")
            expect(observed).toContain("session.status")
            expect(observed).toContain("session.idle")
            if (
              scenario === "stream" ||
              scenario === "retry-success" ||
              scenario === "reasoning" ||
              scenario === "network-retry"
            ) {
              expect(result.info.error).toBeUndefined()
              expect(result.parts.some((part) => part.type === "text" && part.text.length > 0)).toBe(true)
            }
            if (scenario === "manual-abort") expect(result.info.error?.name).toBe("MessageAbortedError")
            if (scenario === "headers" || scenario === "budget-backoff") {
              expect(result.info.error?.name).toBe("APIError")
              expect(apiError?.message).toContain("including retries")
            }
            if (scenario === "budget-backoff") expect(apiError?.message).toContain("Upstream maintenance")
            if (scenario === "retry-exhausted") {
              expect(result.info.error?.name).toBe("APIError")
              expect(apiError?.message).toContain("Upstream maintenance")
              expect(yield* llm.calls).toBeGreaterThan(1)
            }
            if (scenario === "retry-success") expect(yield* llm.calls).toBe(2)
            if (scenario === "network-retry") expect(yield* llm.calls).toBe(2)
            if (scenario === "reasoning") expect(result.parts.some((part) => part.type === "reasoning")).toBe(true)
            if (result.info.error) {
              expect(observed).toContain("session.error")
              yield* llm.reset
              yield* llm.text("A new message works")
              const next = yield* prompts.prompt(input)
              if (next.info.role !== "assistant") throw new Error("Expected an assistant response after retry")
              expect(next.info.error).toBeUndefined()
              expect(next.parts.some((part) => part.type === "text" && part.text === "A new message works")).toBe(true)
              expect((yield* status.get(session.id)).type).toBe("idle")
            }
          }).pipe(
            Effect.provideService(ProviderWait.Policy, {
              normal: scenario === "network-retry" ? 5000 : 700,
              reasoning: 700,
            }),
          ),
        { config: testProviderConfig },
      ),
    15000,
  )
}
