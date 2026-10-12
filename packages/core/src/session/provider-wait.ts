export * as ProviderWait from "./provider-wait"

import { Context, Deferred, Effect, Stream } from "effect"
import type { LLMEvent } from "@opencode-ai/llm"

// This budget includes transport retries and their backoff, but not active generation.
// Unknown capabilities use the reasoning allowance rather than a model-name heuristic.
export const Policy = Context.Reference<{ normal: number; reasoning: number }>("@opencode/ProviderWait", {
  defaultValue: () => ({ normal: 6 * 60_000, reasoning: 12 * 60_000 }),
})

export class BudgetExceeded extends Error {
  override readonly name = "ProviderWaitBudgetExceeded"
  constructor(readonly milliseconds: number) {
    super(`Provider did not begin a response within ${Math.round(milliseconds / 1000)} seconds, including retries`)
  }
}

export class StreamStalled extends Error {
  override readonly name = "ProviderStreamStalled"
  constructor() {
    super("Provider response stream stopped sending events for 300 seconds")
  }
}

export const make = Effect.fn("ProviderWait.make")(function* (reasoning?: boolean) {
  const policy = yield* Policy
  const milliseconds = reasoning === false ? policy.normal : policy.reasoning
  const progress = yield* Deferred.make<void>()
  return {
    // V2 executes local tools outside the provider stream, so only provider I/O is timed here.
    // Legacy already owns transport idle timeouts and may execute tools inside its stream.
    guard: <E, R>(stream: Stream.Stream<LLMEvent, E, R>) =>
      Stream.transformPull(stream, (pull) =>
        Effect.succeed(
          Effect.gen(function* () {
            if (!(yield* Deferred.isDone(progress))) return yield* pull
            return yield* pull.pipe(
              Effect.timeoutOrElse({
                duration: "5 minutes",
                orElse: () => Effect.fail(new StreamStalled()),
              }),
            )
          }),
        ),
      ),
    observe: (event: LLMEvent) =>
      ((event.type === "text-delta" || event.type === "reasoning-delta" || event.type === "tool-input-delta") &&
        event.text.length > 0) ||
      event.type === "tool-call" ||
      event.type === "finish"
        ? Deferred.succeed(progress, undefined).pipe(Effect.asVoid)
        : Effect.void,
    run: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.raceFirst(
        effect,
        Deferred.await(progress).pipe(
          Effect.timeoutOrElse({
            duration: milliseconds,
            orElse: () => Effect.fail(new BudgetExceeded(milliseconds)),
          }),
          Effect.andThen(Effect.never),
        ),
      ),
  }
})
