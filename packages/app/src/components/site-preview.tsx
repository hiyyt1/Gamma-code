import { createEffect, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useSDK } from "@/context/sdk"
import { productRequest } from "@/utils/product"
import type { PreviewSnapshot } from "@/utils/site-preview-document"
import "./site-preview.css"

type App = { path: string; kind: "static" | "dynamic" }

export function SitePreview(props: { sessionID: string; path?: string; entry?: string; onClose: () => void }) {
  const language = useLanguage()
  const server = useServerSDK()
  const sdk = useSDK()
  const [state, setState] = createStore({
    apps: [] as App[],
    selected: "",
    busy: true,
    loading: false,
    error: "",
    document: "",
    width: "desktop",
    expanded: false,
    version: 0,
  })
  const http = server().server.http
  const endpoint = `session/${encodeURIComponent(props.sessionID)}/preview`
  let disposed = false
  let generation = 0
  let revision = ""
  let route = "index.html"
  let render: ((route?: string) => string) | undefined
  let frame: HTMLIFrameElement | undefined
  let controller: AbortController | undefined
  let debounce: ReturnType<typeof setTimeout> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  const fail = (error: unknown) => (error instanceof Error ? error.message : "preview_failed")
  const refresh = async (force = false) => {
    if (disposed || state.apps.find((app) => app.path === state.selected)?.kind !== "static") return
    if (controller && !force) return
    controller?.abort()
    const request = new AbortController()
    controller = request
    const current = ++generation
    if (force) setState({ busy: true, error: "" })
    await productRequest<PreviewSnapshot>(
      http,
      `${endpoint}/snapshot`,
      {
        path: state.selected,
        ...(!force && revision ? { revision } : {}),
      },
      AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
    )
      .then(async (snapshot) => {
        if (disposed || current !== generation) return
        if (!snapshot.files.length) return
        const { preparePreview } = await import("@/utils/site-preview-document")
        if (disposed || current !== generation) return
        render = preparePreview(snapshot)
        const document = render(route)
        revision = snapshot.revision
        setState({ document, version: state.version + 1, loading: true, error: "" })
      })
      .catch((error) => {
        if (!disposed && current === generation) setState({ document: "", loading: false, error: fail(error) })
      })
      .finally(() => {
        if (controller === request) controller = undefined
        if (!disposed && current === generation) setState("busy", false)
      })
  }
  const start = async (path: string) => {
    controller?.abort()
    generation++
    revision = ""
    route = path === props.path ? (props.entry ?? "index.html") : "index.html"
    render = undefined
    setState({ selected: path, document: "", error: "", busy: false })
    if (state.apps.find((app) => app.path === path)?.kind === "dynamic") {
      setState("error", "dynamic_unavailable")
      return
    }
    await refresh(true)
  }
  const scan = async () => {
    setState({ busy: true, error: "" })
    await productRequest<{ apps: App[] }>(http, endpoint, undefined, AbortSignal.timeout(20_000))
      .then(async (result) => {
        if (disposed) return
        setState("apps", result.apps)
        const ready = result.apps.filter((app) => app.kind === "static")
        const chosen = props.path ?? ready.find((app) => /(^|\/)(dist|build)$/.test(app.path))?.path ?? ready[0]?.path
        if (chosen !== undefined) await start(chosen)
      })
      .catch((error) => {
        if (!disposed) setState("error", fail(error))
      })
    if (!disposed) setState("busy", false)
  }
  const receive = (event: MessageEvent) => {
    if (event.source !== frame?.contentWindow || !event.data || typeof event.data !== "object") return
    if (event.data.type === "preview-ready") setState("loading", false)
    if (event.data.type === "hash" && typeof event.data.hash === "string" && event.data.hash.length < 2048)
      route = route.split("#")[0] + event.data.hash
    if (
      event.data.type !== "navigate" ||
      typeof event.data.route !== "string" ||
      event.data.route.length > 2048 ||
      !render
    )
      return
    if (!URL.canParse(event.data.route, "https://gamma-preview.invalid/")) return
    const url = new URL(event.data.route, "https://gamma-preview.invalid/")
    if (url.origin !== "https://gamma-preview.invalid") return
    const next = url.pathname.slice(1) + url.hash
    // Only known HTML files can navigate. History-API routing needs a real origin;
    // hash routers work within the opaque document without weakening isolation.
    try {
      const document = render(next)
      route = next
      setState({ document, loading: true, error: "" })
    } catch {
      setState("error", "site_missing")
    }
  }
  window.addEventListener("message", receive)
  const stop = sdk().event.listen((event) => {
    if (!["file.watcher.updated", "file.edited"].includes(event.details.type)) return
    clearTimeout(debounce)
    debounce = setTimeout(() => void refresh(), 350)
  })
  // dist/build may be excluded by the existing watcher. Poll only while mounted
  // and visible, comparing snapshot revisions before replacing the document.
  const poll = setInterval(() => {
    if (document.visibilityState === "visible") void refresh()
  }, 5000)
  createEffect(() => {
    state.document
    clearTimeout(timeout)
    if (!state.document) return
    timeout = setTimeout(() => {
      if (state.loading) setState({ loading: false, error: "preview_failed" })
    }, 20_000)
  })
  onCleanup(() => {
    disposed = true
    generation++
    controller?.abort()
    stop()
    clearInterval(poll)
    clearTimeout(debounce)
    clearTimeout(timeout)
    window.removeEventListener("message", receive)
    render = undefined
  })
  void scan()
  const errorText = () =>
    language.t(
      state.error === "dynamic_unavailable"
        ? "sitePreview.buildRequired"
        : ["http_401", "http_403", "access_denied"].includes(state.error)
          ? "sitePreview.accessDenied"
          : state.error === "network_error"
            ? "sitePreview.offline"
            : state.error === "site_missing"
              ? "sitePreview.missing"
              : state.error === "preview_limit"
                ? "sitePreview.limit"
                : "sitePreview.error",
    )
  return (
    <aside
      class="gamma-site-preview"
      classList={{ "gamma-site-preview-expanded": state.expanded }}
      aria-label={language.t("sitePreview.title")}
    >
      <header>
        <strong role="tab" aria-selected="true">
          {language.t("sitePreview.title")}
        </strong>
        <button disabled={state.busy} onClick={() => (state.document ? void refresh(true) : void scan())}>
          {language.t("sitePreview.refresh")}
        </button>
        <button disabled={!state.document} onClick={() => setState("expanded", (value) => !value)}>
          {language.t(state.expanded ? "sitePreview.collapse" : "sitePreview.expand")}
        </button>
        <button onClick={props.onClose} aria-label={language.t("common.close")}>
          ×
        </button>
      </header>
      <div class="gamma-site-preview-tools" role="group" aria-label={language.t("sitePreview.viewport")}>
        <For each={["desktop", "tablet", "mobile"] as const}>
          {(width) => (
            <button aria-pressed={state.width === width} onClick={() => setState("width", width)}>
              {language.t(`sitePreview.${width}`)}
            </button>
          )}
        </For>
      </div>
      <Show when={state.apps.length > 1}>
        <label>
          {language.t("sitePreview.choose")}
          <select
            disabled={state.busy}
            value={state.selected}
            onChange={(event) => void start(event.currentTarget.value)}
          >
            <For each={state.apps}>
              {(app) => (
                <option value={app.path}>
                  {app.path || "/"}
                  {app.kind === "dynamic" ? " (build)" : ""}
                </option>
              )}
            </For>
          </select>
        </label>
      </Show>
      <Show when={state.busy || state.loading}>
        <p role="status">{language.t("common.loading")}</p>
      </Show>
      <Show when={state.error}>
        <p role="alert">{errorText()}</p>
      </Show>
      <Show when={!state.busy && !state.error && !state.apps.length}>
        <p>{language.t("sitePreview.empty")}</p>
      </Show>
      <Show when={state.document && `${state.document}<!--${state.version}-->`} keyed>
        {(html) => (
          <div class="gamma-site-preview-viewport" data-width={state.width}>
            <iframe
              ref={frame}
              title={language.t("sitePreview.title")}
              srcdoc={html}
              sandbox="allow-scripts"
              referrerpolicy="no-referrer"
            />
          </div>
        )}
      </Show>
    </aside>
  )
}
