import { createEffect, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { AgentMarket } from "@opencode-ai/schema/agent-market"
import type { ServerConnection } from "@/context/server"
import { useLanguage } from "@/context/language"
import { productRequest } from "@/utils/product"

export function AgentRuntime(props: { server: ServerConnection.HttpBase; project: string; agentId: string }) {
  const language = useLanguage()
  const [state, setState] = createStore<{ busy: boolean; result?: AgentMarket.Runtime; error?: string }>({
    busy: false,
  })
  const identity = () => `${props.server.url}:${props.project}:${props.agentId}`
  createEffect(() => {
    identity()
    setState({ busy: false, result: undefined, error: undefined })
  })
  const check = async () => {
    if (!props.project || state.busy) return
    const current = identity()
    setState({ busy: true, result: undefined, error: undefined })
    await productRequest<AgentMarket.Runtime>(
      props.server,
      `projects/${encodeURIComponent(props.project)}/agent-check`,
      { agentId: props.agentId },
    )
      .then((result) => current === identity() && setState("result", result))
      .catch(
        (error: unknown) =>
          current === identity() &&
          setState("error", error instanceof Error ? error.message : language.t("agents.runtime.failed")),
      )
      .finally(() => current === identity() && setState("busy", false))
  }
  return (
    <div class="skill-market-detail">
      <h3>{language.t("agents.runtime.title")}</h3>
      <p>
        {language.t(
          state.result?.status === "ready"
            ? "agents.runtime.ready"
            : state.result?.status === "failed"
              ? "agents.runtime.failed"
              : "agents.runtime.unchecked",
        )}
      </p>
      <Show when={state.result}>
        <p>{language.t(state.result?.sourceTools ? "agents.runtime.pythonReady" : "agents.runtime.pythonMissing")}</p>
        <p>{state.result?.tools.join(", ")}</p>
        <Show when={state.result?.error || state.result?.sourceError}>
          <pre style={{ "white-space": "pre-wrap", "overflow-wrap": "anywhere" }}>
            {[state.result?.error, state.result?.sourceError].filter(Boolean).join("\n")}
          </pre>
        </Show>
      </Show>
      <Show when={state.error}>
        <p role="alert">{state.error}</p>
      </Show>
      <button class="skill-market-toggle" disabled={!props.project || state.busy} onClick={() => void check()}>
        {language.t(state.busy ? "agents.runtime.checking" : "agents.runtime.check")}
      </button>
    </div>
  )
}
