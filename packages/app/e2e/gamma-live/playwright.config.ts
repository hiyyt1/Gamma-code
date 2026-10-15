import { defineConfig, devices } from "@playwright/test"

// Explicit opt-in against an already running, isolated local Gamma. No mocked APIs.
export default defineConfig({
  testDir: ".",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  outputDir: "/tmp/gamma-live-results",
  reporter: [["line"], ["json", { outputFile: "/tmp/gamma-live-report.json" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.GAMMA_LIVE_URL,
    storageState: process.env.GAMMA_LIVE_STORAGE,
    locale: "ru-RU",
    actionTimeout: 15_000,
    trace: "off",
    screenshot: "only-on-failure",
  },
})
