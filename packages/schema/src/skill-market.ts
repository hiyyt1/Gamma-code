import { Schema } from "effect"

export * as SkillMarket from "./skill-market"

export const Category = Schema.Literals([
  "development",
  "design",
  "automation",
  "testing",
  "security",
  "integrations",
  "documents",
])
export const Compatibility = Schema.Literals(["verified", "needs-adaptation", "needs-configuration", "unsupported"])
export const Skill = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  path: Schema.String,
  sha256: Schema.String,
})
export interface Package extends Schema.Schema.Type<typeof Package> {}
export const Package = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  source: Schema.String,
  author: Schema.String,
  description: Schema.String,
  revision: Schema.NullOr(Schema.String),
  license: Schema.NullOr(Schema.String),
  category: Category,
  skills: Schema.Array(Skill),
  dependencies: Schema.Array(Schema.String),
  compatibility: Compatibility,
  runtimes: Schema.Array(Schema.Literals(["v1", "v2"])),
  reason: Schema.String,
  enabledByDefault: Schema.Literal(false),
})
export const Selection = Schema.Struct({ enabled: Schema.Array(Schema.String) })
