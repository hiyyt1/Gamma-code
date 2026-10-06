import { createEffect, For, on, onCleanup, Show, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { Persist, persisted } from "@/utils/persist"
import { authTokenFromCredentials } from "@/utils/server"
import FileTreeV2 from "./file-tree-v2"
import { SessionFileView } from "@/pages/session/file-tabs"
import "./workspace-files.css"

export function WorkspaceFiles(props: ParentProps<{ sessionID?: string }>) {
  const file = useFile()
  const sdk = useSDK()
  const server = useServerSDK()
  const language = useLanguage()
  const dialog = useDialog()
  const [preference, setPreference] = persisted(Persist.global("workspace-files"), createStore({ open: true }))
  const [state, setState] = createStore({
    disposed: false,
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
  let previewID: string | undefined
  onCleanup(() => {
    disposed = true
    setState("disposed", true)
    request?.abort()
    if (previewID && dialog.active?.id === previewID) dialog.close()
  })
  createEffect(
    on(
      () => [sdk().directory, preference.open] as const,
      () => {
        setState({ selected: "", drag: 0 })
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
          if (!disposed && event.lengthComputable) setState("progress", Math.round((event.loaded / event.total) * 100))
        }
        xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300 ? undefined : (xhr.response?.code ?? "failed"))
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
      if (sdk().directory === directory) await file.tree.refresh("")
    }
    if (!disposed) setState({ uploading: false, current: "", progress: 0 })
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

  const preview = async (path: string) => {
    setState("selected", path)
    void file.load(path, { force: true })
    await dialog.show(() => (
      <Show when={!state.disposed}>
        <Dialog title={path} size="x-large">
          <div class="workspace-file-preview">
            <SessionFileView tab={file.tab(path)} />
          </div>
        </Dialog>
      </Show>
    ))
    previewID = dialog.active?.id
    if (disposed && previewID) dialog.close()
  }
  const isFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files")

  return (
    <div class="workspace-files-layout">
      <div class="workspace-files-content">{props.children}</div>
      <Show when={!preference.open}>
        <button class="workspace-files-reopen" onClick={() => setPreference("open", true)}>
          {language.t("workspace.files.open")}
        </button>
      </Show>
      <Show when={preference.open}>
        <aside
          class="workspace-files-panel"
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
          <header>
            <strong>{language.t("workspace.files.title")}</strong>
            <button aria-label={language.t("workspace.files.refresh")} onClick={() => void refresh()}>
              ↻
            </button>
            <button aria-label={language.t("workspace.files.close")} onClick={() => setPreference("open", false)}>
              ›
            </button>
          </header>
          <div class="workspace-files-actions">
            <button disabled={!props.sessionID || state.uploading} onClick={() => input?.click()}>
              {language.t("workspace.files.upload")}
            </button>
            <span>{sdk().directory.split("/").filter(Boolean).at(-1)}</span>
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
          <div class="workspace-files-tree">
            <FileTreeV2 active={state.selected} draggable={false} onFileClick={(node) => preview(node.path)} />
          </div>
          <Show when={state.drag > 0}>
            <div class="workspace-files-drop">
              <strong>{language.t("workspace.files.drop")}</strong>
              <span>{language.t("workspace.files.dropHint")}</span>
            </div>
          </Show>
        </aside>
      </Show>
    </div>
  )
}
