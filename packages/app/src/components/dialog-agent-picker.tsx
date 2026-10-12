import { createMemo, createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { Icon } from "@opencode-ai/ui/icon"
import type { AgentMarket } from "@opencode-ai/schema/agent-market"
import type { ServerConnection } from "@/context/server"
import { useLanguage } from "@/context/language"
import { productRequest } from "@/utils/product"
import "./dialog-agent-picker.css"

export function DialogAgentPicker(props: {
  server: ServerConnection.HttpBase
  current: string
  onSelect: (agent: AgentMarket.Profile) => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({ query: "" })
  const [catalog, { refetch }] = createResource(
    () => props.server,
    (server) => productRequest<AgentMarket.Profile[]>(server, "agent-market/agents"),
  )
  const query = createMemo(() => state.query.trim().toLocaleLowerCase())
  const frequent = createMemo(() =>
    ["gamma", "1c-developer", "bitrix24-developer", "website-builder"].flatMap((id) =>
      (catalog() ?? []).filter((agent) => agent.id === id),
    ),
  )
  const agents = createMemo(() =>
    (catalog() ?? []).filter((agent) =>
      query()
        ? `${agent.name} ${agent.description}`.toLocaleLowerCase().includes(query())
        : !frequent().some((item) => item.id === agent.id),
    ),
  )
  const row = (agent: AgentMarket.Profile) => {
    const selected = () => props.current === agent.id || props.current === `gamma-${agent.id}`
    return (
      <button
        type="button"
        class="agent-picker-row"
        data-agent={agent.id}
        aria-pressed={selected()}
        disabled={!agent.available}
        onClick={() => props.onSelect(agent)}
      >
        <span class="agent-picker-icon" aria-hidden="true">
          <Icon
            name={
              agent.id === "website-builder"
                ? "window-cursor"
                : agent.id === "gamma"
                  ? "brain"
                  : agent.type === "team"
                    ? "models"
                    : "code"
            }
            size="small"
          />
        </span>
        <span class="agent-picker-copy">
          <span class="agent-picker-name">{agent.name}</span>
          <span class="agent-picker-description" title={agent.description}>
            {agent.description}
          </span>
          <Show when={!agent.available}>
            <span class="agent-picker-description">{language.t("agents.unavailable")}</span>
          </Show>
        </span>
        <span class="agent-picker-check" aria-hidden="true">
          <Show when={selected()}>
            <Icon name="check" size="small" />
          </Show>
        </span>
      </button>
    )
  }
  return (
    <Dialog containerClass="agent-picker">
      <DialogHeader>
        <DialogTitle>{language.t("agents.picker.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <label class="agent-picker-search">
          <Icon name="magnifying-glass" size="small" />
          <input
            autofocus
            type="search"
            aria-label={language.t("agents.search")}
            placeholder={language.t("agents.search")}
            value={state.query}
            onInput={(event) => setState("query", event.currentTarget.value)}
          />
        </label>
        <Show
          when={!catalog.error}
          fallback={
            <div class="agent-picker-state" role="alert">
              <p>{language.t("market.error")}</p>
              <button type="button" onClick={() => refetch()}>
                {language.t("market.retry")}
              </button>
            </div>
          }
        >
          <Show
            when={!catalog.loading}
            fallback={
              <div class="agent-picker-state" role="status">
                {language.t("common.loading")}
              </div>
            }
          >
            <Show when={!query() && frequent().length}>
              <section class="agent-picker-frequent" aria-label={language.t("agents.picker.frequent")}>
                <h3>{language.t("agents.picker.frequent")}</h3>
                <div class="agent-picker-grid">
                  <For each={frequent()}>{row}</For>
                </div>
              </section>
            </Show>
            <h3 class="agent-picker-list-title">{language.t("agents.all")}</h3>
            <div class="agent-picker-list" role="region" aria-label={language.t("agents.all")} tabindex="0">
              <For
                each={agents()}
                fallback={
                  <p class="agent-picker-state" role="status">
                    {language.t("palette.empty")}
                  </p>
                }
              >
                {row}
              </For>
            </div>
          </Show>
        </Show>
      </DialogBody>
    </Dialog>
  )
}
