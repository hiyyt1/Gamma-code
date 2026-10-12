import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogProductProject } from "@/components/dialog-product-project"
import { productRequest, type ProductProject } from "@/utils/product"
import type { LocalProject } from "@/context/layout"
import { useGlobal } from "@/context/global"
import { type HomeProjectSelection, useLayout } from "@/context/layout"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useTabs } from "@/context/tabs"
import { toggleHomeProjectSelection } from "@/pages/layout/helpers"
import { createEffect, createMemo, createResource, createComponent, startTransition } from "solid-js"
import { createStore } from "solid-js/store"
import { useOnboarding } from "@/context/onboarding"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"

export function createHomeController() {
  const sync = useServerSync()
  const layout = useLayout()
  const server = useServer()
  const global = useGlobal()
  const tabs = useTabs()
  const dialog = useDialog()
  const onboarding = useOnboarding()
  const language = useLanguage()
  const [state, setState] = createStore({ catalogFailed: false, choosing: false, error: "" })
  const selection = layout.home.selection
  const focusedServer = createMemo(
    () => global.servers.list().find((conn) => ServerConnection.key(conn) === selection().server) ?? server.current,
  )
  const focusedServerCtx = createMemo(() => {
    const conn = focusedServer()
    if (!conn) return undefined
    return global.ensureServerCtx(conn)
  })
  const focusedSync = () => focusedServerCtx()?.sync ?? sync()
  const [catalog, { refetch }] = createResource(focusedServer, async (conn) => {
    setState("catalogFailed", false)
    return productRequest<ProductProject[]>(conn.http, "projects").catch(() => {
      setState("catalogFailed", true)
      return []
    })
  })
  const projects = createMemo<LocalProject[]>(() =>
    (catalog() ?? []).map((project) => ({ name: project.name, worktree: project.path, expanded: true, sandboxes: [] })),
  )
  const recentlyClosed = () => [] as LocalProject[]
  const homedir = () => ""
  const selectedProject = createMemo(() => projects().find((project) => project.worktree === selection().directory))
  const newSessionProject = createMemo(
    () =>
      selectedProject() ??
      projects().find((project) => project.worktree === focusedServerCtx()?.projects.last()) ??
      projects()[0],
  )

  createEffect(() => {
    const list = global.servers.list()
    if (list.some((conn) => ServerConnection.key(conn) === selection().server)) return
    const conn = list.find((conn) => ServerConnection.key(conn) === server.key) ?? list[0]
    if (conn) setSelection({ server: ServerConnection.key(conn) })
  })

  function setSelection(next: HomeProjectSelection) {
    layout.home.setSelection(next)
  }

  async function openSession(conn: ServerConnection.Any, project: ProductProject, sessionID: string, text?: string) {
    const ctx = global.ensureServerCtx(conn)
    if (text) onboarding.stage(ctx.sdk.scope, sessionID, text)
    ctx.projects.open(project.path)
    ctx.projects.touch(project.path)
    setSelection({ server: ServerConnection.key(conn), directory: project.path })
    try {
      await startTransition(() => {
        const tab = tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: sessionID })
        tabs.select(tab)
      })
    } catch (cause) {
      throw new Error("navigation_failed", { cause })
    }
  }

  function openProjectNewSession(conn: ServerConnection.Any, directory?: string, text?: string, create = false) {
    if (state.choosing) return
    setState({ choosing: true, error: "" })
    // Both paths create only a session. A directory is created exclusively by the picker.
    const choose = async (project: ProductProject) => {
      const ctx = global.ensureServerCtx(conn)
      ctx.projects.open(project.path)
      ctx.projects.touch(project.path)
      setSelection({ server: ServerConnection.key(conn), directory: project.path })
      await tabs.newDraft({ server: ServerConnection.key(conn), directory: project.path }, text)
    }
    if (directory) {
      void choose({ path: directory, name: "" })
        .catch((error: unknown) => {
          const code = error instanceof Error ? error.message : "unavailable"
          setState("error", code)
          showToast({
            title: language.t(
              code === "navigation_failed" ? "product.projects.navigationFailed" : "product.projects.sessionFailed",
              { code },
            ),
          })
        })
        .finally(() => setState("choosing", false))
      return
    }
    void dialog.show(
      () =>
        createComponent(DialogProductProject, {
          server: conn.http,
          initialCreate: create,
          context: text,
          refresh: () => {
            void refetch()
          },
          choose: async (project) => {
            await choose(project)
            dialog.close()
          },
        }),
      () => setState("choosing", false),
    )
  }

  return {
    selection: {
      value: selection,
      set: setSelection,
      focusServer: (conn: ServerConnection.Any) => setSelection({ server: ServerConnection.key(conn) }),
    },
    server: {
      list: global.servers.list,
      health: (conn: ServerConnection.Any) => global.servers.health[ServerConnection.key(conn)],
      context: (conn: ServerConnection.Any) => global.ensureServerCtx(conn),
      focused: focusedServer,
      focusedContext: focusedServerCtx,
      focusedSync,
    },
    project: {
      help: async () => {
        const conn = focusedServer()
        if (!conn || state.choosing) return
        setState("choosing", true)
        await productRequest<{ id: string; directory: string }>(conn.http, "help/session", {})
          .then((session) => openSession(conn, { name: "Gamma Guide", path: session.directory }, session.id))
          .catch(() => showToast({ title: language.t("agents.error"), variant: "error" }))
          .finally(() => setState("choosing", false))
      },
      ready: () => !!focusedServer() && !catalog.loading && !state.catalogFailed && catalog() !== undefined,
      choosing: () => state.choosing,
      failed: () => state.catalogFailed,
      error: () => state.error,
      create: (text?: string) => {
        const conn = focusedServer()
        if (!conn || catalog.loading || state.catalogFailed) return
        openProjectNewSession(conn, undefined, text, true)
      },
      start: (text: string) => {
        const conn = focusedServer()
        if (conn && text.trim() && !catalog.loading && !state.catalogFailed) {
          onboarding.set(global.ensureServerCtx(conn).sdk.scope, text)
          openProjectNewSession(conn, selectedProject()?.worktree, text)
        }
      },
      list: projects,
      recentlyClosed,
      homedir,
      selected: selectedProject,
      newSession: newSessionProject,
      forServer: (_conn: ServerConnection.Any) => projects(),
      select: (conn: ServerConnection.Any, directory: string) => {
        if (!projects().some((project) => project.worktree === directory)) return
        setSelection(toggleHomeProjectSelection(selection(), ServerConnection.key(conn), directory))
      },
      add: (conn: ServerConnection.Any, _directories: string[]) => openProjectNewSession(conn),
      refresh: refetch,
      openNewSession: () => {
        const route = layout.route()
        const conn =
          route.type === "session" && route.server
            ? global.servers.list().find((item) => ServerConnection.key(item) === route.server)
            : focusedServer()
        if (!conn) return
        const directory =
          route.type === "session"
            ? global.ensureServerCtx(conn).sync.session.data.info[route.sessionId]?.directory
            : selectedProject()?.worktree
        openProjectNewSession(conn, directory)
      },
      openProjectNewSession,
      openSession,
    },
  }
}

export type HomeController = ReturnType<typeof createHomeController>
