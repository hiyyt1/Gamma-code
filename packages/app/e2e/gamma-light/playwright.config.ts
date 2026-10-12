import { defineConfig, devices } from "@playwright/test"

const port = 4518
process.env.PLAYWRIGHT_PORT = String(port)
process.env.PLAYWRIGHT_SERVER_PORT ??= String(port)
const build = process.env.GAMMA_LIGHT_BUILD ?? "/tmp/gamma-light-build"
export default defineConfig({
  testDir: ".",
  outputDir: "/tmp/gamma-light-results",
  snapshotPathTemplate: "{testDir}/snapshots/{arg}{ext}",
  timeout: 60_000,
  expect: { timeout: 15_000, toHaveScreenshot: { animations: "disabled" } },
  workers: 1,
  retries: 0,
  reporter: [["line"], ["json", { outputFile: "/tmp/gamma-light-report.json" }]],
  webServer: {
    command: `bun run serve -- --host 127.0.0.1 --port ${port} --strictPort --outDir ${build}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}`,
    locale: "ru-RU",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
})
