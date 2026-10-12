import config from '/home/nikita/menti/mvp_platform/packages/app/e2e/performance/playwright.config.ts'
export default {
  ...config,
  testDir: '/home/nikita/menti/mvp_platform/packages/app/e2e/performance',
  outputDir: '/tmp/gamma-audit-playwright-results',
  reporter: [['line']],
  webServer: {
    ...config.webServer,
    command: 'bun run serve -- --host 127.0.0.1 --port 4517 --strictPort --outDir /tmp/gamma-performance-audit-build',
    cwd: '/home/nikita/menti/mvp_platform/packages/app',
    url: 'http://127.0.0.1:4517',
    reuseExistingServer: false,
  },
  use: {...config.use, baseURL: 'http://127.0.0.1:4517', video: 'off'},
}
