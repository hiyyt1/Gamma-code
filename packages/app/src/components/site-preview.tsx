import { createEffect, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { usePlatform } from "@/context/platform"
import { productRequest } from "@/utils/product"
import "./site-preview.css"

type App = { path: string; kind: "static" | "dynamic" }

export function SitePreview(props: { sessionID: string; path?: string; onClose: () => void }) {
  const language = useLanguage()
  const server = useServerSDK()
  const platform = usePlatform()
  const [state, setState] = createStore({
    apps: [] as App[],
    selected: "",
    enabled: false,
    busy: true,
    loading: false,
    error: "",
    url: "",
    id: "",
    revision: 0,
  })
  const http = server().server.http
  const endpoint = `session/${encodeURIComponent(props.sessionID)}/preview`
  let disposed = false
  let generation = 0
  let timeout: ReturnType<typeof setTimeout> | undefined
  const release = (id: string) => {
    if (id) void productRequest(http, `${endpoint}/stop`, { id }, undefined, true).catch(() => {})
  }
  const fail = (error: unknown) => (error instanceof Error ? error.message : "preview_failed")
  const start = async (path: string) => {
    const current = ++generation
    release(state.id)
    setState({ selected: path, id: "", url: "", error: "", busy: true, loading: false })
    if (state.apps.find((app) => app.path === path)?.kind === "dynamic") {
      setState({ busy: false, error: "dynamic_unavailable" })
      return
    }
    await productRequest<{ id: string; url: string }>(http, `${endpoint}/start`, { path })
      .then(async (result) => {
        if (disposed || current !== generation) return release(result.id)
        setState("id", result.id)
        const response = await fetch(result.url, {
          method: "HEAD",
          credentials: "omit",
          signal: AbortSignal.timeout(15_000),
        })
        if (!response.ok) throw new Error("preview_failed")
        if (disposed || current !== generation) return release(result.id)
        setState({ url: result.url, loading: true })
      })
      .catch((error) => {
        if (!disposed && current === generation) {
          release(state.id)
          setState({ id: "", error: fail(error) })
        }
      })
      .finally(() => {
        if (!disposed && current === generation) setState("busy", false)
      })
  }
  const scan = async () => {
    setState({ busy: true, error: "" })
    await productRequest<{ enabled: boolean; apps: App[] }>(http, endpoint)
      .then(async (result) => {
        if (disposed) return
        setState(result)
        if (!result.enabled) return setState("error", "preview_unconfigured")
        if (props.path !== undefined) {
          if (!result.apps.some((app) => app.path === props.path && app.kind === "static"))
            return setState("error", "site_missing")
          await start(props.path)
          return
        }
        if (result.apps.length === 1) await start(result.apps[0].path)
      })
      .catch((error) => {
        if (!disposed) setState("error", fail(error))
      })
    if (!disposed) setState("busy", false)
  }
  void scan()
  const heartbeat = setInterval(() => {
    if (!state.id) return
    const id = state.id
    void productRequest(http, `${endpoint}/renew`, { id }).catch(() => {
      if (disposed || state.id !== id) return
      release(id)
      setState({ id: "", url: "", error: "expired", loading: false })
    })
  }, 30_000)
  createEffect(() => {
    state.url
    state.revision
    clearTimeout(timeout)
    if (!state.url) return
    timeout = setTimeout(() => {
      if (state.loading) setState({ loading: false, error: "preview_failed" })
    }, 20_000)
  })
  onCleanup(() => {
    disposed = true
    generation++
    clearInterval(heartbeat)
    clearTimeout(timeout)
    release(state.id)
  })
  const errorText = () =>
    language.t(
      state.error === "dynamic_unavailable"
        ? "sitePreview.dynamic"
        : state.error === "preview_unconfigured"
          ? "sitePreview.setupRequired"
          : ["http_401", "http_403", "access_denied"].includes(state.error)
            ? "sitePreview.accessDenied"
            : state.error === "network_error"
              ? "sitePreview.offline"
              : state.error === "site_missing"
                ? "sitePreview.missing"
                : state.error === "expired"
                  ? "sitePreview.expired"
                  : "sitePreview.error",
    )
  return (
    <aside class="gamma-site-preview" aria-label={language.t("sitePreview.title")}>
      <header>
        <strong>{language.t("sitePreview.title")}</strong>
        <button
          disabled={state.busy}
          onClick={() =>
            state.url
              ? (setState({ loading: true, error: "" }), setState("revision", (value) => value + 1))
              : void scan()
          }
        >
          {language.t("sitePreview.refresh")}
        </button>
        <Show when={state.url}>
          <a
            href={state.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              event.preventDefault()
              platform.openExternal(state.url)
            }}
          >
            {language.t("sitePreview.open")}
          </a>
        </Show>
        <button onClick={props.onClose} aria-label={language.t("common.close")}>
          ×
        </button>
      </header>
      <Show when={state.apps.length > 1}>
        <label>
          {language.t("sitePreview.choose")}
          <select
            disabled={state.busy || !state.enabled}
            value={state.id || state.error === "dynamic_unavailable" ? state.selected : "__choose__"}
            onChange={(event) => void start(event.currentTarget.value)}
          >
            <option value="__choose__" disabled>
              {language.t("sitePreview.choose")}
            </option>
            <For each={state.apps}>
              {(app) => (
                <option value={app.path}>
                  {app.path || "/"}
                  {app.kind === "dynamic" ? " (dev)" : ""}
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
      <Show when={!state.busy && !state.error && state.apps.length === 0}>
        <p>{language.t("sitePreview.empty")}</p>
      </Show>
      <Show when={state.url && `${state.url}?refresh=${state.revision}`} keyed>
        {(url) => (
          <iframe
            title={language.t("sitePreview.title")}
            src={url}
            sandbox="allow-scripts allow-forms"
            referrerpolicy="no-referrer"
            onLoad={() => setState("loading", false)}
            onError={() => setState({ loading: false, error: "preview_failed" })}
          />
        )}
      </Show>
    </aside>
  )
}
