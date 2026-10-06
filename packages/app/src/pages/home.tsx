import { OreshnikShell } from "@/components/oreshnik-shell"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { createHomeScrollController } from "./home/home-scroll-controller"
import { createHomeSessionSearchController } from "./home/home-session-search-controller"
import { HomeSessions } from "./home/home-sessions"

export function NewHome() {
  const shell = OreshnikShell.use()
  const search = createHomeSessionSearchController(shell.home, shell.sessions)
  const scroll = createHomeScrollController(shell.sessions.data.groups)
  return (
    <div
      class={`
        oreshnik-home m-2 min-h-0 flex-1 self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <ScrollView
        class="h-full [container-type:size]"
        thumbContainer={scroll.viewport.thumbTrack}
        thumbHoverTarget={scroll.viewport.hoverTarget}
        viewportRef={scroll.viewport.setViewport}
        onScroll={(event) => scroll.viewport.update(event.currentTarget.scrollTop)}
        onWheel={scroll.viewport.containOuterWheel}
      >
        <div
          class={`
            mx-auto flex min-h-full w-full max-w-[1100px] flex-col px-6 lg:px-10
          `}
        >
          <HomeSessions sessions={shell.sessions} search={search} scroll={scroll} />
        </div>
      </ScrollView>
    </div>
  )
}
