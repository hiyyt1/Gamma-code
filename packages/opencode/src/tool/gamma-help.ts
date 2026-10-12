import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import { AgentMarketService } from "@opencode-ai/core/agent-market"
import { guideSkills } from "@opencode-ai/core/gamma/system"

const Input = Schema.Struct({ topic: Schema.Literals(["catalog", "capabilities"]) })

export const GammaHelpTool = Tool.define(
  "gamma_help",
  Effect.gen(function* () {
    const market = yield* AgentMarketService.Service
    return {
      description:
        "Read trusted Gamma help or the current public agent catalogue. No files, credentials, account data, shell commands or mutations are accepted.",
      parameters: Input,
      execute: (input: typeof Input.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "gamma_help", patterns: [input.topic], always: ["*"], metadata: {} })
          const result =
            input.topic === "catalog"
              ? (yield* market.catalog().pipe(Effect.orDie))
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
                  diagnostics: "Public catalogue only; no private files, logs or credentials.",
                }
          return { title: "Gamma Help", output: JSON.stringify(result), metadata: {} }
        }),
    }
  }),
)
