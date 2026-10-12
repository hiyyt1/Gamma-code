// Opt-in E2E against a real configured Gamma provider. No mock model or fake QA.
// Run only against an isolated backend/workspace root; normal provider costs apply.
import { randomUUID } from "node:crypto"

const endpoint = process.env.GAMMA_PRESENTATION_TEST_SERVER
const model = process.env.GAMMA_PRESENTATION_TEST_MODEL
if (!endpoint || !model || !model.includes("/"))
  throw new Error("Set GAMMA_PRESENTATION_TEST_SERVER and GAMMA_PRESENTATION_TEST_MODEL=provider/model")
const headers = {
  "Content-Type": "application/json",
  ...(process.env.GAMMA_PRESENTATION_TEST_AUTH ? { Authorization: process.env.GAMMA_PRESENTATION_TEST_AUTH } : {}),
}
const request = async (route: string, body?: object, directory?: string) => {
  const result = await fetch(`${endpoint.replace(/\/$/, "")}${route}`, {
    method: body ? "POST" : "GET",
    headers: { ...headers, ...(directory ? { "x-opencode-directory": directory } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  })
  if (!result.ok) throw new Error(`HTTP ${result.status}: ${route}`)
  if (result.status === 204) return undefined
  return result.json()
}
const project = (await request("/product/projects", { name: `presentation-live-${randomUUID().slice(0, 8)}` })) as {
  name: string
  path: string
}
const applied = (await request(`/product/projects/${project.name}/active-agent`, {
  agentId: "presentation-creator",
  expectedVersion: 0,
  confirmed: false,
  connectSkills: true,
  requestId: randomUUID(),
})) as { sessionId: string }
const [providerID, ...parts] = model.split("/")
await request(
  `/session/${applied.sessionId}/prompt_async`,
  {
    agent: "gamma-presentation-creator",
    model: { providerID, modelID: parts.join("/") },
    parts: [
      {
        type: "text",
        text:
          process.env.GAMMA_PRESENTATION_TEST_PROMPT ??
          "Создай презентацию на 10 слайдов о внедрении ИИ в отдел продаж для руководства. Цель — согласовать измеримый пилот. Фактических данных компании нет: не выдумывай показатели. Нужны редактируемый PPTX, PDF и предпросмотр. Используй помощников, визуальное ревью и исправь обнаруженные проблемы.",
      },
    ],
  },
  project.path,
)
console.log(JSON.stringify({ project, sessionId: applied.sessionId }))
const duration = Number(process.env.GAMMA_PRESENTATION_TEST_TIMEOUT_MS ?? 30 * 60 * 1000)
if (!Number.isFinite(duration) || duration < 60000 || duration > 3600000)
  throw new Error("Test timeout must be between 1 and 60 minutes")
const deadline = Date.now() + duration
while (Date.now() < deadline) {
  await Bun.sleep(3000)
  const messages = (await request(`/session/${applied.sessionId}/message`, undefined, project.path)) as {
    info: { role: string; error?: unknown; time?: { completed?: number } }
    parts: { type: string; tool?: string; state?: { status: string } }[]
  }[]
  const last = messages.at(-1)
  if (
    last?.info.role !== "assistant" ||
    !last.info.time?.completed ||
    last.parts.some((part) => part.type === "tool" && ["pending", "running"].includes(part.state?.status ?? ""))
  )
    continue
  const status = (await request("/session/status", undefined, project.path)) as Record<string, { type: string }>
  if (status[applied.sessionId]?.type === "busy" || status[applied.sessionId]?.type === "retry") continue
  const children = await request(`/session/${applied.sessionId}/children`, undefined, project.path)
  const tools = messages.flatMap((message) =>
    message.parts
      .filter((part) => part.type === "tool")
      .map((part) => ({ name: part.tool, status: part.state?.status })),
  )
  const files = (await request(`/product/session/${applied.sessionId}/files?path=`, undefined)) as {
    name: string
    type: string
  }[]
  const results = []
  for (const file of files.filter((file) => file.type === "directory" && file.name.startsWith("presentation-"))) {
    const response = (await request(
      `/product/session/${applied.sessionId}/content?path=${encodeURIComponent(`${file.name}/answer.presentation.json`)}`,
    )) as { content: string }
    results.push(JSON.parse(response.content))
  }
  console.log(
    JSON.stringify(
      { project, sessionId: applied.sessionId, children, tools, results, error: last.info.error },
      null,
      2,
    ),
  )
  process.exit(results.some((result) => result.status === "ready") && !last.info.error ? 0 : 1)
}
await request(`/session/${applied.sessionId}/abort`, {}, project.path)
throw new Error(`Live E2E timed out; inspect ${project.path}. Partial artifacts remain unverified.`)
