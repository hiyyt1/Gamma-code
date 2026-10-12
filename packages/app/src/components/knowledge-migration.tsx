import { For, Show, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import type { KnowledgeVerification } from "@opencode-ai/schema/knowledge"
import type { ServerConnection } from "@/context/server"
import { useLanguage } from "@/context/language"
import { knowledgeInventory, knowledgeBackup, type KnowledgeInventory } from "@/utils/knowledge-backup"
import { productRequest } from "@/utils/product"

export function KnowledgeMigration(props: { server?: ServerConnection.HttpBase }) {
  const language = useLanguage()
  const [state, setState] = createStore({
    busy: false,
    error: false,
    inventory: undefined as KnowledgeInventory | undefined,
    download: "",
    verification: undefined as typeof KnowledgeVerification.Type | undefined,
  })
  let modal!: HTMLDialogElement
  let disposed = false
  const revoke = () => {
    if (state.download) URL.revokeObjectURL(state.download)
  }
  onCleanup(() => {
    disposed = true
    revoke()
  })
  const inspect = async () => {
    setState({ busy: true, error: false })
    await knowledgeInventory()
      .then((inventory) => setState("inventory", inventory))
      .catch(() => setState("error", true))
      .finally(() => setState("busy", false))
  }
  const backup = async () => {
    setState({ busy: true, error: false })
    await knowledgeInventory()
      .then(async (inventory) => {
        const file = await knowledgeBackup(inventory)
        if (disposed) return
        revoke()
        setState({ inventory, download: URL.createObjectURL(file) })
      })
      .catch(() => setState("error", true))
      .finally(() => setState("busy", false))
  }
  const verify = async () => {
    if (!props.server) return
    setState({ busy: true, error: false, verification: undefined })
    await productRequest<typeof KnowledgeVerification.Type>(props.server, "knowledge/verify")
      .then((verification) => setState("verification", verification))
      .catch(() => setState("error", true))
      .finally(() => setState("busy", false))
  }
  return (
    <>
      <button
        class="kb-migration-launch"
        onClick={() => {
          modal.showModal()
          void inspect()
        }}
      >
        {language.t("knowledge.migration.manage")}
      </button>
      <Portal>
        <dialog ref={modal} class="kb-dialog kb-migration" aria-label={language.t("knowledge.migration.manage")}>
          <header>
            <h2>{language.t("knowledge.migration.manage")}</h2>
            <button type="button" aria-label={language.t("knowledge.close")} onClick={() => modal.close()}>
              ×
            </button>
          </header>
          <p>{language.t("knowledge.migration.hint")}</p>

          <div class="kb-migration-actions">
            <button disabled={state.busy} onClick={() => void inspect()}>
              {language.t("knowledge.migration.inspect")}
            </button>
            <button disabled={state.busy} onClick={() => void backup()}>
              {language.t("knowledge.migration.backup")}
            </button>
            <button disabled={state.busy || !props.server} onClick={() => void verify()}>
              {language.t("knowledge.migration.verify")}
            </button>
            <Show when={state.download}>
              <a href={state.download} download="gamma-knowledge-backup.json">
                {language.t("knowledge.migration.download")}
              </a>
            </Show>
          </div>
          <Show when={state.busy}>
            <p role="status">{language.t("knowledge.sync.loading")}</p>
          </Show>
          <Show when={state.error}>
            <p role="alert">{language.t("knowledge.migration.failed")}</p>
          </Show>
          <Show when={state.inventory}>
            {(inventory) => (
              <>
                <Show when={inventory().data.spaces.length === 0}>
                  <p>{language.t("knowledge.migration.empty")}</p>
                </Show>
                <p>
                  {language.t("knowledge.migration.counts", {
                    spaces: inventory().data.spaces.length,
                    materials: inventory().data.sources.length,
                    relations: inventory().data.relations.length,
                    originals: inventory().data.sources.filter(
                      (source) => source.filename && inventory().files.some((file) => file.key === source.id),
                    ).length,
                  })}
                </p>
                <For each={inventory().missing}>
                  {(source) => (
                    <p role="alert">
                      {language.t("knowledge.migration.missing", {
                        name: `${source.name} (${source.id}, ${source.filename})`,
                      })}
                    </p>
                  )}
                </For>
                <For each={inventory().mismatched}>
                  {(source) => (
                    <p role="alert">
                      {language.t("knowledge.migration.mismatch", { name: `${source.name} (${source.id})` })}
                    </p>
                  )}
                </For>
                <details>
                  <summary>{language.t("knowledge.migration.details")}</summary>
                  <code>{window.location.origin}</code>
                  <div class="kb-migration-table">
                    <table>
                      <thead>
                        <tr>
                          <th>{language.t("knowledge.migration.material")}</th>
                          <th>{language.t("knowledge.migration.original")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={inventory().data.sources}>
                          {(source) => (
                            <tr>
                              <td>
                                <strong>{source.name}</strong>
                                <br />
                                {source.id} · {source.type}
                                <br />
                                {inventory().data.spaces.find((space) => space.id === source.spaceID)?.name}
                                <p>{source.description}</p>
                                <code>{JSON.stringify(source.visual ?? {})}</code>
                              </td>
                              <td>
                                {source.filename}
                                <br />
                                {inventory().files.find((file) => file.key === source.id)?.size}
                                <br />
                                <code>{inventory().files.find((file) => file.key === source.id)?.sha256}</code>
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </Show>
          <Show when={state.verification}>
            {(verification) => (
              <>
                <code>{verification().root}</code>
                <p>
                  {language.t("knowledge.migration.counts", {
                    spaces: verification().spaces,
                    materials: verification().materials,
                    relations: verification().relations,
                    originals: verification().originals.length,
                  })}
                </p>
                <p role="status">
                  {language.t(
                    verification().errors.length ? "knowledge.migration.invalid" : "knowledge.migration.verified",
                  )}
                </p>
                <For each={verification().errors}>
                  {(error) => (
                    <p role="alert">
                      {error.id}: {error.reason}
                    </p>
                  )}
                </For>
              </>
            )}
          </Show>
        </dialog>
      </Portal>
    </>
  )
}
