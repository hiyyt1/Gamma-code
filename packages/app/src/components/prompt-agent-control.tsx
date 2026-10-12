import { createMemo, createResource, Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import type { AgentMarket } from "@opencode-ai/schema/agent-market"
import type { PromptInputControls } from "./prompt-input/contracts"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { productRequest } from "@/utils/product"
import "./prompt-agent-control.css"

export function PromptAgentControl(props: { agents: PromptInputControls["agents"]; sessionID?: string }) {
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useServerSDK()
  const [catalog] = createResource(
    () => sdk().server.http,
    (http) => productRequest<AgentMarket.Profile[]>(http, "agent-market/agents").catch(() => []),
  )
  const name = createMemo(() => {
    const current = props.agents.current
    if (current === "gamma" || (!current && !props.sessionID)) return language.t("agents.standard")
    // A display name must not hold the session's navigation transition open.
    return (
      (catalog.loading
        ? undefined
        : catalog()?.find((agent) => agent.id === current || `gamma-${agent.id}` === current)?.name) ??
      (current || language.t("agents.session.unknown"))
    )
  })
  const choose = async () => {
    if (props.sessionID) return
    const { DialogAgentPicker } = await import("./dialog-agent-picker")
    dialog.show(() => (
      <DialogAgentPicker
        server={sdk().server.http}
        current={props.agents.current || "gamma"}
        onSelect={(agent) => {
          props.agents.select(agent.id === "gamma" || agent.id === "gamma-guide" ? agent.id : `gamma-${agent.id}`)
          dialog.close()
        }}
      />
    ))
  }
  return (
    <button
      type="button"
      data-action="prompt-agent"
      data-agent={props.agents.current || (props.sessionID ? undefined : "gamma")}
      disabled={!!props.sessionID || props.agents.loading}
      title={language.t(props.sessionID ? "agents.session.fixed" : "agents.title")}
      class="flex h-7 max-w-[240px] shrink-0 items-center gap-1.5 rounded-md border border-border-base px-2 text-13-medium text-text-base bg-background-base hover:bg-surface-base-hover disabled:cursor-default"
      onClick={() => void choose()}
    >
      <Icon name="brain" size="small" />
      <span class="truncate">{name()}</span>
      <Show when={!props.sessionID}>
        <Icon name="chevron-down" size="small" />
      </Show>
    </button>
  )
}
