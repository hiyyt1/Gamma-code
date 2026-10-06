import { createStore } from "solid-js/store"
import { ServerConnection } from "@/context/server"
import { createEffect, For, Show } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context/helper"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useCommand } from "@/context/command"
import { useLayout } from "@/context/layout"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeProjectsController } from "@/pages/home/home-projects-controller"
import { createHomeSessionsController } from "@/pages/home/home-sessions-controller"
import { HomeUtilityNav } from "@/pages/home/home-projects-view"
import { A, useNavigate } from "@solidjs/router"
import { ProductBrand } from "./product-brand"

// Share the existing Home view-models between the shell and the Home page.
export const OreshnikShell = createSimpleContext({
  name: "OreshnikShell",
  init: () => {
    const home = createHomeController()
    const layout = useLayout()
    const navigate = useNavigate()
    const command = useCommand()
    const projects = createHomeProjectsController(home)
    command.register("product", () => [
      {
        id: "product.new",
        title: projects.copy.language.t("command.session.new"),
        hidden: true,
        onSelect: home.project.openNewSession,
      },
    ])
    const sessions = createHomeSessionsController(home, () => layout.route().type === "home")
    const [navigation, setNavigation] = createStore<{ target?: { server: ServerConnection.Any; directory: string } }>(
      {},
    )
    createEffect(() => {
      const target = navigation.target
      if (!target || sessions.data.loading()) return
      if (home.selection.value().server !== ServerConnection.key(target.server)) return
      const session = sessions.data.records().find((record) => record.session.directory === target.directory)?.session
      setNavigation("target", undefined)
      if (session) return sessions.session.open(session)
      navigate("/")
    })
    return {
      home,
      sessions,
      projects: {
        ...projects,
        project: {
          ...projects.project,
          select: (server: ServerConnection.Any, directory: string) => {
            // Home selection only filters the session index. In the persistent
            // sidebar it must also activate the target's route and SDK scope.
            home.selection.set({ server: ServerConnection.key(server), directory })
            setNavigation("target", { server, directory })
          },
        },
      },
    }
  },
})

export function OreshnikSidebar(props: { tabsMount: (element: HTMLDivElement) => void }) {
  const shell = OreshnikShell.use()
  const command = useCommand()
  const layout = useLayout()
  const language = shell.sessions.copy.language

  return (
    <aside data-component="oreshnik-sidebar" class="flex min-h-0 flex-col gap-4 overflow-hidden">
      <A href="/" class="oreshnik-home-link" aria-label={language.t("app.name")}>
        <ProductBrand />
      </A>
      {
        <ButtonV2 size="large" variant="neutral" icon="plus" onClick={() => command.trigger("tab.new")}>
          {language.t("command.session.new")}
        </ButtonV2>
      }
      <h2 class="px-2">{language.t("home.projects")}</h2>
      <ScrollView class="min-h-0 shrink">
        <For each={shell.home.project.list()}>
          {(project) => (
            <button
              type="button"
              class="oreshnik-recent-item"
              aria-current={shell.home.selection.value().directory === project.worktree ? "page" : undefined}
              onClick={() => {
                const conn = shell.home.server.focused()
                if (conn) shell.projects.project.select(conn, project.worktree)
              }}
            >
              {project.name}
            </button>
          )}
        </For>
      </ScrollView>
      {
        <>
          <section class="oreshnik-recent" aria-label={language.t("sidebar.project.recentSessions")}>
            <h2>{language.t("sidebar.project.recentSessions")}</h2>
            <ScrollView class="min-h-0 flex-1">
              <For each={shell.sessions.data.records()}>
                {(record) => {
                  const selected = () => {
                    const route = layout.route()
                    return (
                      route.type === "session" &&
                      route.sessionId === record.session.id &&
                      route.server === shell.sessions.session.server()
                    )
                  }
                  return (
                    <button
                      type="button"
                      class="oreshnik-recent-item"
                      aria-current={selected() ? "page" : undefined}
                      title={record.session.title}
                      onClick={() => shell.sessions.session.open(record.session)}
                    >
                      <span>{record.session.title}</span>
                    </button>
                  )
                }}
              </For>
              <Show when={!shell.sessions.data.loading() && shell.sessions.data.records().length === 0}>
                <p class="px-2 text-v2-text-text-faint text-13">{language.t("home.sessions.empty")}</p>
              </Show>
            </ScrollView>
          </section>
          <details class="oreshnik-open-tabs">
            <summary>{language.t("app.openTabs")}</summary>
            <div ref={props.tabsMount} />
          </details>
        </>
      }
      <HomeUtilityNav
        class="oreshnik-sidebar-utility mt-auto flex"
        language={language}
        onOpenSettings={shell.projects.utility.settings}
        onOpenHelp={shell.projects.utility.help}
      />
    </aside>
  )
}
