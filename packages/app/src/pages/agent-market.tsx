import { For, Show, createMemo, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import type { ServerConnection } from "@/context/server"
import { useSearchParams } from "@solidjs/router"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import type { AgentMarket } from "@opencode-ai/schema/agent-market"
import { DialogProductProject } from "@/components/dialog-product-project"
import { GammaShell } from "@/components/gamma-shell"
import { useLanguage } from "@/context/language"
import { productRequest, type ProductProject } from "@/utils/product"
import "./skill-market.css"
import "./agent-market.css"
import { AgentRuntime } from "@/components/agent-runtime"
import { WildberriesConnection } from "@/components/wildberries-connection"
import { Bitrix24Connection } from "@/components/bitrix24-connection"
import { useQueryClient } from "@tanstack/solid-query"
import { normalizeAgentList } from "@/context/global-sync/utils"

const categories = ["all", "development", "design", "testing", "security", "automation", "data", "business"] as const
const icons = {
  development: "code",
  design: "edit",
  testing: "check",
  security: "shield",
  automation: "terminal",
  data: "models",
  business: "models",
} as const

export default function AgentMarketPage() {
  return <AgentMarketCatalog />
}

export function AgentMarketCatalog(props: {
  onSelect?: (agent: AgentMarket.Profile) => void
  server?: ServerConnection.HttpBase
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const shell = GammaShell.use()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const [state, setState] = createStore({
    query: "",
    category: "all",
    type: "specialist",
    project: typeof params.project === "string" ? params.project : "",
  })
  const [catalog, { refetch }] = createResource(
    () => props.server ?? shell.home.server.focused()?.http,
    (http) => productRequest<AgentMarket.Profile[]>(http, "agent-market/agents"),
  )
  // The page owns its loading/error UI. Reading a pending resource here would
  // suspend the router transition and keep the previous page (and URL) visible.
  const filtered = createMemo(() =>
    (catalog.loading || catalog.error ? [] : (catalog() ?? [])).filter(
      (agent) =>
        agent.type === state.type &&
        (state.category === "all" || agent.category === state.category) &&
        [agent.name, agent.description, ...agent.tasks, ...agent.skills]
          .join(" ")
          .toLocaleLowerCase()
          .includes(state.query.trim().toLocaleLowerCase()),
    ),
  )
  const featured = createMemo(() =>
    state.query || state.category !== "all" || state.type !== "specialist"
      ? []
      : ["gamma", "1c-developer", "bitrix24-developer", "website-builder"].flatMap((id) =>
          filtered().filter((agent) => agent.id === id),
        ),
  )
  const category = (value: (typeof categories)[number]) =>
    value === "business"
      ? language.t("wb.category")
      : value === "data"
        ? language.t("agents.category.data")
        : language.t(`market.category.${value}`)
  const use = (agent: AgentMarket.Profile) => {
    if (props.onSelect) {
      if (agent.available) props.onSelect(agent)
      return
    }
    if (agent.id === "gamma-guide") {
      void shell.home.project.help()
      return
    }
    const conn = shell.home.server.focused()
    if (!conn || !agent.available) return
    const requestId = crypto.randomUUID()
    const choose = async (project: ProductProject) => {
      const apply = async (connectSkills: boolean) => {
        const result = await productRequest<AgentMarket.Applied>(
          conn.http,
          `projects/${encodeURIComponent(project.name)}/sessions`,
          { agentId: agent.id, connectSkills, requestId },
        )
        const context = shell.home.server.context(conn)
        const agents = normalizeAgentList(
          (await context.sdk.createClient({ directory: project.path }).app.agents()).data ?? [],
        )
        queryClient.setQueryData([context.sdk.scope, project.path, "agents"], agents)
        context.sync.child(project.path)[1]("agent", agents)
        await shell.home.project.openSession(conn, project, result.sessionId)
        void shell.home.project.refresh()
        dialog.close()
      }
      dialog.show(() => {
        const [form, setForm] = createStore({ busy: false, error: "", connect: false })
        const submit = async () => {
          if (form.busy) return
          setForm({ busy: true, error: "" })
          await apply(form.connect)
            .catch((error: unknown) => {
              const code = error instanceof Error ? error.message : ""
              setForm(
                "error",
                language.t(
                  code === "project_busy"
                    ? "agents.error.busy"
                    : code === "version_conflict"
                      ? "agents.error.conflict"
                      : code.startsWith("skill") || code === "missing_dependency"
                        ? "agents.error.skills"
                        : "agents.error",
                ),
              )
            })
            .finally(() => setForm("busy", false))
        }
        return (
          <Dialog size="normal">
            <DialogHeader>
              <DialogTitle>{language.t("agents.use")}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <div class="skill-market-detail">
                <h3>
                  {project.name} · {agent.name}
                </h3>
                <p>{language.t("agents.session.fixed")}</p>
                <strong>{language.t("agents.preserved")}</strong>
                <Show when={agent.skills.length && !agent.source.startsWith("builtin:")}>
                  <p>{language.t(agent.skillBundle ? "agents.bundledSkills" : "agents.dependencies")}</p>
                  <ul>
                    <For each={agent.skills}>{(skill) => <li>{skill}</li>}</For>
                  </ul>
                  <Show when={!agent.skillBundle}>
                    <label>
                      <input
                        type="checkbox"
                        checked={form.connect}
                        disabled={form.busy}
                        onChange={(event) => setForm("connect", event.currentTarget.checked)}
                      />{" "}
                      {language.t("agents.connectSkills")}
                    </label>
                  </Show>
                </Show>
                <Show when={form.error}>
                  <p role="alert" class="skill-market-error">
                    {form.error}
                  </p>
                </Show>
                <div class="agent-market-actions">
                  <button class="agent-market-secondary" disabled={form.busy} onClick={() => dialog.close()}>
                    {language.t("agents.cancel")}
                  </button>
                  <button class="skill-market-toggle" disabled={form.busy} onClick={() => void submit()}>
                    {language.t(form.busy ? "market.saving" : "agents.use")}
                  </button>
                </div>
              </div>
            </DialogBody>
          </Dialog>
        )
      })
    }
    dialog.show(() => (
      <DialogProductProject
        server={conn.http}
        refresh={() => void shell.home.project.refresh()}
        choose={choose}
        preferredProject={state.project}
      />
    ))
  }
  const action = (agent: AgentMarket.Profile) => (
    <button class="skill-market-toggle" disabled={!agent.available} onClick={() => use(agent)}>
      {language.t("agents.use")}
      <span aria-hidden="true">→</span>
    </button>
  )
  const details = (agent: AgentMarket.Profile) =>
    dialog.show(() => (
      <Dialog size="large" containerClass="skill-market-dialog">
        <DialogHeader>
          <DialogTitle>{agent.name}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div class="skill-market-detail">
            <p>{agent.description}</p>
            {action(agent)}
            <h3>{language.t("agents.tasks")}</h3>
            <ul>
              <For each={agent.tasks}>{(task) => <li>{task}</li>}</For>
            </ul>
            <h3>{language.t("agents.skills")}</h3>
            <p>{agent.skills.join(", ") || language.t("agents.noSkills")}</p>
            <h3>{language.t("agents.tools")}</h3>
            <p>{agent.tools.join(", ")}</p>
            <Show when={agent.environment?.length}>
              <h3>{language.t("agents.runtime.requirements")}</h3>
              <ul>
                <For each={agent.environment}>{(item) => <li>{item}</li>}</For>
              </ul>
            </Show>
            <Show when={agent.limitations?.length}>
              <h3>{language.t(agent.mcp === "bitrix24" ? "bitrix.limitations" : "agents.runtime.limitations")}</h3>
              <ul>
                <For each={agent.limitations}>{(item) => <li>{item}</li>}</For>
              </ul>
            </Show>
            <Show
              when={
                (agent.mcp === "bsl-language-server" || agent.mcp === "presentation") && shell.home.server.focused()
              }
            >
              {(conn) => <AgentRuntime server={conn().http} project={state.project} agentId={agent.id} />}
            </Show>
            <Show when={agent.mcp === "bitrix24" && shell.home.server.focused()}>
              {(conn) => <Bitrix24Connection server={conn().http} project={state.project} />}
            </Show>
            <Show when={agent.mcp === "wildberries" && shell.home.server.focused()}>
              {(conn) => <WildberriesConnection server={conn().http} project={state.project} />}
            </Show>
            <Show when={agent.members.length}>
              <h3>{language.t("agents.members")}</h3>
              <ul>
                <For each={agent.members}>
                  {(id) => <li>{catalog()?.find((item) => item.id === id)?.name ?? id}</li>}
                </For>
              </ul>
            </Show>
            <h3>{language.t("agents.permissions")}</h3>
            <p>
              {Object.entries(agent.permissions)
                .map(([key, value]) => `${key}: ${value}`)
                .join(" · ")}
            </p>
            <h3>{language.t("market.source")}</h3>
            <Show when={!agent.source.startsWith("builtin:")} fallback={<span>{language.t("agents.system")}</span>}>
              <a href={agent.source} target="_blank" rel="noopener noreferrer">
                {agent.source}
              </a>
            </Show>
            <p>
              <code>{agent.revision}</code> · {agent.license}
            </p>
            <p>{agent.reason}</p>
          </div>
        </DialogBody>
      </Dialog>
    ))
  const card = (agent: AgentMarket.Profile) => (
    <article class="agent-market-card" data-agent={agent.id}>
      <div
        class="agent-market-art"
        data-category={agent.category}
        data-agent={agent.id}
        data-type={agent.type}
        aria-hidden="true"
      >
        <span class="agent-market-art-orbit" />
        <span class="agent-market-art-tile">
          <Icon
            name={
              agent.id === "website-builder"
                ? "window-cursor"
                : agent.type === "team"
                  ? "models"
                  : icons[agent.category]
            }
          />
        </span>
      </div>
      <div class="agent-market-card-copy">
        <h3>{agent.name}</h3>
        <p>{agent.description}</p>
        <div class="agent-market-tags">
          <span>{category(agent.category)}</span>
          <For each={agent.tasks.slice(0, 2)}>{(task) => <span>{task}</span>}</For>
          <Show when={!agent.available}>
            <span class="agent-market-unavailable">{language.t("agents.unavailable")}</span>
          </Show>
        </div>
      </div>
      <div class="agent-market-card-actions">
        <button class="agent-market-secondary" onClick={() => details(agent)}>
          {language.t("agents.details")}
        </button>
        {action(agent)}
      </div>
    </article>
  )
  return (
    <section class="skill-market agent-market">
      <div class="skill-market-inner">
        <div class="skill-market-intro">
          <div class="skill-market-toolbar">
            <label class="skill-market-search">
              <Icon name="magnifying-glass" />
              <input
                type="search"
                aria-label={language.t("agents.search")}
                placeholder={language.t("agents.search")}
                value={state.query}
                onInput={(event) => setState("query", event.currentTarget.value)}
              />
            </label>
            <Show when={!props.onSelect}>
              <label class="skill-market-project">
                <Icon name="folder" />
                <select
                  aria-label={language.t("market.project")}
                  value={state.project}
                  onChange={(event) => setState("project", event.currentTarget.value)}
                >
                  <option value="">{language.t("market.project")}</option>
                  <For each={shell.home.project.list()}>
                    {(project) => <option value={project.name}>{project.name}</option>}
                  </For>
                </select>
              </label>
            </Show>
          </div>
          <Show when={!props.onSelect}>
            <header class="skill-market-hero">
              <div class="market-hero-copy">
                <div class="skill-market-eyebrow">
                  <Icon name="plus" /> {language.t("agents.heroTitle")}
                </div>
                <h1>{language.t("agents.title")}</h1>
                <p class="market-hero-lead">{language.t("agents.subtitle")}</p>
                <p class="skill-market-subtitle">{language.t("agents.heroDescription")}</p>
                <div class="market-hero-actions">
                  <button
                    type="button"
                    class="market-hero-primary"
                    onClick={() =>
                      dialog.show(() => (
                        <Dialog size="normal">
                          <DialogHeader>
                            <DialogTitle>{language.t("market.how")}</DialogTitle>
                          </DialogHeader>
                          <DialogBody>
                            <div class="skill-market-help">
                              <p>{language.t("agents.scopeDescription")}</p>
                              <p>{language.t("agents.session.fixed")}</p>
                            </div>
                          </DialogBody>
                        </Dialog>
                      ))
                    }
                  >
                    <span aria-hidden="true">▷</span>
                    {language.t("market.how")}
                  </button>
                  <button
                    type="button"
                    class="market-hero-secondary"
                    onClick={() =>
                      dialog.show(() => (
                        <Dialog size="normal">
                          <DialogHeader>
                            <DialogTitle>{language.t("agents.createOwn")}</DialogTitle>
                          </DialogHeader>
                          <DialogBody>
                            <div class="skill-market-help">
                              <p>{language.t("market.comingSoon")}</p>
                            </div>
                          </DialogBody>
                        </Dialog>
                      ))
                    }
                  >
                    <Icon name="plus" />
                    {language.t("agents.createOwn")}
                  </button>
                </div>
              </div>
            </header>
          </Show>
        </div>
        <div class="agent-market-filters">
          <div class="agent-market-tabs" role="tablist" aria-label={language.t("agents.title")}>
            <For each={["specialist", "team"] as const}>
              {(type) => (
                <button role="tab" aria-selected={state.type === type} onClick={() => setState("type", type)}>
                  {language.t(`agents.${type}`)}
                </button>
              )}
            </For>
          </div>
          <nav class="skill-market-categories" aria-label={language.t("market.categories")}>
            <For each={categories}>
              {(value) => (
                <button aria-pressed={state.category === value} onClick={() => setState("category", value)}>
                  {category(value)}
                </button>
              )}
            </For>
          </nav>
        </div>
        <Show
          when={!catalog.error}
          fallback={
            <div class="skill-market-state" role="alert">
              <p>{language.t("market.error")}</p>
              <button class="skill-market-toggle" onClick={() => refetch()}>
                {language.t("market.retry")}
              </button>
            </div>
          }
        >
          <Show
            when={!catalog.loading}
            fallback={
              <div class="agent-market-list" aria-busy="true">
                <For each={[1, 2, 3, 4, 5, 6]}>{() => <div class="skill-market-skeleton" />}</For>
              </div>
            }
          >
            <Show when={filtered().length} fallback={<p class="skill-market-state">{language.t("market.empty")}</p>}>
              <Show when={featured().length}>
                <section
                  class="skill-market-section skill-market-featured agent-market-featured"
                  aria-labelledby="agents-featured-title"
                >
                  <div class="skill-market-section-heading">
                    <div>
                      <h2 id="agents-featured-title">{language.t("agents.popularRoles")}</h2>
                      <p>{language.t("agents.popularSubtitle")}</p>
                    </div>
                    <a href="#agents-all-title">
                      {language.t("market.viewAll")} <span aria-hidden="true">→</span>
                    </a>
                  </div>
                  <div class="skill-market-grid">
                    <For each={featured()}>
                      {(agent) => (
                        <button
                          type="button"
                          class="agent-market-featured-card"
                          data-agent={agent.id}
                          onClick={() => details(agent)}
                        >
                          <span class="skill-market-icon" data-category={agent.category}>
                            <Icon name={agent.id === "website-builder" ? "window-cursor" : icons[agent.category]} />
                          </span>
                          <strong>{agent.name}</strong>
                          <p>{agent.description}</p>
                          <span class="market-featured-arrow" aria-hidden="true">
                            →
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                </section>
              </Show>
              <section class="skill-market-section" aria-labelledby="agents-all-title">
                <div class="skill-market-section-heading">
                  <div>
                    <h2 id="agents-all-title">{language.t("agents.all")}</h2>
                    <p>{language.t("agents.subtitle")}</p>
                  </div>
                </div>
                <div class="agent-market-list">
                  <For each={filtered()}>{card}</For>
                </div>
              </section>
            </Show>
          </Show>
        </Show>
      </div>
    </section>
  )
}
