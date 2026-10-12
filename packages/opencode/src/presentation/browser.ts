// Playwright loads data and optional modules relative to its package directory.
// Keep it outside Bun's executable bundle; deployments can point to an installed
// package entry without adding Chromium or its runtime to every agent startup.
export async function chromium() {
  const source = process.env.GAMMA_PRESENTATION_PLAYWRIGHT_MODULE ?? "playwright"
  const runtime: typeof import("playwright") = await import(source)
  return runtime.chromium
}
