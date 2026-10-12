export * as GammaHelpTool from "./gamma-help"
import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { AgentMarketService } from "../agent-market"
import { guideSkills } from "../gamma/system"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service
    const market = yield* AgentMarketService.Service
    yield* tools
      .register({
        gamma_help: Tool.make({
          description:
            "Read Gamma's public catalogue or documented capabilities. No private project data, files, credentials or mutations.",
          input: Schema.Struct({ topic: Schema.Literals(["catalog", "capabilities"]) }),
          output: Schema.String,
          toModelOutput: ({ output }) => [{ type: "text", text: output }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission
                .assert({
                  action: "gamma_help",
                  resources: [input.topic],
                  save: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                })
                .pipe(Effect.mapError(() => new ToolFailure({ message: "Gamma help access denied" })))
              return JSON.stringify(
                input.topic === "catalog"
                  ? (yield* market
                      .catalog()
                      .pipe(Effect.mapError(() => new ToolFailure({ message: "Gamma catalogue unavailable" }))))
                      .filter((item) => !item.hidden)
                      .map((item) => ({
                        id: item.id,
                        name: item.name,
                        description: item.description,
                        tasks: item.tasks,
                        available: item.available,
                        limitations: item.limitations ?? [],
                      }))
                  : {
                      agent: "gamma-guide",
                      readonly: true,
                      skills: guideSkills.map((item) => ({ name: item.name, description: item.description })),
                    },
              )
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
export const node = makeLocationNode({
  name: "tool/gamma-help",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, AgentMarketService.node],
})
