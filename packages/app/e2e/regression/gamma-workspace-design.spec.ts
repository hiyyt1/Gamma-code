import { expect, test } from "@playwright/test"
import { writeFile } from "node:fs/promises"
test.skip(process.env.GAMMA_WORKSPACE_E2E !== "1", "Requires isolated Gamma backend")
test.use({ viewport: { width: 1672, height: 941 }, locale: "ru-RU", reducedMotion: "reduce" })
test("reference workspace layout and real file actions with a UI-only assistant fixture", async ({
  page,
  request,
}, info) => {
  const base = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4129"}`
  const project = await (
    await request.post(base + "/product/projects", { data: { name: "reference-" + Date.now() } })
  ).json()
  const session = await (
    await request.post(base + "/session", {
      headers: { "x-opencode-directory": project.path },
      data: { title: "Привет мир на Python" },
    })
  ).json()
  await request.post(base + "/session/" + session.id + "/message", {
    headers: { "x-opencode-directory": project.path },
    data: { noReply: true, parts: [{ type: "text", text: "Напиши на питоне привет мир" }] },
  })
  await Promise.all(
    [
      ["hello.py", 'print("Привет, мир!")\n'],
      ["test.py", "assert True\n"],
      ["requirements.txt", "# No dependencies\n"],
      ["notes.md", "# Документация проекта\n\nЗапустите python hello.py\n"],
    ].map(([name, content]) => writeFile(project.path + "/" + name, content)),
  )

  await page.route("**/session/" + session.id + "/message*", async (route) => {
    const response = await route.fetch()
    const data = await response.json()
    if (!Array.isArray(data)) return route.fulfill({ response })
    const parent = data.find((x) => x.info.role === "user")?.info.id
    if (!parent) return route.fulfill({ response })
    const id = "msg_visual_assistant"
    const text =
      'Конечно! Вот простая программа на Python, которая выводит сообщение «Привет, мир!»:\n\n```python\nprint("Привет, мир!")\n```\n\nВы можете сохранить этот код в файл с расширением `.py` (например, `hello.py`) и запустить его с помощью команды:\n\n```bash\npython hello.py\n```\n\nВ результате в консоли будет выведено:\n\n```text\nПривет, мир!\n```\n\nЕсли хотите, могу показать, как запустить этот код в разных средах или добавить что-то ещё!'
    data.push({
      info: {
        id,
        sessionID: session.id,
        role: "assistant",
        parentID: parent,
        time: { created: Date.now(), completed: Date.now() },
        modelID: "test",
        providerID: "test",
        mode: "build",
        agent: "build",
        path: { cwd: project.path, root: project.path },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
      },
      parts: [{ id: "prt_visual", sessionID: session.id, messageID: id, type: "text", text }],
    })
    await route.fulfill({ response, json: data })
  })
  await page.goto("/" + Buffer.from(project.path).toString("base64url") + "/session/" + session.id)
  await page.getByText("Конечно! Вот простая программа", { exact: false }).waitFor()
  await page.getByRole("button", { name: "hello.py", exact: true }).waitFor()

  await expect(page.getByRole("heading", { name: "Привет мир на Python", exact: true })).toBeVisible()
  await expect(page.getByText("4 файла", { exact: true })).toBeVisible()
  await expect(page.locator('[data-component="markdown-code"][data-language="python"]')).toBeVisible()
  await page.screenshot({ path: info.outputPath("desktop.png"), animations: "disabled" })
  const composer = page.locator('[data-component="prompt-input-v2"] [contenteditable]')
  await expect(page.getByRole("button", { name: "Показать, как запустить", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Объяснить решение", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Предложить улучшения", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Поделиться", exact: true }).click()
  await expect(page.getByRole("button", { name: "Опубликовать", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Документация проекта Заметки, планы, описания" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "notes.md", exact: true }).click()
  await expect(page.getByText("Запустите python hello.py", { exact: false })).toBeVisible()
  await page.screenshot({ path: info.outputPath("file-preview.png"), animations: "disabled" })
  await page.getByRole("button", { name: "Интеграции Подключить внешние сервисы" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Настройки проекта Директория и конфигурация" }).click()
  await expect(page.getByRole("dialog")).toContainText(project.path)
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Рабочая область", exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(composer).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath("mobile.png"), animations: "disabled" })
})
