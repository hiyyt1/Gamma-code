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
  shop?: string
  categories: string[]
  methods: string[]
  diagnostics?: Record<string, string>
  mcp: { portal: string }
  plans: {
    id: string
    summary: string
    operations: { method: string; params: object }[]
    state: string
    expires: number
  }[]
}

export function WildberriesConnection(props: {
  server: ServerConnection.HttpBase
  project: string
  onContinue?: (planId?: string) => Promise<unknown>
}) {
  const language = useLanguage()
  const [state, setState] = createStore<{ busy: boolean; result?: Status; error?: string }>({ busy: false })
  const identity = () => `${props.server.url}:${props.project}`
  const scopeLabels = {
    statistics: "wb.scope.statistics",
    content: "wb.scope.content",
    prices: "wb.scope.prices",
    advertising: "wb.scope.advertising",
    finance: "wb.scope.finance",
    analytics: "wb.scope.analytics",
    reviews: "wb.scope.reviews",
  } as const
  const label = (scope: string) => language.t(scopeLabels[scope as keyof typeof scopeLabels] ?? "wb.scopes")
  const api = () => `projects/${encodeURIComponent(props.project)}/wildberries`
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
              ? "wb.authRequired"
              : code === "wildberries_profile_required"
                ? "wb.applyFirst"
                : code === "browser_approval_required"
                  ? "wb.reconnect"
                  : code === "personal_requires_on_premise"
                    ? "wb.originDenied"
                    : code === "authorization_expired"
                      ? "wb.expired"
                      : code === "project_busy"
                        ? "wb.busy"
                        : "wb.failure",
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
    const token = String(data.get("token") ?? "")
    form.reset()
    if (
      !window.isSecureContext ||
      (!props.server.url.startsWith("https://") &&
        !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(props.server.url))
    ) {
      setState("error", language.t("wb.secureRequired"))
      return
    }
    const approvalKey = crypto.randomUUID() + crypto.randomUUID()
    const current = identity()
    void run("/connect", {
      token,
      categories: data.getAll("scope"),
      mode: data.get("mode"),
      allowWrites: data.get("allowWrites") === "on",
      approvalKey,
    }).then((ok) => {
      if (ok) {
        approvals.set(current, approvalKey)
        void props.onContinue?.().catch(() => setState("error", language.t("wb.continueFailed")))
      }
    })
  }
  return (
    <section class="bitrix24-connection">
      <h3>{language.t("wb.title")}</h3>
      <p>{language.t("wb.help")}</p>
      <p>{language.t("wb.setup")}</p>
      <Show when={!props.project}>
        <p>{language.t("wb.applyFirst")}</p>
      </Show>
      <button class="skill-market-toggle" disabled={!props.project || state.busy} onClick={() => void run()}>
        {language.t("wb.refresh")}
      </button>
      <Show when={state.result}>
        {(result) => (
          <>
            <p>
              {language.t(result().status === "connected" ? "wb.connected" : "wb.disconnected")} {result().shop}
            </p>
            <p>{language.t(result().mcp.portal === "connected" ? "wb.localReady" : "wb.localMissing")}</p>

            <p>
              {language.t("wb.scopes")}: {result().categories.map(label).join(", ")}
            </p>
            <For each={Object.entries(result().diagnostics ?? {}).filter(([, status]) => status !== "available")}>
              {([category]) => (
                <p>
                  {label(category)}: {language.t("wb.categoryUnavailable")}
                </p>
              )}
            </For>
            <Show when={result().status === "connected"}>
              <button
                class="skill-market-toggle"
                disabled={state.busy}
                onClick={() => {
                  approvals.delete(identity())
                  void run("/disconnect", {})
                }}
              >
                {language.t("wb.disconnect")}
              </button>
            </Show>
            <For each={result().plans.filter((plan) => plan.state === "pending")}>
              {(plan) => (
                <div class="bitrix24-plan">
                  <h4>{language.t("wb.plan")}</h4>
                  <p>{plan.summary}</p>
                  <p>{language.t("wb.approvalHelp")}</p>
                  <details>
                    <summary>{language.t("wb.details")}</summary>
                    <pre style={{ "white-space": "pre-wrap", "overflow-wrap": "anywhere" }}>
                      {JSON.stringify(plan.operations, null, 2)}
                    </pre>
                  </details>
                  <p>{language.t("wb.approvalHelp")}</p>
                  <Show when={!approvals.has(identity())}>
                    <p>{language.t("wb.reconnect")}</p>
                  </Show>
                  <button
                    class="skill-market-toggle"
                    disabled={state.busy || !approvals.has(identity()) || plan.expires < Date.now()}
                    onClick={() =>
                      void run(`/plans/${plan.id}`, { approved: true, approvalKey: approvals.get(identity()) })
                        .then((ok) => {
                          if (ok) return props.onContinue?.(plan.id)
                        })
                        .catch(() => setState("error", language.t("wb.continueFailed")))
                    }
                  >
                    {language.t("wb.approve")}
                  </button>
                  <button
                    class="skill-market-toggle"
                    disabled={state.busy || !approvals.has(identity())}
                    onClick={() =>
                      void run(`/plans/${plan.id}`, { approved: false, approvalKey: approvals.get(identity()) })
                    }
                  >
                    {language.t("wb.reject")}
                  </button>
                </div>
              )}
            </For>
          </>
        )}
      </Show>
      <form onSubmit={connect} autocomplete="off">
        <label>
          {language.t("wb.mode")}
          <select name="mode">
            <option value="sandbox">{language.t("wb.sandbox")}</option>
            <option value="personal">{language.t("wb.personal")}</option>
          </select>
        </label>
        <label>
          <input type="checkbox" name="allowWrites" />
          {language.t("wb.allowWrites")}
        </label>
        <label>
          {language.t("wb.token")}
          <input name="token" type="password" required autocomplete="new-password" spellcheck={false} />
        </label>
        <fieldset>
          <legend>{language.t("wb.scopes")}</legend>
          <For each={["statistics", "content", "prices", "advertising", "finance", "analytics", "reviews"]}>
            {(scope) => (
              <label>
                <input
                  type="checkbox"
                  name="scope"
                  value={scope}
                  checked={scope === "statistics" || scope === "content"}
                />
                {label(scope)}
              </label>
            )}
          </For>
        </fieldset>
        <button class="skill-market-toggle" type="submit" disabled={!props.project || state.busy}>
          {language.t("wb.connect")}
        </button>
      </form>
      <p>{language.t("wb.memoryOnly")}</p>
      <p>{language.t("wb.oauth")}</p>
      <button
        class="skill-market-toggle"
        disabled={!props.project || state.busy}
        onClick={() => void run("/check", {})}
      >
        {language.t("wb.check")}
      </button>
      <Show when={state.error}>
        <p role="alert">{state.error}</p>
      </Show>
    </section>
  )
}
