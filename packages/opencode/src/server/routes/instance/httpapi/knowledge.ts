import { Effect, Layer, Schema, Stream } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import {
  KnowledgePublish,
  KnowledgeState,
  KnowledgeProject,
  KnowledgeVerification,
} from "@opencode-ai/schema/knowledge"
import { KnowledgeStore } from "@/server/knowledge-store"
import { Authorization } from "./middleware/authorization"

class KnowledgeHttpError extends Schema.TaggedErrorClass<KnowledgeHttpError>()(
  "KnowledgeHttpError",
  { code: Schema.String },
  { httpApiStatus: 409 },
) {}
const Api = HttpApi.make("knowledge").add(
  HttpApiGroup.make("knowledge")
    .add(
      HttpApiEndpoint.get("verify", "/product/knowledge/verify", {
        success: KnowledgeVerification,
        error: KnowledgeHttpError,
      }),
    )
    .add(HttpApiEndpoint.get("state", "/product/knowledge", { success: KnowledgeState, error: KnowledgeHttpError }))
    .add(
      HttpApiEndpoint.post("publish", "/product/knowledge/publish", {
        payload: KnowledgePublish,
        success: KnowledgeState,
        error: KnowledgeHttpError,
      }),
    )
    .add(
      HttpApiEndpoint.post("blob", "/product/knowledge/blob/:hash", {
        params: { hash: Schema.String },
        success: Schema.Struct({ hash: Schema.String, size: Schema.Number }),
        error: KnowledgeHttpError,
      }),
    )
    .add(
      HttpApiEndpoint.get("original", "/product/knowledge/original", {
        query: { id: Schema.String },
        success: Schema.Struct({ bytes: Schema.String, mime: Schema.String }),
        error: KnowledgeHttpError,
      }),
    )
    .add(
      HttpApiEndpoint.get("projects", "/product/knowledge/projects", {
        success: Schema.Array(KnowledgeProject),
        error: KnowledgeHttpError,
      }),
    )
    .add(
      HttpApiEndpoint.post("connect", "/product/knowledge/projects", {
        payload: Schema.Struct({ projectID: Schema.String, spaces: Schema.Array(Schema.String) }),
        success: Schema.Array(KnowledgeProject),
        error: KnowledgeHttpError,
      }),
    )
    .middleware(Authorization),
)
const handlers = HttpApiBuilder.group(Api, "knowledge", (group) =>
  Effect.gen(function* () {
    const operation = <T>(run: () => Promise<T>) =>
      Effect.tryPromise({
        try: run,
        catch: (error) =>
          new KnowledgeHttpError({
            code: error instanceof KnowledgeStore.KnowledgeError ? error.message : "unavailable",
          }),
      })
    return group
      .handle("verify", () => operation(() => KnowledgeStore.verify()))
      .handle("state", () => operation(() => KnowledgeStore.state()))
      .handle("publish", (ctx) => operation(() => KnowledgeStore.publish(ctx.payload)))
      .handle("original", (ctx) =>
        operation(async () => {
          const file = await KnowledgeStore.original(ctx.query.id)
          return { bytes: file.bytes.toString("base64"), mime: file.mime }
        }),
      )
      .handle("projects", () => operation(() => KnowledgeStore.projects()))
      .handle("connect", (ctx) => operation(() => KnowledgeStore.projects(ctx.payload)))
      .handleRaw("blob", (ctx) =>
        Effect.gen(function* () {
          const body = yield* ctx.request.stream.pipe(
            Stream.runFoldEffect(
              () => ({ chunks: [] as Uint8Array[], size: 0 }),
              (body, chunk) => {
                if (body.size + chunk.byteLength > 20 * 1024 * 1024)
                  return Effect.fail(new KnowledgeHttpError({ code: "too_large" }))
                body.chunks.push(chunk)
                body.size += chunk.byteLength
                return Effect.succeed(body)
              },
            ),
            Effect.mapError(() => new KnowledgeHttpError({ code: "invalid_upload" })),
          )
          const result = yield* operation(() =>
            KnowledgeStore.upload(ctx.params.hash, Buffer.concat(body.chunks, body.size)),
          )
          return HttpServerResponse.jsonUnsafe(result)
        }),
      )
  }),
)
export const knowledgeRoutes = HttpApiBuilder.layer(Api).pipe(Layer.provide(handlers))
