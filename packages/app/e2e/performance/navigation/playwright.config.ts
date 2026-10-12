import { defineConfig, devices } from "@playwright/test"

const port = 4520
process.env.PLAYWRIGHT_PORT = String(port)
process.env.PLAYWRIGHT_SERVER_PORT = String(port)
const phase = process.env.GAMMA_NAV_PHASE ?? "before"
const build = process.env.GAMMA_NAV_BUILD ?? `/tmp/gamma-navigation-${phase}`
export default defineConfig({
  testDir: ".",
  outputDir: `/tmp/gamma-navigation-${phase}-results`,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [["line"], ["json", { outputFile: `/tmp/gamma-navigation-${phase}-report.json` }]],
  webServer: {
    command: `bun run serve -- --host 127.0.0.1 --port ${port} --strictPort --outDir ${build}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    baseURL: `http://127.0.0.1:${port}`,
    locale: "ru-RU",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
})
