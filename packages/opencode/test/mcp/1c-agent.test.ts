import { expect } from "bun:test"
import path from "node:path"
import { appendFile, cp, symlink } from "node:fs/promises"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionAgent } from "@opencode-ai/core/session/agent"
import { AgentMarketService } from "@opencode-ai/core/agent-market"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { MCP } from "../../src/mcp"
import { BslMcp } from "../../src/mcp/bsl"
import { McpCatalog } from "../../src/mcp/catalog"
import { Agent } from "../../src/agent/agent"
import { Skill } from "../../src/skill"
import { Permission } from "../../src/permission"
import { SkillTool } from "../../src/tool/skill"
import { ReadTool } from "../../src/tool/read"
import { Session } from "../../src/session/session"
import { MessageID } from "../../src/session/schema"
import { Truncate } from "../../src/tool/truncate"
import { LSP } from "../../src/lsp/lsp"
import { Instruction } from "../../src/session/instruction"
import { testEffect } from "../lib/effect"
import { provideTmpdirInstance } from "../fixture/fixture"

const profile = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const binding = {
      sessionID: "bsl-fixture",
      ...(yield* Effect.promise(() => SessionAgent.prepare("gamma-1c-developer"))),
    }
    return yield* SessionAgent.provide(binding, effect)
  })

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      MCP.node,
      AgentMarketService.node,
      Agent.node,
      Skill.node,
      CrossSpawnSpawner.node,
      Ripgrep.node,
      Session.node,
      Truncate.node,
      FSUtil.node,
      Instruction.node,
      LSP.node,
    ]),
  ),
)

it.live("missing JAR or Java never advertises a connected profile MCP", () =>
  provideTmpdirInstance((directory) =>
    profile(
      Effect.gen(function* () {
        const jar = process.env.GAMMA_BSL_JAR
        const java = process.env.GAMMA_BSL_JAVA
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (jar === undefined) delete process.env.GAMMA_BSL_JAR
            if (jar !== undefined) process.env.GAMMA_BSL_JAR = jar
            if (java === undefined) delete process.env.GAMMA_BSL_JAVA
            if (java !== undefined) process.env.GAMMA_BSL_JAVA = java
          }),
        )
        delete process.env.GAMMA_BSL_JAR
        const market = yield* AgentMarketService.Service
        const mcp = yield* MCP.Service
        yield* market.apply(
          directory,
          {
            agentId: "1c-developer",
            expectedVersion: 0,
            confirmed: false,
            connectSkills: false,
            requestId: crypto.randomUUID(),
          },
          Effect.succeed("dependency-session"),
          () => Effect.succeed(true),
        )
        expect(JSON.stringify(yield* mcp.status())).toContain("bsl_jar_missing")
        expect(Object.keys(yield* mcp.tools()).filter((name) => name.startsWith("gamma-bsl_"))).toHaveLength(0)
        yield* Effect.promise(() => Bun.write(path.join(directory, "placeholder.jar"), "not executed"))
        process.env.GAMMA_BSL_JAR = path.join(directory, "placeholder.jar")
        process.env.GAMMA_BSL_JAVA = path.join(directory, "missing-java")
        expect(JSON.stringify(yield* mcp.refreshProfile())).toContain("bsl_java_missing")
        expect((yield* mcp.connect(BslMcp.name).pipe(Effect.exit))._tag).toBe("Failure")
      }),
    ),
  ),
)

it.live("1C bundle, roles and read-only resource access stay session-scoped", () =>
  provideTmpdirInstance((directory) =>
    profile(
      Effect.gen(function* () {
        const market = yield* AgentMarketService.Service
        const agents = yield* Agent.Service
        const skills = yield* Skill.Service
        yield* market.apply(
          directory,
          {
            agentId: "1c-developer",
            expectedVersion: 0,
            confirmed: false,
            connectSkills: false,
            requestId: crypto.randomUUID(),
          },
          Effect.succeed("fixture-session"),
          () => Effect.succeed(true),
        )
        const primary = yield* agents.resolve("gamma-1c-developer")
        expect(primary.name).toBe("gamma-1c-developer")
        expect(Permission.evaluate("task", "gamma-1c-explorer", primary.permission).action).toBe("allow")
        expect(Permission.evaluate("task", "general", primary.permission).action).toBe("deny")
        const reviewer = yield* agents.resolve("gamma-1c-reviewer", true)
        expect(reviewer.mode).toBe("subagent")
        expect(Permission.evaluate("edit", "file.bsl", reviewer.permission).action).toBe("deny")
        const skill = yield* skills.require("1c-development:bsp")
        expect(skill.content).toContain("3.1.11")
        expect(
          Permission.evaluate(
            "external_directory",
            path.join(path.dirname(skill.location), "references", "*"),
            primary.permission,
          ).action,
        ).toBe("allow")
        expect(
          Permission.evaluate("edit", path.join(path.dirname(skill.location), "SKILL.md"), primary.permission).action,
        ).toBe("deny")
        expect(Permission.evaluate("external_directory", "/other/project/*", primary.permission).action).toBe("deny")
        const index = yield* skills.require("1c-development:1c-config-index")
        expect(index.content).not.toContain("{{SKILLS_ROOT}}")
        expect(index.content).toContain("/1c-config-index/scripts/config-index.py")
        const sessions = yield* Session.Service
        const context = {
          sessionID: (yield* sessions.create({})).id,
          messageID: MessageID.make("msg_1c_skill"),
          callID: "1c-skill",
          agent: primary.name,
          abort: new AbortController().signal,
          messages: [],
          metadata: () => Effect.void,
          ask: (request: { permission: string; patterns: readonly string[] }) =>
            Effect.sync(() => {
              for (const pattern of request.patterns)
                expect(Permission.evaluate(request.permission, pattern, primary.permission).action).toBe("allow")
            }),
        }
        const skillDefinition = yield* SkillTool
        const skillTool = yield* skillDefinition.init()
        expect((yield* skillTool.execute({ name: "1c-development:bsp" }, context)).output).toContain("3.1.11")
        const readDefinition = yield* ReadTool
        const read = yield* readDefinition.init()
        expect(
          (yield* read.execute(
            { filePath: path.join(path.dirname(skill.location), "scripts/bsp_api.py"), limit: 20 },
            context,
          )).output,
        ).toContain("lookup methods")
        yield* market.apply(
          directory,
          {
            agentId: "website-builder",
            expectedVersion: 1,
            confirmed: true,
            connectSkills: false,
            requestId: crypto.randomUUID(),
          },
          Effect.succeed("next-session"),
          () => Effect.succeed(true),
        )
        expect((yield* skills.all()).some((item) => item.name.startsWith("1c-development:"))).toBe(true)
        expect(
          (yield* skills.all().pipe(Effect.provideService(SessionAgent.Current, undefined))).some((item) =>
            item.name.startsWith("1c-development:"),
          ),
        ).toBe(false)
      }),
    ),
  ),
)
;(process.env.GAMMA_BSL_JAR ? it.live : it.live.skip)(
  "real BSL MCP registers the project, analyzes symbols/definitions and remains available only in its session context",
  () =>
    provideTmpdirInstance((directory) =>
      profile(
        Effect.gen(function* () {
          const market = yield* AgentMarketService.Service
          const mcp = yield* MCP.Service
          yield* Effect.promise(() =>
            cp(path.join(import.meta.dir, "../fixture/1c-project"), directory, { recursive: true }),
          )
          expect((yield* mcp.tools().pipe(Effect.provideService(SessionAgent.Current, undefined)))["gamma-bsl_document_symbols"]).toBeUndefined()
          yield* market.apply(
            directory,
            {
              agentId: "1c-developer",
              expectedVersion: 0,
              confirmed: false,
              connectSkills: false,
              requestId: crypto.randomUUID(),
            },
            Effect.succeed("fixture-session"),
            () => Effect.succeed(true),
          )
          expect((yield* mcp.status())[BslMcp.name]).toEqual({ status: "connected" })
          const tools = yield* mcp.tools()
          expect(tools["gamma-bsl_register_workspace_folder"]).toBeUndefined()
          const call = (name: string, args: Record<string, unknown>) =>
            Effect.promise(async () => {
              const entry = tools[`gamma-bsl_${name}`]
              const tool = McpCatalog.convertTool(entry.def, entry.client, entry.timeout)
              return tool.execute!(args, {
                toolCallId: "1c-test",
                messages: [],
                abortSignal: new AbortController().signal,
              })
            })
          const file = path.join(directory, "CommonModules/ОбщиеФункции/Ext/Module.bsl")
          const symbols = yield* call("document_symbols", { file })
          expect(JSON.stringify(symbols)).toContain("Приветствие")
          const definition = yield* call("definition", { file, line: 7, character: 15 })
          expect(JSON.stringify(definition)).toContain("Module.bsl")
          expect(JSON.stringify(definition)).toContain('startLine\\\":2')
          const references = yield* call("find_references", { file, line: 2, character: 12 })
          expect(JSON.stringify(references)).toContain("Module.bsl")
          const diagnostics = yield* call("analyze_file", { file })
          expect(JSON.stringify(diagnostics)).toContain("diagnostics")
          yield* Effect.promise(() =>
            appendFile(file, "\nФункция НоваяФункция() Экспорт\n    Возврат 42;\nКонецФункции\n"),
          )
          expect(JSON.stringify(yield* call("document_symbols", { file }))).toContain("НоваяФункция")
          yield* Effect.promise(() => symlink("/etc/passwd", path.join(directory, "outside.bsl")))
          expect(
            (yield* call("analyze_file", { file: path.join(directory, "outside.bsl") }).pipe(Effect.exit))._tag,
          ).toBe("Failure")
          expect(
            (yield* call("type_info", { typeName: "Массив", fileType: "BSL", workspaceFolder: "file:///tmp" }).pipe(
              Effect.exit,
            ))._tag,
          ).toBe("Failure")
          yield* market.apply(
            directory,
            {
              agentId: "website-builder",
              expectedVersion: 1,
              confirmed: true,
              connectSkills: false,
              requestId: crypto.randomUUID(),
            },
            Effect.succeed("next-session"),
            () => Effect.succeed(true),
          )
          expect(
            (yield* mcp.status().pipe(Effect.provideService(SessionAgent.Current, undefined)))[BslMcp.name],
          ).toBeUndefined()
          expect(JSON.stringify(yield* call("document_symbols", { file }))).toContain("Приветствие")
        }),
      ),
    ),
  180_000,
)
