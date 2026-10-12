import path from "node:path"
import { read } from "./files"
import { outline } from "./schema"
import { chromium } from "./browser"

// PPTAgent's host-authored HTML workflow, with an intentionally small native
// PowerPoint vocabulary. Unsupported CSS is rejected rather than rasterized.
export async function compileHTML(workspace: string, files: string[], brief: unknown) {
  if (!files.length || files.length > 40) throw new Error("slide_limit")
  const metadata = outline
    .pick({ title: true, audience: true, objective: true, direction: true, font: true })
    .parse(brief)
  const notes = outline
    .pick({ slides: true })
    .shape.slides.element.pick({ notes: true, sources: true })
    .array()
    .parse(typeof brief === "object" && brief !== null && "slides" in brief ? (brief.slides ?? []) : [])
  if (notes.length && notes.length !== files.length)
    throw new Error("html_slide_count_must_match_outline_pass_all_slides_in_order")
  const browser = await (await chromium()).launch({ headless: true })
  try {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1280, height: 720 },
      serviceWorkers: "block",
    })
    await context.route("**/*", (route) => route.abort())
    const slides = []
    for (const filename of files) {
      const source = (await read(workspace, filename, 512 * 1024)).toString()
      if (
        /<(?:script|iframe|object|embed|link|svg|canvas|video|audio)\b|@import|url\s*\(|\bon\w+\s*=|(?:src|href)\s*=\s*["'](?:https?:|file:|data:|\/)/i.test(
          source,
        )
      )
        throw new Error("unsafe_or_unsupported_html")
      const page = await context.newPage()
      await page.setContent(source, { waitUntil: "domcontentloaded" })
      const extracted = await page
        .evaluate((font) => {
          const rgb = (value: string) => {
            const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/)
            if (!match || (match[4] !== undefined && Number(match[4]) !== 1)) throw new Error("unsupported_color")
            return match
              .slice(1, 4)
              .map((part) => Number(part).toString(16).padStart(2, "0"))
              .join("")
          }
          const body = document.body.getBoundingClientRect()
          if (
            Math.abs(body.width - 1280) > 1 ||
            Math.abs(body.height - 720) > 1 ||
            document.body.scrollWidth > 1281 ||
            document.body.scrollHeight > 721
          )
            throw new Error("html_canvas_must_be_1280x720_without_overflow")
          const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-pptx]"))
          if (!nodes.length || nodes.length > 80) throw new Error("invalid_html_elements")
          if (
            Array.from(document.body.querySelectorAll("*")).some(
              (node) => !["STYLE"].includes(node.tagName) && !node.closest("[data-pptx]"),
            )
          )
            throw new Error("unmarked_html_content")
          const elements = nodes.map((node) => {
            const style = getComputedStyle(node)
            const bounds = node.getBoundingClientRect()
            if (
              style.transform !== "none" ||
              style.backgroundImage !== "none" ||
              style.boxShadow !== "none" ||
              style.textShadow !== "none" ||
              Number(style.opacity) !== 1 ||
              style.filter !== "none" ||
              style.fontStyle !== "normal" ||
              style.textDecorationLine !== "none" ||
              [
                style.paddingTop,
                style.paddingRight,
                style.paddingBottom,
                style.paddingLeft,
                style.borderTopWidth,
                style.borderRightWidth,
                style.borderBottomWidth,
                style.borderLeftWidth,
              ].some((value) => parseFloat(value) !== 0)
            )
              throw new Error("unsupported_css_use_plain_text_and_separate_shapes")
            if (node.querySelector("[data-pptx]") || node.children.length)
              throw new Error("nested_elements_not_supported")
            if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)
              throw new Error("text_overflow")
            const position = {
              x: (bounds.x - body.x) / 96,
              y: (bounds.y - body.y) / 96,
              w: bounds.width / 96,
              h: bounds.height / 96,
            }
            if (node.dataset.pptx === "text") {
              if (
                style.fontFamily
                  .split(",")[0]
                  .trim()
                  .replace(/^["']|["']$/g, "")
                  .toLowerCase() !== font.toLowerCase()
              )
                throw new Error("html_font_must_match_outline_font")
              return {
                ...position,
                type: "text",
                text: node.innerText,
                size: parseFloat(style.fontSize) * 0.75,
                color: rgb(style.color),
                bold: Number(style.fontWeight) >= 600,
                align: style.textAlign === "center" || style.textAlign === "right" ? style.textAlign : "left",
              }
            }
            if (node.dataset.pptx === "shape")
              return {
                ...position,
                type: "shape",
                shape: node.dataset.shape ?? "rect",
                color: rgb(style.backgroundColor),
              }
            if (node.dataset.pptx === "image")
              return { ...position, type: "image", path: node.getAttribute("src"), alt: node.getAttribute("alt") ?? "" }
            throw new Error("unsupported_html_element")
          })
          return {
            title: document.title,
            takeaway: document.querySelector('meta[name="takeaway"]')?.getAttribute("content") ?? document.title,
            background: rgb(getComputedStyle(document.body).backgroundColor),
            elements,
          }
        }, metadata.font)
        .catch((error: unknown) => {
          throw new Error(
            `${filename}: ${error instanceof Error ? error.message : "html_export_failed"}. Read pptagent/references/html.md: BODY must be 1280x720 with margin:0; direct data-pptx elements only, explicit geometry, no nested content.`,
          )
        })
      slides.push({
        ...notes[slides.length],
        ...extracted,
        elements: extracted.elements.map((element) =>
          "path" in element
            ? {
                ...element,
                path: path.posix.normalize(path.posix.join(path.posix.dirname(filename), element.path ?? "")),
              }
            : element,
        ),
      })
      await page.close()
    }
    return outline.parse({ ...metadata, width: 1280 / 96, height: 720 / 96, slides })
  } finally {
    await browser.close()
  }
}
