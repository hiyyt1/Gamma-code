import { outline, chartData } from "./schema"
import { read, run } from "./files"
import { inspect, requireImage } from "./pptx"

export async function generate(workspace: string, input: unknown) {
  const data = outline.parse(input)
  const { default: PptxGenJS } = await import("pptxgenjs")
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: "GAMMA", width: data.width, height: data.height })
  pptx.layout = "GAMMA"
  pptx.title = data.title
  pptx.author = "Gamma"
  pptx.subject = data.objective
  pptx.theme = { headFontFace: data.font, bodyFontFace: data.font }
  const warnings: string[] = []
  const resources = { bytes: 0 }
  if (!Bun.which("fc-match")) warnings.push("font_check_unavailable")
  if (Bun.which("fc-match")) {
    const matched = await run(["fc-match", "-f", "%{family}", data.font], workspace)
    if (
      !matched
        .split(",")
        .map((font) => font.toLowerCase())
        .includes(data.font.toLowerCase())
    )
      throw new Error(`missing_font:${data.font}`)
  }
  for (const [index, source] of data.slides.entries()) {
    const slide = pptx.addSlide()
    slide.background = { color: source.background }
    slide.addNotes([source.notes, "Sources: " + source.sources.join("; ")].join("\n"))
    for (const element of source.elements) {
      if (element.x + element.w > data.width + 0.01 || element.y + element.h > data.height + 0.01)
        throw new Error(`out_of_bounds:slide_${index + 1}`)
      const position = { x: element.x, y: element.y, w: element.w, h: element.h }
      if (element.type === "text") {
        slide.addText(element.text, {
          ...position,
          fontFace: data.font,
          fontSize: element.size,
          color: element.color,
          bold: element.bold,
          align: element.align,
          margin: 0,
          breakLine: false,
          valign: "top",
        })
        if (element.size < 18) warnings.push(`small_text:slide_${index + 1}`)
      }
      if (element.type === "shape")
        slide.addShape(pptx.ShapeType[element.shape], {
          ...position,
          fill: { color: element.color },
          line: { color: element.line ?? element.color },
        })
      if (element.type === "table")
        slide.addTable(
          element.rows.map((row) => row.map((text) => ({ text }))),
          {
            ...position,
            fontFace: data.font,
            fontSize: element.size,
            color: "172B3A",
            border: { color: "CDD5DB", pt: 0.5 },
            margin: 0.08,
            autoPage: false,
          },
        )
      if (element.type === "image") {
        const bytes = await read(workspace, element.path, 10 * 1024 * 1024)
        resources.bytes += bytes.length
        if (resources.bytes > 50 * 1024 * 1024) throw new Error("deck_image_budget_exceeded")
        const mime = requireImage(bytes)
        slide.addImage({ ...position, data: `image/${mime};base64,${bytes.toString("base64")}`, altText: element.alt })
      }
      if (element.type === "chart") {
        const dataset = chartData.parse(
          JSON.parse((await read(workspace, `data/${element.dataset}.json`)).toString()).chart,
        )
        slide.addChart(
          pptx.ChartType[element.kind],
          dataset.series.map((series) => ({ name: series.name, labels: dataset.categories, values: series.values })),
          {
            ...position,
            title: element.title,
            showTitle: !!element.title,
            showLegend: dataset.series.length > 1,
            catAxisLabelFontSize: 16,
            valAxisLabelFontSize: 14,
            showValue: true,
            chartColors: ["16697A", "E58F65", "536878", "A5BE00"],
            fontFace: data.font,
          },
        )
      }
    }
  }
  const bytes = Buffer.from((await pptx.write({ outputType: "nodebuffer" })) as ArrayBuffer)
  const info = await inspect(bytes)
  if (info.slides.length !== data.slides.length) throw new Error("slide_count_mismatch")
  return { bytes, warnings, info }
}
