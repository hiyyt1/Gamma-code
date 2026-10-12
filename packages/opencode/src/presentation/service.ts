import path from "node:path"
import { mkdir, mkdtemp, rm, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import z from "zod"
import { hash, read, write, local, folders, run, unpack } from "./files"
import { manifest, outline, review, edit, type Manifest } from "./schema"
import { inspect, patch, replaceSlide, requireImage, relationships } from "./pptx"
import { generate } from "./generate"
import { compileHTML } from "./html"
import EXTRACTOR from "./extract.py.txt"
import { chromium } from "./browser"

export type Vision = {
  available: () => Promise<{ model: string; image: boolean }>
  analyse: (
    images: { number: number; bytes: Uint8Array }[],
    context: string,
    signal?: AbortSignal,
  ) => Promise<z.infer<typeof review> & { model: string }>
}
const busy = new Set<string>()
const renderer = { busy: false }
export async function exclusive<T>(key: string, operation: () => Promise<T>) {
  if (busy.has(key)) throw new Error("presentation_busy")
  busy.add(key)
  try {
    return await operation()
  } finally {
    busy.delete(key)
  }
}
export async function health(vision?: Vision) {
  const browser = await chromium().catch(() => undefined)
  return {
    libreoffice: !!Bun.which("libreoffice"),
    poppler: !!Bun.which("pdftoppm"),
    pdftotext: !!Bun.which("pdftotext"),
    python: !!Bun.which("python3"),
    fonts: !!Bun.which("fc-match"),
    chromium: browser ? await Bun.file(browser.executablePath()).exists() : false,
    vision: (await vision?.available().catch(() => ({ model: "", image: false }))) ?? { model: "", image: false },
    limits: { slides: 40, inputMiB: 50, reviewCycles: 3, simultaneousRenders: 1 },
  }
}
export async function create(directory: string, title: string, route: Manifest["route"], brief?: string) {
  const name = `presentation-${randomUUID()}`
  const root = path.join(directory, name)
  await mkdir(root, { mode: 0o700 })
  await folders(root, ["originals", "sources", "data", "assets", "renders", "qa", "history"])
  if (brief) await write(root, "sources/brief.md", brief)
  const state: Manifest = {
    schema: "gamma.presentation.v1",
    id: name,
    title,
    revision: 0,
    status: "draft",
    route,
    slides: [],
    reviewCycles: 0,
    reviewedHashes: [],
    reviewFailures: 0,
    warnings: [],
  }
  await save(root, state)
  return {
    workspace: name,
    directory: root,
    source: `${name}/sources/outline.json`,
    preview: `${name}/answer.presentation.json`,
    pathContract:
      "Author with write_source(workspace, name, content or edit), using a basename such as outline.json. Native read requires the project-relative workspace prefix or directory absolute path. Native write/edit are forbidden. Other MCP paths after workspace are workspace-relative.",
  }
}
export async function load(directory: string, workspace: string) {
  if (!/^presentation-[a-f0-9-]{36}$/.test(workspace)) throw new Error("invalid_workspace")
  const root = await local(directory, workspace)
  const state = manifest.parse(JSON.parse((await read(root, "answer.presentation.json")).toString()))
  if (state.reviewedHashes && !state.reviewedHashes.some((value) => value.startsWith("legacy-reserved-")))
    return { root, state }
  // Older manifests counted slide and deck reviews separately. Keep historical
  // budget reservations, but never count more cycles than exported revisions.
  const reports = await Promise.all(
    (await readdir(await local(root, "qa")))
      .filter((name) => /^(slides|deck)-review(?:-\d+)?\.json$/.test(name))
      .map(async (name) =>
        z
          .object({ hash: z.string(), revision: z.number().int() })
          .parse(JSON.parse((await read(root, `qa/${name}`, 2 * 1024 * 1024)).toString())),
      ),
  )
  const known = [
    ...new Set([
      ...(state.reviewedHashes ?? []).filter((value) => !value.startsWith("legacy-reserved-")),
      ...reports.map((report) => report.hash),
    ]),
  ].slice(-3)
  const lastReviewedRevision = reports.length ? Math.max(...reports.map((report) => report.revision)) : state.revision
  const count = Math.max(known.length, Math.min(state.reviewCycles, lastReviewedRevision, 3))
  const reviewedHashes = [
    ...known,
    ...Array.from({ length: count - known.length }, (_, index) => `legacy-reserved-${index}`),
  ]
  return { root, state: { ...state, reviewedHashes, reviewCycles: reviewedHashes.length } }
}
export const save = (root: string, state: Manifest) =>
  write(root, "answer.presentation.json", JSON.stringify(manifest.parse(state), null, 2))

export async function ingest(directory: string, workspace: string, file: string) {
  const { root } = await load(directory, workspace)
  const bytes = await read(directory, file)
  const extension = path.extname(file).toLowerCase()
  if (
    ![".pdf", ".docx", ".pptx", ".xlsx", ".csv", ".txt", ".md", ".markdown", ".png", ".jpg", ".jpeg"].includes(
      extension,
    )
  )
    throw new Error("unsupported_file")
  const name = `originals/${hash(bytes).slice(0, 16)}${extension}`
  await write(root, name, bytes)
  if (extension === ".pptx") return { source: name, untrusted: true, content: await inspect(bytes) }
  if ([".png", ".jpg", ".jpeg"].includes(extension)) {
    requireImage(bytes)
    return { source: name, untrusted: true, image: true }
  }
  if (extension === ".pdf") {
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("invalid_pdf")
    if (!Bun.which("pdftotext")) throw new Error("missing_pdftotext")
    const text = await run(["pdftotext", "-f", "1", "-l", "200", "-layout", path.join(root, name), "-"], root)
    return {
      source: name,
      untrusted: true,
      text: text.slice(0, 150000),
      truncated: text.length > 150000,
      pageLimit: 200,
      scope: "Text extraction covers at most the first 200 pages, not a guarantee that the entire PDF was read.",
    }
  }
  return { source: name, untrusted: true, content: await extract(root, { file: path.join(root, name) }) }
}

export async function aggregate(root: string, file: string, id: string, category: string, value: string, sheet = 1) {
  if (!/^[a-z0-9-]+$/.test(id) || !/\.(csv|xlsx)$/i.test(file)) throw new Error("invalid_dataset")
  const source = await read(root, file)
  const result = await extract(root, { file: await local(root, file), operation: "aggregate", category, value, sheet })
  const data: Record<string, unknown> = { ...result, source: file, sourceHash: hash(source), sheet }
  await write(root, `data/${id}.json`, JSON.stringify(data, null, 2))
  return data
}

async function extract(root: string, args: object) {
  const child = Bun.spawn(["python3", "-I", "-c", EXTRACTOR], {
    cwd: root,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH, LANG: "C.UTF-8" },
  })
  const timer = setTimeout(() => child.kill(), 30000)
  child.stdin.write(JSON.stringify(args))
  child.stdin.end()
  try {
    const [stdout, , code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    const output = JSON.parse(stdout || "{}")
    if (code !== 0) throw new Error(typeof output.error === "string" ? output.error : "extraction_failed")
    return output as Record<string, unknown>
  } finally {
    clearTimeout(timer)
  }
}

export async function build(root: string, state: Manifest, html?: string[]) {
  if (state.status !== "ready" && (state.reviewedHashes?.length ?? state.reviewCycles) >= 3)
    throw new Error("review_cycle_limit_return_draft")
  if (state.route === "edit" && state.pptx) throw new Error("existing_pptx_use_edit_or_create_separate_redesign")
  const source = JSON.parse((await read(root, "sources/outline.json", 2 * 1024 * 1024)).toString())
  const data = html ? await compileHTML(root, html, source) : outline.parse(source)
  // Recompute every chart from its immutable source rather than trusting edited JSON.
  await refreshData(
    root,
    data.slides.flatMap((slide) =>
      slide.elements.flatMap((element) => (element.type === "chart" ? [element.dataset] : [])),
    ),
  )
  const revision = state.revision + 1
  await save(root, { ...state, revision, status: "building", error: undefined, slides: [], pdf: undefined })
  const output = await generate(root, data)
  if (state.pptx) await write(root, `history/revision-${state.revision}.pptx`, await read(root, state.pptx))
  await write(root, `history/outline-${revision}.json`, JSON.stringify(data, null, 2))
  await write(root, "answer.pptx", output.bytes)
  const next: Manifest = {
    ...state,
    title: data.title,
    revision,
    status: "review_required",
    pptx: "answer.pptx",
    hash: hash(output.bytes),
    sourceHash: await sourceHash(root),
    slides: [],
    pdf: undefined,
    error: undefined,
    warnings: output.warnings,
    reviewCycles: state.status === "ready" ? 0 : state.reviewCycles,
    reviewedHashes: state.status === "ready" ? [] : state.reviewedHashes,
  }
  await save(root, next)
  return next
}

export async function editDeck(
  root: string,
  state: Manifest,
  source: string,
  changes: unknown,
  redesign?: { slide: number; source: string },
) {
  if (state.status !== "ready" && (state.reviewedHashes?.length ?? state.reviewCycles) >= 3)
    throw new Error("review_cycle_limit_return_draft")
  const original = await read(root, source)
  const replacement = redesign ? outline.parse(JSON.parse((await read(root, redesign.source)).toString())) : undefined
  await refreshData(
    root,
    replacement
      ? replacement.slides.flatMap((slide) =>
          slide.elements.flatMap((element) => (element.type === "chart" ? [element.dataset] : [])),
        )
      : edit.parse(changes).changes.flatMap((change) => (change.type === "chart" ? [change.dataset] : [])),
  )
  const output = redesign
    ? await replaceSlide(original, (await generate(root, replacement)).bytes, redesign.slide)
    : await patch(original, changes, root)
  if (state.pptx) await write(root, `history/revision-${state.revision}.pptx`, await read(root, state.pptx))
  await write(root, "answer.pptx", output.bytes)
  await write(root, `qa/edit-${state.revision + 1}.json`, JSON.stringify(output.report, null, 2))
  await write(root, `sources/edit-${state.revision + 1}.json`, JSON.stringify({ source, changes, redesign }, null, 2))
  const next: Manifest = {
    ...state,
    route: "edit",
    revision: state.revision + 1,
    status: "review_required",
    pptx: "answer.pptx",
    hash: hash(output.bytes),
    sourceHash: await sourceHash(root),
    slides: [],
    pdf: undefined,
    error: undefined,
    reviewCycles: state.status === "ready" ? 0 : state.reviewCycles,
    reviewedHashes: state.status === "ready" ? [] : state.reviewedHashes,
  }
  await save(root, next)
  return { ...next, preservation: output.report }
}

export async function render(root: string, state: Manifest, signal?: AbortSignal) {
  if (!state.pptx || !state.hash) throw new Error("build_required")
  if (!Bun.which("libreoffice")) throw new Error("missing_libreoffice")
  if (!Bun.which("pdftoppm")) throw new Error("missing_poppler")
  if (renderer.busy) throw new Error("renderer_busy_retry_later")
  renderer.busy = true
  const temp = await mkdtemp(path.join(tmpdir(), "gamma-presentation-"))
  try {
    const bytes = await read(root, state.pptx)
    if (hash(bytes) !== state.hash) throw new Error("stale_build")
    for (const [name, content] of Object.entries(unpack(bytes))) {
      if (/vbaProject|activeX|\.bin$/i.test(name)) throw new Error("active_content_render_forbidden")
      if (/\.rels$/.test(name)) {
        if (relationships(content).some((link) => link.external && !link.type.endsWith("/hyperlink")))
          throw new Error("external_resource_render_forbidden")
      }
    }
    const info = await inspect(bytes)
    await save(root, { ...state, status: "rendering", slides: [], pdf: undefined })
    await Bun.write(path.join(temp, "answer.pptx"), bytes)
    await run(
      [
        "libreoffice",
        `-env:UserInstallation=file://${temp}/lo-profile`,
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        temp,
        path.join(temp, "answer.pptx"),
      ],
      temp,
      signal,
    )
    const pdf = await read(temp, "answer.pdf")
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("invalid_rendered_pdf")
    await run(
      ["pdftoppm", "-png", "-scale-to", "1280", "-r", "96", path.join(temp, "answer.pdf"), path.join(temp, "slide")],
      temp,
      signal,
    )
    const images = (await readdir(temp))
      .filter((name) => /^slide-\d+\.png$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    if (images.length !== info.slides.length) throw new Error("render_count_mismatch")
    const target = `renders/${state.hash}`
    await folders(root, [target])
    const slides = []
    for (const [index, name] of images.entries()) {
      const image = await read(temp, name, 2 * 1024 * 1024)
      requireImage(image)
      await write(root, `${target}/${name}`, image)
      slides.push({ number: index + 1, image: `${target}/${name}`, sha256: hash(image) })
    }
    await write(root, "answer.pdf", pdf)
    const next: Manifest = { ...state, status: "review_required", slides, pdf: "answer.pdf", error: undefined }
    await write(root, `qa/structure-${state.revision}.json`, JSON.stringify(info, null, 2))
    await save(root, next)
    return next
  } finally {
    renderer.busy = false
    await rm(temp, { recursive: true, force: true })
  }
}

export async function visualReview(root: string, state: Manifest, vision: Vision, deck: boolean, signal?: AbortSignal) {
  if (!state.slides.length || !state.hash || !state.pptx || hash(await read(root, state.pptx)) !== state.hash)
    throw new Error("fresh_render_required")
  const filename = `qa/${deck ? "deck" : "slides"}-review.json`
  const cached = (await readdir(await local(root, "qa"))).includes(filename.slice(3))
    ? JSON.parse((await read(root, filename, 2 * 1024 * 1024)).toString())
    : undefined
  if (
    cached?.hash === state.hash &&
    cached.revision === state.revision &&
    typeof cached.passed === "boolean" &&
    Array.isArray(cached.evidence)
  ) {
    await save(root, { ...state, status: cached.passed ? "review_required" : "needs_changes", error: undefined })
    return cached
  }
  const reviewedHashes = [...new Set([...(state.reviewedHashes ?? []), state.hash])]
  if (reviewedHashes.length > 3 || state.reviewFailures >= 3) throw new Error("review_cycle_limit")
  const capability = await vision.available()
  if (!capability.image) throw new Error("vision_unavailable")
  const active: Manifest = {
    ...state,
    reviewedHashes,
    reviewCycles: reviewedHashes.length,
    status: "review_required",
    error: undefined,
  }
  await save(root, active)
  const info = await inspect(await read(root, state.pptx))
  const brief = (await readdir(await local(root, "sources"))).includes("brief.md")
    ? (await read(root, "sources/brief.md", 100000)).toString()
    : "No original request was recorded. Numeric claims without computed datasets or explicit source evidence must be flagged unless clearly labelled as illustrative assumptions."
  const datasets = await Promise.all(
    (await readdir(await local(root, "data")))
      .filter((name) => name.endsWith(".json"))
      .slice(0, 40)
      .map(async (name) => JSON.parse((await read(root, `data/${name}`, 1024 * 1024)).toString())),
  )
  const evidence = []
  for (let offset = 0; offset < state.slides.length; offset += deck ? 40 : 3) {
    const batch = state.slides.slice(offset, offset + (deck ? 40 : 3))
    const images = []
    for (const slide of batch) {
      const bytes = await read(root, slide.image, 2 * 1024 * 1024)
      if (hash(bytes) !== slide.sha256) throw new Error("stale_render")
      images.push({ number: slide.number, bytes })
    }
    if (images.reduce((size, image) => size + image.bytes.length, 0) > 12 * 1024 * 1024)
      throw new Error("vision_payload_limit")
    const result = await vision
      .analyse(
        images,
        JSON.stringify({
          scope: deck ? "deck consistency, narrative and visual hierarchy" : "individual slide defects",
          title: state.title,
          originalRequest: brief,
          computedDatasets: datasets,
          slides: info.slides.filter((slide) => batch.some((image) => image.number === slide.number)),
        }),
        signal,
      )
      .catch(async (error: unknown) => {
        await save(root, {
          ...active,
          status: "failed",
          reviewFailures: state.reviewFailures + 1,
          error: error instanceof Error ? error.message : "vision_failed",
        })
        throw error
      })
    if (result.findings.some((finding) => !batch.some((slide) => slide.number === finding.slide)))
      throw new Error("invalid_review_slide")
    if (result.verdict === "pass" && result.findings.some((finding) => finding.severity === "error"))
      throw new Error("inconsistent_review")
    evidence.push({ ...result, slides: batch.map((slide) => ({ number: slide.number, sha256: slide.sha256 })) })
  }
  const passed = evidence.every((result) => result.verdict === "pass")
  const result = { hash: state.hash, revision: state.revision, passed, evidence }
  await write(root, filename, JSON.stringify(result, null, 2))
  await write(root, filename.replace(".json", `-${state.revision}.json`), JSON.stringify(result, null, 2))
  await save(root, {
    ...active,
    status: passed ? "review_required" : "needs_changes",
    error: undefined,
    reviewFailures: 0,
  })
  return result
}

export async function finalize(root: string, state: Manifest) {
  if (!state.pptx || !state.hash || !state.slides.length) throw new Error("incomplete_presentation")
  if (hash(await read(root, state.pptx)) !== state.hash) throw new Error("stale_build")
  if (!state.sourceHash || (await sourceHash(root)) !== state.sourceHash)
    throw new Error("sources_changed_rebuild_required")
  const info = await inspect(await read(root, state.pptx))
  if (info.slides.length !== state.slides.length) throw new Error("render_count_mismatch")
  for (const name of ["slides", "deck"]) {
    const result = JSON.parse((await read(root, `qa/${name}-review.json`)).toString())
    if (result.hash !== state.hash || result.revision !== state.revision || result.passed !== true)
      throw new Error("visual_review_required")
    const evidence = z
      .array(
        review.extend({
          model: z.string().min(1),
          slides: z.array(z.object({ number: z.number().int(), sha256: z.string() })),
        }),
      )
      .parse(result.evidence)
    if (
      evidence.some(
        (item) => item.verdict !== "pass" || item.findings.some((finding) => finding.severity === "error"),
      ) ||
      state.slides.some(
        (slide) =>
          !evidence.some((item) =>
            item.slides.some((image) => image.number === slide.number && image.sha256 === slide.sha256),
          ),
      )
    )
      throw new Error("incomplete_visual_evidence")
  }
  for (const slide of state.slides)
    if (hash(await read(root, slide.image)) !== slide.sha256) throw new Error("stale_render")
  const next: Manifest = { ...state, status: "ready", error: undefined }
  await write(
    root,
    "qa/final-report.json",
    JSON.stringify(
      {
        complete: true,
        hash: state.hash,
        revision: state.revision,
        slides: info.slides.length,
        nativeTextObjects: info.nativeText,
        warnings: state.warnings,
        openedByLibreOffice: true,
        reviewed: true,
      },
      null,
      2,
    ),
  )
  await save(root, next)
  return next
}

async function sourceHash(root: string) {
  const entries: string[] = []
  const visit = async (directory: string) => {
    for (const entry of await readdir(await local(root, directory), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("symlink_forbidden")
      const name = `${directory}/${entry.name}`
      if (entry.isDirectory()) {
        await visit(name)
        continue
      }
      if (entries.length >= 500) throw new Error("source_file_limit")
      entries.push(`${name}:${hash(await read(root, name))}`)
    }
  }
  for (const directory of ["sources", "assets", "data"]) await visit(directory)
  return hash(entries.sort().join("\n"))
}

async function refreshData(root: string, ids: string[]) {
  for (const id of new Set(ids)) {
    const dataset = z
      .object({
        source: z.string(),
        sourceHash: z.string(),
        sheet: z.number(),
        columns: z.object({ category: z.string(), value: z.string() }),
      })
      .parse(JSON.parse((await read(root, `data/${id}.json`)).toString()))
    if (hash(await read(root, dataset.source)) !== dataset.sourceHash) throw new Error("data_source_changed")
    await aggregate(root, dataset.source, id, dataset.columns.category, dataset.columns.value, dataset.sheet)
  }
}
