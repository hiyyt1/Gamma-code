import { For, Show, createResource, onCleanup, startTransition } from "solid-js"
import { createStore } from "solid-js/store"
import { A } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/switch"
import "./project-knowledge.css"
import { Popover } from "@opencode-ai/ui/popover"
import type { KnowledgeProject } from "@opencode-ai/schema/knowledge"
import type { ServerConnection } from "@/context/server"
import { useLanguage } from "@/context/language"
import { productRequest } from "@/utils/product"
import type { RemoteKnowledge } from "@/utils/knowledge-sync"

type Project = typeof KnowledgeProject.Type
export function ProjectKnowledge(props: {
  server: ServerConnection.HttpBase
  directory?: string
  compact?: boolean
  selected?: string[]
  onChange?: (ids: string[]) => void
  disabled?: boolean
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const [state, setState] = createStore({ busy: false, error: false, open: false, query: "", pending: "" })
  // Register before the enclosing dialog's Escape listener: dismiss the picker
  // first, preserving the project form and its selected spaces.
  const dismissPicker = (event: KeyboardEvent) => {
    if (!props.onChange || !state.open || event.key !== "Escape") return
    event.preventDefault()
    event.stopImmediatePropagation()
    setState("open", false)
  }
  window.addEventListener("keydown", dismissPicker, true)
  onCleanup(() => window.removeEventListener("keydown", dismissPicker, true))
  const [catalog, { refetch, mutate }] = createResource(
    () => ({ server: props.server, directory: props.directory }),
    async (key) => {
      setState("error", false)
      // Both routes share the store's publication lock; read them sequentially.
      return productRequest<RemoteKnowledge>(key.server, "knowledge")
        .then(async (data) => {
          const projects = key.directory ? await productRequest<Project[]>(key.server, "knowledge/projects") : []
          return { data, project: projects.find((project) => project.path === key.directory), directory: key.directory }
        })
        .catch(() => {
          setState("error", true)
          return undefined
        })
    },
  )
  // Knowledge metadata is optional to the chat. Its own loading UI must not
  // suspend the route while these requests are pending (including on refocus).
  const loaded = () => (catalog.loading ? undefined : catalog())
  // Returning from a preview iframe must not suspend the page during a click.
  const refresh = () =>
    void startTransition(() => {
      void refetch()
    })
  window.addEventListener("focus", refresh)
  onCleanup(() => window.removeEventListener("focus", refresh))
  const selected = () => props.selected ?? loaded()?.project?.spaces ?? []
  const toggle = async (id: string, checked: boolean) => {
    if (state.busy || props.disabled) return
    const ids = checked ? [...new Set([...selected(), id])] : selected().filter((value) => value !== id)
    if (props.onChange) return props.onChange(ids)
    const current = loaded()
    if (!current?.project || current.directory !== props.directory) return
    setState({ busy: true, error: false, pending: id })
    await productRequest<Project[]>(props.server, "knowledge/projects", { projectID: current.project.id, spaces: ids })
      .then((projects) => {
        if (current.directory !== props.directory) return
        mutate({ ...current, project: projects.find((project) => project.id === current.project!.id) })
      })
      .catch(() => {
        if (current.directory === props.directory) setState("error", true)
      })
      .finally(() => setState({ busy: false, pending: "" }))
  }
  const content = () => (
    <section class="flex flex-col gap-3" aria-label={language.t("knowledge.title")}>
      <p class="text-12 text-text-weak">{language.t("knowledge.project.hint")}</p>
      <Show when={!catalog.loading} fallback={<p>{language.t("knowledge.sync.loading")}</p>}>
        <Show
          when={props.onChange || loaded()?.project}
          fallback={<p class="text-12">{language.t("knowledge.project.notProduct")}</p>}
        >
          <div class="flex max-h-72 flex-col gap-3 overflow-y-auto">
            <For
              each={loaded()?.data.data.spaces}
              fallback={<p class="text-12">{language.t("knowledge.project.empty")}</p>}
            >
              {(space) => (
                <label class="flex items-start gap-3 text-13">
                  <input
                    type="checkbox"
                    aria-label={space.name}
                    class="mt-1"
                    checked={selected().includes(space.id)}
                    disabled={state.busy || props.disabled}
                    onChange={(event) => void toggle(space.id, event.currentTarget.checked)}
                  />
                  <span class="min-w-0 break-words">
                    <strong class="block">{space.name}</strong>
                    <Show when={space.description}>
                      <span class="block text-12 text-text-weak">{space.description}</span>
                    </Show>
                    <span class="block text-12 text-text-weak">
                      {language.t("knowledge.project.materials", {
                        count: loaded()?.data.data.sources.filter((source) => source.spaceID === space.id).length ?? 0,
                      })}
                    </span>
                  </span>
                </label>
              )}
            </For>
          </div>
        </Show>
      </Show>
      <Show when={state.error || catalog.error}>
        <p role="alert">{language.t("knowledge.sync.failed")}</p>
        <button type="button" onClick={() => void refetch()}>
          {language.t("knowledge.sync.refresh")}
        </button>
      </Show>
      <A class="text-13 text-text-interactive-base" href="/knowledge" onClick={() => setState("open", false)}>
        {language.t("knowledge.project.open")}
      </A>
    </section>
  )
  const picker = () => (
    <section class="gamma-knowledge-picker" aria-label={language.t("knowledge.title")}>
      <div class="gamma-knowledge-picker-label">
        <span>{language.t("knowledge.title")}</span>
        <span>{language.t("knowledge.project.optional")}</span>
      </div>
      <Popover
        title={language.t("knowledge.project.select")}
        class="gamma-knowledge-menu"
        modal
        placement="bottom-start"
        open={state.open}
        onOpenChange={(open) => setState("open", open)}
        triggerAs="button"
        triggerProps={{ type: "button", class: "gamma-knowledge-trigger", disabled: props.disabled }}
        trigger={
          <>
            <Icon name="folder" />
            <span>
              {selected().length
                ? language.t("knowledge.project.selected", { count: selected().length })
                : language.t("knowledge.project.select")}
            </span>
            <Icon name="chevron-down" />
          </>
        }
      >
        <Show when={(loaded()?.data.data.spaces.length ?? 0) > 6}>
          <input
            class="gamma-knowledge-search"
            type="search"
            aria-label={language.t("knowledge.project.search")}
            placeholder={language.t("knowledge.project.search")}
            value={state.query}
            onInput={(event) => setState("query", event.currentTarget.value)}
          />
        </Show>
        <Show when={!catalog.loading} fallback={<p>{language.t("knowledge.sync.loading")}</p>}>
          <div class="gamma-knowledge-options">
            <For
              each={loaded()?.data.data.spaces.filter((space) =>
                space.name.toLowerCase().includes(state.query.trim().toLowerCase()),
              )}
              fallback={
                <p>{language.t(state.query.trim() ? "knowledge.project.noMatches" : "knowledge.project.empty")}</p>
              }
            >
              {(space) => (
                <label class="gamma-knowledge-option" title={space.name}>
                  <input
                    type="checkbox"
                    aria-label={space.name}
                    checked={selected().includes(space.id)}
                    disabled={props.disabled}
                    onChange={(event) => void toggle(space.id, event.currentTarget.checked)}
                  />
                  <span>{space.name}</span>
                  <small>
                    {language.t("knowledge.project.materials", {
                      count: loaded()?.data.data.sources.filter((source) => source.spaceID === space.id).length ?? 0,
                    })}
                  </small>
                </label>
              )}
            </For>
          </div>
        </Show>
        <Show when={state.error}>
          <p role="alert">{language.t("knowledge.sync.failed")}</p>
          <button type="button" onClick={() => void refetch()}>
            {language.t("knowledge.sync.refresh")}
          </button>
        </Show>
        <A
          class="gamma-knowledge-menu-link"
          href="/knowledge"
          onClick={() => {
            setState("open", false)
            dialog.close()
          }}
        >
          {language.t("knowledge.project.open")}
        </A>
      </Popover>
      <p class="gamma-knowledge-hint">{language.t("knowledge.project.hint")}</p>
    </section>
  )
  return (
    <Show
      when={props.onChange}
      fallback={
        <Show
          when={props.compact}
          fallback={
            <section class="flex flex-col gap-3 border-t border-border-base pt-4">
              <h3>{language.t(props.onChange ? "knowledge.project.connect" : "knowledge.title")}</h3>
              {content()}
            </section>
          }
        >
          <Show when={loaded()?.project || state.error}>
            <Popover
              title={
                <span class="gamma-project-kb-heading">
                  <span class="gamma-project-kb-icon">
                    <Icon name="folder" />
                  </span>
                  <span>
                    {language.t("knowledge.title")}
                    <small>{language.t("knowledge.project.subtitle")}</small>
                  </span>
                </span>
              }
              class="gamma-project-kb"
              style={{ width: "360px", "max-width": "calc(100vw - 24px)" }}
              placement="bottom-end"
              open={state.open}
              onOpenChange={(open) => {
                setState("open", open)
                if (open) void refetch()
              }}
              triggerAs="button"
              triggerProps={{
                type: "button",
                class: "gamma-project-kb-trigger",
                "aria-label": language.t("knowledge.project.button", { count: selected().length }),
              }}
              trigger={
                <>
                  <Icon name="folder" size="small" />
                  <span class="gamma-project-kb-label">{language.t("knowledge.title")}</span>
                  <span class="gamma-project-kb-count">{selected().length}</span>
                </>
              }
            >
              <input
                class="gamma-project-kb-search"
                type="search"
                aria-label={language.t("knowledge.project.search")}
                placeholder={language.t("knowledge.project.search")}
                value={state.query}
                onInput={(event) => setState("query", event.currentTarget.value)}
              />
              <div class="gamma-project-kb-list" aria-busy={catalog.loading || state.busy}>
                <Show when={!catalog.loading} fallback={<p role="status">{language.t("knowledge.sync.loading")}</p>}>
                  <For
                    each={loaded()
                      ?.data.data.spaces.filter((space) =>
                        space.name.toLowerCase().includes(state.query.trim().toLowerCase()),
                      )
                      .sort((a, b) => Number(selected().includes(b.id)) - Number(selected().includes(a.id)))}
                    fallback={
                      <p>
                        {language.t(state.query.trim() ? "knowledge.project.noMatches" : "knowledge.project.empty")}
                      </p>
                    }
                  >
                    {(space) => (
                      <div
                        class="gamma-project-kb-row"
                        data-connected={selected().includes(space.id)}
                        data-pending={state.pending === space.id}
                      >
                        <span class="gamma-project-kb-folder">
                          <Icon name="folder" />
                        </span>
                        <span
                          class="gamma-project-kb-name"
                          title={
                            space.description
                              ? `${space.name}
${space.description}`
                              : space.name
                          }
                        >
                          {space.name}
                        </span>
                        <small>
                          {language.t("knowledge.project.materials", {
                            count:
                              loaded()?.data.data.sources.filter((source) => source.spaceID === space.id).length ?? 0,
                          })}
                        </small>
                        <Switch
                          hideLabel
                          checked={selected().includes(space.id)}
                          disabled={
                            state.busy ||
                            props.disabled ||
                            !loaded()?.project ||
                            loaded()?.directory !== props.directory
                          }
                          onChange={(checked) => void toggle(space.id, checked)}
                        >
                          {space.name}
                        </Switch>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
              <Show when={state.error || catalog.error}>
                <div class="gamma-project-kb-error">
                  <p role="alert">{language.t("knowledge.sync.failed")}</p>
                  <button type="button" disabled={state.busy} onClick={() => void refetch()}>
                    {language.t("knowledge.sync.refresh")}
                  </button>
                </div>
              </Show>
              <footer class="gamma-project-kb-footer">
                <span>{language.t("knowledge.project.connected", { count: selected().length })}</span>
                <A href="/knowledge" onClick={() => setState("open", false)}>
                  {language.t("knowledge.project.openBase")}
                </A>
              </footer>
            </Popover>
          </Show>
        </Show>
      }
    >
      {picker()}
    </Show>
  )
}
