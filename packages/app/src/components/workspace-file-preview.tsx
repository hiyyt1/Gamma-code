import { createEffect, Match, Switch, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { Icon } from "@opencode-ai/ui/icon"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { PresentationPreview } from "./presentation-preview"

export function WorkspaceFilePreview(props: { path: string; onBack: () => void }) {
  const file = useFile()
  const language = useLanguage()
  const component = useFileComponent()
  const [state, setState] = createStore({ copied: false, copyError: false, imageError: false })
  const current = () => file.get(props.path)
  const content = () => current()?.content
  const image = () =>
    content()?.encoding === "base64" && /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(content()?.mimeType ?? "")
  createEffect(() => {
    props.path
    content()
    setState({ copied: false, copyError: false, imageError: false })
  })
  const copy = async () => {
    const text = content()
    if (text?.type !== "text") return
    await navigator.clipboard.writeText(text.content).then(
      () => setState({ copied: true, copyError: false }),
      () => setState("copyError", true),
    )
  }

  return (
    <section class="workspace-files-preview" aria-label={language.t("workspace.files.preview")}>
      <div class="workspace-files-preview-toolbar">
        <button
          onClick={props.onBack}
          aria-label={language.t("workspace.files.back")}
          title={language.t("workspace.files.back")}
        >
          <Icon name="arrow-left" />
        </button>
        <strong title={props.path}>{props.path}</strong>
        <Show when={content()?.type === "text" && !current()?.error}>
          <button
            onClick={() => void copy()}
            aria-label={language.t(state.copied ? "workspace.files.copied" : "workspace.files.copy")}
            title={language.t(state.copied ? "workspace.files.copied" : "workspace.files.copy")}
          >
            <Icon name={state.copied ? "check" : "copy"} />
          </button>
        </Show>
      </div>
      <Show when={state.copyError}>
        <p role="alert" class="workspace-files-status">
          {language.t("workspace.files.copyError")}
        </p>
      </Show>
      <Switch>
        <Match when={/\.(pptx|presentation\.json)$/i.test(props.path)}>
          <PresentationPreview path={props.path} />
        </Match>
        <Match when={current()?.error}>
          <div class="workspace-files-status" role="alert">
            <p>
              {language.t(
                current()?.error === "too_large" ? "workspace.files.previewTooLarge" : "workspace.files.readError",
              )}
            </p>
            <button onClick={() => void file.load(props.path, { force: true })}>{language.t("market.retry")}</button>
          </div>
        </Match>
        <Match when={!current()?.loaded}>
          <p class="workspace-files-status" role="status">
            {language.t("common.loading")}
          </p>
        </Match>
        <Match when={content()?.type === "text"}>
          <div class="workspace-files-preview-content">
            <Dynamic
              component={component}
              mode="text"
              file={{ name: props.path, contents: content()?.content ?? "" }}
            />
          </div>
        </Match>
        <Match when={image() && !state.imageError}>
          <div class="workspace-files-preview-content workspace-files-image">
            <img
              alt={props.path}
              src={`data:${content()?.mimeType};base64,${content()?.content}`}
              onError={() => setState("imageError", true)}
            />
          </div>
        </Match>
        <Match when={true}>
          <p class="workspace-files-status">{language.t("workspace.files.unsupported")}</p>
        </Match>
      </Switch>
    </section>
  )
}
