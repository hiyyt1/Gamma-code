export * as ProfileTools from "./profile-tools"

import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "../effect/app-node"
import type { Tool } from "./tool"
import { SystemContext } from "../system-context"

// Hosts adapt their existing MCP clients to canonical tools. The runner owns
// the scoped registration, just as it owns the provider-turn lifetime.
export interface Interface {
  readonly load: (directory: string) => Effect.Effect<{
    readonly tools: Readonly<Record<string, Tool.AnyTool>>
    readonly context: SystemContext.SystemContext
  }>
}
export class Service extends Context.Service<Service, Interface>()("@gamma/ProfileTools") {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.succeed(Service, { load: () => Effect.succeed({ tools: {}, context: SystemContext.empty }) }),
  deps: [],
})
