import { afterEach, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Schema } from "effect"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Format } from "../../src/format"
import { LSP } from "../../src/lsp/lsp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Instruction } from "../../src/session/instruction"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { MessageID, SessionID } from "../../src/session/schema"
import { ReadTool } from "../../src/tool/read"
import { ShellTool } from "../../src/tool/shell"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { WriteTool } from "../../src/tool/write"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const config = (profile: string) => {
  const result = Bun.spawnSync(["python3", "-B", "-c", "import gamma_installer,json,sys; print(json.dumps(gamma_installer.policy(sys.argv[1])))", profile], {
    cwd: path.resolve(import.meta.dir, "../../../../deploy/installer"),
  })
  expect(result.exitCode).toBe(0)
  const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(ConfigV1.Info), { propertyOrder: "original" })(result.stdout.toString())
  return { default_agent: decoded.default_agent, permission: decoded.permission }
}
const it = testEffect(LayerNode.compile(LayerNode.group([
  Agent.node, Config.node, CrossSpawnSpawner.node, FSUtil.node, RuntimeFlags.node,
  EventV2Bridge.node, Instruction.node, Ripgrep.node, Format.node, LSP.node, Permission.node, Plugin.node, Truncate.node,
])))
afterEach(disposeAllInstances)

it.instance("installer trusted-auto permits real Gamma shell and file tools without approval", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const agents = yield* Agent.Service
    const permissions = yield* Permission.Service
    const agent = yield* agents.get("gamma")
    expect(agent).toBeDefined()
    for (const candidate of (yield* agents.list()).filter((item) => item.name.startsWith("gamma-") || item.name === "custom")) {
      for (const action of ["read", "edit", "bash", "skill", "task"]) {
        // Role denies remain; ordinary operations never acquire an inherited ask.
        expect(Permission.evaluate(action, "*", candidate.permission).action).not.toBe("ask")
      }
    }
    expect(Permission.evaluate("bash", "echo gamma", (yield* agents.get("custom"))!.permission).action).toBe("allow")
    expect(Permission.evaluate("bash", "echo gamma", (yield* agents.get("gamma-website-builder"))!.permission).action).toBe("allow")
    const context: Tool.Context = {
      sessionID: SessionID.make("ses_installer"), messageID: MessageID.make("msg_installer"),
      agent: "gamma", callID: "installer-smoke", abort: AbortSignal.any([]), messages: [],
      metadata: () => Effect.void,
      ask: (request) => permissions.ask({ ...request, sessionID: SessionID.make("ses_installer"), ruleset: agent!.permission }).pipe(Effect.orDie),
    }
    const write = yield* WriteTool
    const writer = yield* write.init()
    yield* writer.execute({ filePath: path.join(instance.directory, "native.txt"), content: "Gamma" }, context)
    const shell = yield* ShellTool
    const runner = yield* shell.init()
    yield* runner.execute({ command: "cat native.txt > shell.txt" }, context)
    expect(yield* Effect.promise(() => Bun.file(path.join(instance.directory, "shell.txt")).text())).toBe("Gamma")
    const read = yield* ReadTool
    const reader = yield* read.init()
    expect((yield* reader.execute({ filePath: path.join(instance.directory, "shell.txt") }, context)).output).toContain("Gamma")
    const specialist = yield* agents.get("gamma-website-builder")
    const automatic = { ...context, agent: specialist!.name,
      ask: (request: Parameters<Tool.Context["ask"]>[0]) => permissions.ask({ ...request, sessionID: context.sessionID, ruleset: specialist!.permission }).pipe(Effect.orDie) }
    yield* writer.execute({ filePath: path.join(instance.directory, "specialist.txt"), content: "specialist" }, automatic)
    yield* runner.execute({ command: "cat specialist.txt > specialist-copy.txt" }, automatic)
    expect(yield* Effect.promise(() => Bun.file(path.join(instance.directory, "specialist-copy.txt")).text())).toBe("specialist")
    expect(yield* permissions.list()).toEqual([])
  }).pipe(Effect.timeout("10 seconds")), { config: () => ({ ...config("trusted-auto"), agent: { custom: { description: "User-created agent" } } }) }, 20000)

it.instance("installer restricted policy keeps shell approval and denies external directories", () =>
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const agent = yield* agents.get("gamma")
    expect(Permission.evaluate("bash", "echo gamma", agent!.permission).action).toBe("ask")
    expect(Permission.evaluate("external_directory", "/root/*", agent!.permission).action).toBe("deny")
  }), { config: () => config("restricted") })
