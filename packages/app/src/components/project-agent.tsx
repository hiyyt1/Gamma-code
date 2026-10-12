import { useServerSync } from "@/context/server-sync"
import { createResource, onCleanup, Show, startTransition, type JSX } from "solid-js"
import { A } from "@solidjs/router"
import type { AgentMarket } from "@opencode-ai/schema/agent-market"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { productRequest } from "@/utils/product"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { AgentRuntime } from "./agent-runtime"
import { WildberriesConnection } from "./wildberries-connection"
import { Bitrix24Connection } from "./bitrix24-connection"

export function ProjectAgent(props: { trigger: (label: string, open: () => void) => JSX.Element }) {
  const sdk = useSDK()
  const layout = useLayout()
  const server = useServerSDK()
  const language = useLanguage()
  const dialog = useDialog()
  const sync = useServerSync()
  const agent = () => {
    const route = layout.route()
    return route.type === "session" ? sync().session.data.info[route.sessionId]?.agent : undefined
  }
  const project = () => sdk().directory.split("/").filter(Boolean).at(-1) ?? ""
  const label = () =>
    active()?.name ??
    (agent() === "gamma" ? language.t("agents.standard") : agent()) ??
    language.t("agents.session.unknown")
  const [active, { refetch }] = createResource(
    () => ({ http: server().server.http, agent: agent() }),
    async (key) => {
      if (!key.agent || !key.agent.startsWith("gamma-") || key.agent === "gamma-guide") return null
      return productRequest<AgentMarket.Profile>(
        key.http,
        `agent-market/agents/${encodeURIComponent(key.agent.replace(/^gamma-/, ""))}`,
      )
    },
  )
  // Keep the current UI mounted when focus returns from a preview iframe.
  const refresh = () =>
    void startTransition(() => {
      void refetch()
    })
  window.addEventListener("focus", refresh)
  onCleanup(() => {
    window.removeEventListener("focus", refresh)
  })
  const open = () =>
    dialog.show(() => (
      <Dialog size="normal">
        <DialogHeader>
          <DialogTitle>{label()}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div class="skill-market-detail">
            <p>
              {active()?.description ?? language.t(agent() ? "agents.scopeDescription" : "agents.session.unresolved")}
            </p>
            <p>{language.t("agents.session.fixed")}</p>
            <Show when={active()?.mcp === "bsl-language-server" || active()?.mcp === "presentation"}>
              <AgentRuntime server={server().server.http} project={project()} agentId={active()!.id} />
            </Show>
            <Show when={active()?.mcp === "wildberries"}>
              <WildberriesConnection
                server={server().server.http}
                project={project()}
                onContinue={async (planId) => {
                  const route = layout.route()
                  if (route.type !== "session") return
                  await sdk().client.session.promptAsync({
                    sessionID: route.sessionId,
                    agent: "gamma-wildberries-manager",
                    parts: [
                      {
                        type: "text",
                        text: planId ? language.t("wb.continuePlan", { planId }) : language.t("wb.continueConnected"),
                      },
                    ],
                  })
                  dialog.close()
                }}
              />
            </Show>
            <Show when={active()?.mcp === "bitrix24"}>
              <Bitrix24Connection server={server().server.http} project={project()} />
            </Show>
            <A
              class="skill-market-toggle"
              href={`/agents?project=${encodeURIComponent(project())}`}
              onClick={() => dialog.close()}
            >
              {language.t("agents.title")}
            </A>
          </div>
        </DialogBody>
      </Dialog>
    ))
  return <Show when={layout.route().type === "session"}>{props.trigger(label(), open)}</Show>
}
