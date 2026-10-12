import { useCommand } from "@/context/command"
import { createEffect, Show, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { usePlatform } from "@/context/platform"
import { setV2Toast, ToastRegion } from "@/utils/toast"
import { GammaShell, GammaSidebar } from "@/components/gamma-shell"

import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const command = useCommand()
  const layout = useLayout()
  const language = useLanguage()
  const [state, setState] = createStore({ debugTools: true, tabsMount: undefined as HTMLDivElement | undefined })

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
    <GammaShell.provider>
      <div
        data-gamma-shell=""
        data-sidebar-open={layout.mobileSidebar.opened()}
        data-gamma-web={platform.platform === "web" ? "" : undefined}
        class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
        style={{
          "padding-top": "env(safe-area-inset-top, 0px)",
          "padding-bottom": "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <IconButtonV2
          class="gamma-sidebar-toggle"
          variant="ghost-muted"
          size="large"
          icon={<Icon name="menu" />}
          aria-label={language.t("command.sidebar.toggle")}
          aria-expanded={layout.mobileSidebar.opened()}
          aria-controls="gamma-navigation"
          onClick={layout.mobileSidebar.toggle}
        />
        <Show when={layout.mobileSidebar.opened()}>
          <button
            class="gamma-sidebar-backdrop"
            aria-label={language.t("command.sidebar.toggle")}
            onClick={layout.mobileSidebar.toggle}
          />
        </Show>
        <div id="gamma-navigation" class="gamma-navigation">
          <GammaSidebar tabsMount={(element) => setState("tabsMount", element)} />
        </div>
        <Titlebar
          newChat={() => command.trigger("product.new")}
          tabsMount={platform.platform === "web" ? state.tabsMount : undefined}
          update={update}
          debugTools={
            import.meta.env.DEV
              ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
              : undefined
          }
        />
        <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
          <Suspense>{props.children}</Suspense>
        </main>
        <div data-slot="gamma-debug">{import.meta.env.DEV && state.debugTools && <DebugBar inline />}</div>
        <TabsInfoPopup />
        <ToastRegion v2 />
      </div>
    </GammaShell.provider>
  )
}
