import { For, Show, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useLanguage } from "@/context/language"
import { productRequest, type ProductProject } from "@/utils/product"
import type { ServerConnection } from "@/context/server"

export function DialogProductProject(props: {
  server: ServerConnection.HttpBase
  choose: (project: ProductProject) => Promise<void>
  refresh: () => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({ create: false, name: "", busy: false, error: "", stage: "list" })
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
          project ?? (await productRequest<ProductProject>(props.server, "projects", { name: state.name }))
        props.refresh()
        setState("stage", "session")
        await props.choose(selected)
      })
      .catch((error: unknown) => setState("error", error instanceof Error ? error.message : "unavailable"))
      .finally(() => setState("busy", false))
  }
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t(state.create ? "product.projects.create" : "product.projects.choose")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="p-5 flex flex-col gap-4 min-w-80">
        <Show
          when={state.create}
          fallback={
            <>
              <ButtonV2 size="large" icon="plus" disabled={state.busy} onClick={() => setState("create", true)}>
                {language.t("product.projects.create")}
              </ButtonV2>
              <h2>{language.t("product.projects.existing")}</h2>
              <div class="flex flex-col gap-2 max-h-80 overflow-auto">
                <For each={projects()}>
                  {(project) => (
                    <ButtonV2 size="large" disabled={state.busy} onClick={() => void submit(project)}>
                      {project.name}
                    </ButtonV2>
                  )}
                </For>
              </div>
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
            <label class="flex flex-col gap-2">
              {language.t("product.projects.name")}
              <input
                autofocus
                class="rounded-lg border border-border-base p-3"
                value={state.name}
                maxLength={120}
                required
                disabled={state.busy}
                onInput={(event) => setState("name", event.currentTarget.value)}
              />
            </label>
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
