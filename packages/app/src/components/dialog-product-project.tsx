import { ProjectKnowledge } from "./project-knowledge"
import type { KnowledgeProject } from "@opencode-ai/schema/knowledge"
import { For, Show, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog, DialogBody, DialogHeader, DialogTitle, DialogTitleGroup } from "@opencode-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { productRequest, type ProductProject } from "@/utils/product"
import type { ServerConnection } from "@/context/server"
import "./dialog-product-project.css"

export function DialogProductProject(props: {
  server: ServerConnection.HttpBase
  choose: (project: ProductProject) => Promise<void>
  refresh: () => void
  preferredProject?: string
  initialCreate?: boolean
  context?: string
}) {
  const language = useLanguage()
  const [state, setState] = createStore({
    create: props.initialCreate ?? false,
    name: "",
    spaces: [] as string[],
    busy: false,
    error: "",
    stage: "list",
    created: undefined as ProductProject | undefined,
  })
  const [projects] = createResource(() =>
    productRequest<ProductProject[]>(props.server, "projects").catch((error: unknown) => {
      setState("error", error instanceof Error ? error.message : "unavailable")
      return []
    }),
  )
  const submit = async (project?: ProductProject) => {
    if (state.busy) return
    setState({ busy: true, error: "", stage: project ? "session" : "create" })
    await Promise.resolve()
      .then(async () => {
        const selected =
          project ??
          state.created ??
          (await productRequest<ProductProject>(props.server, "projects", { name: state.name }))
        if (!project) setState("created", selected)
        if (!project && state.spaces.length) {
          setState("stage", "knowledge")
          const projects = await productRequest<(typeof KnowledgeProject.Type)[]>(props.server, "knowledge/projects")
          const registered = projects.find((item) => item.path === selected.path)
          if (!registered) throw new Error("not_found")
          await productRequest(props.server, "knowledge/projects", { projectID: registered.id, spaces: state.spaces })
        }
        props.refresh()
        setState("stage", "session")
        await props.choose(selected)
      })
      .catch((error: unknown) => setState("error", error instanceof Error ? error.message : "unavailable"))
      .finally(() => setState("busy", false))
  }
  return (
    <Dialog fit containerClass="gamma-project-picker-container" class="gamma-project-picker">
      <DialogHeader>
        <Show
          when={state.create}
          fallback={
            <DialogTitleGroup
              title={language.t("product.projects.choose")}
              description={language.t("product.projects.chooseDescription")}
            />
          }
        >
          <DialogTitle>{language.t("product.projects.create")}</DialogTitle>
        </Show>
      </DialogHeader>
      <DialogBody>
        <Show
          when={state.create}
          fallback={
            <>
              <button
                type="button"
                class="gamma-project-create"
                aria-label={language.t("product.projects.create")}
                disabled={state.busy}
                onClick={() => setState("create", true)}
              >
                <span class="gamma-project-create-icon">
                  <Icon name="plus" />
                </span>
                <span class="gamma-project-create-copy">
                  <span class="gamma-project-create-title">{language.t("product.projects.create")}</span>
                  <span class="gamma-project-create-description">
                    {language.t("product.projects.createDescription")}
                  </span>
                </span>
              </button>
              <section class="gamma-project-list-section">
                <h2>{language.t("product.projects.existing")}</h2>
                <div class="gamma-project-list">
                  <For
                    each={[...(projects() ?? [])].sort(
                      (a, b) => Number(b.name === props.preferredProject) - Number(a.name === props.preferredProject),
                    )}
                  >
                    {(project) => (
                      <button
                        type="button"
                        class="gamma-project-row"
                        disabled={state.busy}
                        onClick={() => void submit(project)}
                      >
                        <Icon name="folder" />
                        <span class="gamma-project-row-name">{project.name}</span>
                        <Icon name="chevron-right" />
                      </button>
                    )}
                  </For>
                </div>
              </section>
            </>
          }
        >
          <form
            class="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <Show when={props.context}>
              <p class="text-13 text-text-weak">{props.context}</p>
            </Show>
            <label class="flex flex-col gap-2">
              {language.t("product.projects.name")}
              <input
                autofocus
                class="rounded-lg border border-border-base p-3"
                value={state.name}
                maxLength={120}
                required
                disabled={state.busy || !!state.created}
                onInput={(event) => setState("name", event.currentTarget.value)}
              />
            </label>
            <ProjectKnowledge
              server={props.server}
              selected={state.spaces}
              onChange={(spaces) => setState("spaces", spaces)}
              disabled={state.busy}
            />
            <ButtonV2 type="submit" size="large" disabled={state.busy || !state.name.trim()}>
              {language.t("product.projects.create")}
            </ButtonV2>
          </form>
        </Show>
        <Show when={state.error}>
          <p role="alert">
            {language.t(
              state.error === "exists"
                ? "product.projects.exists"
                : state.error === "invalid_name"
                  ? "product.projects.invalid"
                  : state.error === "invalid_response"
                    ? "product.projects.incompatible"
                    : state.error === "permission_denied"
                      ? "product.projects.denied"
                      : state.error === "network_error"
                        ? "product.projects.network"
                        : state.error === "http_401" || state.error === "http_403"
                          ? "product.projects.auth"
                          : state.error === "navigation_failed"
                            ? "product.projects.navigationFailed"
                            : state.stage === "knowledge"
                              ? "knowledge.project.failed"
                              : state.stage === "session"
                                ? "product.projects.sessionFailed"
                                : state.stage === "create"
                                  ? "product.projects.createFailed"
                                  : "product.projects.listFailed",
              { code: state.error },
            )}
          </p>
        </Show>
      </DialogBody>
    </Dialog>
  )
}
