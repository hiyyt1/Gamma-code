import { Schema } from "effect"

const ID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160))
const Text = Schema.String.check(Schema.isMaxLength(20 * 1024 * 1024))
export const KnowledgeSpace = Schema.Struct({
  id: ID,
  name: Text,
  description: Text,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export const KnowledgeSource = Schema.Struct({
  id: ID,
  spaceID: ID,
  type: Schema.Literals(["document", "note", "link", "entity", "project"]),
  entityType: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
  properties: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  documentID: Schema.optional(ID),
  name: Text,
  description: Text,
  tags: Schema.Array(Text),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  text: Schema.optional(Text),
  url: Schema.optional(Text),
  filename: Schema.optional(Text),
  mime: Schema.optional(Text),
  size: Schema.optional(Schema.Number),
  authored: Schema.optional(Schema.Boolean),
  visual: Schema.optional(
    Schema.Struct({
      color: Schema.optional(ID),
      icon: Schema.optional(ID),
      size: Schema.optional(ID),
      style: Schema.optional(ID),
    }),
  ),
})
export const KnowledgeRelation = Schema.Struct({
  id: ID,
  spaceID: ID,
  source: ID,
  target: ID,
  type: Text,
  provenance: Schema.Literals(["manual", "demo", "extracted"]),
  origin: Schema.optional(Schema.Literals(["manual", "generated"])),
  createdAt: Schema.optional(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.String),
})
export const KnowledgeData = Schema.Struct({
  revision: Schema.optional(Schema.Number),
  spaces: Schema.Array(KnowledgeSpace),
  sources: Schema.Array(KnowledgeSource),
  relations: Schema.Array(KnowledgeRelation),
  jobs: Schema.Array(
    Schema.Struct({
      id: ID,
      sourceID: ID,
      spaceID: ID,
      status: Schema.Literals(["stored", "processing", "waiting", "error"]),
      attempts: Schema.Number,
      error: Schema.optional(Schema.String),
      updatedAt: Schema.String,
    }),
  ),
})
export const KnowledgeBlob = Schema.Struct({
  hash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  size: Schema.Number,
  mime: Schema.String,
})
export const KnowledgePublish = Schema.Struct({
  expectedVersion: Schema.Number,
  requestID: ID,
  data: KnowledgeData,
  originals: Schema.Record(Schema.String, KnowledgeBlob),
})
export const KnowledgeState = Schema.Struct({
  modelVersion: Schema.optional(Schema.Number),
  version: Schema.Number,
  data: KnowledgeData,
  originals: Schema.Record(Schema.String, KnowledgeBlob),
  spaces: Schema.Array(Schema.Struct({ id: ID, storageID: ID, version: Schema.Number })),
})
export const KnowledgeProject = Schema.Struct({
  id: ID,
  name: Schema.String,
  path: Schema.String,
  spaces: Schema.Array(ID),
})

export const KnowledgeVerification = Schema.Struct({
  root: Schema.String,
  version: Schema.Number,
  spaces: Schema.Number,
  materials: Schema.Number,
  relations: Schema.Number,
  originals: Schema.Array(Schema.Struct({ id: ID, size: Schema.Number, sha256: Schema.String })),
  errors: Schema.Array(Schema.Struct({ id: ID, reason: Schema.String })),
})
