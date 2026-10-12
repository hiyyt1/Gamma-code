import { expect, test } from "@playwright/test"

test.skip(process.env.GAMMA_SYSTEM_AGENTS_E2E !== "1", "Requires an isolated Gamma backend")
test.use({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", reducedMotion: "reduce" })
const backend = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4180"}`

test("Gamma default, isolated Help, specialist preservation and explicit return", async ({ page, request }) => {
  const created = await request.post(`${backend}/product/projects`, {
    data: { name: `system-ui-${crypto.randomUUID().slice(0, 8)}` },
  })
  expect(created.ok()).toBe(true)
  const project = (await created.json()) as { name: string; path: string }
  const headers = { "x-opencode-directory": project.path }
  const sessionResponse = await request.post(`${backend}/session`, { headers, data: {} })
  const session = (await sessionResponse.json()) as { id: string }
  const message = await request.post(`${backend}/session/${session.id}/message`, {
    headers,
    data: { noReply: true, parts: [{ type: "text", text: "Сохранённая история Gamma" }] },
  })
  expect(message.ok()).toBe(true)
  expect((await (await request.get(`${backend}/session/${session.id}`, { headers })).json()).agent).toBe("gamma")
  const applied = await request.post(`${backend}/product/projects/${project.name}/active-agent`, {
    data: {
      agentId: "website-builder",
      expectedVersion: 0,
      confirmed: false,
      connectSkills: true,
      requestId: crypto.randomUUID(),
    },
  })
  expect(applied.ok()).toBe(true)
  await page.goto(`/${Buffer.from(project.path).toString("base64url")}/session/${session.id}`)
  await expect(page.getByRole("button", { name: "Создатель сайтов", exact: true })).toBeVisible()
  const helpResponse = page.waitForResponse(
    (response) => response.url().endsWith("/product/help/session") && response.request().method() === "POST",
  )
  await page.getByRole("button", { name: "Помощь", exact: true }).click()
  const help = (await (await helpResponse).json()) as { id: string; agent: string; directory: string }
  expect(help.agent).toBe("gamma-guide")
  expect(help.directory).not.toBe(project.path)
  await expect(page).toHaveURL(new RegExp(`/session/${help.id}$`))
  await expect(page.getByRole("heading", { name: "Gamma Guide", exact: true })).toBeVisible()
  await expect(page.getByRole("complementary", { name: "Рабочая область", exact: true })).toHaveCount(0)
  await request.post(`${backend}/session/${help.id}/message`, {
    headers: { "x-opencode-directory": help.directory },
    data: { noReply: true, parts: [{ type: "text", text: "Объясни интерфейс" }] },
  })
  await page.reload()
  await expect(page.getByRole("heading", { name: "Gamma Guide", exact: true })).toBeVisible()
  const selection = await (await request.get(`${backend}/product/projects/${project.name}/active-agent`)).json()
  expect(selection.agentId).toBe("website-builder")
  await page.goto(`/agents?project=${project.name}`)
  await expect(page.locator('article[data-agent="gamma-guide"]')).toBeVisible()
  await page.getByRole("combobox", { name: "Выберите проект", exact: true }).selectOption(project.name)
  await page.locator('article[data-agent="gamma"]').getByRole("button", { name: "Использовать", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: project.name, exact: true }).click()
  const resetResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/projects/${project.name}/active-agent`) && response.request().method() === "POST",
  )
  await page.getByRole("dialog").getByRole("button", { name: "Заменить агента", exact: true }).click()
  expect((await (await resetResponse).json()).selection.agentId).toBeNull()
  await expect(page.getByRole("button", { name: "Gamma", exact: true })).toBeVisible()
  const history = await request.get(`${backend}/session/${session.id}/message`, { headers })
  expect(JSON.stringify(await history.json())).toContain("Сохранённая история Gamma")
})
