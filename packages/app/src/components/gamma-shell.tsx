import { createStore } from "solid-js/store"
import { ServerConnection } from "@/context/server"
import { createEffect, For, Show, onCleanup, untrack } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context/helper"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useCommand } from "@/context/command"
import { useLayout } from "@/context/layout"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeProjectsController } from "@/pages/home/home-projects-controller"
import { createHomeSessionsController } from "@/pages/home/home-sessions-controller"
import { HomeUtilityNav } from "@/pages/home/home-projects-view"
import { A } from "@solidjs/router"
import { ProductBrand } from "./product-brand"
import { createEmptySessionLifecycle } from "@/utils/empty-session"
import { productRequest } from "@/utils/product"
import { notifySessionTabsRemoved } from "./titlebar-session-events"
import { useGammaAuth } from "@/context/gamma-auth"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"

// Share the existing Home view-models between the shell and the Home page.
export const GammaShell = createSimpleContext({
  name: "GammaShell",
  init: () => {
    const home = createHomeController()
    const layout = useLayout()
    const command = useCommand()
    const projects = createHomeProjectsController(home)
    const lifecycle = createEmptySessionLifecycle({
      discard: async (previous: { sessionID: string; server: string; connection: ServerConnection.Any }) => {
        const result = await productRequest<{ removed: boolean }>(
          previous.connection.http,
          `session/${encodeURIComponent(previous.sessionID)}/discard-empty`,
          {},
          undefined,
          true,
        )
        if (!result.removed) return
        const context = home.server.context(previous.connection)
        const info = context.sync.session.data.info[previous.sessionID]
        context.sync.session.apply({ type: "session.deleted", properties: { sessionID: previous.sessionID } })
        context.sync.homeSessions.remove(previous.sessionID)
        notifySessionTabsRemoved({
          server: ServerConnection.key(previous.connection),
          directory: info?.directory ?? "",
          sessionIDs: [previous.sessionID],
        })
      },
    })
    const cleanupError = (error: unknown) => console.warn("Empty session cleanup failed", error)
    createEffect(() => {
      const route = layout.route()
      const connection =
        route.type === "session"
          ? home.server.list().find((item) => ServerConnection.key(item) === route.server)
          : undefined
      untrack(() => {
        void lifecycle
          .visit(
            route.type === "session" && connection
              ? { sessionID: route.sessionId, server: ServerConnection.key(connection), connection }
              : undefined,
          )
          .catch(cleanupError)
      })
    })
    const leave = () => {
      void lifecycle.visit().catch(cleanupError)
    }
    window.addEventListener("pagehide", leave)
    onCleanup(() => {
      window.removeEventListener("pagehide", leave)
      leave()
    })
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
      if (session) {
        // The target route resolves lineage and gates workspace providers until
        // its directory is known. Commit navigation before that network request.
        sessions.session.open(session)
        return
      }
      home.project.openProjectNewSession(target.server, target.directory)
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

export function GammaSidebar(props: { tabsMount: (element: HTMLDivElement) => void }) {
  const auth = useGammaAuth()
  const shell = GammaShell.use()
  const command = useCommand()
  const layout = useLayout()
  const language = shell.sessions.copy.language

  return (
    <aside data-component="gamma-sidebar" class="gamma-sidebar-inner flex min-h-0 flex-col overflow-hidden">
      <A href="/" class="gamma-home-link" aria-label={language.t("app.name")}>
        <ProductBrand />
      </A>
      {
        <ButtonV2
          class="gamma-new-chat"
          size="large"
          variant="neutral"
          icon="plus"
          onClick={() => command.trigger("tab.new")}
        >
          {language.t("command.session.new")}
        </ButtonV2>
      }
      <div class="gamma-sidebar-shortcuts">
        <A href="/agents" end class="gamma-sidebar-item" onClick={() => layout.mobileSidebar.hide()}>
          <span class="gamma-sidebar-item-icon">
            <Icon name="models" />
          </span>
          <span class="gamma-sidebar-item-copy">
            <span class="gamma-sidebar-item-title">{language.t("product.navigation.agents")}</span>
            <span class="gamma-sidebar-item-subtitle">{language.t("product.navigation.agentsDescription")}</span>
          </span>
        </A>
        <A href="/knowledge" end class="gamma-sidebar-item" onClick={() => layout.mobileSidebar.hide()}>
          <span class="gamma-sidebar-item-icon">
            <Icon name="dot-grid" />
          </span>
          <span class="gamma-sidebar-item-copy">
            <span class="gamma-sidebar-item-title">{language.t("knowledge.title")}</span>
            <span class="gamma-sidebar-item-subtitle">{language.t("knowledge.subtitle")}</span>
          </span>
        </A>
      </div>
      <section class="gamma-projects" aria-label={language.t("home.projects")}>
        <h2 class="gamma-sidebar-heading">{language.t("home.projects")}</h2>
        <ScrollView class="min-h-0 shrink">
          <For each={shell.home.project.list()}>
            {(project) => (
              <button
                type="button"
                class="gamma-recent-item"
                aria-current={shell.home.selection.value().directory === project.worktree ? "page" : undefined}
                onClick={() => {
                  const conn = shell.home.server.focused()
                  if (conn) shell.projects.project.select(conn, project.worktree)
                }}
              >
                <Icon name="folder" />
                <span>{project.name}</span>
              </button>
            )}
          </For>
        </ScrollView>
      </section>
      {
        <>
          <section class="gamma-recent" aria-label={language.t("sidebar.project.recentSessions")}>
            <h2 class="gamma-sidebar-heading">{language.t("sidebar.project.recentSessions")}</h2>
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
                      class="gamma-recent-item"
                      aria-current={selected() ? "page" : undefined}
                      title={record.session.title}
                      onClick={() => shell.sessions.session.open(record.session)}
                    >
                      <Icon name="bubble-5" />
                      <span>{record.session.title}</span>
                    </button>
                  )
                }}
              </For>
              <Show when={!shell.sessions.data.loading() && shell.sessions.data.records().length === 0}>
                <p class="gamma-sidebar-empty text-v2-text-text-faint text-13">{language.t("home.sessions.empty")}</p>
              </Show>
            </ScrollView>
          </section>
          <details class="gamma-open-tabs">
            <summary>{language.t("app.openTabs")}</summary>
            <div ref={props.tabsMount} />
          </details>
        </>
      }
      <HomeUtilityNav
        class="gamma-sidebar-utility mt-auto flex"
        language={language}
        onOpenSettings={shell.projects.utility.settings}
        onOpenHelp={shell.projects.utility.help}
      />
      <MenuV2 placement="top-start">
        <MenuV2.Trigger class="gamma-user-profile">
          <span class="gamma-user-avatar" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 21v-3a7 7 0 0 1 14 0v3" />
            </svg>
          </span>
          <span>
            <strong>{auth?.username() || language.t("gamma.profile")}</strong>
            <small>{language.t("gamma.profileSubtitle")}</small>
          </span>
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content>
            <MenuV2.Item onSelect={shell.projects.utility.settings}>{language.t("command.settings.open")}</MenuV2.Item>
            <Show when={auth}>
              <MenuV2.Item onSelect={() => void auth?.logout()}>{language.t("auth.logout")}</MenuV2.Item>
            </Show>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </aside>
  )
}
