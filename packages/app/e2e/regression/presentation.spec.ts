import { expect, test } from "@playwright/test"
import { execFileSync } from "node:child_process"
import path from "node:path"

test.skip(process.env.GAMMA_PRESENTATION_E2E !== "1", "Requires an isolated Gamma backend, LibreOffice and Poppler")
test.use({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", reducedMotion: "reduce" })
const backend = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4173"}`

test("real presentation files: catalogue, preview, thumbnails, fullscreen, download and update after edit", async ({
  page,
  request,
}, info) => {
  const projectResponse = await request.post(`${backend}/product/projects`, {
    data: { name: `presentation-ui-${crypto.randomUUID().slice(0, 8)}` },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = (await projectResponse.json()) as { name: string; path: string }
  const applied = await request.post(`${backend}/product/projects/${project.name}/active-agent`, {
    data: {
      agentId: "presentation-creator",
      expectedVersion: 0,
      confirmed: false,
      connectSkills: true,
      requestId: crypto.randomUUID(),
    },
  })
  expect(applied.ok()).toBe(true)
  const session = (await applied.json()) as { sessionId: string }
  // Gamma discards abandoned empty sessions; persist an actual user message
  // without starting a model turn for this deterministic UI test.
  const message = await request.post(`${backend}/session/${session.sessionId}/message`, {
    headers: { "x-opencode-directory": project.path },
    data: { noReply: true, parts: [{ type: "text", text: "Покажи тестовую презентацию из файлов проекта." }] },
  })
  expect(message.ok()).toBe(true)
  const catalog = await request.get(`${backend}/product/agent-market/agents`)
  expect(
    ((await catalog.json()) as { id: string; name: string }[]).find((item) => item.id === "presentation-creator")?.name,
  ).toBe("Создатель презентаций")
  const runtime = await request.post(`${backend}/product/projects/${project.name}/active-agent/check`, { data: {} })
  expect((await runtime.json()).tools).toContain("gamma-presentation_build")
  const agentsResponse = await request.get(`${backend}/agent`, { headers: { "x-opencode-directory": project.path } })
  const agents = (await agentsResponse.json()) as {
    name: string
    permission: { permission: string; pattern: string; action: string }[]
  }[]
  const presentations = agents.filter((agent) => agent.name.startsWith("gamma-presentation-"))
  expect(presentations).toHaveLength(5)
  for (const agent of presentations)
    expect(agent.permission.findLast((rule) => rule.permission === "edit" && rule.pattern === "*")?.action).toBe("deny")
  const leader = presentations.find((agent) => agent.name === "gamma-presentation-creator")!
  expect(leader.permission.filter((rule) => rule.permission === "task" && rule.action === "allow")).toHaveLength(4)
  const script = path.resolve("../opencode/script/presentation-fixture.ts")
  const fixture = JSON.parse(
    execFileSync("bun", [script, "create", project.path], { encoding: "utf8", timeout: 60000 }),
  ) as { workspace: string }
  await page.goto(`/${Buffer.from(project.path).toString("base64url")}/session/${session.sessionId}`)
  const panel = page.getByRole("complementary", { name: "Рабочая область", exact: true })
  await expect(panel).toBeVisible()
  await panel.getByRole("button", { name: fixture.workspace, exact: true }).click()
  await panel.getByRole("button", { name: "answer.pptx", exact: true }).dblclick()
  const thumbnails = panel.getByRole("navigation", { name: "Слайды презентации", exact: true })
  await expect(thumbnails.getByRole("button")).toHaveCount(3)
  const image = panel.getByRole("img", { name: "Слайд 1", exact: true })
  await expect(image).toHaveJSProperty("naturalWidth", 1280)
  await thumbnails.getByRole("button", { name: "Слайд 2", exact: true }).click()
  await expect(panel.getByText("Слайд 2 из 3", { exact: true })).toBeVisible()
  const previous = await panel.getByRole("img", { name: "Слайд 2", exact: true }).getAttribute("src")
  await panel.getByRole("button", { name: "Полноэкранный режим", exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  await panel.getByRole("button", { name: "Полноэкранный режим", exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false)
  const download = page.waitForEvent("download")
  await panel.getByRole("button", { name: "Скачать PowerPoint", exact: true }).click()
  expect((await download).suggestedFilename()).toBe("answer.pptx")
  execFileSync("bun", [script, "edit", project.path, fixture.workspace], { encoding: "utf8", timeout: 60000 })
  await expect(panel.getByRole("img", { name: "Слайд 2", exact: true })).not.toHaveAttribute("src", previous ?? "")
  await expect(panel.getByRole("img", { name: "Слайд 2", exact: true })).toHaveJSProperty("naturalWidth", 1280)
  await expect(panel.getByText("Ожидает визуальной проверки", { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("presentation-preview.png"), animations: "disabled" })
})
