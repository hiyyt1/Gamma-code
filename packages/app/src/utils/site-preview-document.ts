import { tokenizer } from "acorn"
import { parse } from "parse5"

export type PreviewSnapshot = { revision: string; files: { path: string; mime: string; data: string }[] }
const origin = "https://gamma-preview.invalid/"
// This policy belongs to the trusted outer document. In particular frame-src
// blocks the untrusted child's own navigations, which its sandbox cannot do.
export const previewPolicy =
  "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
const json = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c")
const dataURL = (mime: string, text: string) => {
  const bytes = new TextEncoder().encode(text)
  const binary = Array.from({ length: Math.ceil(bytes.length / 32768) }, (_, index) =>
    String.fromCharCode(...bytes.subarray(index * 32768, (index + 1) * 32768)),
  ).join("")
  return `data:${mime};base64,${btoa(binary)}`
}

export function preparePreview(snapshot: PreviewSnapshot) {
  const files = new Map(
    snapshot.files.map((file) => [new URL(file.path.split("/").map(encodeURIComponent).join("/"), origin).href, file]),
  )
  const assets = new Map<string, string>()
  const budget = { bytes: 0 }
  const bounded = (value: string) => {
    budget.bytes += value.length
    if (budget.bytes > 64 * 1024 * 1024) throw new Error("preview_limit")
    return value
  }
  const text = (data: string) => new TextDecoder().decode(Uint8Array.from(atob(data), (char) => char.charCodeAt(0)))
  const resolve = (value: string, base: string) => {
    if (!URL.canParse(value, base)) return ""
    const url = new URL(value, base)
    url.search = ""
    url.hash = ""
    return url.href
  }
  const asset = (value: string, base: string, stack: string[] = []): string => {
    if (value.startsWith("data:") || value.startsWith("#")) return value
    const key = resolve(value, base)
    if (assets.has(key)) return assets.get(key)!
    const file = files.get(key)
    if (!file || stack.includes(key)) return "data:,"
    const result = /\.css$/i.test(file.path)
      ? dataURL("text/css", css(text(file.data), key, [...stack, key]))
      : `data:${file.mime};base64,${file.data}`
    bounded(result)
    assets.set(key, result)
    return result
  }
  const css = (source: string, base: string, stack: string[] = []): string =>
    source.replace(
      /url\(\s*(['"]?)(.*?)\1\s*\)|@import\s+(['"])(.*?)\3/gi,
      (match, quote, url, importQuote, imported) =>
        bounded(
          imported !== undefined ? `@import "${asset(imported, base, stack)}"` : `url("${asset(url, base, stack)}")`,
        ),
    )
  const javascript = (source: string, base: string) => {
    // Tokenize rather than replacing quoted text with regex: regex literals,
    // comments and escaped strings in production bundles must remain intact.
    const replacements = Array.from(tokenizer(source, { ecmaVersion: "latest", sourceType: "module" })).flatMap(
      (token) => {
        if (token.type.label !== "string" || !("value" in token) || typeof token.value !== "string") return []
        const key = resolve(token.value, base)
        const file = files.get(key)
        if (!file) return []
        return [
          {
            start: token.start,
            end: token.end,
            value: bounded(JSON.stringify(/\.m?js$/i.test(file.path) ? key : asset(key, base))),
          },
        ]
      },
    )
    return (
      replacements
        .map((item, index) => source.slice(replacements[index - 1]?.end ?? 0, item.start) + item.value)
        .join("") + source.slice(replacements.at(-1)?.end ?? 0)
    )
  }
  const imports = Object.fromEntries(
    snapshot.files
      .filter((file) => /\.m?js$/i.test(file.path))
      .map((file) => {
        const key = new URL(file.path.split("/").map(encodeURIComponent).join("/"), origin).href
        return [key, bounded(dataURL("text/javascript", javascript(text(file.data), key)))]
      }),
  )
  const preparedBytes = budget.bytes
  return (route = "index.html") => {
    budget.bytes = preparedBytes
    const requested = new URL(route, origin)
    if (requested.origin !== new URL(origin).origin) throw new Error("site_missing")
    const key = resolve(route, origin)
    const file = files.get(key) ?? files.get(`${key.endsWith("/") ? key : `${key}/`}index.html`)
    if (!file || !/\.html?$/i.test(file.path)) throw new Error("site_missing")
    // HTML templates intentionally omit document-level tags. Preserve their
    // attributes using a non-fetching parser, including body classes and lang.
    const html = parse(text(file.data)).childNodes.find((node) => "tagName" in node && node.tagName === "html")
    const body =
      html && "childNodes" in html
        ? html.childNodes.find((node) => "tagName" in node && node.tagName === "body")
        : undefined
    const opening = (tag: string, node: typeof html) => {
      const element = document.createElement(tag)
      if (node && "attrs" in node)
        node.attrs.forEach((attr) =>
          element.setAttribute(attr.name, attr.name === "style" ? css(attr.value, key) : attr.value),
        )
      return element.outerHTML.slice(0, -`</${tag}>`.length)
    }
    // Template contents are inert, including images and frames. Never parse
    // untrusted HTML into Gamma's live document or a fetching DOMParser document.
    const template = document.createElement("template")
    template.innerHTML = text(file.data)
    template.content
      .querySelectorAll("base, meta[http-equiv], iframe, frame, object, embed")
      .forEach((node) => node.remove())
    template.content.querySelectorAll("*").forEach((node) => {
      node.removeAttribute("integrity")
      node.removeAttribute("crossorigin")
      node.removeAttribute("ping")
      if (node.hasAttribute("style")) node.setAttribute("style", css(node.getAttribute("style")!, key))
      if (node.tagName === "STYLE") node.textContent = css(node.textContent ?? "", key)
      if (node.tagName === "SCRIPT") {
        if (node.getAttribute("type") === "importmap") {
          node.remove()
          return
        }
        const src = node.getAttribute("src")
        if (src) node.setAttribute("src", imports[resolve(src, key)] ?? "data:,")
        if (
          !src &&
          [null, "", "module", "text/javascript", "application/javascript"].includes(node.getAttribute("type"))
        )
          node.textContent = javascript(node.textContent ?? "", key)
        return
      }
      if (node.tagName === "LINK" && node.getAttribute("rel") !== "stylesheet") {
        node.remove()
        return
      }
      for (const name of ["src", "poster", "background", ...(node.tagName === "LINK" ? ["href"] : [])]) {
        const value = node.getAttribute(name)
        if (value) node.setAttribute(name, bounded(asset(value, key)))
      }
      const srcset = node.getAttribute("srcset")
      if (srcset)
        node.setAttribute(
          "srcset",
          srcset
            .split(",")
            .map((item) => {
              const [url, ...size] = item.trim().split(/\s+/)
              return bounded(`${asset(url, key)} ${size.join(" ")}`)
            })
            .join(","),
        )
      if (node.tagName === "A" || node.tagName === "AREA") {
        const href = node.getAttribute("href")
        node.removeAttribute("target")
        if (href && !href.startsWith("#")) {
          if (URL.canParse(href, key)) node.setAttribute("data-gamma-route", new URL(href, key).href)
          node.setAttribute("href", "#")
        }
      }
    })
    const bridge = `addEventListener('click',e=>{const a=e.target.closest?.('a,area');if(!a)return;const href=a.getAttribute('href');if(href?.startsWith('#')&&!a.dataset.gammaRoute){e.preventDefault();location.hash=href;return}if(!a.dataset.gammaRoute)return;e.preventDefault();parent.postMessage({type:'navigate',route:a.dataset.gammaRoute},'*')});addEventListener('hashchange',()=>parent.postMessage({type:'hash',hash:location.hash},'*'));${requested.hash ? `location.hash=${json(requested.hash)};` : ""}`
    const inner = `<!doctype html>${opening("html", html)}<head><meta charset="utf-8"><script type="importmap">${json({ imports })}</script><script>${bridge}</script></head>${opening("body", body)}${template.innerHTML}</body></html>`
    if (inner.length > 64 * 1024 * 1024) throw new Error("preview_limit")
    // No project code runs in this wrapper. Messages grant only navigation among
    // files already in the snapshot; they never grant filesystem or API access.
    return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${previewPolicy}"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}body{overflow:hidden}</style></head><body><script>const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.title='Preview';frame.referrerPolicy='no-referrer';frame.srcdoc=${json(inner)};frame.onload=()=>parent.postMessage({type:'preview-ready'},'*');addEventListener('message',e=>{if(e.source===frame.contentWindow&&['navigate','hash'].includes(e.data?.type))parent.postMessage(e.data,'*')});document.body.append(frame);</script></body></html>`
  }
}
