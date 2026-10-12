import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Session } from "@/session/session"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const it = testEffect(
  Layer.mergeAll(
    AppNodeBuilder.build(LayerNode.group([Session.node, SessionProjector.node, InstanceStore.node]), [
      [InstanceStore.bootstrapNode, InstanceBootstrap.node],
    ]),
    httpApiLayer,
  ),
)

it.instance("product cleanup removes an empty session through HTTP and is idempotent", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const session = yield* sessions.create({})
    const response = yield* requestInDirectory(`/product/session/${session.id}/discard-empty`, session.directory, {
      method: "POST",
    })
    expect(response.status).toBe(200)
    expect(yield* response.json).toEqual({ removed: true })
    const missing = yield* requestInDirectory(`/session/${session.id}`, session.directory)
    expect(missing.status).toBe(404)
    const again = yield* requestInDirectory(`/product/session/${session.id}/discard-empty`, session.directory, {
      method: "POST",
    })
    expect(yield* again.json).toEqual({ removed: true })
  }),
)

it.instance("cleanup immediately after prompt_async preserves the first persisted user message", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const session = yield* sessions.create({})
    const admitted = yield* requestInDirectory(`/session/${session.id}/prompt_async`, session.directory, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        noReply: true,
        model: { providerID: "test", modelID: "test" },
        parts: [{ type: "text", text: "Привет" }],
      }),
    })
    expect(admitted.status).toBe(204)
    const response = yield* requestInDirectory(`/product/session/${session.id}/discard-empty`, session.directory, {
      method: "POST",
    })
    expect(response.status).toBe(200)
    expect(yield* response.json).toEqual({ removed: false })
    const messages = yield* sessions.messages({ sessionID: session.id })
    expect(messages.some((message) => message.info.role === "user")).toBe(true)
    yield* sessions.remove(session.id)
  }),
)
