import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"

export const { use: useOnboarding, provider: OnboardingProvider } = createSimpleContext({
  name: "Onboarding",
  gate: false,
  init: () => {
    const [store, setStore, , ready] = persisted(
      Persist.global("onboarding"),
      createStore({
        drafts: {} as Record<string, string>,
        pending: {} as Record<string, { sessionID: string; text: string } | undefined>,
      }),
    )
    return {
      ready,
      text: (server: string) => store.drafts[server] ?? "",
      set: (server: string, text: string) => setStore("drafts", server, text),
      pending: (server: string) => store.pending[server],
      stage: (server: string, sessionID: string, text: string) => setStore("pending", server, { sessionID, text }),
      // Claim before invoking the normal submit path: remounts must never replay it.
      claim: (server: string, sessionID: string) => {
        const pending = store.pending[server]
        if (!pending || pending.sessionID !== sessionID) return
        setStore("pending", server, undefined)
        if (store.drafts[server] === pending.text) setStore("drafts", server, "")
        return pending.text
      },
    }
  },
})
