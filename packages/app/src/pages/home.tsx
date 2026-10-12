import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { HomeOnboarding } from "./home/home-onboarding"

export function NewHome() {
  return (
    <div class="gamma-home m-2 min-h-0 flex-1 self-stretch overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]">
      <ScrollView class="h-full">
        <div class="mx-auto flex min-h-full w-full max-w-[1100px] flex-col px-6 lg:px-10">
          <HomeOnboarding />
        </div>
      </ScrollView>
    </div>
  )
}
