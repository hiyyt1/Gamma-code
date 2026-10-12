import { createEffect, For, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { productRequest } from "@/utils/product"
import { authTokenFromCredentials } from "@/utils/server"
import "./presentation-preview.css"

type Manifest = {
  schema: string
  title: string
  revision: number
  status: string
  error?: string
  pptx?: string
  pdf?: string
  slides: { number: number; image: string; sha256: string }[]
}
const safe = (value: unknown): value is string =>
  typeof value === "string" &&
  !!value &&
  !value.startsWith("/") &&
  !/[\\:\x00-\x1f]/.test(value) &&
  value.split("/").every((part) => part && part !== "." && part !== "..")

export function PresentationPreview(props: { path: string }) {
  const language = useLanguage()
  const server = useServerSDK()
  const params = useParams()
  const [state, setState] = createStore({
    manifest: undefined as Manifest | undefined,
    images: {} as Record<string, string>,
    selected: 0,
    error: false,
    downloadError: false,
  })
  let container: HTMLDivElement | undefined
  const manifestPath = () => props.path.replace(/\.pptx$/i, ".presentation.json")
  const prefix = () => manifestPath().split("/").slice(0, -1).join("/")
  const filePath = (path: string) => `${prefix()}/${path}`
  const current = () => state.manifest?.slides[state.selected]
  const errorText = () => {
    const error = state.manifest?.error ?? ""
    if (/missing_(libreoffice|poppler|pdftotext)|Executable doesn't exist/.test(error))
      return language.t("presentation.dependenciesMissing")
    if (/vision_unavailable/.test(error)) return language.t("presentation.visionMissing")
    if (/missing_font/.test(error)) return language.t("presentation.fontMissing")
    if (/review_cycle_limit/.test(error)) return language.t("presentation.reviewLimit")
    return language.t("presentation.operationError")
  }
  const labels = () => ({
    draft: language.t("presentation.status.draft"),
    building: language.t("presentation.status.building"),
    rendering: language.t("presentation.status.rendering"),
    review_required: language.t("presentation.status.review"),
    needs_changes: language.t("presentation.status.changes"),
    ready: language.t("presentation.status.ready"),
    failed: language.t("presentation.status.failed"),
  })
  createEffect(() => {
    const target = manifestPath()
    const base = prefix()
    const session = params.id
    const http = server().server.http
    const controller = new AbortController()
    setState({ manifest: undefined, images: {}, selected: 0, error: false, downloadError: false })
    const refresh = async () => {
      const result = await productRequest<{ type: string; content: string }>(
        http,
        `session/${encodeURIComponent(session ?? "")}/content?path=${encodeURIComponent(target)}`,
        undefined,
        controller.signal,
      )
      const data = JSON.parse(result.content) as Manifest
      if (
        data.schema !== "gamma.presentation.v1" ||
        typeof data.title !== "string" ||
        !Array.isArray(data.slides) ||
        data.slides.length > 40 ||
        data.slides.some((slide) => !safe(slide.image) || typeof slide.sha256 !== "string") ||
        (data.pptx && !safe(data.pptx)) ||
        (data.pdf && !safe(data.pdf))
      )
        throw new Error("invalid_manifest")
      if (controller.signal.aborted) return
      setState("manifest", data)
      setState(
        "images",
        reconcile(
          Object.fromEntries(
            Object.entries(state.images).filter(([key]) => data.slides.some((slide) => slide.sha256 === key)),
          ),
        ),
      )
      setState("error", false)
      setState("selected", (index) => Math.max(0, Math.min(index, data.slides.length - 1)))
      for (const slide of data.slides) {
        if (state.images[slide.sha256]) continue
        const image = await productRequest<{ encoding?: string; mimeType?: string; content: string }>(
          http,
          `session/${encodeURIComponent(session ?? "")}/content?path=${encodeURIComponent(`${base}/${slide.image}`)}`,
          undefined,
          controller.signal,
        )
        if (controller.signal.aborted) return
        if (image.encoding !== "base64" || image.mimeType !== "image/png") throw new Error("invalid_image")
        setState("images", slide.sha256, `data:image/png;base64,${image.content}`)
      }
    }
    let running = false
    const poll = () => {
      if (running || controller.signal.aborted) return
      running = true
      void refresh()
        .catch(() => {
          if (!controller.signal.aborted) setState("error", true)
        })
        .finally(() => {
          running = false
        })
    }
    poll()
    const timer = setInterval(poll, 3000)
    onCleanup(() => {
      controller.abort()
      clearInterval(timer)
    })
  })
  const download = async (path: string) => {
    const http = server().server.http
    setState("downloadError", false)
    await fetch(
      `${http.url.replace(/\/$/, "")}/product/session/${encodeURIComponent(params.id ?? "")}/download?path=${encodeURIComponent(filePath(path))}`,
      {
        headers: http.password
          ? { Authorization: `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}` }
          : {},
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("download_failed")
        const url = URL.createObjectURL(await response.blob())
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = path.split("/").at(-1) ?? path
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      })
      .catch(() => setState("downloadError", true))
  }
  return (
    <div
      class="presentation-preview"
      ref={container}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight")
          setState("selected", (index) => Math.min(index + 1, (state.manifest?.slides.length ?? 1) - 1))
        if (event.key === "ArrowLeft") setState("selected", (index) => Math.max(0, index - 1))
      }}
    >
      <Show when={state.error}>
        <p role="alert">{language.t("presentation.previewError")}</p>
      </Show>
      <Show when={state.manifest} fallback={<p role="status">{language.t("common.loading")}</p>}>
        {(manifest) => (
          <>
            <header>
              <strong>{manifest().title}</strong>
              <p role="status">
                {labels()[manifest().status as keyof ReturnType<typeof labels>] ??
                  language.t("presentation.status.draft")}
              </p>
            </header>
            <Show when={manifest().error}>
              <p role="alert">{errorText()}</p>
            </Show>
            <Show when={current()}>
              {(slide) => (
                <figure>
                  <img
                    src={state.images[slide().sha256]}
                    alt={language.t("presentation.slide", { number: slide().number })}
                  />
                  <figcaption>
                    {language.t("presentation.position", { number: slide().number, total: manifest().slides.length })}
                  </figcaption>
                </figure>
              )}
            </Show>
            <nav class="presentation-thumbnails" aria-label={language.t("presentation.slides")}>
              <For each={manifest().slides}>
                {(slide, index) => (
                  <button
                    aria-label={language.t("presentation.slide", { number: slide.number })}
                    aria-pressed={state.selected === index()}
                    onClick={() => setState("selected", index())}
                  >
                    <img loading="lazy" src={state.images[slide.sha256]} alt="" />
                    <span>{slide.number}</span>
                  </button>
                )}
              </For>
            </nav>
            <footer>
              <button
                onClick={() => {
                  const action = document.fullscreenElement ? document.exitFullscreen() : container?.requestFullscreen()
                  void action?.catch(() => setState("downloadError", true))
                }}
              >
                {language.t("knowledge.fullscreen")}
              </button>
              <Show when={manifest().pptx}>
                {(path) => (
                  <button onClick={() => void download(path())}>{language.t("presentation.downloadPptx")}</button>
                )}
              </Show>
              <Show when={manifest().pdf}>
                {(path) => (
                  <button onClick={() => void download(path())}>{language.t("presentation.downloadPdf")}</button>
                )}
              </Show>
            </footer>
            <Show when={state.downloadError}>
              <p role="alert">{language.t("presentation.downloadError")}</p>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}
