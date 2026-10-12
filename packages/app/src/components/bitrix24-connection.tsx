import { createEffect, For, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import type { ServerConnection } from "@/context/server"
import { useLanguage } from "@/context/language"
import { productRequest } from "@/utils/product"
import "./bitrix24-connection.css"

// Browser memory only. Neither localStorage, chat, project files nor server env.
const approvals = new Map<string, string>()
type Status = {
  status: string
  portal?: string
  scopes: string[]
  methods: string[]
  mcp: { portal: string; docs: string }
  plans: {
    id: string
    summary: string
    operations: { method: string; params: object }[]
    state: string
    expires: number
  }[]
}

export function Bitrix24Connection(props: { server: ServerConnection.HttpBase; project: string }) {
  const language = useLanguage()
  const [state, setState] = createStore<{ busy: boolean; result?: Status; error?: string }>({ busy: false })
  const identity = () => `${props.server.url}:${props.project}`
  const scopeLabels = {
    crm: "bitrix.scope.crm",
    task: "bitrix.scope.task",
    user: "bitrix.scope.user",
    bizproc: "bitrix.scope.bizproc",
    event: "bitrix.scope.event",
    placement: "bitrix.scope.placement",
  } as const
  const label = (scope: string) => language.t(scopeLabels[scope as keyof typeof scopeLabels] ?? "bitrix.scopes")
  const api = () => `projects/${encodeURIComponent(props.project)}/bitrix24`
  const run = async (suffix = "", body?: object) => {
    if (!props.project || state.busy) return
    const current = identity()
    setState({ busy: true, error: undefined })
    return productRequest<Status>(props.server, api() + suffix, body)
      .then((result) => {
        if (current === identity()) setState("result", result)
        return current === identity()
      })
      .catch((error: unknown) => {
        if (current !== identity()) return
        const code = error instanceof Error ? error.message : ""
        setState(
          "error",
          language.t(
            code === "server_auth_required"
              ? "bitrix.authRequired"
              : code === "bitrix24_profile_required"
                ? "bitrix.applyFirst"
                : code === "browser_approval_required"
                  ? "bitrix.reconnect"
                  : code === "portal_origin_not_allowed"
                    ? "bitrix.originDenied"
                    : code === "authorization_expired"
                      ? "bitrix.expired"
                      : code === "project_busy"
                        ? "bitrix.busy"
                        : "bitrix.failure",
          ),
        )
        return false
      })
      .finally(() => {
        if (current === identity()) setState("busy", false)
      })
  }
  createEffect(() => {
    identity()
    setState({ result: undefined, error: undefined, busy: false })
    untrack(() => void run())
  })
  const connect = (event: SubmitEvent) => {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const data = new FormData(form)
    const webhook = String(data.get("webhook") ?? "")
    form.reset()
    if (
      !window.isSecureContext ||
      (!props.server.url.startsWith("https://") &&
        !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(props.server.url))
    ) {
      setState("error", language.t("bitrix.secureRequired"))
      return
    }
    const approvalKey = crypto.randomUUID() + crypto.randomUUID()
    const current = identity()
    void run("/connect", { webhook, scopes: data.getAll("scope"), approvalKey }).then((ok) => {
      if (ok) approvals.set(current, approvalKey)
    })
  }
  return (
    <section class="bitrix24-connection">
      <h3>{language.t("bitrix.title")}</h3>
      <p>{language.t("bitrix.help")}</p>
      <p>{language.t("bitrix.setup")}</p>
      <Show when={!props.project}>
        <p>{language.t("bitrix.applyFirst")}</p>
      </Show>
      <button class="skill-market-toggle" disabled={!props.project || state.busy} onClick={() => void run()}>
        {language.t("bitrix.refresh")}
      </button>
      <Show when={state.result}>
        {(result) => (
          <>
            <p>
              {language.t(result().status === "connected" ? "bitrix.connected" : "bitrix.disconnected")}{" "}
              {result().portal}
            </p>
            <p>{language.t(result().mcp.portal === "connected" ? "bitrix.localReady" : "bitrix.localMissing")}</p>
            <p>{language.t(result().mcp.docs === "connected" ? "bitrix.docsReady" : "bitrix.docsMissing")}</p>
            <p>
              {language.t("bitrix.scopes")}: {result().scopes.map(label).join(", ")}
            </p>
            <Show when={result().status === "connected"}>
              <button
                class="skill-market-toggle"
                disabled={state.busy}
                onClick={() => {
                  approvals.delete(identity())
                  void run("/disconnect", {})
                }}
              >
                {language.t("bitrix.disconnect")}
              </button>
            </Show>
            <For each={result().plans.filter((plan) => plan.state === "pending")}>
              {(plan) => (
                <div class="bitrix24-plan">
                  <h4>{language.t("bitrix.plan")}</h4>
                  <p>{plan.summary}</p>
                  <For each={plan.operations}>
                    {(operation) => (
                      <p>
                        {language.t(
                          operation.method.endsWith(".delete") || operation.method.endsWith(".terminate")
                            ? "bitrix.delete"
                            : operation.method.endsWith(".add")
                              ? "bitrix.create"
                              : "bitrix.change",
                        )}
                        :{" "}
                        {label(
                          operation.method.startsWith("tasks.")
                            ? "task"
                            : operation.method.startsWith("userfield")
                              ? "crm"
                              : operation.method.split(".")[0],
                        )}
                      </p>
                    )}
                  </For>
                  <details>
                    <summary>{language.t("bitrix.details")}</summary>
                    <pre style={{ "white-space": "pre-wrap", "overflow-wrap": "anywhere" }}>
                      {JSON.stringify(plan.operations, null, 2)}
                    </pre>
                  </details>
                  <p>{language.t("bitrix.approvalHelp")}</p>
                  <Show when={!approvals.has(identity())}>
                    <p>{language.t("bitrix.reconnect")}</p>
                  </Show>
                  <button
                    class="skill-market-toggle"
                    disabled={state.busy || !approvals.has(identity()) || plan.expires < Date.now()}
                    onClick={() =>
                      void run(`/plans/${plan.id}`, { approved: true, approvalKey: approvals.get(identity()) })
                    }
                  >
                    {language.t("bitrix.approve")}
                  </button>
                  <button
                    class="skill-market-toggle"
                    disabled={state.busy || !approvals.has(identity())}
                    onClick={() =>
                      void run(`/plans/${plan.id}`, { approved: false, approvalKey: approvals.get(identity()) })
                    }
                  >
                    {language.t("bitrix.reject")}
                  </button>
                </div>
              )}
            </For>
          </>
        )}
      </Show>
      <form onSubmit={connect} autocomplete="off">
        <label>
          {language.t("bitrix.webhook")}
          <input name="webhook" type="password" required autocomplete="new-password" spellcheck={false} />
        </label>
        <fieldset>
          <legend>{language.t("bitrix.scopes")}</legend>
          <For each={["crm", "task", "user", "bizproc", "event"]}>
            {(scope) => (
              <label>
                <input type="checkbox" name="scope" value={scope} checked={scope === "crm" || scope === "task"} />
                {label(scope)}
              </label>
            )}
          </For>
        </fieldset>
        <button class="skill-market-toggle" type="submit" disabled={!props.project || state.busy}>
          {language.t("bitrix.connect")}
        </button>
      </form>
      <p>{language.t("bitrix.memoryOnly")}</p>
      <p>{language.t("bitrix.oauth")}</p>
      <button
        class="skill-market-toggle"
        disabled={!props.project || state.busy}
        onClick={() => void run("/check", {})}
      >
        {language.t("bitrix.check")}
      </button>
      <Show when={state.error}>
        <p role="alert">{state.error}</p>
      </Show>
    </section>
  )
}
