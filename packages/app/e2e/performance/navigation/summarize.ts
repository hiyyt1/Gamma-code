// Run with Bun from packages/app. Raw reports and traces are never rewritten.
import { readdir } from "node:fs/promises"

const evidence = "../../docs/audits/evidence/gamma-navigation-2026-10-12"
type Sample = {
  name: string
  iteration: number
  input: number
  click: number
  url: number
  dom: number
  ready: number
  usable: number
}
type Measurement = { profile: { name: string }; samples: Sample[]; checkpoints: unknown[]; resources: string[] }
type Report = { suites: { specs: { tests: { results: { attachments: { name: string; body?: string }[] }[] }[] }[] }[] }
type TraceEvent = { name: string; pid: number; tid: number; ts: number; dur?: number; args?: { name?: string } }
const stats = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b)
  if (!sorted.length) return { n: 0 }
  return {
    n: sorted.length,
    p50: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  }
}
const summary: Record<string, unknown> = {}
const rows: string[] = [
  "| Профиль / маршрут | DOM до | DOM после | Ready до | Ready после |",
  "|---|---:|---:|---:|---:|",
]
const measurements: Record<string, Measurement[]> = {}
for (const phase of ["before", "after"]) {
  const report = (await Bun.file(`${evidence}/${phase}-playwright.json`).json()) as Report
  measurements[phase] = report.suites.flatMap((suite) =>
    suite.specs.flatMap((spec) =>
      spec.tests.flatMap((test) =>
        test.results.flatMap((result) =>
          result.attachments
            .filter((item) => item.name === "measurements" && item.body)
            .map((item) => JSON.parse(Buffer.from(item.body!, "base64").toString()) as Measurement),
        ),
      ),
    ),
  )
  summary[phase] = measurements[phase].map((data) => ({
    profile: data.profile,
    stages: ["agents", "knowledge", "projects", "chat", "home"].map((name) => {
      const samples = data.samples.filter((item) => item.name === name)
      return {
        name,
        inputToCapture: stats(samples.map((x) => x.click - x.input)),
        captureToURL: stats(samples.map((x) => x.url - x.click)),
        captureToDOM: stats(samples.map((x) => x.dom - x.click)),
        DOMToReady: stats(samples.map((x) => x.ready - x.dom)),
        captureToReady: stats(samples.map((x) => x.ready - x.click)),
        first: samples[0],
        warmReady: stats(samples.slice(1).map((x) => x.ready - x.click)),
      }
    }),
    checkpoints: data.checkpoints,
    resources: data.resources,
  }))
}
const format = (values: number[]) => {
  const result = stats(values)
  if (!result.n) return "n/a"
  return [result.p50, result.p95, result.max].map((value) => value!.toFixed(1)).join(" / ")
}
for (const before of measurements.before) {
  const after = measurements.after.find((item) => item.profile.name === before.profile.name)!
  for (const name of ["agents", "knowledge", "projects", "chat", "home"]) {
    const left = before.samples.filter((x) => x.name === name)
    const right = after.samples.filter((x) => x.name === name)
    rows.push(
      `| ${before.profile.name} / ${name} | ${format(left.map((x) => x.dom - x.click))} | ${format(right.map((x) => x.dom - x.click))} | ${format(left.map((x) => x.ready - x.click))} | ${format(right.map((x) => x.ready - x.click))} |`,
    )
  }
}
const traces: unknown[] = []
const manifest: unknown[] = []
for (const phase of ["before", "after"]) {
  const directory = `/tmp/gamma-navigation-final-traces-${phase}`
  for (const file of await readdir(directory)) {
    if (!file.endsWith(".json")) continue
    const source = Bun.file(`${directory}/${file}`)
    const bytes = await source.arrayBuffer()
    manifest.push({
      phase,
      path: source.name,
      bytes: source.size,
      sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    })
    const data = JSON.parse(new TextDecoder().decode(bytes)) as { traceEvents: TraceEvent[] }
    const main = new Set(
      data.traceEvents
        .filter((x) => x.name === "thread_name" && x.args?.name === "CrRendererMain")
        .map((x) => `${x.pid}:${x.tid}`),
    )
    const events = data.traceEvents.filter((x) => main.has(`${x.pid}:${x.tid}`)).toSorted((a, b) => a.ts - b.ts)
    const clicks = events.filter((x) => x.name === "gamma-nav:click")
    const marks = events.filter((x) => x.name === "gamma-nav:dom" || x.name === "gamma-nav:ready" || x.name === "Paint")
    const spans = clicks.map((click, index) => {
      const end = clicks[index + 1]?.ts ?? Infinity
      const dom = marks.find((x) => x.name === "gamma-nav:dom" && x.ts >= click.ts && x.ts < end)
      const ready = marks.find((x) => x.name === "gamma-nav:ready" && x.ts >= click.ts && x.ts < end)
      const paint = dom && marks.find((x) => x.name === "Paint" && x.pid === click.pid && x.ts >= dom.ts && x.ts < end)
      return {
        route: ["agents", "knowledge", "projects", "chat", "home"][index % 5],
        start: click.ts,
        end: ready?.ts ?? click.ts,
        paintMs: paint ? (paint.ts - click.ts) / 1000 : undefined,
      }
    })
    const tasks = events.filter((x) => x.name === "RunTask" && x.dur! >= 50_000)
    const navigationTasks = tasks.filter((x) => spans.some((span) => x.ts <= span.end && x.ts + x.dur! >= span.start))
    traces.push({
      phase,
      file,
      clicks: clicks.length,
      longTasks: stats(tasks.map((x) => x.dur! / 1000)),
      navigationLongTasks: stats(navigationTasks.map((x) => x.dur! / 1000)),
      paint: ["agents", "knowledge", "projects", "chat", "home"].map((route) => ({
        route,
        ...stats(spans.filter((x) => x.route === route && x.paintMs !== undefined).map((x) => x.paintMs!)),
      })),
    })
  }
}
await Bun.write(`${evidence}/summary.json`, JSON.stringify(summary, null, 2) + "\n")
await Bun.write(`${evidence}/comparison.md`, rows.join("\n") + "\n")
await Bun.write(`${evidence}/traces-summary.json`, JSON.stringify(traces, null, 2) + "\n")
await Bun.write(`${evidence}/trace-manifest.json`, JSON.stringify(manifest, null, 2) + "\n")
