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
import { createEffect, createMemo, createResource, createComponent } from "solid-js"

export function createHomeController() {
  const sync = useServerSync()
  const layout = useLayout()
  const server = useServer()
  const global = useGlobal()
  const tabs = useTabs()
  const dialog = useDialog()
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
    return productRequest<ProductProject[]>(conn.http, "projects").catch(() => [])
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

  function openProjectNewSession(conn: ServerConnection.Any, _directory?: string) {
    void dialog.show(() =>
      createComponent(DialogProductProject, {
        server: conn.http,
        refresh: () => {
          void refetch()
        },
        choose: async (project) => {
          const ctx = global.ensureServerCtx(conn)
          const response = await ctx.sdk.client.session.create({ directory: project.path })
          if (!response.data) throw new Error("unavailable")
          ctx.projects.open(project.path)
          ctx.projects.touch(project.path)
          setSelection({ server: ServerConnection.key(conn), directory: project.path })
          try {
            const tab = tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: response.data.id })
            tabs.select(tab)
          } catch (cause) {
            throw new Error("navigation_failed", { cause })
          }
          dialog.close()
        },
      }),
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
        const conn = focusedServer()
        if (conn) openProjectNewSession(conn)
      },
      openProjectNewSession,
    },
  }
}

export type HomeController = ReturnType<typeof createHomeController>
