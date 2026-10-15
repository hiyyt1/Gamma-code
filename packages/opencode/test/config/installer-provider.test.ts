import { expect, test } from "bun:test"
import path from "node:path"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ConfigParse } from "../../src/config/parse"

function installer(text: string) {
  return Bun.spawnSync(
    [
      "python3",
      "-B",
      "-c",
      "import sys,json,provider_config; value=provider_config.parse(sys.stdin.read()); provider_config.validate(value); print(json.dumps(value))",
    ],
    {
      cwd: path.resolve(import.meta.dir, "../../../../deploy/installer"),
      stdin: Buffer.from(text),
      stdout: "pipe",
      stderr: "pipe",
    },
  )
}

test("installer provider JSONC agrees with the actual OpenCode parser and V1 schema", () => {
  for (const text of [
    `{ // custom provider saved by Gamma
      "$schema": "https://opencode.ai/config.json",
      "disabled_providers": ["openai",],
      "provider": {"vsellm": {
        "name": "VSELLM", "npm": "@ai-sdk/openai-compatible",
        "options": {"baseURL": "https://example.invalid/v1"},
        "models": {"minimax/minimax-m3": {"name": "MiniMax M3",}},
      }},
    }`,
    JSON.stringify({
      model: "vsellm/minimax/minimax-m3",
      provider: {
        vsellm: {
          options: { timeout: false, headerTimeout: 5000, chunkTimeout: 5000, setCacheKey: true },
          models: {
            "minimax/minimax-m3": {
              reasoning: true,
              tool_call: true,
              limit: { context: 200000, output: 8192 },
              cost: { input: 1, output: 2, context_over_200k: { input: 2, output: 4 } },
              modalities: { input: ["text", "image"], output: ["text"] },
            },
          },
        },
      },
    }),
  ]) {
    const result = installer(text)
    expect(result.exitCode).toBe(0)
    const parsed = ConfigParse.jsonc(text, "fixture.jsonc")
    expect(JSON.parse(result.stdout.toString())).toEqual(parsed)
    expect<unknown>(ConfigParse.schema(ConfigV1.Info, parsed, "fixture.jsonc")).toEqual(parsed)
  }
})

test("installer intentionally rejects runtime extension points and ambiguous JSONC", () => {
  for (const text of [
    '{"permission":"allow"}',
    '{"plugin":["file:///tmp/execute.js"]}',
    '{"provider":{"vsellm":{"npm":"unreviewed-package"}}}',
    '{"provider":{"vsellm":{"options":{"body":{"tools":[]}}}}}',
    '{"model":"safe", "model":"other"}',
    '{"provider":{},,}',
    '{"model":1 2}',
  ]) {
    expect(installer(text).exitCode).not.toBe(0)
  }
})
