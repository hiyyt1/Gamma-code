import { test, expect } from "bun:test"
import { mkdtemp, rm, symlink } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import {
  create,
  load,
  build,
  render,
  editDeck,
  ingest,
  aggregate,
  finalize,
  health,
  visualReview,
} from "../../src/presentation/service"
import { inspect, patch, replaceSlide } from "../../src/presentation/pptx"
import { read, write, unpack, pack, hash, local, run } from "../../src/presentation/files"
import { generate } from "../../src/presentation/generate"
import { compileHTML } from "../../src/presentation/html"
import { connect } from "../../src/presentation/mcp"
import { AgentCatalog } from "@opencode-ai/core/agent-market/catalog"

test("presentation bundle verifies every shipped skill and resource hash", async () => {
  const bundle = await AgentCatalog.bundle("presentation-creation")
  expect(bundle.skills).toHaveLength(8)
  expect(bundle.skills.map((skill) => skill.name)).toContain("pptagent")
})

const titles = [
  "ИИ в продажах: начните с измеримого пилота",
  "Сначала найдите узкое место",
  "Данные определяют качество результата",
  "Сравните текущий процесс и пилот",
  "Ассистент помогает подготовить контакт",
  "Менеджер сохраняет контроль",
  "Риски требуют конкретных ограничений",
  "Пилот проверяет гипотезу",
  "Масштабируйте подтверждённый результат",
  "Решение: назначить владельца пилота",
]
const deck = () => ({
  title: "ИИ в отделе продаж",
  audience: "Руководство",
  objective: "Принять решение о пилоте",
  direction: "Business Consulting",
  font: "Liberation Sans",
  slides: titles.map((title, index) => ({
    title,
    takeaway: title,
    notes: "Тестовый сценарий: фактические показатели не заявлены.",
    background: index % 3 === 0 ? "172B3A" : "FFFFFF",
    elements: [
      {
        type: "text",
        x: 0.6,
        y: 0.5,
        w: 12,
        h: 1.2,
        text: title,
        size: 32,
        bold: true,
        color: index % 3 === 0 ? "FFFFFF" : "172B3A",
      },
      ...Array.from({ length: (index % 3) + 1 }, (_, item) => ({
        type: "shape",
        shape: index % 2 ? "chevron" : "rect",
        x: 0.7 + item * 4,
        y: 2.4,
        w: 3.5,
        h: 1.4,
        color: "16697A",
      })),
      {
        type: "text",
        x: 0.7,
        y: 4.5,
        w: 11.5,
        h: 1.3,
        text: "Цель → данные → ответственный → проверка результата",
        size: 24,
        color: index % 3 === 0 ? "FFFFFF" : "172B3A",
      },
    ],
  })),
})
const absentVision = {
  available: async () => ({ model: "", image: false }),
  analyse: async () => {
    throw new Error("vision_unavailable")
  },
}

test("real ten-slide export, LibreOffice render, targeted office-kit edit and unchanged nine renders", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "presentation-integration-"))
  try {
    const created = await create(directory, "AI sales", "data")
    const { root, state } = await load(directory, created.workspace)
    await write(root, "sources/outline.json", JSON.stringify(deck()))
    const built = await build(root, state)
    const before = await read(root, "answer.pptx")
    const info = await inspect(before)
    expect(info.slides).toHaveLength(10)
    expect(info.nativeText).toBe(20)
    const rendered = await render(root, built)
    expect(rendered.slides).toHaveLength(10)
    expect(rendered.status).toBe("review_required")
    await expect(finalize(root, rendered)).rejects.toThrow()
    await expect(visualReview(root, rendered, absentVision, false)).rejects.toThrow("vision_unavailable")
    await expect(visualReview(root, { ...rendered, reviewFailures: 3 }, absentVision, false)).rejects.toThrow(
      "review_cycle_limit",
    )
    await write(root, "sources/outline.json", JSON.stringify({ ...deck(), title: "Changed after export" }))
    await expect(finalize(root, rendered)).rejects.toThrow("sources_changed_rebuild_required")
    await write(root, "sources/outline.json", JSON.stringify(deck()))
    const selected = info.slides[3].shapes.find((shape) => shape.text === titles[3])!
    const edited = await editDeck(root, rendered, "answer.pptx", {
      slide: 4,
      changes: [{ type: "text", shape: selected.id, find: titles[3], replace: "Пилот: сравните два процесса" }],
    })
    expect(edited.preservation.changed).toEqual(["ppt/slides/slide4.xml"])
    await expect(build(root, edited)).rejects.toThrow("existing_pptx_use_edit")
    const after = unpack(await read(root, "answer.pptx"))
    for (const [name, bytes] of Object.entries(unpack(before)))
      if (name !== "ppt/slides/slide4.xml") expect(hash(after[name])).toBe(hash(bytes))
    expect(
      (await inspect(await read(root, "answer.pptx"))).slides[3].shapes.some(
        (shape) => shape.text === "Пилот: сравните два процесса",
      ),
    ).toBe(true)
    const rerendered = await render(root, edited)
    for (const [index, slide] of rerendered.slides.entries()) {
      if (index === 3) expect(slide.sha256).not.toBe(rendered.slides[index].sha256)
      if (index !== 3) expect(slide.sha256).toBe(rendered.slides[index].sha256)
    }
    const pictures = await generate(root, {
      ...deck(),
      slides: [0, 1].map((index) => ({
        ...deck().slides[index],
        elements: [
          { type: "image", x: 1, y: 2, w: 4, h: 2.25, path: rendered.slides[index].image, alt: "Fixture preview" },
        ],
      })),
    })
    const picture = (await inspect(pictures.bytes)).slides[0].shapes[0]
    const swapped = await patch(
      pictures.bytes,
      {
        slide: 1,
        changes: [{ type: "image", shape: picture.id, path: rendered.slides[2].image }],
      },
      root,
    )
    expect(swapped.report.changed.some((name) => name.startsWith("ppt/media/"))).toBe(true)
    expect(hash(unpack(swapped.bytes)["ppt/slides/slide2.xml"])).toBe(
      hash(unpack(pictures.bytes)["ppt/slides/slide2.xml"]),
    )
    if (process.env.GAMMA_PRESENTATION_KEEP_TEST_OUTPUT === "1") console.log(`REAL_PRESENTATION_ARTIFACTS=${root}`)
  } finally {
    if (process.env.GAMMA_PRESENTATION_KEEP_TEST_OUTPUT !== "1") await rm(directory, { recursive: true, force: true })
  }
}, 120000)

test("real XLSX decimal aggregation, native chart and fourth-slide chart edit preserve other parts", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "presentation-data-"))
  try {
    const created = await create(directory, "Sales", "data")
    const { root, state } = await load(directory, created.workspace)
    const xml = new TextEncoder()
    const files = {
      "[Content_Types].xml": xml.encode(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ),
      "_rels/.rels": xml.encode(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="xl/workbook.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/></Relationships>',
      ),
      "xl/workbook.xml": xml.encode(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": xml.encode(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>',
      ),
      "xl/worksheets/sheet1.xml": xml.encode(
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Month</t></is></c><c r="B1" t="inlineStr"><is><t>Sales</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>January</t></is></c><c r="B2"><v>100.10</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>January</t></is></c><c r="B3"><v>200.20</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>February</t></is></c><c r="B4"><v>450.50</v></c></row></sheetData></worksheet>',
      ),
    }
    await write(directory, "sales.xlsx", pack(files))
    await run(
      [
        "libreoffice",
        `-env:UserInstallation=file://${directory}/lo-profile`,
        "--headless",
        "--convert-to",
        "csv",
        "--outdir",
        directory,
        path.join(directory, "sales.xlsx"),
      ],
      directory,
    )
    expect((await read(directory, "sales.csv")).toString()).toContain("January,100.1")
    const imported = await ingest(directory, created.workspace, "sales.xlsx")
    const data = await aggregate(root, imported.source, "sales", "Month", "Sales")
    expect(data.exact).toEqual({ January: "300.30", February: "450.50" })
    expect(data.total).toBe("750.80")
    await write(root, "originals/precision.csv", "Month,Sales\nJanuary,0.10000000000000000001\n")
    await expect(aggregate(root, "originals/precision.csv", "precision", "Month", "Sales")).rejects.toThrow(
      "chart_precision_loss",
    )
    const source = deck()
    const chart = { type: "chart", x: 0.8, y: 2, w: 11, h: 4.8, kind: "bar", dataset: "sales", title: "Продажи" }
    const outline = {
      ...source,
      slides: source.slides.map((slide, index) =>
        index === 3 ? { ...slide, elements: [slide.elements[0], chart] } : slide,
      ),
    }
    await write(root, "sources/outline.json", JSON.stringify(outline))
    const built = await build(root, state)
    const bytes = await read(root, "answer.pptx")
    const info = await inspect(bytes)
    const shape = info.slides[3].shapes.find((shape) => shape.kind === "chart")!
    expect(shape).toBeDefined()
    const xmlChart = new TextDecoder().decode(unpack(bytes)["ppt/charts/chart1.xml"])
    expect(xmlChart).toContain("300.3")
    expect(xmlChart).toContain("450.5")
    const originalRender = await render(root, built)
    await write(root, "originals/new-sales.csv", "Month,Sales\nJanuary,310.30\nFebruary,470.50\n")
    await aggregate(root, "originals/new-sales.csv", "updated", "Month", "Sales")
    const edited = await editDeck(root, built, "answer.pptx", {
      slide: 4,
      changes: [
        { type: "text", shape: info.slides[3].shapes[0].id, find: titles[3], replace: "Продажи: обновлённые данные" },
        { type: "chart", shape: shape.id, dataset: "updated", kind: "line" },
      ],
    })
    expect(edited.preservation.changed.some((name) => name.startsWith("ppt/charts/"))).toBe(true)
    const after = unpack(await read(root, "answer.pptx"))
    for (const index of [1, 2, 3, 5, 6, 7, 8, 9, 10])
      expect(hash(after[`ppt/slides/slide${index}.xml`])).toBe(hash(unpack(bytes)[`ppt/slides/slide${index}.xml`]))
    const { loadPresentation, getSlides, getSlideCharts } = await import("@office-kit/pptx")
    const parsed = await loadPresentation(await read(root, "answer.pptx"))
    expect(getSlideCharts(getSlides(parsed)[3])[0].spec?.series[0].values).toEqual([310.3, 470.5])
    const rendered = await render(root, edited)
    expect(rendered.slides).toHaveLength(10)
    for (const index of [0, 1, 2, 4, 5, 6, 7, 8, 9])
      expect(rendered.slides[index].sha256).toBe(originalRender.slides[index].sha256)
    expect(rendered.slides[3].sha256).not.toBe(originalRender.slides[3].sha256)
    if (process.env.GAMMA_PRESENTATION_KEEP_TEST_OUTPUT === "1") console.log(`DATA_PRESENTATION_ARTIFACTS=${root}`)
  } finally {
    if (process.env.GAMMA_PRESENTATION_KEEP_TEST_OUTPUT !== "1") await rm(directory, { recursive: true, force: true })
  }
}, 120000)

test("PPTAgent HTML route exports native objects and rejects remote/unsupported content", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "presentation-html-"))
  try {
    const created = await create(directory, "HTML", "pptagent")
    const { root, state } = await load(directory, created.workspace)
    await write(root, "sources/outline.json", JSON.stringify({ ...deck(), slides: undefined }))
    const html =
      '<html><head><title>Editable strategy</title><style>body{margin:0;width:1280px;height:720px;position:relative;background:#fff}p{position:absolute;margin:0;color:#172b3a;font-family:"Liberation Sans"}</style></head><body><p data-pptx="text" style="left:60px;top:60px;width:1100px;height:100px;font-size:48px">Editable strategy</p><div data-pptx="shape" style="position:absolute;left:60px;top:240px;width:900px;height:12px;background:#16697a"></div></body></html>'
    await write(root, "sources/slide01.html", html)
    await expect(compileHTML(root, ["sources/slide01.html"], deck())).rejects.toThrow("html_slide_count")
    const compiled = await compileHTML(root, ["sources/slide01.html"], { ...deck(), slides: [deck().slides[0]] })
    expect(compiled.slides[0].notes).toBe(deck().slides[0].notes)
    const built = await build(root, state, ["sources/slide01.html"])
    expect((await inspect(await read(root, "answer.pptx"))).nativeText).toBe(1)
    expect((await render(root, built)).slides).toHaveLength(1)
    await write(
      root,
      "sources/bad.html",
      html.replace("<body>", '<body><script src="http://127.0.0.1/">fetch("/secret")</script>'),
    )
    await expect(compileHTML(root, ["sources/bad.html"], { ...deck(), slides: [deck().slides[0]] })).rejects.toThrow(
      "unsafe_or_unsupported_html",
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60000)

test("corrupt/partial PPTX, fonts, bounds, path escapes and unsupported objects fail explicitly", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "presentation-negative-"))
  try {
    await expect(inspect(new Uint8Array([1, 2, 3]))).rejects.toThrow()
    const valid = await generate(directory, deck())
    await expect(inspect(valid.bytes.subarray(0, 100))).rejects.toThrow()
    await expect(generate(directory, { ...deck(), font: "GammaMissingFont987654" })).rejects.toThrow("missing_font")
    await expect(
      generate(directory, { ...deck(), slides: Array.from({ length: 41 }, () => deck().slides[0]) }),
    ).rejects.toThrow()
    await expect(
      generate(directory, {
        ...deck(),
        slides: [{ ...deck().slides[0], elements: [{ type: "text", x: 12, y: 1, w: 10, h: 1, text: "Outside" }] }],
      }),
    ).rejects.toThrow("out_of_bounds")
    await expect(local(directory, "../etc/passwd")).rejects.toThrow("invalid_path")
    await symlink("/tmp", path.join(directory, "escape"))
    await expect(local(directory, "escape/test")).rejects.toThrow("symlink_forbidden")
    await expect(
      patch(
        valid.bytes,
        {
          slide: 1,
          changes: [{ type: "image", shape: (await inspect(valid.bytes)).slides[0].shapes[0].id, path: "x.png" }],
        },
        directory,
      ),
    ).rejects.toThrow("unsupported_object")
    expect((await health()).libreoffice).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60000)

test("actual MCP protocol exposes scoped tools and fails after profile change", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "presentation-mcp-"))
  const active = { value: true }
  const connection = await connect(
    directory,
    async () => {
      if (!active.value) throw new Error("profile_changed")
    },
    absentVision,
  )
  try {
    expect(connection.definitions.map((tool) => tool.name)).toContain("review_slides")
    const result = await connection.client.callTool({ name: "create", arguments: { title: "MCP" } })
    expect(result.isError).not.toBe(true)
    const content = result.content as { type: string; text: string }[]
    const workspace = JSON.parse(content[0].text).workspace as string
    const authored = await connection.client.callTool({
      name: "write_source",
      arguments: { workspace, name: "outline.json", content: JSON.stringify(deck()) },
    })
    expect(authored.isError).not.toBe(true)
    expect(JSON.parse((await read(directory, `${workspace}/sources/outline.json`)).toString()).slides).toHaveLength(10)
    const corrected = await connection.client.callTool({
      name: "write_source",
      arguments: {
        workspace,
        name: "outline.json",
        edit: { find: JSON.stringify(titles[0]), replace: JSON.stringify("Corrected title") },
      },
    })
    // This title occurs in title/takeaway/text: ambiguous replacements must fail.
    expect(corrected.isError).toBe(true)
    await connection.client.callTool({
      name: "write_source",
      arguments: { workspace, name: "story.md", content: "First\nSecond\n" },
    })
    const patched = await connection.client.callTool({
      name: "write_source",
      arguments: { workspace, name: "story.md", edit: { find: "Second", replace: "$& revised" } },
    })
    expect(patched.isError).not.toBe(true)
    expect((await read(directory, `${workspace}/sources/story.md`)).toString()).toBe("First\n$& revised\n")
    const invalid = await connection.client.callTool({
      name: "write_source",
      arguments: { workspace, name: "outline.json", edit: { find: '{"title":', replace: "{invalid:" } },
    })
    expect(invalid.isError).toBe(true)
    expect(JSON.parse((await read(directory, `${workspace}/sources/outline.json`)).toString()).slides).toHaveLength(10)
    const escape = await connection.client.callTool({
      name: "write_source",
      arguments: { workspace, name: "../qa/slides-review.json", content: "{}" },
    })
    expect(escape.isError).toBe(true)
    active.value = false
    const blocked = await connection.client.callTool({ name: "health", arguments: {} })
    expect(blocked.isError).toBe(true)
  } finally {
    await connection.client.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("corporate template editing preserves theme, fonts, canvas and notes; single-slide redesign preserves nine slides", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "presentation-brand-"))
  try {
    const original = await generate(directory, deck())
    const info = await inspect(original.bytes)
    const updated = await patch(
      original.bytes,
      {
        slide: 1,
        changes: [
          { type: "text", shape: info.slides[0].shapes[0].id, find: titles[0], replace: "Корпоративный пилот ИИ" },
        ],
      },
      directory,
    )
    const styled = await inspect(updated.bytes)
    expect(styled.size).toEqual(info.size)
    expect(styled.fonts).toEqual(info.fonts)
    expect(styled.theme).toEqual(info.theme)
    expect(styled.slides.map((slide) => slide.notes)).toEqual(info.slides.map((slide) => slide.notes))
    const replacement = await generate(directory, {
      ...deck(),
      slides: [
        {
          ...deck().slides[3],
          elements: [
            deck().slides[3].elements[0],
            { type: "shape", shape: "rightArrow", x: 1, y: 3, w: 4, h: 1, color: "16697A" },
            { type: "shape", shape: "rightArrow", x: 6, y: 3, w: 4, h: 1, color: "E58F65" },
          ],
        },
      ],
    })
    const redesigned = await replaceSlide(original.bytes, replacement.bytes, 4)
    const before = unpack(original.bytes)
    const after = unpack(redesigned.bytes)
    for (const [name, bytes] of Object.entries(before))
      if (!redesigned.report.changed.includes(name) && name !== "[Content_Types].xml")
        expect(hash(after[name])).toBe(hash(bytes))
    const revised = await inspect(redesigned.bytes)
    expect(revised.slides).toHaveLength(10)
    expect(revised.slides[3].shapes.filter((shape) => shape.text).map((shape) => shape.text)).toEqual([titles[3]])
    expect(revised.slides[3].notes).toEqual(info.slides[3].notes)
    const unknown = unpack(original.bytes)
    unknown["ppt/slides/slide4.xml"] = new TextEncoder().encode(
      new TextDecoder()
        .decode(unknown["ppt/slides/slide4.xml"])
        .replace("</p:sld>", '<p:extLst><p:ext uri="gamma-unknown"/></p:extLst></p:sld>'),
    )
    await expect(replaceSlide(pack(unknown), replacement.bytes, 4)).rejects.toThrow("unsupported_slide_redesign")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60000)

test("full redesign retains all source titles, numbers and notes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "presentation-redesign-"))
  try {
    const source = deck()
    const old = await inspect((await generate(directory, source)).bytes)
    const redesigned = {
      ...source,
      direction: "Editorial Minimal",
      slides: source.slides.map((slide) => ({
        ...slide,
        background: "FFFFFF",
        elements: slide.elements.map((element) =>
          element.type === "text" ? { ...element, color: "172B3A", x: 0.8 } : { ...element, color: "DDDDDD" },
        ),
      })),
    }
    const next = await inspect((await generate(directory, redesigned)).bytes)
    expect(next.slides.map((slide) => slide.shapes.map((shape) => shape.text).filter(Boolean))).toEqual(
      old.slides.map((slide) => slide.shapes.map((shape) => shape.text).filter(Boolean)),
    )
    expect(next.slides.map((slide) => slide.notes)).toEqual(old.slides.map((slide) => slide.notes))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("missing system dependencies are real failures in an isolated PATH", async () => {
  const service = path.resolve(import.meta.dir, "../../src/presentation/service.ts")
  const code = `const {health,render}=await import(${JSON.stringify(service)}); console.log(JSON.stringify(await health())); await render('/tmp',{pptx:'answer.pptx',hash:'x'}).catch(e=>console.log(e.message))`
  const child = Bun.spawn([process.execPath, "-e", code], {
    env: { PATH: "/nonexistent" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = await new Response(child.stdout).text()
  expect(await child.exited).toBe(0)
  expect(output).toContain('"libreoffice":false')
  expect(output).toContain('"image":false')
  expect(output).toContain("missing_libreoffice")
})

test("review budget counts exported versions and retains failed review evidence without re-running vision", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "presentation-review-budget-"))
  try {
    const created = await create(directory, "Review budget", "data")
    const loaded = await load(directory, created.workspace)
    const root = loaded.root
    await write(root, "sources/outline.json", JSON.stringify({ ...deck(), slides: [deck().slides[0]] }))
    const first = await render(root, await build(root, loaded.state))
    // Legacy FAILED-report fixtures exercise migration/cache only. They never
    // assert visual approval or pretend that a model analysed these images.
    const report = (state: typeof first) =>
      JSON.stringify({ hash: state.hash, revision: state.revision, passed: false, evidence: [] })
    await write(root, "qa/slides-review.json", report(first))
    await write(root, "qa/deck-review.json", report(first))
    await write(
      root,
      "answer.presentation.json",
      JSON.stringify({ ...first, reviewCycles: 2, reviewedHashes: undefined }),
    )
    const migrated = (await load(directory, created.workspace)).state
    expect(migrated.reviewCycles).toBe(1)
    expect(migrated.reviewedHashes).toEqual([first.hash!])
    expect((await visualReview(root, migrated, absentVision, false)).passed).toBe(false)
    expect((await load(directory, created.workspace)).state.reviewCycles).toBe(1)
    const shape = (await inspect(await read(root, "answer.pptx"))).slides[0].shapes[0]
    const second = await render(
      root,
      await editDeck(root, migrated, "answer.pptx", {
        slide: 1,
        changes: [{ type: "text", shape: shape.id, find: titles[0], replace: "Second version" }],
      }),
    )
    await write(root, "qa/slides-review.json", report(second))
    await write(
      root,
      "answer.presentation.json",
      JSON.stringify({ ...second, revision: second.revision + 1, reviewCycles: 3, reviewedHashes: undefined }),
    )
    const next = (await load(directory, created.workspace)).state
    expect(next.reviewCycles).toBe(2)
    expect(next.reviewedHashes).toHaveLength(2)
    // Deck review of the last allowed version remains permitted; a fourth
    // distinct version is blocked before contacting any provider.
    await expect(
      visualReview(
        root,
        { ...next, reviewCycles: 3, reviewedHashes: [...next.reviewedHashes!, "legacy-reserved-0"] },
        absentVision,
        true,
      ),
    ).rejects.toThrow("vision_unavailable")
    await expect(
      visualReview(root, { ...next, reviewedHashes: ["legacy-1", "legacy-2", "legacy-3"] }, absentVision, true),
    ).rejects.toThrow("review_cycle_limit")
    const exhausted = { ...next, reviewedHashes: ["legacy-1", "legacy-2", "legacy-3"] }
    await expect(build(root, exhausted)).rejects.toThrow("review_cycle_limit_return_draft")
    await expect(editDeck(root, exhausted, "answer.pptx", {})).rejects.toThrow("review_cycle_limit_return_draft")
    expect(hash(await read(root, "answer.pptx"))).toBe(second.hash!)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60000)
