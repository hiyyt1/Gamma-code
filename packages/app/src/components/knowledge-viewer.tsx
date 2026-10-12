import { Match, onCleanup, onMount, Show, Switch, Suspense, lazy } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { readKnowledgeFile, validateURL, type KnowledgeSource } from "@/utils/knowledge"
import { knowledgeFormat, knowledgeHTML } from "@/utils/knowledge-preview"
import "./knowledge-viewer.css"

const KnowledgePDF = lazy(async () => {
  const { KnowledgePDF } = await import("./knowledge-pdf")
  return { default: KnowledgePDF }
})

export function KnowledgeViewer(props: {
  source: KnowledgeSource
  readOnly?: boolean
  onClose: () => void
  onEdit: (source: KnowledgeSource) => void
}) {
  const language = useLanguage()
  const format = knowledgeFormat(props.source)
  const [state, setState] = createStore({
    loading: true,
    file: undefined as Blob | undefined,
    text: props.source.text,
    html: "",
    error: "",
    missing: false,
    url: "",
  })
  let dialog!: HTMLDialogElement
  let worker: Worker | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const urls = new Set<string>()
  const editable = () => (format === "markdown" || format === "txt") && state.text !== undefined
  onMount(() => {
    dialog.showModal()
    void (async () => {
      if (format === "link") {
        setState("url", validateURL(props.source.url ?? ""))
        return
      }
      if (props.source.filename || format === "pdf" || format === "docx") {
        const file = await readKnowledgeFile(props.source.id).catch(() => undefined)
        if (disposed) return
        setState({ file, missing: !file })
        if (!file && state.text === undefined) return
      }
      if (state.file && state.file.size > 20 * 1024 * 1024) {
        setState("error", "large")
        return
      }
      if (format === "pdf") return
      if (format === "docx" && state.file) {
        if (!state.file.size) return
        const buffer = await state.file.arrayBuffer()
        if (disposed) return
        worker = new Worker(new URL("./knowledge-docx.worker.ts", import.meta.url), { type: "module" })
        await new Promise<void>((resolve) => {
          const finish = (error?: string, html?: string) => {
            clearTimeout(timer)
            worker?.terminate()
            if (!disposed) setState({ error: error ?? "", html: html ? knowledgeHTML(html) : "" })
            resolve()
          }
          worker!.onmessage = (event: MessageEvent<{ html?: string; error?: boolean }>) => {
            if (event.data.error) return finish("invalid")
            if ((event.data.html?.length ?? 0) > 4_000_000) return finish("large")
            finish(undefined, event.data.html)
          }
          worker!.onerror = () => finish("invalid")
          timer = setTimeout(() => finish("large"), 30_000)
          worker!.postMessage(buffer, [buffer])
        })
        return
      }
      const text = state.text ?? (state.file ? await state.file.text() : undefined)
      if (disposed) return
      setState("text", text)
      if (format === "markdown" && text) {
        if (text.length > 2_000_000) {
          setState("error", "large")
          return
        }
        const { marked } = await import("marked")
        const html = knowledgeHTML(await marked.parse(text))
        if (!disposed) setState("html", html)
      }
    })()
      .catch(() => {
        if (!disposed) setState("error", "invalid")
      })
      .finally(() => {
        if (!disposed) setState("loading", false)
      })
  })
  onCleanup(() => {
    disposed = true
    worker?.terminate()
    clearTimeout(timer)
    urls.forEach((url) => URL.revokeObjectURL(url))
  })
  const download = () => {
    if (!state.file) return
    const url = URL.createObjectURL(state.file)
    urls.add(url)
    const link = document.createElement("a")
    link.href = url
    link.download = props.source.filename ?? props.source.name
    link.click()
    setTimeout(() => {
      URL.revokeObjectURL(url)
      urls.delete(url)
    }, 1000)
  }
  const size = () => state.file?.size ?? props.source.size
  return (
    <dialog
      ref={dialog}
      class="kb-dialog kb-viewer"
      aria-labelledby="kb-viewer-title"
      onCancel={(event) => {
        event.preventDefault()
        props.onClose()
      }}
    >
      <header>
        <div>
          <small>{language.t("knowledge.title")}</small>
          <h2 id="kb-viewer-title">{props.source.name}</h2>
          <span class="kb-viewer-meta">
            {props.source.filename ?? language.t(`knowledge.${props.source.type}`)} ·{" "}
            {format === "link"
              ? language.t("knowledge.link")
              : format === "unknown"
                ? language.t("knowledge.document")
                : format.toUpperCase()}
            <Show when={size() !== undefined}> · {language.t("knowledge.viewer.bytes", { size: size() ?? 0 })}</Show>
          </span>
        </div>
        <button autofocus type="button" aria-label={language.t("knowledge.close")} onClick={props.onClose}>
          ×
        </button>
      </header>
      <div class="kb-viewer-actions">
        <Show when={props.source.filename || state.file}>
          <button disabled={!state.file} onClick={download}>
            {language.t("knowledge.viewer.download")}
          </button>
        </Show>
        <Show when={!props.readOnly && editable()}>
          <button onClick={() => props.onEdit({ ...props.source, text: state.text })}>
            {language.t("knowledge.editor.edit")}
          </button>
        </Show>
        <Show when={state.url}>
          <a href={state.url} target="_blank" rel="noopener noreferrer">
            {language.t("knowledge.viewer.website")} ↗
          </a>
        </Show>
      </div>
      <Show when={state.missing}>
        <p role="status" class="kb-viewer-notice">
          {language.t("knowledge.viewer.missing")}
        </p>
      </Show>
      <div class="kb-viewer-body">
        <Switch>
          <Match when={state.loading}>
            <p role="status">{language.t("common.loading")}</p>
          </Match>
          <Match when={state.error}>
            <p role="alert">
              {language.t(state.error === "large" ? "knowledge.viewer.large" : "knowledge.viewer.invalid")}
            </p>
          </Match>
          <Match when={format === "link"}>
            <article class="kb-source-card">
              <h3>{props.source.name}</h3>
              <p>{props.source.description}</p>
              <p>{state.url}</p>
              <p>{props.source.text}</p>
              <p>{language.t("knowledge.viewer.sourceHint")}</p>
            </article>
          </Match>
          <Match when={state.file?.size === 0 && (format === "pdf" || format === "docx")}>
            <p role="status">{language.t("knowledge.viewer.empty")}</p>
          </Match>
          <Match when={format === "pdf" && state.file}>
            <Suspense fallback={<p role="status">{language.t("common.loading")}</p>}>
              <KnowledgePDF file={state.file!} />
            </Suspense>
          </Match>
          <Match when={!!state.html}>
            <iframe
              class="kb-document-frame"
              title={props.source.name}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              referrerpolicy="no-referrer"
              srcdoc={state.html}
            />
          </Match>
          <Match when={state.text !== undefined}>
            <Show when={state.text} fallback={<p role="status">{language.t("knowledge.viewer.empty")}</p>}>
              <pre class="kb-viewer-text">{state.text}</pre>
            </Show>
          </Match>
          <Match when={state.missing}>
            <p>{language.t("knowledge.viewer.unavailable")}</p>
          </Match>
          <Match when={format === "docx"}>
            <p role="status">{language.t("knowledge.viewer.empty")}</p>
          </Match>
          <Match when={true}>
            <p>{props.source.description || language.t("knowledge.viewer.unavailable")}</p>
          </Match>
        </Switch>
      </div>
    </dialog>
  )
}
