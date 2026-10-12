import { For, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { GammaShell } from "@/components/gamma-shell"
import { useLanguage } from "@/context/language"
import "./home-onboarding.css"

export function HomeOnboarding() {
  const shell = GammaShell.use()
  const language = useLanguage()
  const scenarios = [
    {
      title: "dashboard.website",
      description: "onboarding.website.description",
      example: "onboarding.website.example",
      icon: "window-cursor",
    },
    {
      title: "onboarding.bot.title",
      description: "onboarding.bot.description",
      example: "onboarding.bot.example",
      icon: "bubble-5",
    },
    {
      title: "onboarding.app.title",
      description: "onboarding.app.description",
      example: "onboarding.app.example",
      icon: "code",
    },
    { title: "dashboard.other", description: "dashboard.otherDescription", icon: "plus", example: undefined },
  ] as const
  const busy = () => shell.home.project.choosing()
  const populated = () => shell.home.project.list().length > 0

  return (
    <section
      class="gamma-dashboard"
      classList={{ "gamma-dashboard-empty": !populated() }}
      aria-labelledby="dashboard-title"
    >
      <Show
        when={shell.home.project.ready()}
        fallback={
          <Show
            when={shell.home.project.failed()}
            fallback={
              <div class="gamma-dashboard-loading" role="status">
                <p>{language.t("dashboard.loading")}</p>
                <div class="gamma-dashboard-grid" aria-hidden="true">
                  <For each={[1, 2, 3]}>{() => <div />}</For>
                </div>
              </div>
            }
          >
            <div class="gamma-dashboard-error" role="alert">
              <p>{language.t("dashboard.error")}</p>
              <button type="button" onClick={() => void shell.home.project.refresh()}>
                {language.t("market.retry")}
              </button>
            </div>
          </Show>
        }
      >
        <header class="gamma-dashboard-header">
          <div>
            <Show when={!populated()}>
              <span class="gamma-dashboard-mark">
                <Icon name="folder" size="large" />
              </span>
            </Show>
            <h1 id="dashboard-title">{language.t(populated() ? "onboarding.projects" : "onboarding.title")}</h1>
            <p>{language.t(populated() ? "dashboard.description" : "dashboard.emptyDescription")}</p>
          </div>
          <button
            class="gamma-dashboard-primary"
            type="button"
            disabled={busy()}
            onClick={() => shell.home.project.create()}
          >
            <Icon name="plus" />
            {language.t(populated() ? "dashboard.newProject" : "dashboard.firstProject")}
          </button>
        </header>
        <Show when={shell.home.project.error()}>
          <p role="alert" class="gamma-dashboard-error">
            {language.t("product.projects.sessionFailed", { code: shell.home.project.error() })}
          </p>
        </Show>
        <Show
          when={populated()}
          fallback={
            <div class="gamma-dashboard-examples">
              <For each={scenarios}>
                {(scenario) => (
                  <button
                    type="button"
                    disabled={busy()}
                    onClick={() =>
                      shell.home.project.create(scenario.example ? language.t(scenario.example) : undefined)
                    }
                  >
                    <span class="gamma-dashboard-example-icon">
                      <Icon name={scenario.icon} size="large" />
                    </span>
                    <strong>{language.t(scenario.title)}</strong>
                    <span>{language.t(scenario.description)}</span>
                    <Icon name="arrow-right" />
                  </button>
                )}
              </For>
            </div>
          }
        >
          <div class="gamma-dashboard-grid">
            <For each={shell.home.project.list()}>
              {(project) => (
                <button
                  class="gamma-dashboard-card"
                  type="button"
                  disabled={busy() || shell.sessions.data.loading()}
                  onClick={() => {
                    const connection = shell.home.server.focused()
                    if (connection) shell.projects.project.select(connection, project.worktree)
                  }}
                >
                  <span class="gamma-dashboard-folder">
                    <Icon name="folder" size="large" />
                  </span>
                  <h2>{project.name}</h2>
                  <span class="gamma-dashboard-card-footer">
                    {language.t("dashboard.open")}
                    <Icon name="arrow-right" />
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  )
}
