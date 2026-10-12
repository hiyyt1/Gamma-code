import DOMPurify from "dompurify"
import type { KnowledgeSource } from "./knowledge"

export function knowledgeFormat(source: KnowledgeSource) {
  if (source.type === "link") return "link"
  if (source.type === "note") return "markdown"
  const extension = source.filename?.split(".").pop()?.toLowerCase()
  if (extension === "pdf" || extension === "docx" || extension === "txt") return extension
  if (extension === "md" || extension === "markdown") return "markdown"
  if (source.mime === "application/pdf") return "pdf"
  if (source.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx"
  if (source.mime === "text/markdown") return "markdown"
  if (source.mime === "text/plain" || source.text !== undefined) return "txt"
  return "unknown"
}

// Only semantic text survives. In particular images, CSS, SVG and embedded
// documents cannot issue requests, even before the sandbox's CSP is applied.
export function knowledgeHTML(html: string) {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "hr",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "del",
      "blockquote",
      "pre",
      "code",
      "ul",
      "ol",
      "li",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
      "a",
      "sup",
      "sub",
    ],
    ALLOWED_ATTR: ["href", "title", "colspan", "rowspan", "start"],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  })
  fragment.querySelectorAll("a").forEach((link) => {
    if (!/^https?:\/\//i.test(link.getAttribute("href") ?? "")) link.removeAttribute("href")
    link.setAttribute("target", "_blank")
    link.setAttribute("rel", "noopener noreferrer")
  })
  const container = document.createElement("div")
  container.append(fragment)
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
    :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:40px max(24px,calc((100% - 820px)/2));font:16px/1.75 system-ui,sans-serif;color:#292535;background:#fff;overflow-wrap:anywhere}h1,h2,h3{line-height:1.25;letter-spacing:-.025em}h1{font-size:32px}h2{font-size:24px}a{color:#7045ad}table{border-collapse:collapse;max-width:100%;display:block;overflow:auto}td,th{border:1px solid #ddd7e8;padding:10px 14px;text-align:left}th{background:#f5f1fa}pre{padding:18px;background:#f5f1fa;overflow:auto;white-space:pre-wrap}code{font-family:monospace}blockquote{border-left:3px solid #b69af0;padding-left:20px;margin-left:0;color:#62586f}@media(max-width:600px){body{padding:24px 18px}h1{font-size:26px}}
  </style></head><body>${container.innerHTML}</body></html>`
}
