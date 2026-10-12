import { createEffect, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist"
import { useLanguage } from "@/context/language"

export function KnowledgePDF(props: { file: Blob }) {
  const language = useLanguage()
  const [state, setState] = createStore({
    document: undefined as PDFDocumentProxy | undefined,
    page: 1,
    zoom: 1,
    width: 800,
    busy: true,
    error: "",
  })
  let surface!: HTMLDivElement
  let loading: PDFDocumentLoadingTask | undefined
  let disposed = false
  onMount(() => {
    const observer = new ResizeObserver(() => setState("width", Math.max(200, surface.clientWidth - 40)))
    observer.observe(surface)
    onCleanup(() => observer.disconnect())
    void (async () => {
      const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist")
      const { default: worker } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
      const data = new Uint8Array(await props.file.arrayBuffer())
      if (disposed) return
      GlobalWorkerOptions.workerSrc = worker
      // Render only page graphics. No scripting, forms, attachments or link actions.
      loading = getDocument({
        data,
        enableXfa: false,
        useSystemFonts: true,
        useWorkerFetch: false,
        BinaryDataFactory: KnowledgePDFAssets,
        isImageDecoderSupported: false,
        maxImageSize: 16_000_000,
      })
      const document = await loading.promise
      if (!disposed) setState("document", document)
    })().catch((error: unknown) => {
      if (!disposed)
        setState({
          busy: false,
          error: error instanceof Error && error.name === "PasswordException" ? "password" : "invalid",
        })
    })
  })
  onCleanup(() => {
    disposed = true
    void loading?.destroy().catch(() => undefined)
  })
  createEffect(() => {
    const document = state.document
    const number = state.page
    const zoom = state.zoom
    const width = state.width
    if (!document) return
    const render = {
      cancelled: false,
      task: undefined as RenderTask | undefined,
    }
    setState({ busy: true, error: "" })
    const canvas = window.document.createElement("canvas")
    onCleanup(() => {
      render.cancelled = true
      render.task?.cancel()
      canvas.remove()
      canvas.width = canvas.height = 0
    })
    void document
      .getPage(number)
      .then(async (page) => {
        if (render.cancelled) return
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (Math.min(width, 1000) / base.width) * zoom })
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        )
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        canvas.setAttribute("role", "img")
        canvas.setAttribute(
          "aria-label",
          language.t("knowledge.viewer.pageOf", { page: number, total: document.numPages }),
        )
        render.task = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
        await render.task.promise.finally(() => page.cleanup())
        if (render.cancelled) return
        surface.replaceChildren(canvas)
        surface.scrollTo(0, 0)
        setState("busy", false)
      })
      .catch(() => {
        if (!render.cancelled) setState({ busy: false, error: "invalid" })
      })
  })
  return (
    <div class="kb-pdf">
      <div class="kb-pdf-toolbar">
        <button
          disabled={!state.document || state.page <= 1}
          aria-label={language.t("knowledge.viewer.previous")}
          onClick={() => setState("page", state.page - 1)}
        >
          ←
        </button>
        <label>
          {language.t("knowledge.viewer.page")}{" "}
          <input
            aria-label={language.t("knowledge.viewer.page")}
            type="number"
            min="1"
            max={state.document?.numPages ?? 1}
            value={state.page}
            disabled={!state.document}
            onChange={(event) => {
              const number = event.currentTarget.valueAsNumber
              if (Number.isInteger(number))
                setState("page", Math.max(1, Math.min(state.document?.numPages ?? 1, number)))
              event.currentTarget.value = String(state.page)
            }}
          />
        </label>
        <span>/ {state.document?.numPages ?? "—"}</span>
        <button
          disabled={!state.document || state.page >= state.document.numPages}
          aria-label={language.t("knowledge.viewer.next")}
          onClick={() => setState("page", state.page + 1)}
        >
          →
        </button>
        <button
          aria-label={language.t("knowledge.zoomOut")}
          disabled={state.zoom <= 0.5}
          onClick={() => setState("zoom", Math.max(0.5, state.zoom - 0.25))}
        >
          −
        </button>
        <button aria-label={language.t("knowledge.viewer.fit")} onClick={() => setState("zoom", 1)}>
          {Math.round(state.zoom * 100)}%
        </button>
        <button
          aria-label={language.t("knowledge.zoomIn")}
          disabled={state.zoom >= 3}
          onClick={() => setState("zoom", Math.min(3, state.zoom + 0.25))}
        >
          +
        </button>
      </div>
      <Show when={state.busy}>
        <p role="status">{language.t("common.loading")}</p>
      </Show>
      <Show when={state.error}>
        <p role="alert">
          {language.t(state.error === "password" ? "knowledge.viewer.password" : "knowledge.viewer.invalid")}
        </p>
      </Show>
      <div ref={surface} class="kb-pdf-surface" aria-busy={state.busy} />
    </div>
  )
}

// Ship PDF.js's own fonts/decoders with the app. Only allowlisted bundled assets
// may be fetched, never URLs supplied by an uploaded document.
const pdfAssets = import.meta.glob<string>(
  [
    "../../node_modules/pdfjs-dist/cmaps/*.bcmap",
    "../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}",
    "../../node_modules/pdfjs-dist/wasm/{openjpeg,jbig2,qcms_bg}.wasm",
  ],
  { query: "?url", import: "default", eager: true },
)

class KnowledgePDFAssets {
  async fetch(input: { kind: string; filename: string }) {
    const folder = (
      { cMapUrl: "cmaps", standardFontDataUrl: "standard_fonts", wasmUrl: "wasm" } as Record<string, string>
    )[input.kind]
    const url = pdfAssets[`../../node_modules/pdfjs-dist/${folder}/${input.filename}`]
    if (!url) throw new Error("Unknown PDF asset")
    const response = await fetch(url)
    if (!response.ok) throw new Error("PDF asset unavailable")
    return new Uint8Array(await response.arrayBuffer())
  }
}
