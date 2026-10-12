import z from "zod"

export const color = z.string().regex(/^[\da-fA-F]{6}$/)
export const box = z.object({
  x: z.number().min(0).max(30),
  y: z.number().min(0).max(30),
  w: z.number().positive().max(30),
  h: z.number().positive().max(30),
})
const text = box.extend({
  type: z.literal("text"),
  text: z.string().max(5000),
  size: z.number().min(10).max(120).default(24),
  color: color.default("172B3A"),
  bold: z.boolean().default(false),
  align: z.enum(["left", "center", "right"]).default("left"),
})
const shape = box.extend({
  type: z.literal("shape"),
  shape: z.enum(["rect", "ellipse", "line", "chevron", "roundRect", "rightArrow"]).default("rect"),
  color,
  line: color.optional(),
})
const image = box.extend({ type: z.literal("image"), path: z.string().max(500), alt: z.string().max(500) })
export const chartData = z
  .object({
    categories: z.array(z.string().max(200)).min(1).max(100),
    series: z
      .array(z.object({ name: z.string().max(100), values: z.array(z.number().finite()).min(1).max(100) }))
      .min(1)
      .max(12),
  })
  .superRefine((data, ctx) => {
    if (data.series.some((series) => series.values.length !== data.categories.length))
      ctx.addIssue({ code: "custom", message: "Chart categories and values must have equal length" })
  })
// Data charts reference a saved, deterministic dataset; arbitrary LLM-authored numbers are not accepted.
const chart = box.extend({
  type: z.literal("chart"),
  kind: z.enum(["bar", "line", "pie", "doughnut", "area"]).default("bar"),
  dataset: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().max(200).default(""),
})
const table = box.extend({
  type: z.literal("table"),
  rows: z
    .array(z.array(z.string().max(500)).min(1).max(12))
    .min(1)
    .max(30),
  size: z.number().min(12).max(32).default(18),
})
export const element = z.discriminatedUnion("type", [text, shape, image, chart, table])
export const outline = z.object({
  title: z.string().min(1).max(200),
  audience: z.string().max(1000),
  objective: z.string().max(1000),
  direction: z.enum([
    "Editorial Minimal",
    "Business Consulting",
    "Tech Premium",
    "Visual Storytelling",
    "Corporate",
    "Data-driven",
  ]),
  font: z.string().min(1).max(100).default("Liberation Sans"),
  width: z.number().min(5).max(20).default(13.333333),
  height: z.number().min(4).max(20).default(7.5),
  slides: z
    .array(
      z.object({
        title: z.string().max(300),
        takeaway: z.string().max(1000),
        sources: z.array(z.string().max(500)).default([]),
        notes: z.string().max(5000).default(""),
        background: color.default("FFFFFF"),
        elements: z.array(element).min(1).max(80),
      }),
    )
    .min(1)
    .max(40),
})
export const edit = z.object({
  slide: z.number().int().min(1).max(40),
  changes: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("text"),
          shape: z.number().int(),
          find: z.string().min(1).max(5000),
          replace: z.string().max(5000),
        }),
        z.object({ type: z.literal("image"), shape: z.number().int(), path: z.string().max(500) }),
        z.object({ type: z.literal("bounds"), shape: z.number().int(), bounds: box }),
        z.object({
          type: z.literal("chart"),
          shape: z.number().int(),
          dataset: z.string().regex(/^[a-z0-9-]+$/),
          kind: z.enum(["bar", "column", "line", "pie", "doughnut", "area"]).default("column"),
        }),
      ]),
    )
    .min(1)
    .max(80),
})
export const finding = z.object({
  slide: z.number().int().min(1),
  severity: z.enum(["error", "warning"]),
  check: z.enum(["overflow", "bounds", "overlap", "readability", "contrast", "hierarchy", "data", "consistency"]),
  detail: z.string().min(1).max(1000),
})
export const review = z.object({
  verdict: z.enum(["pass", "fail"]),
  summary: z.string().min(20).max(3000),
  findings: z.array(finding).max(150),
})
export const manifest = z.object({
  schema: z.literal("gamma.presentation.v1"),
  id: z.string(),
  title: z.string(),
  revision: z.number().int(),
  status: z.enum(["draft", "building", "rendering", "review_required", "needs_changes", "ready", "failed"]),
  route: z.enum(["pptagent", "data", "edit"]),
  slides: z.array(z.object({ number: z.number(), image: z.string(), sha256: z.string() })),
  pptx: z.string().optional(),
  pdf: z.string().optional(),
  hash: z.string().optional(),
  error: z.string().optional(),
  sourceHash: z.string().optional(),
  reviewCycles: z.number().int().default(0),
  reviewedHashes: z.array(z.string()).max(3).optional(),
  reviewFailures: z.number().int().default(0),
  warnings: z.array(z.string()).default([]),
})
export type Manifest = z.infer<typeof manifest>
