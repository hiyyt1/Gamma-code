import { expect, test } from "@playwright/test"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"

test.skip(process.env.GAMMA_AGENT_E2E !== "1", "Requires isolated Gamma product backend")
test.use({ viewport: { width: 1440, height: 1050 }, locale: "ru-RU" })
const backend = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test("Wildberries market, project application, secure connection panel and real analytics artifacts", async ({
  page,
  request,
}, info) => {
  const name = `wb-ui-${crypto.randomUUID().slice(0, 8)}`
  const created = await request.post(`${backend}/product/projects`, { data: { name } })
  expect(created.ok()).toBe(true)
  const project = await created.json()
  await page.goto("/agents")
  await page.getByRole("searchbox").fill("Wildberries")
  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Wildberries Менеджер", exact: true }) })
  await expect(card).toBeVisible()
  await card.getByRole("button", { name: "Подробнее", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("wb-unit-economics")
  await expect(dialog).toContainText("wb-sales-analyst")
  await expect(dialog.getByRole("heading", { name: "Подключение Wildberries", exact: true })).toBeVisible()
  await expect(dialog.getByLabel("Токен API", { exact: true })).toHaveAttribute("type", "password")
  await page.screenshot({ path: info.outputPath("wildberries-details.png"), fullPage: true })
  await page.keyboard.press("Escape")
  await card.getByRole("button", { name: "Использовать", exact: true }).click()
  await dialog.getByRole("button", { name, exact: true }).click()
  const appliedResponse = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/active-agent"),
  )
  await dialog.getByRole("button", { name: "Использовать", exact: true }).click()
  const applied = await (await appliedResponse).json()
  await expect(page).toHaveURL(new RegExp(applied.sessionId))
  await expect(page.getByRole("button", { name: "Wildberries Менеджер", exact: true })).toBeVisible()
  expect(applied.selection.agentId).toBe("wildberries-manager")
  await writeFile(path.join(project.path, "wb.csv"), "nmID,date,quantity,revenue\n1,2026-09-15,10,1000\n")
  const script = path.resolve(
    "../../gamma-agent-market/bundles/wildberries-management/skills/wb-unit-economics/scripts/analytics.py",
  )
  execFileSync("python3", ["-I", script], {
    input: JSON.stringify({
      root: project.path,
      files: [{ path: "wb.csv", kind: "sale" }],
      start: "2026-09-01",
      end: "2026-09-30",
      output: "wb-report",
    }),
  })
  // Persist a real user input without provider execution; Gamma intentionally
  // removes abandoned empty sessions on pagehide.
  const admitted = await request.post(`${backend}/session/${applied.sessionId}/message`, {
    headers: { "x-opencode-directory": project.path },
    data: {
      noReply: true,
      model: { providerID: "test", modelID: "test-model" },
      parts: [{ type: "text", text: "Рассчитай продажи из загруженного файла" }],
    },
  })
  expect(admitted.ok()).toBe(true)
  await page.reload()
  const panel = page.getByRole("complementary", { name: "Рабочая область", exact: true })
  await expect(panel.getByRole("button", { name: "wb-report", exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "wb-report", exact: true }).click()
  for (const file of ["report.md", "products.csv", "products.xlsx", "analysis.json"])
    await expect(panel.getByRole("button", { name: file, exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "report.md", exact: true }).click()
  await expect(page.getByText("Wildberries: проверяемый расчёт", { exact: false })).toBeVisible()
  await page.screenshot({ path: info.outputPath("wildberries-report.png"), fullPage: true })
})

test("secure connection and approval resume existing chat without another user prompt (mock WB UI responses)", async ({
  page,
  request,
}) => {
  const project = await (
    await request.post(`${backend}/product/projects`, {
      data: { name: `wb-resume-${crypto.randomUUID().slice(0, 8)}` },
    })
  ).json()
  const applied = await (
    await request.post(`${backend}/product/projects/${project.name}/active-agent`, {
      data: {
        agentId: "wildberries-manager",
        expectedVersion: 0,
        confirmed: false,
        connectSkills: true,
        requestId: crypto.randomUUID(),
      },
    })
  ).json()
  const planId = "71d882e6-2672-40bc-90ab-c704c22496bd"
  const state = { connected: false, approved: false }
  const status = () => ({
    status: state.connected ? "connected" : "disconnected",
    shop: "mock-store",
    categories: ["prices"],
    methods: [],
    mcp: { portal: "connected" },
    plans:
      state.connected && !state.approved
        ? [
            {
              id: planId,
              summary: "Цена товара 120 рублей",
              operations: [{ method: "update_prices", params: { data: [{ nmID: 1, price: 120, discount: 0 }] } }],
              state: "pending",
              expires: Date.now() + 600000,
            },
          ]
        : [],
  })
  await page.route(`**/product/projects/${project.name}/wildberries**`, async (route) => {
    if (route.request().url().endsWith("/connect")) state.connected = true
    if (route.request().url().includes("/plans/")) state.approved = true
    await route.fulfill({ json: status() })
  })
  const prompts: string[] = []
  await page.route(`**/session/${applied.sessionId}/prompt_async`, async (route) => {
    prompts.push(route.request().postData() ?? "")
    await route.fulfill({ status: 204 })
  })
  await page.goto(`/${Buffer.from(project.path).toString("base64url")}/session/${applied.sessionId}`)
  const open = page.getByRole("button", { name: "Wildberries Менеджер", exact: true })
  await open.click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Токен API", { exact: true }).fill("test-only-not-a-real-token")
  const connected = page.waitForRequest((r) => r.url().endsWith(`/session/${applied.sessionId}/prompt_async`))
  await dialog.getByRole("button", { name: "Подключить", exact: true }).click()
  await connected
  await expect(dialog).toHaveCount(0)
  expect(prompts[0]).toContain("Wildberries подключён")
  expect(prompts[0]).not.toContain("test-only-not-a-real-token")
  await open.click()
  await expect(dialog).toContainText("Цена товара 120 рублей")
  const approved = page.waitForRequest((r) => r.url().endsWith(`/session/${applied.sessionId}/prompt_async`))
  await dialog.getByRole("button", { name: "Подтвердить точные изменения", exact: true }).click()
  await approved
  await expect(dialog).toHaveCount(0)
  expect(prompts[1]).toContain(planId)
  expect(prompts[1]).not.toContain("approvalKey")
})
