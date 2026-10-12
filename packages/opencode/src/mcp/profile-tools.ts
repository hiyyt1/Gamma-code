export * as GammaProfileTools from "./profile-tools"

import { Effect, Layer, Schema, SchemaRepresentation } from "effect"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { makeLocationNode } from "@opencode-ai/core/effect/app-node"
import { ProfileTools } from "@opencode-ai/core/tool/profile-tools"
import { SystemContext } from "@opencode-ai/core/system-context"
import { Tool } from "@opencode-ai/core/tool/tool"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { MCP } from "."
import { McpCatalog } from "./catalog"
import { InstanceStore } from "@/project/instance-store"
import { InstanceRef } from "@/effect/instance-ref"

export function node(mcp: MCP.Interface, instances: InstanceStore.Interface) {
  const layer = Layer.effect(
    ProfileTools.Service,
    Effect.gen(function* () {
      const permission = yield* PermissionV2.Service
      return ProfileTools.Service.of({
        load: (directory) =>
          Effect.gen(function* () {
            const instance = yield* instances.load({ directory })
            const tools = yield* mcp.tools().pipe(Effect.provideService(InstanceRef, instance))
            const instructions = yield* mcp.instructions().pipe(Effect.provideService(InstanceRef, instance))
            return {
              context: instructions.length
                ? SystemContext.make({
                    key: SystemContext.Key.make("gamma/mcp-instructions"),
                    codec: Schema.toCodecJson(Schema.Array(Schema.String)),
                    load: Effect.succeed(instructions.map((item) => `${item.name}: ${item.instructions}`)),
                    baseline: (items) => items.join("\n\n"),
                    update: (_previous, items) => `MCP server instructions have changed:\n${items.join("\n\n")}`,
                    removed: () => "MCP server instructions are no longer available.",
                  })
                : SystemContext.empty,
              tools: Object.fromEntries(
                Object.entries(tools).map(([name, tool]) => [
                  name,
                  Tool.make({
                    description: tool.def.description ?? "",
                    input: SchemaRepresentation.toSchema<Schema.Codec<unknown>>(
                      SchemaRepresentation.fromJsonSchemaDocument({
                        dialect: "draft-2020-12",
                        schema: tool.def.inputSchema,
                        definitions: {},
                      }),
                    ),
                    output: Schema.Unknown,
                    toModelOutput: ({ output }) =>
                      CallToolResultSchema.parse(output).content.flatMap((part): Tool.Content[] => {
                        if (part.type === "text") return [{ type: "text", text: part.text }]
                        if (part.type === "image" || part.type === "audio")
                          return [{ type: "file", data: part.data, mime: part.mimeType }]
                        if (part.type === "resource" && "text" in part.resource)
                          return [{ type: "text", text: part.resource.text }]
                        if (part.type === "resource" && "blob" in part.resource)
                          return [
                            {
                              type: "file",
                              data: part.resource.blob,
                              mime: part.resource.mimeType ?? "application/octet-stream",
                            },
                          ]
                        return [{ type: "text", text: JSON.stringify(part) }]
                      }),
                    execute: (args, context) =>
                      Effect.gen(function* () {
                        yield* permission.assert({
                          sessionID: context.sessionID,
                          agent: context.agent,
                          action: name,
                          resources: ["*"],
                          source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                        })
                        return yield* Effect.tryPromise((signal) =>
                          McpCatalog.call(tool.def, tool.client, args, signal, tool.timeout),
                        )
                      }).pipe(Effect.mapError((error) => new Tool.Failure({ message: String(error) }))),
                  }),
                ]),
              ),
            }
          }),
      })
    }),
  )

  return makeLocationNode({ service: ProfileTools.Service, layer, deps: [PermissionV2.node] })
}
