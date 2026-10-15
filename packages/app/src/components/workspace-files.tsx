import { ProjectKnowledge } from "./project-knowledge"
import {
  createContext,
  useContext,
  createEffect,
  For,
  on,
  onCleanup,
  Show,
  type Accessor,
  type ParentProps,
} from "solid-js"
import { createStore } from "solid-js/store"
import { useFile } from "@/context/file"
import { useCommand } from "@/context/command"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog, DialogHeader, DialogTitle, DialogBody } from "@opencode-ai/ui/v2/dialog-v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { Persist, persisted } from "@/utils/persist"
import { authTokenFromCredentials } from "@/utils/server"
import FileTreeV2 from "./file-tree-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { useServerSync } from "@/context/server-sync"
import { WorkspaceFilePreview } from "./workspace-file-preview"
import { SitePreview } from "./site-preview"
import { productRequest } from "@/utils/product"
import { siteFilePath, previewFailure, type PreviewSite, type PreviewState } from "@/utils/site-results"
import "./workspace-files.css"

const WorkspaceFilesContext = createContext<{
  opened: Accessor<boolean>
  visible: Accessor<boolean>
  toggle: () => void
  sites: Accessor<PreviewSite[]>
  knownSites: Accessor<PreviewSite[]>
  previewEnabled: Accessor<boolean>
  previewStatus: Accessor<PreviewState>
  refreshSites: () => Promise<void>
  openSite: (path?: string) => void
}>()

export const useWorkspaceFiles = () => useContext(WorkspaceFilesContext)

export function WorkspaceFiles(props: ParentProps<{ sessionID?: string }>) {
  const file = useFile()
  const command = useCommand()
  const dialog = useDialog()
  const sdk = useSDK()
  const server = useServerSDK()
  const language = useLanguage()
  const sync = useServerSync()
  const guide = () => sync().session.data.info[props.sessionID ?? ""]?.agent === "gamma-guide"
  const [preference, setPreference] = persisted(
    Persist.global("workspace-files"),
    createStore({ open: true, width: 320 }),
  )
  const [state, setState] = createStore({
    sitePreview: false,
    sitePath: undefined as string | undefined,
    preview: false,
    selected: "",
    drag: 0,
    uploading: false,
    progress: 0,
    current: "",
    errors: [] as string[],
  })
  let input: HTMLInputElement | undefined
  let request: XMLHttpRequest | undefined
  let disposed = false
  const [sites, setSites] = createStore({
    current: [] as PreviewSite[],
    known: [] as PreviewSite[],
    enabled: false,
    status: "loading" as PreviewState,
  })
  let siteRequest: Promise<void> | undefined
  let siteEpoch = 0
  const refreshSites = () => {
    if (siteRequest) return siteRequest
    const id = props.sessionID
    if (!id || guide()) return Promise.resolve()
    const epoch = siteEpoch
    const request = productRequest<{ apps: PreviewSite[]; enabled: boolean }>(
      server().server.http,
      `session/${encodeURIComponent(id)}/preview`,
      undefined,
      AbortSignal.timeout(20_000),
    )
      .then((result) => {
        if (disposed || epoch !== siteEpoch) return
        const known = new Map(sites.known.map((site) => [site.path, site]))
        result.apps.forEach((site) => known.set(site.path, site))
        setSites({
          current: result.apps,
          known: [...known.values()],
          enabled: result.enabled,
          status: result.enabled ? "ready" : "unconfigured",
        })
      })
      .catch((error) => {
        if (!disposed && epoch === siteEpoch) setSites({ enabled: false, status: previewFailure(error) })
      })
      .finally(() => {
        if (siteRequest === request) siteRequest = undefined
      })
    siteRequest = request
    return request
  }
  const openSite = (path?: string) => setState({ sitePreview: true, sitePath: path })
  createEffect(
    on(
      () => [props.sessionID, sdk().directory] as const,
      () => {
        siteEpoch++
        siteRequest = undefined
        setSites({ current: [], known: [], enabled: false, status: "loading" })
        void refreshSites()
      },
    ),
  )
  // Revalidate deleted/replaced sites even when no filesystem watcher is available.
  const siteTimer = setInterval(() => {
    if (document.visibilityState === "visible") void refreshSites()
  }, 10_000)
  const focusSites = () => void refreshSites()
  window.addEventListener("focus", focusSites)
  onCleanup(() => {
    clearInterval(siteTimer)
    window.removeEventListener("focus", focusSites)
  })
  createEffect(
    on(
      () => [props.sessionID, sdk().directory] as const,
      () => setState("sitePreview", false),
    ),
  )
  onCleanup(() => {
    disposed = true
    request?.abort()
  })
  createEffect(
    on(
      () => [sdk().directory, preference.open] as const,
      (next, previous) => {
        if (!next[1] || next[0] !== previous?.[0]) setState({ selected: "", preview: false, drag: 0 })
        if (preference.open) void file.tree.list("")
      },
    ),
  )

  const upload = async (files: File[]) => {
    if (state.uploading || files.length === 0) return
    if (!props.sessionID) {
      setState("errors", [language.t("workspace.files.needSession")])
      return
    }
    const sessionID = props.sessionID
    const directory = sdk().directory
    const http = server().server.http
    setState({ uploading: true, errors: [], progress: 0 })
    try {
      for (const item of files) {
        if (disposed) return
        setState({ current: item.name, progress: 0 })
        const code = await new Promise<string | undefined>((resolve) => {
          if (item.size > 20 * 1024 * 1024) return resolve("too_large")
          const xhr = new XMLHttpRequest()
          request = xhr
          xhr.open("POST", `${http.url.replace(/\/$/, "")}/product/session/${encodeURIComponent(sessionID)}/files`)
          if (http.password)
            xhr.setRequestHeader(
              "Authorization",
              `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}`,
            )
          xhr.responseType = "json"
          xhr.timeout = 120_000
          xhr.upload.onprogress = (event) => {
            if (!disposed && event.lengthComputable)
              setState("progress", Math.round((event.loaded / event.total) * 100))
          }
          xhr.onload = () =>
            resolve(xhr.status >= 200 && xhr.status < 300 ? undefined : (xhr.response?.code ?? "failed"))
          xhr.onerror = xhr.ontimeout = xhr.onabort = () => resolve("failed")
          const data = new FormData()
          data.append("file", item)
          xhr.send(data)
        })
        if (disposed) return
        if (code)
          setState("errors", (errors) => [
            ...errors,
            language.t(
              code === "exists"
                ? "workspace.files.exists"
                : code === "too_large"
                  ? "workspace.files.tooLarge"
                  : "workspace.files.failed",
              { name: item.name },
            ),
          ])
        // Upload completion must not depend on a subsequent directory listing.
        if (sdk().directory === directory) void file.tree.refresh("").catch(() => {})
      }
    } catch {
      if (!disposed)
        setState("errors", (errors) => [...errors, language.t("workspace.files.failed", { name: state.current })])
    } finally {
      request = undefined
      if (!disposed) setState({ uploading: false, current: "", progress: 0 })
    }
  }

  const refresh = async (path = "", directory = sdk().directory) => {
    await file.tree.refresh(path)
    if (sdk().directory !== directory) return
    await Promise.all(
      file.tree
        .children(path)
        .filter((node) => node.type === "directory" && file.tree.state(node.path)?.expanded)
        .map((node) => refresh(node.path, directory)),
    )
  }

  const preview = (path: string) => {
    setState({ selected: path, preview: true })
    void file.load(path, { force: true })
  }

  createEffect(
    on(
      () => file.preview.request,
      () => {
        if (!file.preview.path) return
        setState("sitePreview", false)
        setPreference("open", true)
        preview(file.preview.path)
      },
      { defer: true },
    ),
  )
  command.register("workspace-files", () => [
    {
      id: "fileTree.toggle",
      title: language.t(preference.open ? "workspace.files.hideTree" : "workspace.files.showTree"),
      keybind: "mod+\\",
      onSelect: () => setPreference("open", !preference.open),
    },
  ])

  let updating = false
  let updateAgain = false
  const update = async () => {
    if (!preference.open || disposed || guide()) return
    if (updating) {
      updateAgain = true
      return
    }
    updating = true
    const directory = sdk().directory
    await refresh()
      .then(async () => {
        if (sdk().directory === directory && state.preview && state.selected && !disposed)
          await file.load(state.selected, { force: true })
      })
      .finally(() => {
        updating = false
        if (updateAgain) {
          updateAgain = false
          void update()
        }
      })
  }
  // Native watchers are optional, notably for non-Git project directories.
  // Poll only visible, expanded directories while this workspace is busy.
  const active = () =>
    Object.entries(sync().session.data.session_status).some(
      ([id, status]) => status.type !== "idle" && sync().session.data.info[id]?.directory === sdk().directory,
    )
  createEffect(
    on(
      () => active() && preference.open,
      (busy, previous) => {
        if (busy || previous) void update()
        if (!busy) return
        const timer = setInterval(() => void update(), 3000)
        onCleanup(() => clearInterval(timer))
      },
    ),
  )
  let eventTimer: ReturnType<typeof setTimeout> | undefined
  const stopEvents = sdk().event.listen((event) => {
    const type = event.details.current?.type ?? event.details.type
    if (
      ![
        "session.execution.succeeded",
        "session.execution.failed",
        "session.execution.interrupted",
        "session.idle",
      ].includes(type) &&
      !(event.details.type === "session.status" && event.details.properties.status.type === "idle")
    )
      return
    if (eventTimer) return
    eventTimer = setTimeout(() => {
      eventTimer = undefined
      void update()
    }, 180)
  })
  onCleanup(() => {
    stopEvents()
    clearTimeout(eventTimer)
  })
  const isFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files")

  return (
    <WorkspaceFilesContext.Provider
      value={{
        opened: () => preference.open,
        visible: () => !guide(),
        toggle: () => {
          if (state.sitePreview) {
            setState("sitePreview", false)
            setPreference("open", true)
            return
          }
          setPreference("open", !preference.open)
        },
        sites: () => sites.current,
        knownSites: () => sites.known,
        previewEnabled: () => sites.enabled,
        previewStatus: () => sites.status,
        refreshSites,
        openSite,
      }}
    >
      <div class="workspace-files-layout">
        <div
          class="workspace-files-content"
          on:click={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            const anchor =
              event.target instanceof Element
                ? event.target.closest<HTMLAnchorElement>("[data-slot='session-turn-assistant-content'] a[href]")
                : undefined
            const href = anchor?.getAttribute("href")
            if (!href) return
            const relative = siteFilePath(href, sdk().directory)
            if (!relative || !/\.[a-z0-9]+$/i.test(relative)) return
            event.preventDefault()
            event.stopPropagation()
            const epoch = siteEpoch
            void refreshSites().then(() => {
              if (disposed || epoch !== siteEpoch) return
              const site = sites.current.find(
                (site) => site.kind === "static" && `${site.path ? `${site.path}/` : ""}index.html` === relative,
              )
              if (site && sites.enabled) {
                openSite(site.path)
                return
              }
              setState("sitePreview", false)
              setPreference("open", true)
              preview(relative)
            })
          }}
        >
          {props.children}
        </div>
        <Show
          when={
            !guide() && state.sitePreview && props.sessionID
              ? { sessionID: props.sessionID!, path: state.sitePath }
              : undefined
          }
          keyed
        >
          {(selection) => (
            <SitePreview
              sessionID={selection.sessionID}
              path={selection.path}
              onClose={() => setState("sitePreview", false)}
            />
          )}
        </Show>
        <Show when={!guide() && preference.open && !state.sitePreview}>
          <aside
            class="workspace-files-panel"
            classList={{ "workspace-files-panel-preview": state.preview }}
            style={{ "--workspace-width": `${preference.width}px` }}
            id="gamma-workspace-files"
            aria-label={language.t("workspace.files.title")}
            onDragEnter={(event) => {
              if (!isFiles(event)) return
              event.preventDefault()
              event.stopPropagation()
              setState("drag", (depth) => depth + 1)
            }}
            onDragOver={(event) => {
              if (!isFiles(event)) return
              event.preventDefault()
              event.stopPropagation()
              if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
            }}
            onDragLeave={(event) => {
              event.stopPropagation()
              setState("drag", (depth) => Math.max(0, depth - 1))
            }}
            onDrop={(event) => {
              if (!isFiles(event)) return
              event.preventDefault()
              event.stopPropagation()
              setState("drag", 0)
              if (Array.from(event.dataTransfer?.items ?? []).some((item) => item.webkitGetAsEntry()?.isDirectory)) {
                setState("errors", [language.t("workspace.files.noFolders")])
                return
              }
              void upload(Array.from(event.dataTransfer?.files ?? []))
            }}
          >
            <ResizeHandle
              direction="horizontal"
              edge="start"
              size={preference.width}
              min={260}
              max={640}
              role="separator"
              aria-label={language.t("workspace.files.resize")}
              aria-orientation="vertical"
              tabIndex={0}
              aria-valuemin={260}
              aria-valuemax={640}
              aria-valuenow={preference.width}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
                event.preventDefault()
                setPreference(
                  "width",
                  Math.max(260, Math.min(640, preference.width + (event.key === "ArrowLeft" ? 20 : -20))),
                )
              }}
              onResize={(width) => setPreference("width", width)}
            />
            <div class="workspace-files-surface">
              <header>
                <div class="workspace-files-heading">
                  <strong>{language.t("workspace.files.title")}</strong>
                  <span title={sdk().directory}>
                    {language.t("onboarding.selected", {
                      name: sdk().directory.split("/").filter(Boolean).at(-1) ?? "",
                    })}
                  </span>
                </div>
                <Tooltip value={language.t("workspace.files.refresh")}>
                  <button aria-label={language.t("workspace.files.refresh")} onClick={() => void update()}>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.7"
                      aria-hidden="true"
                    >
                      <path d="M20 7v5h-5M4 17v-5h5M5.2 8a7 7 0 0 1 11.6-3L20 8M4 16l3.2 3A7 7 0 0 0 18.8 16" />
                    </svg>
                  </button>
                </Tooltip>
              </header>
              <div class="workspace-files-actions">
                <button disabled={!props.sessionID || state.uploading} onClick={() => input?.click()}>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 15V3m-4 4 4-4 4 4M4 15v5h16v-5" />
                  </svg>
                  <span>{language.t("workspace.files.upload")}</span>
                </button>
              </div>
              <input
                ref={input}
                type="file"
                multiple
                hidden
                aria-label={language.t("workspace.files.upload")}
                onChange={(event) => {
                  void upload(Array.from(event.currentTarget.files ?? []))
                  event.currentTarget.value = ""
                }}
              />
              <Show when={!props.sessionID}>
                <p class="workspace-files-hint">{language.t("workspace.files.needSession")}</p>
              </Show>
              <Show when={state.uploading}>
                <div class="workspace-files-progress" role="status">
                  <span>{state.current}</span>
                  <progress max="100" value={state.progress} />
                  <span>{state.progress}%</span>
                </div>
              </Show>
              <Show when={state.errors.length}>
                <div class="workspace-files-errors" role="alert">
                  <For each={state.errors}>{(error) => <p>{error}</p>}</For>
                </div>
              </Show>
              <Show
                when={state.preview}
                fallback={
                  <div class="workspace-files-browser">
                    <div class="workspace-files-list-heading">
                      <h2>{language.t("workspace.files.label")}</h2>
                      <Show when={file.tree.state("")?.loaded && !file.tree.state("")?.error}>
                        <span title={language.t("workspace.files.rootCount")}>
                          {language.plural(
                            "workspace.files.count",
                            file.tree.children("").filter((node) => node.type === "file").length,
                          )}
                        </span>
                      </Show>
                    </div>
                    <Show when={file.tree.state("")?.error}>
                      <div class="workspace-files-status" role="alert">
                        <p>{language.t("workspace.files.listError")}</p>
                        <button onClick={() => void refresh()}>{language.t("market.retry")}</button>
                      </div>
                    </Show>
                    <Show when={!file.tree.state("")?.loaded && !file.tree.state("")?.error}>
                      <div class="workspace-files-status" role="status">
                        <p>{language.t("common.loading")}</p>
                        <div class="workspace-files-skeleton" />
                        <div class="workspace-files-skeleton" />
                      </div>
                    </Show>
                    <div class="workspace-files-tree">
                      <FileTreeV2
                        folderIcons
                        active={state.selected}
                        draggable={false}
                        onFileClick={(node) => preview(node.path)}
                      />
                    </div>
                    <button
                      type="button"
                      class="workspace-files-dropzone"
                      disabled={!props.sessionID || state.uploading}
                      onClick={() => input?.click()}
                    >
                      <Icon name="cloud-upload" />
                      <strong>{language.t("workspace.files.drop")}</strong>
                      <span>{language.t("gamma.dropChoose")}</span>
                    </button>
                  </div>
                }
              >
                <WorkspaceFilePreview path={state.selected} onBack={() => setState("preview", false)} />
              </Show>
            </div>
            <section class="workspace-useful" aria-label={language.t("gamma.useful")}>
              <h2>{language.t("gamma.useful")}</h2>
              <button
                onClick={() =>
                  dialog.show(() => (
                    <Dialog>
                      <DialogHeader>
                        <DialogTitle>{language.t("gamma.docs")}</DialogTitle>
                      </DialogHeader>
                      <DialogBody>
                        <div class="workspace-documents">
                          <Show
                            when={file.tree.children("").some((node) => /\.(md|txt|rst)$/i.test(node.name))}
                            fallback={<p>{language.t("gamma.noDocs")}</p>}
                          >
                            <For
                              each={file.tree
                                .children("")
                                .filter((node) => node.type === "file" && /\.(md|txt|rst)$/i.test(node.name))}
                            >
                              {(node) => (
                                <button
                                  onClick={() => {
                                    dialog.close()
                                    preview(node.path)
                                  }}
                                >
                                  <Icon name="code-lines" />
                                  {node.name}
                                </button>
                              )}
                            </For>
                          </Show>
                        </div>
                      </DialogBody>
                    </Dialog>
                  ))
                }
              >
                <span class="workspace-useful-icon">
                  <Icon name="code-lines" />
                </span>
                <span>
                  <strong>{language.t("gamma.docs")}</strong>
                  <small>{language.t("gamma.docsSubtitle")}</small>
                </span>
              </button>
              <button onClick={() => command.trigger("mcp.toggle")}>
                <span class="workspace-useful-icon">
                  <Icon name="mcp" />
                </span>
                <span>
                  <strong>{language.t("gamma.integrations")}</strong>
                  <small>{language.t("gamma.integrationsSubtitle")}</small>
                </span>
              </button>
              <button
                onClick={() =>
                  dialog.show(() => (
                    <Dialog>
                      <DialogHeader>
                        <DialogTitle>{language.t("gamma.projectSettings")}</DialogTitle>
                      </DialogHeader>
                      <DialogBody>
                        <div class="workspace-documents">
                          <ProjectKnowledge server={server().server.http} directory={sdk().directory} />
                          <p>{language.t("gamma.projectSettingsDescription")}</p>
                          <code>{sdk().directory}</code>
                          <Show
                            when={file.tree.children("").some((node) => /^(opencode|gamma)\.jsonc?$/.test(node.name))}
                            fallback={<p>{language.t("gamma.noConfig")}</p>}
                          >
                            <For
                              each={file.tree
                                .children("")
                                .filter((node) => node.type === "file" && /^(opencode|gamma)\.jsonc?$/.test(node.name))}
                            >
                              {(node) => (
                                <button
                                  onClick={() => {
                                    dialog.close()
                                    preview(node.path)
                                  }}
                                >
                                  {node.name}
                                </button>
                              )}
                            </For>
                          </Show>
                        </div>
                      </DialogBody>
                    </Dialog>
                  ))
                }
              >
                <span class="workspace-useful-icon">
                  <Icon name="settings-gear" />
                </span>
                <span>
                  <strong>{language.t("gamma.projectSettings")}</strong>
                  <small>{language.t("gamma.projectSettingsSubtitle")}</small>
                </span>
              </button>
            </section>
            <Show when={state.drag > 0}>
              <div class="workspace-files-drop">
                <strong>{language.t("workspace.files.drop")}</strong>
                <span>{language.t("workspace.files.dropHint")}</span>
              </div>
            </Show>
          </aside>
        </Show>
      </div>
    </WorkspaceFilesContext.Provider>
  )
}
