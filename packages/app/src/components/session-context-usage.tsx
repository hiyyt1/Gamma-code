import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Match, Show, Switch, createMemo, lazy, type Accessor, type ComponentProps, type JSX } from "solid-js"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { ProgressCircleV2 } from "@opencode-ai/ui/v2/progress-circle-v2"
import { Button } from "@opencode-ai/ui/button"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { useSDK } from "@/context/sdk"
import { getSessionContext } from "@/components/session/session-context-metrics"
import { createSessionContextFormatter } from "@/components/session/session-context-format"
import { useSessionLayout } from "@/pages/session/session-layout"

interface SessionContextUsageProps {
  trigger?: (open: () => void, indicator: JSX.Element, usage: Accessor<string>) => JSX.Element
  variant?: "button" | "indicator"
  buttonAppearance?: "default" | "v2"
  placement?: ComponentProps<typeof TooltipV2>["placement"]
}

function ContextTooltipRow(props: { name: JSX.Element; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-4">
      <span class="shrink-0 text-v2-text-text-muted">{props.name}</span>
      <span class="ml-auto min-w-0 truncate text-right text-v2-text-text-base">{props.value}</span>
    </div>
  )
}

const SessionContextTab = lazy(async () => {
  const { SessionContextTab } = await import("./session/session-context-tab")
  return { default: SessionContextTab }
})

export function SessionContextUsage(props: SessionContextUsageProps) {
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()
  const providers = useProviders(() => sdk().directory)
  const { params } = useSessionLayout()

  const variant = createMemo(() => props.variant ?? "button")
  const buttonAppearance = createMemo(() => props.buttonAppearance ?? "default")
  const messages = createMemo(() => (params.id ? (sync().data.message[params.id] ?? []) : []))
  const info = createMemo(() => (params.id ? sync().session.get(params.id) : undefined))

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const context = createMemo(() => getSessionContext(messages(), [...providers.all().values()]))
  const usage = () => createSessionContextFormatter(language.intl()).percent(context()?.usage)
  const cost = createMemo(() => {
    return usd().format(info()?.cost ?? 0)
  })
  const openContext = () => {
    if (!params.id) return
    dialog.show(() => (
      <Dialog title={language.t("context.usage.view")} size="large">
        <div class="h-[70vh] min-h-0">
          <SessionContextTab />
        </div>
      </Dialog>
    ))
  }

  const circle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle
        size={16}
        strokeWidth={2}
        percentage={context()?.usage ?? 0}
        style={
          variant() === "indicator"
            ? {
                "--progress-circle-background": "var(--v2-background-bg-layer-04, var(--border-weak-base))",
                "--progress-circle-background-overlay": "var(--v2-overlay-simple-overlay-pressed, transparent)",
                "--progress-circle-progress": "var(--v2-icon-icon-base, var(--icon-base))",
              }
            : undefined
        }
      />
    </div>
  )
  const circleV2 = () => (
    <div class="flex items-center justify-center">
      <ProgressCircleV2 percentage={context()?.usage ?? 0} />
    </div>
  )

  const tooltipValue = () => (
    <div class="flex w-[120px] flex-col gap-2">
      <ContextTooltipRow name={language.t("context.usage.cost")} value={cost()} />
      <ContextTooltipRow name={language.t("context.usage.usage")} value={usage()} />
      <ContextTooltipRow
        name={language.t("context.usage.tokens")}
        value={context()?.total.toLocaleString(language.intl()) ?? "—"}
      />
    </div>
  )

  if (props.trigger) return <Show when={params.id}>{props.trigger(openContext, circle(), usage)}</Show>

  return (
    <Show when={params.id}>
      <TooltipV2 value={tooltipValue()} placement={props.placement ?? "top"} shift={-8}>
        <Switch>
          <Match when={variant() === "indicator"}>{circle()}</Match>
          <Match when={buttonAppearance() === "v2"}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="large"
              icon={circleV2()}
              onClick={openContext}
              aria-label={language.t("context.usage.view")}
            />
          </Match>
          <Match when={true}>
            <Button
              type="button"
              variant="ghost"
              class="size-6"
              onClick={openContext}
              aria-label={language.t("context.usage.view")}
            >
              {circle()}
            </Button>
          </Match>
        </Switch>
      </TooltipV2>
    </Show>
  )
}
