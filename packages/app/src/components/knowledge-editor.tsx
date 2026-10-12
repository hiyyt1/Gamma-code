import { For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { useBeforeLeave } from "@solidjs/router"
import { createStore, unwrap } from "solid-js/store"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import type { KnowledgeData, KnowledgeSource, Relation } from "@/utils/knowledge"
import { demoKnowledge } from "@/utils/knowledge-demo"
import {
  editKnowledge,
  nodeIcons,
  nodeIconNames,
  nodeSizes,
  nodeStyles,
  nodePresets,
  nodeColor,
  nodePalette,
  relationTypes,
  suggestedFilename,
  validateRelations,
} from "@/utils/knowledge-edit"

import { KnowledgeNodePreview } from "./knowledge-node-preview"

export function KnowledgeEditor(props: {
  data: KnowledgeData
  source: KnowledgeSource
  original?: File
  step?: number
  target?: string
  onClose: () => void
  onSave: (data: KnowledgeData, files: { id: string; file: Blob }[], source: KnowledgeSource) => Promise<boolean>
}) {
  const language = useLanguage()
  const t = (key: keyof typeof import("@/i18n/en").dict) => language.t(key)
  const base = structuredClone(unwrap(props.data))
  const [state, setState] = createStore({
    source: structuredClone(unwrap(props.source)),
    relations: base.relations.filter((edge) => edge.source === props.source.id || edge.target === props.source.id),
    step: props.step ?? 0,
    preview: false,
    dirty: false,
    busy: false,
    error: "",
    search: "",
    target: props.target ?? "",
    type: "RELATED_TO",
    direction: "out",
    adding: !!props.target,
    filenameEdited: !!base.sources.find((item) => item.id === props.source.id),
  })
  let dialog!: HTMLDialogElement
  const existing = base.sources.some((item) => item.id === props.source.id)
  const peers = createMemo(() =>
    base.sources.filter(
      (item) =>
        item.spaceID === state.source.spaceID &&
        item.id !== state.source.id &&
        `${item.name} ${item.description}`.toLocaleLowerCase().includes(state.search.toLocaleLowerCase()),
    ),
  )
  const edit = (patch: Partial<KnowledgeSource>) => {
    setState("source", patch)
    setState({ dirty: true, error: "" })
  }
  const close = () => {
    if (state.busy || (state.dirty && !window.confirm(t("knowledge.editor.discard")))) return
    props.onClose()
  }
  useBeforeLeave((event) => {
    if (state.dirty && !window.confirm(t("knowledge.editor.discard"))) event.preventDefault()
  })
  onMount(() => {
    dialog.showModal()
    const warn = (event: BeforeUnloadEvent) => {
      if (!state.dirty) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    onCleanup(() => window.removeEventListener("beforeunload", warn))
  })
  const validate = () =>
    editKnowledge(base, structuredClone(unwrap(state.source)), structuredClone(unwrap(state.relations)), props.original)
  const save = async () => {
    if (state.busy) return
    setState({ busy: true, error: "" })
    await Promise.resolve()
      .then(validate)
      .then(async (result) => {
        if (
          !(await props.onSave(
            result.data,
            result.files,
            result.data.sources.find((item) => item.id === state.source.id)!,
          ))
        )
          setState("error", t("knowledge.editor.saveError"))
      })
      .catch(() => setState("error", t("knowledge.editor.invalid")))
      .finally(() => setState("busy", false))
  }
  const addRelation = () => {
    const edge: Relation = {
      id: crypto.randomUUID(),
      spaceID: state.source.spaceID,
      source: state.direction === "out" ? state.source.id : state.target,
      target: state.direction === "out" ? state.target : state.source.id,
      type: state.type,
      provenance: "manual",
      origin: "manual",
      createdAt: new Date().toISOString(),
      metadata: {},
    }
    return Promise.resolve()
      .then(() => {
        validateRelations({
          ...base,
          sources: [
            ...base.sources.filter((item) => item.id !== state.source.id),
            structuredClone(unwrap(state.source)),
          ],
          relations: [
            ...base.relations.filter((item) => item.source !== state.source.id && item.target !== state.source.id),
            ...unwrap(state.relations),
            edge,
          ],
        })
        setState("relations", [...unwrap(state.relations), edge])
        setState({ dirty: true, adding: false, target: "", search: "", error: "" })
        return true
      })
      .catch(() => {
        setState("error", t("knowledge.editor.relationError"))
        return false
      })
  }
  const goToStep = async (step: number) => {
    // Next and the step navigation must confirm the pending relation before review.
    if (step === 3 && state.adding && state.target && !(await addRelation())) {
      setState("step", 2)
      return
    }
    setState("step", step)
  }
  const name = (id: string) =>
    id === state.source.id ? state.source.name : (base.sources.find((item) => item.id === id)?.name ?? id)
  return (
    <dialog
      ref={dialog}
      class="kb-dialog kb-editor"
      aria-labelledby="kb-editor-title"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <header>
        <div>
          <small>{t("knowledge.title")}</small>
          <h2 id="kb-editor-title">
            {t(
              existing
                ? "knowledge.editor.edit"
                : props.original
                  ? "knowledge.editor.configure"
                  : "knowledge.editor.create",
            )}
          </h2>
        </div>
        <button type="button" aria-label={t("knowledge.close")} onClick={close}>
          ×
        </button>
      </header>
      <nav class="kb-editor-steps" aria-label={t("knowledge.editor.steps")}>
        <For each={["content", "visual", "relations", "review"] as const}>
          {(step, index) => (
            <button
              type="button"
              aria-current={state.step === index() ? "step" : undefined}
              onClick={() => void goToStep(index())}
            >
              <span>{index() + 1}</span>
              {t(`knowledge.editor.${step}`)}
            </button>
          )}
        </For>
      </nav>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (state.step < 3) void goToStep(state.step + 1)
          else void save()
        }}
      >
        <div class="kb-editor-body" data-step={state.step}>
          <Show when={state.step === 0}>
            <div class="kb-editor-columns">
              <label>
                {t("knowledge.name")}
                <input
                  required
                  maxlength="120"
                  value={state.source.name}
                  onInput={(event) => {
                    const name = event.currentTarget.value
                    edit({
                      name,
                      ...(!state.filenameEdited && state.source.authored ? { filename: suggestedFilename(name) } : {}),
                    })
                  }}
                />
              </label>
              <label>
                {t("knowledge.editor.filename")}
                <input
                  disabled={!state.source.authored}
                  value={state.source.filename ?? ""}
                  onInput={(event) => {
                    setState("filenameEdited", true)
                    edit({ filename: event.currentTarget.value })
                  }}
                />
              </label>
            </div>
            <label>
              {t("knowledge.choose")}
              <select
                aria-label={t("knowledge.choose")}
                disabled={existing}
                value={state.source.spaceID}
                onChange={(event) => {
                  edit({ spaceID: event.currentTarget.value })
                  setState({ relations: [], target: "" })
                }}
              >
                <For each={base.spaces}>{(space) => <option value={space.id}>{space.name}</option>}</For>
              </select>
            </label>
            <label>
              {t("knowledge.editor.description")}
              <textarea
                rows="2"
                maxlength="2000"
                value={state.source.description}
                onInput={(event) => edit({ description: event.currentTarget.value })}
              />
            </label>
            <label>
              {t("knowledge.entityType")}
              <input
                aria-label={t("knowledge.entityType")}
                list="kb-entity-types"
                maxlength="120"
                value={state.source.entityType ?? ""}
                onInput={(event) => edit({ entityType: event.currentTarget.value || undefined })}
              />
              <datalist id="kb-entity-types">
                <For
                  each={Array.from(
                    new Set(
                      [...base.sources, ...demoKnowledge.sources].flatMap((item) =>
                        item.entityType ? [item.entityType] : [],
                      ),
                    ),
                  ).sort()}
                >
                  {(type) => <option value={type} />}
                </For>
              </datalist>
            </label>
            <label>
              {t("knowledge.sourceDocument")}
              <select
                value={state.source.documentID ?? ""}
                onChange={(event) => edit({ documentID: event.currentTarget.value || undefined })}
              >
                <option value="">{t("knowledge.none")}</option>
                <For
                  each={base.sources.filter(
                    (item) =>
                      item.id !== state.source.id &&
                      item.spaceID === state.source.spaceID &&
                      ["document", "note", "link"].includes(item.type),
                  )}
                >
                  {(item) => <option value={item.id}>{item.name}</option>}
                </For>
              </select>
            </label>
            <Show when={state.source.text !== undefined} fallback={<p>{t("knowledge.editor.originalHint")}</p>}>
              <div class="kb-editor-tabs">
                <button type="button" aria-pressed={!state.preview} onClick={() => setState("preview", false)}>
                  {t("knowledge.editor.markdown")}
                </button>
                <button type="button" aria-pressed={state.preview} onClick={() => setState("preview", true)}>
                  {t("knowledge.editor.preview")}
                </button>
              </div>
              <Show
                when={state.preview}
                fallback={
                  <textarea
                    class="kb-markdown-input"
                    aria-label={t("knowledge.editor.markdown")}
                    value={state.source.text ?? ""}
                    onInput={(event) => edit({ text: event.currentTarget.value })}
                    spellcheck={false}
                  />
                }
              >
                <div class="kb-markdown-preview">
                  <Markdown text={state.source.text ?? ""} />
                </div>
              </Show>
            </Show>
          </Show>
          <Show when={state.step === 1}>
            <div class="kb-visual-preview">
              <KnowledgeNodePreview source={state.source} />
              <strong>{state.source.name || state.source.filename || t("knowledge.editor.create")}</strong>
              <small>{t("knowledge.appearance.previewHint")}</small>
            </div>
            <fieldset>
              <legend>{t("knowledge.editor.color")}</legend>
              <div class="kb-swatches">
                <For each={nodePalette}>
                  {(color, index) => (
                    <button
                      type="button"
                      style={{ background: color }}
                      aria-label={`${t("knowledge.editor.color")} ${index() + 1}`}
                      aria-pressed={nodeColor(state.source) === color}
                      onClick={() => edit({ visual: { ...unwrap(state.source.visual), color } })}
                    />
                  )}
                </For>
              </div>
            </fieldset>
            <fieldset>
              <legend>{t("knowledge.editor.icon")}</legend>
              <div class="kb-icon-options">
                <For each={nodeIcons}>
                  {(icon) => (
                    <button
                      type="button"
                      aria-label={t(`knowledge.appearance.icon.${icon}`)}
                      title={t(`knowledge.appearance.icon.${icon}`)}
                      aria-pressed={(state.source.visual?.icon ?? state.source.type) === icon}
                      onClick={() => edit({ visual: { ...unwrap(state.source.visual), icon } })}
                    >
                      <Icon name={nodeIconNames[icon]} />
                    </button>
                  )}
                </For>
              </div>
            </fieldset>
            <fieldset>
              <legend>{t("knowledge.editor.size")}</legend>
              <div class="kb-size-options">
                <For each={Object.keys(nodeSizes) as (keyof typeof nodeSizes)[]}>
                  {(size) => (
                    <button
                      type="button"
                      aria-pressed={(state.source.visual?.size ?? "standard") === size}
                      onClick={() => edit({ visual: { ...unwrap(state.source.visual), size } })}
                    >
                      <span
                        class="kb-size-sample"
                        style={{ width: `${24 * nodeSizes[size]}px`, height: `${24 * nodeSizes[size]}px` }}
                      />
                      <span>{t(`knowledge.appearance.size.${size}`)}</span>
                    </button>
                  )}
                </For>
              </div>
            </fieldset>
            <fieldset>
              <legend>{t("knowledge.appearance.style")}</legend>
              <div class="kb-style-options">
                <For each={nodeStyles}>
                  {(style) => (
                    <button
                      type="button"
                      aria-pressed={(state.source.visual?.style ?? "glow") === style}
                      onClick={() => edit({ visual: { ...unwrap(state.source.visual), style } })}
                    >
                      <span class="kb-style-sample" data-style={style} />
                      <span>{t(`knowledge.appearance.style.${style}`)}</span>
                    </button>
                  )}
                </For>
              </div>
            </fieldset>
            <fieldset>
              <legend>{t("knowledge.appearance.presets")}</legend>
              <div class="kb-preset-options">
                <For each={Object.keys(nodePresets) as (keyof typeof nodePresets)[]}>
                  {(preset) => (
                    <button
                      type="button"
                      aria-pressed={Object.entries(nodePresets[preset]).every(
                        ([key, value]) =>
                          state.source.visual?.[key as keyof NonNullable<KnowledgeSource["visual"]>] === value,
                      )}
                      onClick={() => edit({ visual: { ...nodePresets[preset] } })}
                    >
                      <Icon name={nodeIconNames[nodePresets[preset].icon]} />
                      {t(`knowledge.appearance.preset.${preset}`)}
                    </button>
                  )}
                </For>
              </div>
            </fieldset>
          </Show>
          <Show when={state.step === 2}>
            <p>{t("knowledge.editor.relationsHint")}</p>
            <For each={state.relations}>
              {(edge) => (
                <div class="kb-edge-row">
                  <div>
                    <strong>{name(edge.source)}</strong>
                    <span> {edge.type === "RELATED_TO" ? "↔" : "→"} </span>
                    <strong>{name(edge.target)}</strong>
                  </div>
                  <select
                    aria-label={t("knowledge.editor.relationType")}
                    value={edge.type}
                    onChange={(event) => {
                      setState("relations", (item) => item.id === edge.id, {
                        type: event.currentTarget.value,
                        origin: "manual",
                        provenance: "manual",
                      })
                      setState("dirty", true)
                    }}
                  >
                    <Show when={!relationTypes.includes(edge.type as (typeof relationTypes)[number])}>
                      <option value={edge.type}>{edge.type}</option>
                    </Show>
                    <For each={relationTypes}>
                      {(type) => <option value={type}>{t(`knowledge.relation.${type}`)}</option>}
                    </For>
                  </select>
                  <button
                    type="button"
                    aria-label={t("knowledge.editor.removeRelation")}
                    onClick={() => {
                      setState(
                        "relations",
                        state.relations.filter((item) => item.id !== edge.id),
                      )
                      setState("dirty", true)
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              )}
            </For>
            <Show when={!state.relations.length}>
              <p>{t("knowledge.noRelations")}</p>
            </Show>
            <Show
              when={state.adding}
              fallback={
                <button type="button" onClick={() => setState("adding", true)}>
                  + {t("knowledge.editor.addRelation")}
                </button>
              }
            >
              <div class="kb-edge-add">
                <Show when={!peers().length}>
                  <p role="status">{t(state.search ? "knowledge.none" : "knowledge.editor.noTargets")}</p>
                </Show>
                <label>
                  {t("knowledge.editor.find")}
                  <input
                    type="search"
                    value={state.search}
                    onInput={(event) => setState("search", event.currentTarget.value)}
                  />
                </label>
                <label>
                  {t("knowledge.editor.target")}
                  <select
                    aria-label={t("knowledge.editor.target")}
                    value={state.target}
                    onChange={(event) => setState("target", event.currentTarget.value)}
                  >
                    <option value="">{t("knowledge.select")}</option>
                    <For each={peers()}>{(peer) => <option value={peer.id}>{peer.name}</option>}</For>
                  </select>
                </label>
                <div class="kb-editor-columns">
                  <label>
                    {t("knowledge.editor.relationType")}
                    <select
                      aria-label={t("knowledge.editor.relationType")}
                      value={state.type}
                      onChange={(event) => setState("type", event.currentTarget.value)}
                    >
                      <For each={relationTypes}>
                        {(type) => <option value={type}>{t(`knowledge.relation.${type}`)}</option>}
                      </For>
                    </select>
                  </label>
                  <label>
                    {t("knowledge.editor.direction")}
                    <select
                      aria-label={t("knowledge.editor.direction")}
                      value={state.direction}
                      onChange={(event) => setState("direction", event.currentTarget.value)}
                    >
                      <option value="out">{t("knowledge.editor.out")}</option>
                      <option value="in">{t("knowledge.editor.in")}</option>
                    </select>
                  </label>
                </div>
                <button type="button" disabled={!state.target} onClick={addRelation}>
                  {t("knowledge.editor.addRelation")}
                </button>
                <button type="button" onClick={() => setState({ adding: false, target: "" })}>
                  {t("knowledge.cancel")}
                </button>
              </div>
            </Show>
          </Show>
          <Show when={state.step === 3}>
            <h3>{state.source.name || t("knowledge.editor.create")}</h3>
            <p>{state.source.filename}</p>
            <p>{state.source.description}</p>
            <dl class="kb-editor-summary">
              <dt>{t("knowledge.choose")}</dt>
              <dd>{base.spaces.find((space) => space.id === state.source.spaceID)?.name}</dd>
              <dt>{t("knowledge.relations")}</dt>
              <dd>{state.relations.length}</dd>
            </dl>
            <p>{t("knowledge.editor.saveHint")}</p>
            <Show when={state.adding && state.target}>
              <p role="alert">{t("knowledge.editor.pending")}</p>
            </Show>
          </Show>
          <Show when={state.error}>
            <p role="alert" class="kb-error">
              {state.error}
            </p>
          </Show>
        </div>
        <footer>
          <button type="button" disabled={state.busy} onClick={close}>
            {t("knowledge.cancel")}
          </button>
          <Show when={state.step > 0}>
            <button type="button" onClick={() => setState("step", state.step - 1)}>
              {t("knowledge.editor.back")}
            </button>
          </Show>
          <button
            class="kb-primary"
            type="submit"
            disabled={state.busy || (state.step === 3 && !!state.target && state.adding)}
          >
            {t(state.step === 3 ? "knowledge.save" : "knowledge.editor.next")}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
