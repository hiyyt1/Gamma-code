import type { Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

export const directory = "/gamma/light-project"
export const sessionID = "ses_gamma_light"
export const sessionURL = `/${Buffer.from(directory).toString("base64url")}/session/${sessionID}`
const model = { providerID: "opencode", modelID: "claude-opus-4-6" }

export async function setupGamma(
  page: Page,
  options: { protocol?: "v1" | "v2"; agent?: string; context?: number } = {},
) {
  await mockOpenCodeServer(page, {
    protocol: options.protocol,
    directory,
    project: {
      id: "proj_gamma_light",
      worktree: directory,
      name: "Gamma Light",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    sessions: [
      {
        id: sessionID,
        projectID: "proj_gamma_light",
        directory,
        title: "Проверка интерфейса",
        agent: options.agent,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            [model.modelID]: {
              id: model.modelID,
              name: "Claude Opus 4.6",
              limit: { context: options.context ?? 200000 },
            },
          },
        },
      ],
      connected: ["opencode"],
      default: model,
    },
    pageMessages: () => ({
      items: [
        {
          info: {
            id: "msg_light_user",
            sessionID,
            role: "user",
            time: { created: 1700000000000 },
            summary: { diffs: [] },
            agent: "build",
            model,
          },
          parts: [
            {
              id: "prt_light_user",
              sessionID,
              messageID: "msg_light_user",
              type: "text",
              text: "Проверь интерфейс Gamma",
            },
          ],
        },
        {
          info: {
            id: "msg_light_response",
            sessionID,
            role: "assistant",
            parentID: "msg_light_user",
            time: { created: 1700000001000, completed: 1700000002000 },
            ...model,
            agent: "build",
            mode: "build",
            path: { cwd: directory, root: directory },
            cost: 0,
            tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
            finish: "stop",
          },
          parts: [
            {
              id: "prt_light_response",
              sessionID,
              messageID: "msg_light_response",
              type: "text",
              text: "## Готово\n\nТекст ответа должен быть видимым.\n\n```ts\nconst gamma = 'light'\n```",
            },
          ],
        },
      ],
    }),
    fileList: () => [
      { name: "README.md", path: "README.md", absolute: `${directory}/README.md`, type: "file", ignored: false },
    ],
    fileContent: () => ({ type: "text", content: "# Gamma\n\nСветлый интерфейс", mimeType: "text/markdown" }),
  })
  await page.route("**/pty/shells", (route) => route.fulfill({ json: [] }))
  await page.route("**/product/**", (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/product/projects") return route.fulfill({ json: [{ name: "Gamma Light", path: directory }] })
    if (path.endsWith("/discard-empty")) return route.fulfill({ json: { discarded: false } })
    if (path.endsWith("/content"))
      return route.fulfill({
        json: { type: "text", content: "# Gamma\n\nСветлый интерфейс", mimeType: "text/markdown" },
      })
    if (path.endsWith("/preview")) return route.fulfill({ json: { apps: [], enabled: false } })
    if (path.endsWith("/files"))
      return route.fulfill({
        json: [
          { name: "README.md", path: "README.md", absolute: `${directory}/README.md`, type: "file", ignored: false },
        ],
      })
    if (path === "/product/agent-market/agents")
      return route.fulfill({
        json: [
          {
            id: "test-designer",
            name: "Тестовый дизайнер",
            description: "Помогает с интерфейсом",
            type: "specialist",
            category: "design",
            tasks: ["Проверка интерфейса"],
            skills: [],
            tools: [],
            members: [],
            permissions: {},
            source: "https://example.com/design",
            revision: "test",
            license: "MIT",
            available: true,
            reason: "",
          },
        ],
      })
    if (path === "/product/knowledge")
      return route.fulfill({
        json: {
          modelVersion: 2,
          version: 0,
          data: { spaces: [], sources: [], relations: [], jobs: [] },
          originals: {},
          spaces: [],
        },
      })
    if (path === "/product/knowledge/projects") return route.fulfill({ json: [] })
    if (path.endsWith("/active-agent")) return route.fulfill({ json: { agentId: null, version: 0, revision: null } })
    return route.fallback()
  })
}
