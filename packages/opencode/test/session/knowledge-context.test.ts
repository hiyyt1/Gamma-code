import { expect } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { KnowledgeStore } from "../../src/server/knowledge-store"
import { ProductProjects } from "../../src/server/product-projects"
import { testEffect } from "../lib/effect"
import { provideTmpdirServer, provideInstanceEffect, testInstanceStoreLayer } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionPrompt.node,
      Session.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
  ),
)
const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") }

it.live(
  "existing OpenCode session refreshes connected context and executes ordinary file tools",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir, llm }) {
        const previous = [process.env.GAMMA_KNOWLEDGE_ROOT, process.env.GAMMA_WORKSPACES_ROOT]
        process.env.GAMMA_KNOWLEDGE_ROOT = path.join(dir, "knowledge")
        process.env.GAMMA_WORKSPACES_ROOT = path.join(dir, "projects")
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            ;["GAMMA_KNOWLEDGE_ROOT", "GAMMA_WORKSPACES_ROOT"].forEach((key, index) => {
              if (previous[index] === undefined) delete process.env[key]
              else process.env[key] = previous[index]
            })
          }),
        )
        const project = yield* Effect.promise(() => ProductProjects.create("context-test"))
        yield* Effect.promise(() =>
          Bun.write(path.join(project.path, "opencode.json"), Bun.file(path.join(dir, "opencode.json"))),
        )
        const published = yield* Effect.promise(() =>
          KnowledgeStore.publish({
            expectedVersion: 0,
            requestID: "context-test",
            originals: {},
            data: {
              spaces: [{ id: "kb", name: "CRM knowledge", description: "CRM processes", createdAt: "", updatedAt: "" }],
              sources: ["123", "456"].map((id) => ({
                id,
                spaceID: "kb",
                type: "note" as const,
                name: id,
                description: "Short navigation",
                text: `# Actual material ${id}`,
                tags: [],
                createdAt: "",
                updatedAt: "",
              })),
              relations: [
                {
                  id: "edge",
                  spaceID: "kb",
                  source: "123",
                  target: "456",
                  type: "RELATED_TO",
                  provenance: "manual",
                  metadata: {},
                },
              ],
              jobs: [],
            },
          }),
        )
        const registered = (yield* Effect.promise(() => KnowledgeStore.projects())).find(
          (item) => item.path === project.path,
        )!
        const folder = path.join(KnowledgeStore.root(), "spaces", published.spaces[0].storageID)
        const index = yield* Effect.promise(() => Bun.file(path.join(folder, "index.json")).json())
        yield* Effect.gen(function* () {
          const sessions = yield* Session.Service
          const prompt = yield* SessionPrompt.Service
          const session = yield* sessions.create({ title: "Knowledge context regression", agent: "build" })
          const run = () =>
            prompt.prompt({
              sessionID: session.id,
              agent: "build",
              model,
              parts: [{ type: "text", text: "Inspect relevant connected knowledge using file tools." }],
            })
          yield* llm.text("No connected knowledge")
          yield* run()
          expect(JSON.stringify(yield* llm.inputs)).not.toContain("CRM knowledge")
          yield* Effect.promise(() => KnowledgeStore.projects({ projectID: registered.id, spaces: ["kb"] }))
          yield* llm.reset
          yield* llm.tool("bash", { command: `ls '${folder}'`, description: "List connected knowledge" })
          yield* llm.tool("read", { filePath: path.join(folder, "index.json") })
          yield* llm.tool("read", { filePath: path.join(folder, index["123"][0]) })
          yield* llm.tool("read", { filePath: path.join(folder, "links.json") })
          yield* llm.text("Read physical knowledge")
          const result = yield* run()
          expect(result.info.role === "assistant" && result.info.error).toBeUndefined()
          const history = yield* sessions.messages({ sessionID: session.id })
          const tools = history.flatMap((message) => message.parts).filter((part) => part.type === "tool")
          expect(tools).toHaveLength(4)
          expect(tools.every((part) => part.state.status === "completed")).toBe(true)
          expect(JSON.stringify(tools)).toContain("# Actual material 123")
          const inputs = yield* llm.inputs
          const system = JSON.stringify(
            (inputs[0].messages as { role: string; content: unknown }[]).filter((message) => message.role === "system"),
          )
          expect(system).toContain("CRM knowledge")
          expect(system).toContain(folder)
          expect(system).not.toContain("# Actual material")
          yield* Effect.promise(() => KnowledgeStore.projects({ projectID: registered.id, spaces: [] }))
          yield* llm.reset
          yield* llm.text("Disconnected")
          yield* run()
          const disconnected = (yield* llm.inputs)[0].messages as { role: string; content: unknown }[]
          expect(JSON.stringify(disconnected.filter((message) => message.role === "system"))).not.toContain(folder)
          expect((yield* Effect.promise(() => KnowledgeStore.verify())).errors).toEqual([])
        }).pipe(provideInstanceEffect(project.path), Effect.provide(testInstanceStoreLayer))
      }),
      {
        config: (url) => ({
          permission: { "*": "allow" as const },
          provider: {
            test: {
              name: "Test",
              id: "test",
              env: [],
              npm: "@ai-sdk/openai-compatible",
              models: { "test-model": { name: "Test Model", limit: { context: 100000, output: 10000 } } },
              options: { apiKey: "test-key", baseURL: url },
            },
          },
        }),
      },
    ),
  { timeout: 90_000 },
)
