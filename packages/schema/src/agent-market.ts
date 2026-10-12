export * as AgentMarket from "./agent-market"

import { Schema } from "effect"

export const Profile = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  type: Schema.Literals(["specialist", "team"]),
  category: Schema.Literals(["development", "design", "testing", "security", "automation", "data", "business"]),
  tasks: Schema.Array(Schema.String),
  skills: Schema.Array(Schema.String),
  tools: Schema.Array(Schema.String),
  members: Schema.Array(Schema.String),
  permissions: Schema.Record(Schema.String, Schema.Literals(["allow", "ask", "deny"])),
  source: Schema.String,
  revision: Schema.String,
  license: Schema.String,
  available: Schema.Boolean,
  reason: Schema.String,
  hidden: Schema.optional(Schema.Boolean),
  leader: Schema.optional(Schema.String),
  skillBundle: Schema.optional(Schema.String),
  environment: Schema.optional(Schema.Array(Schema.String)),
  limitations: Schema.optional(Schema.Array(Schema.String)),
  mcp: Schema.optional(Schema.Literals(["bsl-language-server", "bitrix24", "wildberries", "presentation"])),
})
export interface Profile extends Schema.Schema.Type<typeof Profile> {}

export const Selection = Schema.Struct({
  agentId: Schema.NullOr(Schema.String),
  version: Schema.Int,
  revision: Schema.NullOr(Schema.String),
})
export interface Selection extends Schema.Schema.Type<typeof Selection> {}

export const Apply = Schema.Struct({
  agentId: Schema.String,
  // Accepted for older clients; creating a session never changes a project selection.
  expectedVersion: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  confirmed: Schema.optional(Schema.Boolean),
  connectSkills: Schema.Boolean,
  requestId: Schema.String.check(Schema.isMinLength(16), Schema.isMaxLength(100)),
})
export interface Apply extends Schema.Schema.Type<typeof Apply> {}

export const Applied = Schema.Struct({ selection: Selection, sessionId: Schema.String })
export interface Applied extends Schema.Schema.Type<typeof Applied> {}

export const Runtime = Schema.Struct({
  status: Schema.Literals(["disabled", "ready", "failed"]),
  error: Schema.optional(Schema.String),
  tools: Schema.Array(Schema.String),
  sourceTools: Schema.Boolean,
  sourceError: Schema.optional(Schema.String),
})
export interface Runtime extends Schema.Schema.Type<typeof Runtime> {}
