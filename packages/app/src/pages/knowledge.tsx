import { KnowledgeMigration } from "@/components/knowledge-migration"
import { GammaShell } from "@/components/gamma-shell"
import { productRequest } from "@/utils/product"
import {
  knowledgeCache,
  importKnowledge,
  publishKnowledge,
  remoteKnowledgeFile,
  type RemoteKnowledge,
} from "@/utils/knowledge-sync"
import { nodeIconNames } from "@/utils/knowledge-edit"
import { relationTypes } from "@/utils/knowledge-edit"
import { copyKnowledgeDemo } from "@/utils/knowledge-demo"
import { For, Show, createMemo, onMount, onCleanup } from "solid-js"
import { useSearchParams } from "@solidjs/router"
import { createStore, unwrap } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { ProductBrand } from "@/components/product-brand"
import { KnowledgeEditor } from "@/components/knowledge-editor"
import { KnowledgeViewer } from "@/components/knowledge-viewer"
import { KnowledgeGraph, knowledgeColors } from "@/components/knowledge-graph"
import {
  demoKnowledge,
  emptyKnowledge,
  readKnowledge,
  saveKnowledge,
  setKnowledgeFileReader,
  readKnowledgeFile,
  validateMaterial,
  inspectMaterial,
  validateURL,
} from "@/utils/knowledge"
import type { KnowledgeData, KnowledgeSource } from "@/utils/knowledge"
import "./knowledge.css"

const categories = ["all", "document", "note", "link", "entity", "project"] as const

export default function KnowledgePage() {
  const [params, setParams] = useSearchParams()
  const shell = GammaShell.use()
  const server = () => shell.home.server.focused()?.http
  const language = useLanguage()
  const t = (key: keyof typeof import("@/i18n/en").dict, params?: Record<string, string | number>) =>
    language.t(key, params)
  const [state, setState] = createStore({
    data: emptyKnowledge(),
    sync: "loading",
    remote: null as RemoteKnowledge | null,
    storage: "local",
    serverURL: "",
    loading: true,
    localAvailable: false,
    busy: false,
    error: "",
    migrationError: "",
    space: "",
    selectedNodeId: params.demo === "ziorna" ? "demo-company" : "",
    demo: params.demo === "ziorna",
    query: "",
    filters: { category: "all", status: "all" },
    focusedNodeId: "",
    unavailable: false,
    filtersOpen: false,
    modal: "",
    name: "",
    description: "",
    text: "",
    url: "",
    kind: "file",
    viewer: null as KnowledgeSource | null,
    relatedRootId: "",
    expandedFor: "",
    editor: null as KnowledgeSource | null,
    editorStep: 0,
    editorTarget: "",
    original: undefined as File | undefined,
    uploadQueue: [] as { source: KnowledgeSource; file: File }[],
    connecting: "",
    dragging: 0,
    preparing: false,
    pendingFiles: [] as File[],
    returnTo: null as null | {
      space: string
      selectedNodeId: string
      focusedNodeId: string
      relatedRootId: string
      expandedFor: string
      query: string
      filters: { category: string; status: string }
    },
  })
  let demoPanel!: HTMLDivElement
  let surface!: HTMLDivElement
  let modal!: HTMLDialogElement
  let control:
    | { reset: () => void; zoom: (factor: number) => void; hold: () => void; focus: (id: string) => void }
    | undefined
  const load = () => {
    setState({ loading: true, error: "" })
    const http = server()
    setState("serverURL", http?.url ?? "")
    setKnowledgeFileReader()
    return readKnowledge()
      .then(async (local) => {
        setState("localAvailable", local.spaces.length > 0)
        if (!http) {
          setState({ data: local, sync: "offline", storage: "local" })
          return
        }
        const cached = await knowledgeCache(http)
        const remote = await productRequest<RemoteKnowledge>(http, "knowledge").catch(() => undefined)
        const active = remote ?? cached
        if (active && (cached || local.spaces.length === 0)) {
          setState({
            data: structuredClone(active.data) as KnowledgeData,
            remote: active,
            storage: "server",
            sync: remote ? "synced" : "offline",
          })
          setKnowledgeFileReader((id) => remoteKnowledgeFile(http, active, id))
          if (remote && cached) await knowledgeCache(http, remote)
          return
        }
        setState({ data: local, remote: remote ?? null, storage: "local", sync: remote ? "local" : "offline" })
      })
      .then(() =>
        setState(
          "space",
          state.data.spaces.some((s) => s.id === state.space) ? state.space : (state.data.spaces[0]?.id ?? ""),
        ),
      )
      .catch(() => setState("error", t("knowledge.error")))
      .finally(() => setState("loading", false))
  }
  const migrate = async () => {
    const http = server()
    if (!http || !state.remote || state.busy) return
    if (http.url !== state.serverURL) {
      setState("sync", "offline")
      return
    }
    setState({ busy: true, sync: "syncing", migrationError: "" })
    await importKnowledge(http, unwrap(state.remote), structuredClone(unwrap(state.data)))
      .then((remote) => {
        setState({ data: structuredClone(remote.data) as KnowledgeData, remote, storage: "server", sync: "synced" })
        setKnowledgeFileReader((id) => remoteKnowledgeFile(http, remote, id))
        broadcast?.postMessage("updated")
      })
      .catch((error: Error) => {
        const detail = error.cause as { id?: string; name?: string; filename?: string } | undefined
        setState({
          sync: error.message === "conflict" ? "conflict" : error.message === "missing_original" ? "missing" : "failed",
          migrationError: detail?.id ? `${detail.name ?? ""} (${detail.id}, ${detail.filename ?? ""})` : "",
        })
      })
      .finally(() => setState("busy", false))
  }
  const viewLocal = async () => {
    if (state.busy) return
    await readKnowledge()
      .then((local) => {
        setState({ data: local, storage: "local", sync: state.remote ? "local" : "offline" })
        setKnowledgeFileReader()
        choose(local.spaces[0]?.id ?? "")
      })
      .catch(() => setState("error", t("knowledge.error")))
  }
  const viewServer = () => {
    const http = server()
    const remote = state.remote
    if (!http || !remote || state.busy || http.url !== state.serverURL) return
    setState({ data: structuredClone(unwrap(remote.data)) as KnowledgeData, storage: "server", sync: "synced" })
    setKnowledgeFileReader((id) => remoteKnowledgeFile(http, remote, id))
    choose(remote.data.spaces[0]?.id ?? "")
  }

  onMount(() => {
    void load()
  })
  const broadcast = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("gamma-knowledge") : undefined
  if (broadcast)
    broadcast.onmessage = () => {
      if (!state.busy && !state.editor) void load()
    }
  onCleanup(() => {
    broadcast?.close()
    setKnowledgeFileReader()
  })
  const data = () => (state.demo ? demoKnowledge : state.data)
  const sources = createMemo(() => data().sources.filter((s) => s.spaceID === (state.demo ? "demo" : state.space)))
  const relations = createMemo(() => data().relations.filter((r) => r.spaceID === (state.demo ? "demo" : state.space)))
  const selected = createMemo(() => sources().find((s) => s.id === state.selectedNodeId))
  const neighbors = createMemo(
    () =>
      new Set(
        relations()
          .filter((r) => r.source === state.selectedNodeId || r.target === state.selectedNodeId)
          .flatMap((r) => [r.source, r.target])
          .filter((id) => id !== state.selectedNodeId),
      ),
  )
  const filtered = createMemo(() =>
    sources().filter(
      (s) =>
        (state.filters.category === "all" ||
          s.type === state.filters.category ||
          s.entityType === state.filters.category) &&
        (state.filters.status === "all" ||
          data().jobs.some((j) => j.sourceID === s.id && j.status === state.filters.status)),
    ),
  )
  const visibleIds = createMemo(() => new Set(filtered().map((source) => source.id)))
  const searchResults = createMemo(() =>
    filtered().filter(
      (source) =>
        source.id !== state.connecting &&
        `${source.name} ${source.description} ${source.entityType ?? ""} ${source.text ?? ""} ${source.tags.join(" ")}`
          .toLocaleLowerCase()
          .includes(state.query.trim().toLocaleLowerCase()),
    ),
  )
  const highlightedSearchIds = createMemo(() =>
    state.query.trim() ? new Set(searchResults().map((source) => source.id)) : undefined,
  )
  const highlightedRelatedIds = createMemo(
    () =>
      new Set(
        state.relatedRootId
          ? relations()
              .filter((edge) => edge.source === state.relatedRootId || edge.target === state.relatedRootId)
              .flatMap((edge) => [edge.source, edge.target])
              .filter((id) => id !== state.relatedRootId)
          : [],
      ),
  )
  const showAll = () => {
    setState({ relatedRootId: "", focusedNodeId: "", query: "", filters: { category: "all", status: "all" } })
    control?.reset()
  }
  const focusNode = (id: string) => {
    if (state.connecting) {
      selectNode(id)
      return
    }
    selectNode(id)
    // Navigation must reveal its destination even if a category filter hid it.
    if (!visibleIds().has(id)) setState("filters", { category: "all", status: "all" })
    setState("focusedNodeId", id)
    control?.focus(id)
  }
  const connectNode = (id: string) => {
    control?.hold()
    setState({
      connecting: id,
      relatedRootId: "",
      query: "",
      filters: { category: "all", status: "all" },
    })
  }
  const choose = (id: string) => {
    setParams({ demo: undefined }, { replace: true })
    setState({
      connecting: "",
      space: id,
      demo: false,
      selectedNodeId: "",
      focusedNodeId: "",
      relatedRootId: "",
      query: "",
      filters: { category: "all", status: "all" },
    })
  }
  const enterDemo = () => {
    setParams({ demo: "ziorna" }, { replace: true })
    control?.hold()
    setState({
      returnTo: {
        space: state.space,
        selectedNodeId: state.selectedNodeId,
        focusedNodeId: state.focusedNodeId,
        relatedRootId: state.relatedRootId,
        expandedFor: state.expandedFor,
        query: state.query,
        filters: { ...state.filters },
      },
      demo: true,
      selectedNodeId: "demo-company",
      focusedNodeId: "",
      relatedRootId: "",
      expandedFor: "",
      query: "",
      filters: { category: "all", status: "all" },
      connecting: "",
    })
    queueMicrotask(() => demoPanel?.scrollIntoView({ block: "nearest" }))
  }
  const exitDemo = () => {
    setParams({ demo: undefined }, { replace: true })
    if (state.returnTo) {
      setState({ ...state.returnTo, demo: false, returnTo: null })
      return
    }
    choose(state.space)
  }
  const show = (kind: string) => {
    setState({ modal: kind, name: "", description: "", text: "", url: "" })
    if (kind === "rename") {
      const space = state.data.spaces.find((s) => s.id === state.space)
      setState({ name: space?.name ?? "", description: space?.description ?? "" })
    }
    modal.showModal()
  }
  const close = () => {
    modal.close()
    setState({ modal: "", pendingFiles: [] })
  }
  const commit = async (next: KnowledgeData, files: { id: string; file: Blob }[] = [], removed: string[] = []) => {
    setState({ busy: true, error: "" })
    const http = server()
    if ((http?.url ?? "") !== state.serverURL) {
      setState({ busy: false, sync: "offline", error: t("knowledge.sync.offline") })
      return false
    }
    const persist =
      state.storage === "server"
        ? http && state.remote && state.sync !== "offline"
          ? publishKnowledge(http, unwrap(state.remote), next, files).then((remote) => {
              setState({ remote, sync: "synced" })
              setKnowledgeFileReader((id) => remoteKnowledgeFile(http, remote, id))
              return structuredClone(remote.data) as KnowledgeData
            })
          : Promise.reject(new Error("offline"))
        : saveKnowledge(next, files, removed).then(() => next)
    if (state.storage === "server") setState("sync", "syncing")
    return persist
      .then((saved) => {
        setState("data", saved)
        broadcast?.postMessage("updated")
        return true
      })
      .catch((error: Error) => {
        if (state.storage === "server") setState("sync", error.message === "conflict" ? "conflict" : "failed")
        setState("error", t(error.message === "upgrade_required" ? "knowledge.upgradeRequired" : "knowledge.error"))
        return false
      })
      .finally(() => setState("busy", false))
  }
  const snapshot = () => structuredClone(unwrap(state.data))
  const copyDemo = async () => {
    if (state.busy || state.loading) return
    const id = crypto.randomUUID()
    if (await commit(copyKnowledgeDemo(snapshot(), id, new Date().toISOString()))) choose(id)
  }
  const saveSpace = async () => {
    if (!state.name.trim() || state.busy) return
    const next = snapshot()
    const now = new Date().toISOString()
    const id = state.modal === "rename" ? state.space : crypto.randomUUID()
    const space = next.spaces.find((s) => s.id === id)
    if (space) Object.assign(space, { name: state.name.trim(), description: state.description, updatedAt: now })
    if (!space)
      next.spaces.push({ id, name: state.name.trim(), description: state.description, createdAt: now, updatedAt: now })
    if (await commit(next)) {
      choose(id)
      const files = state.pendingFiles
      close()
      if (files.length) void configureFiles(files)
    }
  }
  const removeSpace = async () => {
    const next = snapshot()
    const ids = next.sources.filter((s) => s.spaceID === state.space).map((s) => s.id)
    next.spaces = next.spaces.filter((s) => s.id !== state.space)
    next.sources = next.sources.filter((s) => s.spaceID !== state.space)
    next.relations = next.relations.filter((s) => s.spaceID !== state.space)
    next.jobs = next.jobs.filter((s) => s.spaceID !== state.space)
    if (await commit(next, [], ids)) {
      choose(next.spaces[0]?.id ?? "")
      close()
    }
  }
  const editMaterial = (source: KnowledgeSource, step = 0, target = "") => {
    setState({ editor: structuredClone(unwrap(source)), editorStep: step, editorTarget: target, original: undefined })
  }
  const createFile = () => {
    if (!state.space || state.demo) {
      show("create")
      return
    }
    const now = new Date().toISOString()
    editMaterial({
      id: crypto.randomUUID(),
      spaceID: state.space,
      name: "",
      filename: "material.md",
      authored: true,
      type: "document",
      mime: "text/markdown",
      text: "",
      description: "",
      tags: [],
      createdAt: now,
      updatedAt: now,
    })
  }
  const configureFiles = async (files: File[]) => {
    if (!files.length || state.preparing || state.editor) return
    if (state.demo) {
      setState("error", t("knowledge.demoHint"))
      return
    }
    setState({ preparing: true, error: "" })
    await Promise.resolve()
      .then(async () => {
        await Promise.all(files.map(inspectMaterial))
        if (!state.space) {
          setState("pendingFiles", files)
          show("create")
          return
        }
        const now = new Date().toISOString()
        const queue = await Promise.all(
          files.map(async (file) => ({
            file,
            source: {
              id: crypto.randomUUID(),
              spaceID: state.space,
              type: "document" as const,
              name: file.name,
              filename: file.name,
              mime: file.type,
              size: file.size,
              description: "",
              tags: [],
              createdAt: now,
              updatedAt: now,
              text: /\.(txt|md|markdown)$/i.test(file.name) ? await file.text() : undefined,
            },
          })),
        )
        close()
        setState({
          editor: queue[0].source,
          original: queue[0].file,
          editorStep: 0,
          editorTarget: "",
          uploadQueue: queue.slice(1),
        })
      })
      .catch(() => setState("error", t("knowledge.invalid")))
      .finally(() => setState("preparing", false))
  }
  const nextUpload = () => {
    const queued = state.uploadQueue[0]
    setState({ editor: null, original: undefined, uploadQueue: state.uploadQueue.slice(1) })
    if (queued)
      queueMicrotask(() => setState({ editor: queued.source, original: queued.file, editorStep: 0, editorTarget: "" }))
  }
  const selectNode = (id: string) => {
    if (!id) {
      setState({ selectedNodeId: "", relatedRootId: "" })
      return
    }
    if (!state.connecting) {
      setState({ selectedNodeId: id, relatedRootId: "" })
      return
    }
    const source = sources().find((item) => item.id === state.connecting)
    if (!source || source.id === id) return
    editMaterial(source, 2, id)
    setState("connecting", "")
  }
  const removeMaterial = async (source: KnowledgeSource) => {
    if (!window.confirm(t("knowledge.editor.removeConfirm"))) return
    const next = snapshot()
    next.sources = next.sources.filter((item) => item.id !== source.id)
    next.sources.filter((item) => item.documentID === source.id).forEach((item) => delete item.documentID)
    next.relations = next.relations.filter((edge) => edge.source !== source.id && edge.target !== source.id)
    next.jobs = next.jobs.filter((job) => job.sourceID !== source.id)
    if (await commit(next, [], [source.id]))
      setState({ selectedNodeId: "", focusedNodeId: "", relatedRootId: "", connecting: "" })
  }
  const add = async (files: File[] = []) => {
    if (state.busy || !state.space || state.demo) return
    setState({ busy: true, error: "" })
    const next = snapshot()
    const now = new Date().toISOString()
    const blobs: { id: string; file: Blob }[] = []
    await (async () => {
      files.forEach(validateMaterial)
      const items: KnowledgeSource[] = await Promise.all(
        files.map(async (file) => {
          const id = crypto.randomUUID()
          blobs.push({ id, file })
          return {
            id,
            spaceID: state.space,
            type: "document" as const,
            name: file.name,
            description: "",
            tags: [],
            createdAt: now,
            updatedAt: now,
            filename: file.name,
            size: file.size,
            mime: file.type,
            text: /\.(txt|md|markdown)$/i.test(file.name) ? await file.text() : undefined,
          }
        }),
      )
      if (!files.length) {
        if (!state.name.trim()) throw new Error("name")
        items.push({
          id: crypto.randomUUID(),
          spaceID: state.space,
          type: state.kind === "link" ? "link" : "note",
          name: state.name.trim(),
          description: state.description,
          tags: [],
          createdAt: now,
          updatedAt: now,
          ...(state.kind === "link" ? { url: validateURL(state.url) } : { text: state.text }),
        })
      }
      next.sources.push(...items)
      next.jobs.push(
        ...items.map((s) => ({
          id: crypto.randomUUID(),
          sourceID: s.id,
          spaceID: s.spaceID,
          status: s.text !== undefined ? ("stored" as const) : ("waiting" as const),
          attempts: 0,
          updatedAt: now,
        })),
      )
      if (await commit(next, blobs)) {
        setState("selectedNodeId", items[0].id)
        close()
      }
    })()
      .catch(() => setState("error", t("knowledge.invalid")))
      .finally(() => setState("busy", false))
  }
  const retry = async (source: KnowledgeSource) => {
    if (state.busy) return
    const next = snapshot()
    const job = next.jobs.find((j) => j.sourceID === source.id)
    if (!job) return
    job.attempts += 1
    job.updatedAt = new Date().toISOString()
    job.status = "processing"
    if (!(await commit(next))) return
    await (async () => {
      if (source.filename && /\.(txt|md|markdown)$/i.test(source.filename)) {
        const file = await readKnowledgeFile(source.id)
        next.sources.find((s) => s.id === source.id)!.text = await file.text()
        job.status = "stored"
      } else job.status = source.type === "note" ? "stored" : "waiting"
      delete job.error
    })().catch(() => {
      job.status = "error"
      job.error = "read_failed"
    })
    await commit(next)
  }
  const open = (source: KnowledgeSource) => {
    setState("viewer", structuredClone(unwrap(source)))
  }
  const upload = () => {
    if (!state.space || state.demo) {
      show("create")
      return
    }
    show("upload")
  }
  const badge = (source: KnowledgeSource) => (
    <span
      class="kb-node-icon"
      style={{
        color: source.visual?.color ?? knowledgeColors[source.type],
        background: `${source.visual?.color ?? knowledgeColors[source.type]}16`,
      }}
    >
      <Icon name={nodeIconNames[source.visual?.icon ?? source.type]} />
    </span>
  )
  const search = () => (
    <label class="kb-search">
      <Icon name="magnifying-glass" />
      <input
        type="search"
        placeholder={t("knowledge.search")}
        aria-label={t("knowledge.search")}
        value={state.query}
        onInput={(e) => setState("query", e.currentTarget.value)}
      />
    </label>
  )
  return (
    <section class="kb-page">
      <div class="kb-inner">
        <div class="kb-top">
          {search()}
          <label class="kb-space-select">
            <Icon name="folder" />
            <select
              aria-label={t("knowledge.choose")}
              value={state.demo ? "demo" : state.space}
              onChange={(e) => choose(e.currentTarget.value)}
            >
              <option value="" disabled>
                {t("knowledge.choose")}
              </option>
              <Show when={state.demo}>
                <option value="demo">{demoKnowledge.spaces[0].name}</option>
              </Show>
              <For each={state.data.spaces}>{(space) => <option value={space.id}>{space.name}</option>}</For>
            </select>
          </label>
        </div>
        <header class="kb-hero">
          <div class="kb-hero-copy">
            <span class="kb-eyebrow">{t("knowledge.eyebrow")}</span>
            <h1>{t("knowledge.title")}</h1>
            <p>{t("knowledge.intro")}</p>
            <div class="kb-actions">
              <button class="kb-primary" onClick={() => show("create")}>
                <Icon name="plus" />
                {t("knowledge.create")}
              </button>
            </div>
          </div>
          <div class="kb-art" aria-hidden="true">
            <svg viewBox="0 0 500 220">
              <g fill="none" stroke="#b6a3f8" stroke-width="2">
                <path d="M250 115C135 115 185 40 80 40M250 115C130 115 160 190 50 170M250 115C360 115 325 25 405 25M250 115C375 115 330 190 440 185M250 115C330 115 390 100 470 85" />
              </g>
            </svg>
            <span class="kb-cube">
              <ProductBrand class="kb-hero-brand" />
            </span>
            <span class="kb-art-tile tile-a">▤</span>
            <span class="kb-art-tile tile-b">↗</span>
            <span class="kb-art-tile tile-c">▧</span>
            <span class="kb-art-tile tile-d">◇</span>
            <i class="spark-a">✦</i>
            <i class="spark-b">✦</i>
          </div>
        </header>
        <div class="kb-sync" role="status">
          <span>
            {t(
              `knowledge.sync.${(state.sync === "synced" && state.remote?.version === 0 ? "empty" : state.sync) as "empty" | "loading" | "local" | "offline" | "synced" | "syncing" | "conflict" | "missing" | "failed"}`,
            )}
          </span>
          <Show when={state.storage === "local" && state.data.spaces.length > 0}>
            <button disabled={state.busy || !state.remote} onClick={() => void migrate()}>
              {t("knowledge.sync.import")}
            </button>
          </Show>
          <Show when={state.storage === "server" && state.localAvailable}>
            <button disabled={state.busy} onClick={() => void viewLocal()}>
              {t("knowledge.viewLocal")}
            </button>
          </Show>
          <Show when={state.storage === "local" && state.remote}>
            <button disabled={state.busy} onClick={viewServer}>
              {t("knowledge.viewServer")}
            </button>
          </Show>
          <Show when={state.sync === "offline" || state.sync === "conflict" || state.sync === "failed"}>
            <button disabled={state.busy} onClick={() => void load()}>
              {t("knowledge.sync.refresh")}
            </button>
          </Show>
        </div>
        <Show when={state.migrationError}>
          <p role="alert">{state.migrationError}</p>
        </Show>
        <KnowledgeMigration server={server()} />
        <div class="kb-filterbar">
          <nav aria-label={t("knowledge.filters")}>
            <For each={categories}>
              {(category) => (
                <button
                  aria-pressed={state.filters.category === category}
                  onClick={() => setState("filters", "category", category)}
                >
                  {category !== "all" && <Icon name={nodeIconNames[category]} />}
                  {t(`knowledge.${category}`)}
                </button>
              )}
            </For>
          </nav>
          <div class="kb-tools">
            <button aria-pressed={state.filtersOpen} onClick={() => setState("filtersOpen", !state.filtersOpen)}>
              <Icon name="settings-gear" />
              {t("knowledge.filters")}
            </button>
            <Show
              when={
                state.relatedRootId ||
                state.focusedNodeId ||
                state.query ||
                state.filters.category !== "all" ||
                state.filters.status !== "all"
              }
            >
              <button onClick={showAll}>{t("knowledge.wholeMap")}</button>
            </Show>
            <button
              aria-label={t("knowledge.fullscreen")}
              onClick={() => {
                void (document.fullscreenElement ? document.exitFullscreen() : surface.requestFullscreen()).catch(() =>
                  setState("error", t("knowledge.error")),
                )
              }}
            >
              ⛶
            </button>
          </div>
        </div>
        <Show when={state.filtersOpen}>
          <div class="kb-filter-options">
            <label>
              {t("knowledge.entityType")}
              <select
                aria-label={t("knowledge.entityType")}
                value={state.filters.category}
                onChange={(event) => setState("filters", "category", event.currentTarget.value)}
              >
                <option value="all">{t("knowledge.all")}</option>
                <For
                  each={Array.from(
                    new Set(sources().flatMap((source) => (source.entityType ? [source.entityType] : []))),
                  ).sort()}
                >
                  {(type) => <option value={type}>{type}</option>}
                </For>
              </select>
            </label>
            <label>
              {t("knowledge.status")}{" "}
              <select
                value={state.filters.status}
                onChange={(e) => setState("filters", "status", e.currentTarget.value)}
              >
                <option value="all">{t("knowledge.all")}</option>
                <For each={["stored", "waiting", "processing", "error"] as const}>
                  {(status) => (
                    <option value={status}>
                      {t(status === "error" ? "knowledge.jobError" : `knowledge.${status}`)}
                    </option>
                  )}
                </For>
              </select>
            </label>
          </div>
        </Show>
        <Show when={state.error}>
          <div role="alert" class="kb-error">
            {state.error}
            <button onClick={() => void load()}>{t("knowledge.retry")}</button>
          </div>
        </Show>
        <div class="kb-content" ref={surface}>
          <div class="kb-main">
            <Show when={state.demo}>
              <div class="kb-demo" ref={demoPanel}>
                <div>
                  <strong>{demoKnowledge.spaces[0].name}</strong>
                  <p>{t("knowledge.demoReadOnly")}</p>
                </div>
                <button
                  disabled={state.busy || state.loading || state.sync === "offline"}
                  onClick={() => void copyDemo()}
                >
                  {t("knowledge.copyDemo")}
                </button>
                <button class="kb-primary" onClick={exitDemo}>
                  ← {t("knowledge.exitDemo")}
                </button>
              </div>
            </Show>
            <div class="kb-map">
              <Show when={state.connecting}>
                <div class="kb-connect-banner" role="status">
                  {t(
                    sources().some((source) => source.id !== state.connecting)
                      ? "knowledge.editor.pickTarget"
                      : "knowledge.editor.noTargets",
                  )}
                  <button onClick={() => setState("connecting", "")}>{t("knowledge.cancel")}</button>
                </div>
              </Show>
              <Show
                when={!state.loading || sources().length > 0}
                fallback={
                  <div class="kb-empty" aria-busy="true">
                    {t("knowledge.loading")}
                  </div>
                }
              >
                <Show
                  when={sources().length}
                  fallback={
                    <div class="kb-empty">
                      <span class="kb-empty-symbol">⌘</span>
                      <h2>{t("knowledge.empty")}</h2>
                      <p>{t("knowledge.emptyHint")}</p>
                      <div class="kb-actions">
                        <button onClick={enterDemo}>{t("knowledge.demo")}</button>
                      </div>
                    </div>
                  }
                >
                  <Show
                    when={!state.unavailable}
                    fallback={
                      <div class="kb-list" data-testid="knowledge-webgl-fallback">
                        <p role="status">{t("knowledge.fallback")}</p>
                        <For each={filtered()}>
                          {(source) => (
                            <button
                              aria-pressed={state.selectedNodeId === source.id}
                              onClick={() => selectNode(source.id)}
                            >
                              {badge(source)}
                              <span>
                                {source.name}
                                <small>{t(`knowledge.${source.type}`)}</small>
                              </span>
                              <span>→</span>
                            </button>
                          )}
                        </For>
                      </div>
                    }
                  >
                    <KnowledgeGraph
                      nodes={sources()}
                      relations={relations()}
                      selected={state.selectedNodeId}
                      visibleIds={visibleIds()}
                      relatedRootId={state.relatedRootId}
                      highlightedRelatedIds={highlightedRelatedIds()}
                      highlightedSearchIds={highlightedSearchIds()}
                      space={state.demo ? "demo" : state.space}
                      onSelect={selectNode}
                      onFocus={(id) => setState("focusedNodeId", id)}
                      onUnavailable={() => setState("unavailable", true)}
                      controls={(value) => (control = value)}
                    />
                    <div class="kb-legend">
                      <For each={categories.filter((c) => c !== "all")}>
                        {(type) => (
                          <span>
                            <i style={{ background: knowledgeColors[type] }} />
                            {t(`knowledge.${type}`)}
                          </span>
                        )}
                      </For>
                    </div>
                    <div class="kb-camera">
                      <button aria-label={t("knowledge.zoomIn")} onClick={() => control?.zoom(0.8)}>
                        +
                      </button>
                      <button aria-label={t("knowledge.zoomOut")} onClick={() => control?.zoom(1.25)}>
                        −
                      </button>
                      <button
                        aria-label={t("knowledge.reset")}
                        onClick={() => {
                          setState("focusedNodeId", "")
                          control?.reset()
                        }}
                      >
                        ⛶
                      </button>
                    </div>
                  </Show>
                  <Show when={!filtered().length || (state.query.trim() && !searchResults().length)}>
                    <div class="kb-map-message" role="status">
                      {t("knowledge.none")}
                    </div>
                  </Show>
                </Show>
              </Show>
            </div>
            <p class="kb-hint">
              {t(filtered().length > 250 ? "knowledge.limit" : "knowledge.hint")}
              <Show when={!state.demo && sources().length}>
                <button onClick={enterDemo}>{t("knowledge.demo")}</button>
              </Show>
            </p>
            <div class="kb-bottom">
              <section class="kb-spaces">
                <div class="kb-section-title">
                  <h2>{t("knowledge.spaces")}</h2>
                  <button onClick={() => show("create")}>+ {t("knowledge.create")}</button>
                </div>
                <div class="kb-space-grid">
                  <For each={state.data.spaces}>
                    {(space) => (
                      <article class="kb-space-card" data-active={space.id === state.space && !state.demo}>
                        <button class="kb-space-main" onClick={() => choose(space.id)}>
                          <span class="kb-node-icon">
                            <Icon name="folder" />
                          </span>
                          <span>
                            <strong>{space.name}</strong>
                            <small>{space.description || t("knowledge.subtitle")}</small>
                          </span>
                        </button>
                        <footer>
                          <span>
                            {t("knowledge.materials")}:{" "}
                            {state.data.sources.filter((s) => s.spaceID === space.id).length}
                          </span>
                          <button
                            aria-label={t("knowledge.rename")}
                            onClick={() => {
                              choose(space.id)
                              show("rename")
                            }}
                          >
                            <Icon name="edit" />
                          </button>
                          <button
                            aria-label={t("knowledge.delete")}
                            onClick={() => {
                              choose(space.id)
                              show("delete")
                            }}
                          >
                            <Icon name="trash" />
                          </button>
                        </footer>
                      </article>
                    )}
                  </For>
                  <Show when={!state.data.spaces.length}>
                    <button class="kb-space-create" onClick={() => show("create")}>
                      + {t("knowledge.create")}
                    </button>
                  </Show>
                </div>
              </section>
              <section class="kb-stats">
                <h2>{t("knowledge.stats")}</h2>
                <div>
                  <For each={["document", "note", "link", "entity"] as const}>
                    {(type) => (
                      <article>
                        <span class="kb-node-icon" style={{ color: knowledgeColors[type] }}>
                          <Icon name={nodeIconNames[type]} />
                        </span>
                        <small>{t(`knowledge.${type}`)}</small>
                        <strong>{sources().filter((s) => s.type === type).length}</strong>
                      </article>
                    )}
                  </For>
                </div>
              </section>
            </div>
          </div>
          <aside class="kb-details">
            <Show when={state.query.trim()}>
              <section class="kb-search-results" aria-label={t("knowledge.searchResults")}>
                <h3>{t("knowledge.searchResults")}</h3>
                <Show when={searchResults().length} fallback={<p>{t("knowledge.none")}</p>}>
                  <For each={searchResults()}>
                    {(item) => (
                      <button
                        class="kb-related"
                        aria-pressed={state.selectedNodeId === item.id}
                        onClick={() => focusNode(item.id)}
                      >
                        {badge(item)}
                        <span>{item.name}</span>
                      </button>
                    )}
                  </For>
                </Show>
              </section>
            </Show>
            <Show
              when={selected()}
              fallback={
                <section class="kb-add-materials" aria-label={t("knowledge.addTitle")}>
                  <div class="kb-add-illustration" aria-hidden="true">
                    <span class="kb-add-document">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span class="kb-add-plus">
                      <Icon name="plus" />
                    </span>
                    <span class="kb-add-spark" />
                  </div>
                  <header class="kb-add-heading">
                    <h2>{t("knowledge.addTitle")}</h2>
                    <p>{t("knowledge.addDescription")}</p>
                  </header>
                  <button onClick={createFile} disabled={state.demo || state.preparing}>
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M11.5 2.5H4.5v15h11v-11zM11.5 2.5v4h4M7 10h6M7 13h6" stroke-linejoin="round" />
                    </svg>
                    {t("knowledge.editor.create")}
                  </button>
                  <button class="kb-primary" onClick={upload} disabled={state.demo || state.preparing}>
                    <Icon name="cloud-upload" />
                    {t("knowledge.uploadDocument")}
                  </button>
                  <div
                    class="kb-file-dropzone"
                    data-dragging={state.dragging > 0}
                    data-testid="knowledge-dropzone"
                    onDragEnter={(event) => {
                      if (!event.dataTransfer?.types.includes("Files")) return
                      event.preventDefault()
                      setState("dragging", state.dragging + 1)
                    }}
                    onDragOver={(event) => {
                      if (!event.dataTransfer?.types.includes("Files")) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = state.demo || state.preparing || !!state.editor ? "none" : "copy"
                    }}
                    onDragLeave={(event) => {
                      if (!event.dataTransfer?.types.includes("Files")) return
                      setState("dragging", Math.max(0, state.dragging - 1))
                    }}
                    onDrop={(event) => {
                      if (!event.dataTransfer?.types.includes("Files")) return
                      event.preventDefault()
                      setState("dragging", 0)
                      void configureFiles(Array.from(event.dataTransfer.files))
                    }}
                  >
                    <span class="kb-drop-icon" aria-hidden="true">
                      <Icon name="cloud-upload" />
                    </span>
                    <strong>{t("knowledge.dropHere")}</strong>
                    <p>{t("knowledge.dropFormats")}</p>
                    <div class="kb-drop-formats" aria-hidden="true">
                      <For each={["PDF", "DOCX", "TXT", "MD"]}>{(format) => <span>{format}</span>}</For>
                    </div>
                    <Show when={state.dragging > 0}>
                      <span role="status">{t(state.demo ? "knowledge.demoHint" : "knowledge.dropHint")}</span>
                    </Show>
                  </div>
                  <div class="kb-add-note">
                    <span aria-hidden="true">ⓘ</span>
                    <p>{t("knowledge.addSpaceHint")}</p>
                  </div>
                </section>
              }
            >
              {(source) => (
                <>
                  <div class="kb-detail-heading">
                    {badge(source())}
                    <div>
                      <h2>{source().name}</h2>
                      <small>{source().entityType ?? t(`knowledge.${source().type}`)}</small>
                    </div>
                    <button aria-label={t("knowledge.close")} onClick={() => selectNode("")}>
                      ×
                    </button>
                  </div>
                  <p>{source().description || t("knowledge.waitingHint")}</p>
                  <div class="kb-tags">
                    <For each={source().tags}>{(tag) => <span>{tag}</span>}</For>
                  </div>
                  <dl>
                    <For each={Object.entries(source().properties ?? {})}>
                      {([key, value]) => (
                        <>
                          <dt>{key}</dt>
                          <dd>{value}</dd>
                        </>
                      )}
                    </For>
                    <dt>{t("knowledge.created")}</dt>
                    <dd>{source().createdAt.slice(0, 10)}</dd>
                    <dt>{t("knowledge.updated")}</dt>
                    <dd>{source().updatedAt.slice(0, 10)}</dd>
                    <dt>{t("knowledge.materials")}</dt>
                    <dd>
                      {
                        sources().filter((s) => neighbors().has(s.id) && ["document", "note", "link"].includes(s.type))
                          .length
                      }
                    </dd>
                    <dt>{t("knowledge.relations")}</dt>
                    <dd>{neighbors().size}</dd>
                  </dl>
                  <Show when={data().jobs.find((j) => j.sourceID === source().id)}>
                    {(job) => (
                      <div class="kb-job">
                        <span>{t(job().status === "error" ? "knowledge.jobError" : `knowledge.${job().status}`)}</span>
                        <Show when={job().status === "error" || job().status === "waiting"}>
                          <button disabled={state.busy} onClick={() => void retry(source())}>
                            {t("knowledge.retry")}
                          </button>
                        </Show>
                      </div>
                    )}
                  </Show>
                  <div class="kb-detail-actions">
                    <button class="kb-primary" onClick={() => open(source())}>
                      {t("knowledge.open")}
                    </button>
                    <button
                      aria-pressed={state.relatedRootId === source().id}
                      onClick={() =>
                        setState({
                          relatedRootId: state.relatedRootId === source().id ? "" : source().id,
                          expandedFor: source().id,
                        })
                      }
                    >
                      {t("knowledge.related")}
                    </button>
                    <Show when={!state.demo}>
                      <button onClick={() => editMaterial(source())}>{t("knowledge.editor.edit")}</button>
                      <button onClick={() => connectNode(source().id)}>{t("knowledge.editor.addRelation")}</button>
                      <button onClick={() => editMaterial(source(), 2)}>{t("knowledge.editor.editRelations")}</button>
                      <button onClick={() => connectNode(source().id)}>{t("knowledge.editor.onMap")}</button>
                      <button onClick={() => void removeMaterial(source())}>
                        {t("knowledge.editor.removeMaterial")}
                      </button>
                    </Show>
                    <Show when={sources().find((item) => item.id === source().documentID)}>
                      {(document) => <button onClick={() => open(document())}>{t("knowledge.sourceDocument")}</button>}
                    </Show>
                  </div>
                  <For each={["outgoing", "incoming"] as const}>
                    {(direction) => (
                      <section aria-label={t(`knowledge.${direction}`)}>
                        <h3>{t(`knowledge.${direction}`)}</h3>
                        <For
                          each={relations().filter(
                            (edge) => (direction === "outgoing" ? edge.source : edge.target) === source().id,
                          )}
                        >
                          {(edge) => {
                            const target = () =>
                              sources().find(
                                (item) => item.id === (direction === "outgoing" ? edge.target : edge.source),
                              )
                            return (
                              <Show when={target()}>
                                {(item) => (
                                  <button class="kb-related" onClick={() => focusNode(item().id)}>
                                    <span>
                                      {relationTypes.includes(edge.type as (typeof relationTypes)[number])
                                        ? t(`knowledge.relation.${edge.type as (typeof relationTypes)[number]}`)
                                        : edge.type}{" "}
                                      {direction === "outgoing" ? "→" : "←"} {item().name}
                                    </span>
                                  </button>
                                )}
                              </Show>
                            )
                          }}
                        </For>
                      </section>
                    )}
                  </For>
                  <div class="kb-related-heading">
                    <h3>{t("knowledge.relatedItems")}</h3>
                    <Show when={neighbors().size > 5}>
                      <button
                        aria-expanded={state.expandedFor === state.selectedNodeId}
                        onClick={() =>
                          setState(
                            "expandedFor",
                            state.expandedFor === state.selectedNodeId ? "" : state.selectedNodeId,
                          )
                        }
                      >
                        {t(state.expandedFor === state.selectedNodeId ? "knowledge.showLess" : "knowledge.showAll")}
                      </button>
                    </Show>
                  </div>
                  <Show
                    when={neighbors().size}
                    fallback={
                      <p>{t(state.relatedRootId ? "knowledge.noRelatedDocuments" : "knowledge.noRelations")}</p>
                    }
                  >
                    <For
                      each={sources()
                        .filter((s) => neighbors().has(s.id))
                        .slice(0, state.expandedFor === state.selectedNodeId ? undefined : 5)}
                    >
                      {(item) => (
                        <button class="kb-related" onClick={() => focusNode(item.id)}>
                          {badge(item)}
                          <span>{item.name}</span>
                        </button>
                      )}
                    </For>
                  </Show>
                </>
              )}
            </Show>
          </aside>
        </div>
        <p class="kb-local">{t(state.storage === "server" ? "knowledge.server" : "knowledge.local")}</p>
      </div>
      <Show when={state.viewer} keyed>
        {(source) => (
          <KnowledgeViewer
            source={source}
            readOnly={state.demo}
            onClose={() => setState("viewer", null)}
            onEdit={(material) => {
              setState("viewer", null)
              editMaterial(material)
            }}
          />
        )}
      </Show>
      <Show when={state.editor} keyed>
        {(source) => (
          <KnowledgeEditor
            data={state.data}
            source={source}
            original={state.original}
            step={state.editorStep}
            target={state.editorTarget}
            onClose={nextUpload}
            onSave={async (next, files, saved) => {
              if (!(await commit(next, files))) return false
              setState({
                space: saved.spaceID,
                selectedNodeId: saved.id,
                filters: { category: "all", status: "all" },
                relatedRootId: "",
                query: "",
                demo: false,
              })
              nextUpload()
              return true
            }}
          />
        )}
      </Show>
      <dialog
        ref={modal}
        aria-labelledby="kb-dialog-title"
        class="kb-dialog"
        onCancel={() => setState({ modal: "", pendingFiles: [] })}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (state.modal === "create" || state.modal === "rename") void saveSpace()
            if (state.modal === "upload") void add()
          }}
        >
          <header>
            <h2 id="kb-dialog-title">
              {t(
                state.modal === "create"
                  ? "knowledge.create"
                  : state.modal === "rename"
                    ? "knowledge.rename"
                    : state.modal === "delete"
                      ? "knowledge.delete"
                      : state.modal === "upload"
                        ? "knowledge.upload"
                        : "knowledge.soon",
              )}
            </h2>
            <button type="button" aria-label={t("knowledge.close")} onClick={close}>
              ×
            </button>
          </header>
          <Show
            when={
              state.modal === "create" ||
              state.modal === "rename" ||
              (state.modal === "upload" && state.kind !== "file")
            }
          >
            <label>
              {t("knowledge.name")}
              <input
                required
                maxlength="120"
                value={state.name}
                onInput={(e) => setState("name", e.currentTarget.value)}
              />
            </label>
            <label>
              {t("knowledge.description")}
              <textarea
                maxlength="2000"
                value={state.description}
                onInput={(e) => setState("description", e.currentTarget.value)}
              />
            </label>
          </Show>
          <Show when={state.modal === "upload"}>
            <div class="kb-actions">
              <For each={["file", "note", "link"] as const}>
                {(kind) => (
                  <button type="button" aria-pressed={state.kind === kind} onClick={() => setState("kind", kind)}>
                    {t(`knowledge.${kind}`)}
                  </button>
                )}
              </For>
            </div>
            <Show when={state.kind === "file"}>
              <label class="kb-drop">
                {t("knowledge.fileHint")}
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.md,.markdown"
                  disabled={state.busy || state.preparing}
                  onChange={(e) => {
                    const files = Array.from(e.currentTarget.files ?? [])
                    if (files.length) void configureFiles(files)
                    e.currentTarget.value = ""
                  }}
                />
              </label>
            </Show>
            <Show when={state.kind === "note"}>
              <label>
                {t("knowledge.text")}
                <textarea
                  required
                  rows="7"
                  value={state.text}
                  onInput={(e) => setState("text", e.currentTarget.value)}
                />
              </label>
            </Show>
            <Show when={state.kind === "link"}>
              <label>
                {t("knowledge.url")}
                <input required type="url" value={state.url} onInput={(e) => setState("url", e.currentTarget.value)} />
              </label>
            </Show>
            <p>{t("knowledge.waitingHint")}</p>
          </Show>
          <Show when={state.modal === "delete"}>
            <p>{t("knowledge.deleteConfirm")}</p>
            <button class="kb-danger" type="button" disabled={state.busy} onClick={() => void removeSpace()}>
              {t("knowledge.delete")}
            </button>
          </Show>
          <Show when={state.modal === "soon"}>
            <p>{t("knowledge.soon")}</p>
          </Show>
          <Show when={state.error}>
            <p role="alert" class="kb-error">
              {state.error}
            </p>
          </Show>
          <footer>
            <button type="button" onClick={close}>
              {t("knowledge.cancel")}
            </button>
            <Show
              when={
                state.modal === "create" ||
                state.modal === "rename" ||
                (state.modal === "upload" && state.kind !== "file")
              }
            >
              <button class="kb-primary" disabled={state.busy} type="submit">
                {t("knowledge.save")}
              </button>
            </Show>
          </footer>
        </form>
      </dialog>
    </section>
  )
}
