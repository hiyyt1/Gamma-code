import path from "node:path"
import { hash, unpack, pack, read } from "./files"
import { chartData, edit } from "./schema"

export async function inspect(bytes: Uint8Array) {
  const files = unpack(bytes)
  if (!files["ppt/presentation.xml"] || !files["[Content_Types].xml"]) throw new Error("invalid_pptx")
  const {
    loadPresentation,
    validatePresentation,
    getSlides,
    getSlideShapes,
    getSlidePartName,
    getSlideSize,
    getShapeId,
    getShapeName,
    getShapeKind,
    getShapeChartKind,
    getShapeText,
    getShapeBounds,
    getSlideNotes,
    getPresentationFonts,
    getPresentationTheme,
  } = await import("@office-kit/pptx")
  const pres = await loadPresentation(bytes)
  if (validatePresentation(pres).some((issue) => issue.severity === "error")) throw new Error("invalid_pptx_structure")
  const slides = getSlides(pres)
  if (!slides.length || slides.length > 40) throw new Error("slide_limit")
  const size = getSlideSize(pres)
  if (!size) throw new Error("missing_slide_size")
  return {
    size: { width: size.width / 914400, height: size.height / 914400 },
    fonts: getPresentationFonts(pres),
    theme: getPresentationTheme(pres),
    slides: slides.map((slide, index) => ({
      number: index + 1,
      part: getSlidePartName(slide),
      notes: getSlideNotes(slide),
      shapes: getSlideShapes(slide).map((shape) => ({
        id: getShapeId(shape),
        name: getShapeName(shape),
        kind: getShapeChartKind(shape) ? "chart" : getShapeKind(shape),
        text: getShapeText(shape),
        bounds: getShapeBounds(shape),
      })),
    })),
    parts: Object.keys(files).length,
    nativeText: slides.reduce(
      (total, slide) => total + getSlideShapes(slide).filter((shape) => getShapeText(shape)).length,
      0,
    ),
  }
}

export async function patch(bytes: Uint8Array, input: unknown, workspace: string) {
  const args = edit.parse(input)
  unpack(bytes)
  const {
    loadPresentation,
    savePresentation,
    getSlides,
    getSlidePartName,
    getSlideShapes,
    getShapeId,
    getShapeKind,
    getShapeText,
    setShapeText,
    setShapeImage,
    setShapeBounds,
    getSlideCharts,
    setChartSpec,
    inches,
  } = await import("@office-kit/pptx")
  const pres = await loadPresentation(bytes)
  const slides = getSlides(pres)
  const slide = slides[args.slide - 1]
  if (!slide) throw new Error("slide_not_found")
  const part = getSlidePartName(slide).replace(/^\//, "")
  for (const change of args.changes) {
    const shape = getSlideShapes(slide).find((shape) => getShapeId(shape) === change.shape)
    if (!shape) throw new Error("shape_not_found")
    if (change.type === "text") {
      const text = getShapeText(shape)
      const start = text.indexOf(change.find)
      if (start < 0 || text.indexOf(change.find, start + 1) >= 0) throw new Error("text_match_must_be_unique")
      setShapeText(shape, change.replace, {
        preserveFormatting: true,
        range: { start, end: start + change.find.length },
      })
    }
    if (change.type === "image") {
      if (getShapeKind(shape) !== "picture") throw new Error("unsupported_object")
      const image = await read(workspace, change.path, 10 * 1024 * 1024)
      requireImage(image)
      setShapeImage(shape, image)
    }
    if (change.type === "bounds") {
      if (!["shape", "picture", "text"].includes(getShapeKind(shape))) throw new Error("unsupported_object")
      setShapeBounds(shape, {
        x: inches(change.bounds.x),
        y: inches(change.bounds.y),
        w: inches(change.bounds.w),
        h: inches(change.bounds.h),
      })
    }
    if (change.type === "chart") {
      const chart = getSlideCharts(slide).find((chart) => getShapeId(chart.shape) === change.shape)
      if (!chart) throw new Error("unsupported_chart")
      const data = chartData.parse(JSON.parse((await read(workspace, `data/${change.dataset}.json`)).toString()).chart)
      if (change.kind === "pie" || change.kind === "doughnut") {
        if (data.series.length !== 1) throw new Error("pie_requires_one_series")
        setChartSpec(
          chart,
          change.kind === "pie"
            ? { kind: "pie", categories: data.categories, series: [data.series[0]] }
            : { kind: "doughnut", categories: data.categories, series: [data.series[0]] },
        )
      }
      if (change.kind !== "pie" && change.kind !== "doughnut") setChartSpec(chart, { kind: change.kind, ...data })
    }
  }
  const after = unpack(await savePresentation(pres))
  return preserve(
    bytes,
    after,
    part,
    args.slide,
    slides.filter((s) => s !== slide).map((s) => getSlidePartName(s).replace(/^\//, "")),
  )
}

export async function replaceSlide(bytes: Uint8Array, replacement: Uint8Array, number: number) {
  const before = unpack(bytes)
  const {
    loadPresentation,
    savePresentation,
    getSlides,
    getSlidePartName,
    getSlideShapes,
    clearSlideShapes,
    copyShape,
    copySlideBackground,
    getSlideSize,
  } = await import("@office-kit/pptx")
  const pres = await loadPresentation(bytes)
  const next = await loadPresentation(replacement)
  const slides = getSlides(pres)
  const slide = slides[number - 1]
  if (!slide || getSlides(next).length !== 1) throw new Error("single_slide_required")
  if (JSON.stringify(getSlideSize(pres)) !== JSON.stringify(getSlideSize(next)))
    throw new Error("replacement_canvas_mismatch")
  const part = getSlidePartName(slide).replace(/^\//, "")
  // Replacing an animated/unknown slide can invalidate timing and embedded
  // object references. Keep those intact and require a separate redesign file.
  if (
    /<(?:\w+:)?(?:timing|oleObj|contentPart|extLst)\b|diagramData|smartArt|<mc:AlternateContent/i.test(
      new TextDecoder().decode(before[part]),
    )
  )
    throw new Error("unsupported_slide_redesign_create_separate_deck")
  clearSlideShapes(slide)
  for (const shape of getSlideShapes(getSlides(next)[0])) copyShape(slide, shape)
  copySlideBackground(slide, getSlides(next)[0])
  return preserve(
    bytes,
    unpack(await savePresentation(pres)),
    part,
    number,
    slides.filter((s) => s !== slide).map((s) => getSlidePartName(s).replace(/^\//, "")),
  )
}

async function preserve(
  bytes: Uint8Array,
  after: Record<string, Uint8Array>,
  part: string,
  number: number,
  others: string[],
) {
  const before = unpack(bytes)
  const owned = dependencies(after, part)
  const originalOwned = dependencies(before, part)
  const shared = new Set(others.flatMap((name) => [...dependencies(before, name)]))
  for (const [name, content] of Object.entries(before)) {
    if (!name.endsWith(".rels") || owned.has(name) || originalOwned.has(name)) continue
    const owner = name.replace(/(^|\/)_(rels)\//, "$1").replace(/\.rels$/, "")
    for (const rel of relationships(content)) {
      if (rel.external) continue
      const target = rel.target.startsWith("/")
        ? rel.target.slice(1)
        : path.posix.normalize(path.posix.join(path.posix.dirname(owner), rel.target))
      if (/^ppt\/(media|charts|embeddings)\//.test(target)) shared.add(target)
    }
  }
  const changed = [...owned].filter(
    (name) => after[name] && (!before[name] || hash(before[name]) !== hash(after[name])),
  )
  if (changed.some((name) => shared.has(name))) throw new Error("shared_object_edit_requires_redesign")
  // office-kit may serialize unrelated parts. Only transplant the selected slide
  // and its exclusive media/chart dependencies into the ORIGINAL ZIP package.
  const output = { ...before, ...Object.fromEntries(changed.map((name) => [name, after[name]])) }
  const decoder = new TextDecoder()
  const originalTypes = decoder.decode(before["[Content_Types].xml"])
  const candidateTypes = decoder.decode(after["[Content_Types].xml"])
  const additions = [...candidateTypes.matchAll(/<(?:Default|Override)\b[^>]*\/>/g)]
    .map((m) => m[0])
    .filter((tag) => {
      const key = tag.match(/(?:PartName|Extension)="([^"]+)"/)?.[1]
      return key && !originalTypes.includes(`="${key}"`)
    })
  if (additions.length)
    output["[Content_Types].xml"] = new TextEncoder().encode(
      originalTypes.replace("</Types>", additions.join("") + "</Types>"),
    )
  const preserved = Object.keys(before).filter((name) => !changed.includes(name) && name !== "[Content_Types].xml")
  if (preserved.some((name) => hash(before[name]) !== hash(output[name]))) throw new Error("preservation_failed")
  const result = pack(output)
  await inspect(result)
  return {
    bytes: result,
    report: {
      slide: number,
      changed,
      preservedParts: preserved.length,
      sourceHash: hash(bytes),
      outputHash: hash(result),
    },
  }
}

function dependencies(files: Record<string, Uint8Array>, first: string) {
  const result = new Set<string>()
  const visit = (part: string) => {
    if (result.has(part) || !files[part]) return
    result.add(part)
    const rels = path.posix.join(path.posix.dirname(part), "_rels", path.posix.basename(part) + ".rels")
    if (!files[rels]) return
    result.add(rels)
    for (const rel of relationships(files[rels])) {
      if (rel.external) continue
      const target = rel.target
      const next = target.startsWith("/")
        ? target.slice(1)
        : path.posix.normalize(path.posix.join(path.posix.dirname(part), target))
      if (/^ppt\/(media|charts|embeddings)\//.test(next)) visit(next)
    }
  }
  visit(first)
  return result
}
export function relationships(bytes: Uint8Array) {
  return [...new TextDecoder().decode(bytes).matchAll(/<(?:[\w.-]+:)?Relationship\b[^>]*>/g)].map((match) => {
    const attrs = Object.fromEntries(
      [...match[0].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((attr) => [
        attr[1],
        (attr[2] ?? attr[3]).replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, (_, entity: string) => {
          if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16))
          if (entity.startsWith("#")) return String.fromCodePoint(Number(entity.slice(1)))
          return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[entity]
        }),
      ]),
    )
    if (!attrs.Target || !attrs.Type || !attrs.Id) throw new Error("invalid_relationship")
    return { target: attrs.Target, type: attrs.Type, external: attrs.TargetMode === "External" }
  })
}
export function requireImage(bytes: Uint8Array) {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "png"
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg"
  throw new Error("unsupported_image_use_png_or_jpeg")
}
