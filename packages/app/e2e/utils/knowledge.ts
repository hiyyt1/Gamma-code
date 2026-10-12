import { expect, type Page } from "@playwright/test"

export async function selectKnowledgeNode(page: Page, name: string) {
  await page.getByRole("searchbox").fill(name)
  await page
    .getByRole("region", { name: "Результаты поиска", exact: true })
    .getByRole("button", { name, exact: true })
    .click()
  await expect(page.locator(".kb-details h2")).toHaveText(name)
  await page.getByRole("searchbox").fill("")
}

export async function seedKnowledgeSpace(page: Page) {
  await expect(page.getByRole("heading", { name: "Начните свою историю знаний", exact: true })).toBeVisible()
  await page.evaluate(
    async (path) => {
      const { seedKnowledge } = await import(path)
      await seedKnowledge()
    },
    `/@fs${new URL("../../../../script/knowledge-base/seed.mjs", import.meta.url).pathname}`,
  )
  await page.reload()
  await selectKnowledgeNode(page, "Архитектура платформы")
  await page.getByRole("button", { name: "Сбросить камеру", exact: true }).click()
}

export async function showKnowledgeAdd(page: Page) {
  const close = page.locator(".kb-details").getByRole("button", { name: "Закрыть", exact: true })
  if (await close.count()) await close.click()
  await expect(page.getByRole("region", { name: "Добавить в базу знаний", exact: true })).toBeVisible()
}
