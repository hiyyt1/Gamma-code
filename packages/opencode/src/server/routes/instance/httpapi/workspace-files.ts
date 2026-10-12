import { Effect, Layer, Schema, Stream } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { InstanceStore } from "@/project/instance-store"
import { InstanceRef } from "@/effect/instance-ref"
import { ProductProjects } from "@/server/product-projects"
import { WorkspaceUpload } from "@/server/workspace-upload"
import { Authorization } from "./middleware/authorization"

class UploadError extends Schema.TaggedErrorClass<UploadError>()(
  "UploadError",
  {
    code: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

// Product-only surface: not part of the OpenCode SDK or provider/tool APIs.
const Api = HttpApi.make("workspaceFiles").add(
  HttpApiGroup.make("workspaceFiles")
    .add(
      HttpApiEndpoint.post("discardEmptySession", "/product/session/:sessionID/discard-empty", {
        params: { sessionID: SessionID },
        success: Schema.Struct({ removed: Schema.Boolean }),
      }),
    )
    .add(
      HttpApiEndpoint.post("upload", "/product/session/:sessionID/files", {
        params: { sessionID: SessionID },
        error: UploadError,
        success: Schema.Struct({ name: Schema.String }),
      }),
    )
    .add(
      HttpApiEndpoint.get("projects", "/product/projects", {
        success: Schema.Array(Schema.Struct({ name: Schema.String, path: Schema.String })),
        error: UploadError,
      }),
    )
    .add(
      HttpApiEndpoint.post("createProject", "/product/projects", {
        payload: Schema.Struct({ name: Schema.String }),
        success: Schema.Struct({ name: Schema.String, path: Schema.String }),
        error: UploadError,
      }),
    )
    .add(
      HttpApiEndpoint.get("files", "/product/session/:sessionID/files", {
        params: { sessionID: SessionID },
        query: { path: Schema.String },
        success: Schema.Array(
          Schema.Struct({
            name: Schema.String,
            path: Schema.String,
            absolute: Schema.String,
            type: Schema.Literals(["file", "directory"]),
            ignored: Schema.Boolean,
          }),
        ),
        error: UploadError,
      }),
    )
    .add(
      HttpApiEndpoint.get("download", "/product/session/:sessionID/download", {
        params: { sessionID: SessionID },
        query: { path: Schema.String },
        error: UploadError,
      }),
    )
    .add(
      HttpApiEndpoint.get("content", "/product/session/:sessionID/content", {
        params: { sessionID: SessionID },
        query: { path: Schema.String },
        success: Schema.Struct({
          type: Schema.Literals(["text", "binary"]),
          content: Schema.String,
          encoding: Schema.optional(Schema.Literal("base64")),
          mimeType: Schema.optional(Schema.String),
        }),
        error: UploadError,
      }),
    )
    .add(
      HttpApiEndpoint.get("find", "/product/session/:sessionID/find", {
        params: { sessionID: SessionID },
        query: { query: Schema.String, type: Schema.Literals(["file", "directory"]) },
        success: Schema.Array(Schema.String),
        error: UploadError,
      }),
    )
    .middleware(Authorization),
)

const handlers = HttpApiBuilder.group(Api, "workspaceFiles", (group) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const instances = yield* InstanceStore.Service
    const operation = <T>(run: () => Promise<T>) =>
      Effect.tryPromise({ try: run, catch: (error) => error }).pipe(
        Effect.tapError((error) =>
          Effect.logError("product filesystem operation failed", {
            root: process.env.GAMMA_WORKSPACES_ROOT ?? "/home/gamma/workspaces",
            error,
          }),
        ),
        Effect.mapError(
          (error) =>
            new UploadError({
              code:
                error instanceof Error && "code" in error && error.code === "EEXIST"
                  ? "exists"
                  : error instanceof Error && "code" in error && ["EACCES", "EPERM"].includes(String(error.code))
                    ? "permission_denied"
                    : error instanceof Error &&
                        ["invalid_name", "invalid_path", "invalid_root", "unsupported_platform", "too_large"].includes(
                          error.message,
                        )
                      ? error.message
                      : "unavailable",
            }),
        ),
      )
    return group
      .handle("discardEmptySession", (ctx) =>
        Effect.gen(function* () {
          const session = yield* sessions.get(ctx.params.sessionID)
          const instance = yield* instances.load({ directory: session.directory })
          return yield* sessions.discardEmpty(session.id).pipe(Effect.provideService(InstanceRef, instance))
        }).pipe(
          Effect.catchTag("NotFoundError", () => Effect.succeed(true)),
          Effect.map((removed) => ({ removed })),
        ),
      )
      .handle("find", (ctx) =>
        sessions.get(ctx.params.sessionID).pipe(
          Effect.mapError(() => new UploadError({ code: "session_missing" })),
          Effect.flatMap((session) =>
            operation(() => ProductProjects.find(session.directory, ctx.query.query, ctx.query.type, 100)),
          ),
        ),
      )
      .handle("projects", () => operation(ProductProjects.list))
      .handle("createProject", (ctx) => operation(() => ProductProjects.create(ctx.payload.name)))
      .handle("files", (ctx) =>
        sessions.get(ctx.params.sessionID).pipe(
          Effect.mapError(() => new UploadError({ code: "session_missing" })),
          Effect.flatMap((session) => operation(() => ProductProjects.files(session.directory, ctx.query.path))),
        ),
      )
      .handle("content", (ctx) =>
        sessions.get(ctx.params.sessionID).pipe(
          Effect.mapError(() => new UploadError({ code: "session_missing" })),
          Effect.flatMap((session) => operation(() => ProductProjects.content(session.directory, ctx.query.path))),
        ),
      )
      .handleRaw("download", (ctx) =>
        Effect.gen(function* () {
          const session = yield* sessions.get(ctx.params.sessionID).pipe(Effect.mapError(() => new UploadError({ code: "session_missing" })))
          const bytes = yield* operation(() => ProductProjects.download(session.directory, ctx.query.path))
          const filename = ctx.query.path.split("/").at(-1) ?? "download"
          return HttpServerResponse.uint8Array(bytes, { contentType: "application/octet-stream", headers: { "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "x-content-type-options": "nosniff", "cache-control": "no-store" } })
        }),
      )
      .handleRaw("upload", (ctx) =>
        Effect.gen(function* () {
          const session = yield* sessions
            .get(ctx.params.sessionID)
            .pipe(Effect.mapError(() => new UploadError({ code: "session_missing" })))
          const file = yield* readUpload(ctx.request)
          const name = yield* Effect.tryPromise({
            try: () =>
              ProductProjects.withProject(session.directory, (directory) =>
                WorkspaceUpload.saveAt(directory, file.name, file.bytes),
              ),
            catch: (error) =>
              new UploadError({
                code:
                  error instanceof Error && "code" in error && error.code === "EEXIST"
                    ? "exists"
                    : error instanceof Error &&
                        ["invalid_name", "too_large", "unsupported_platform"].includes(error.message)
                      ? error.message
                      : "write_failed",
              }),
          })
          return HttpServerResponse.jsonUnsafe({ name })
        }).pipe(Effect.scoped),
      )
  }),
)

export const workspaceFilesRoutes = HttpApiBuilder.layer(Api).pipe(Layer.provide(handlers))

export function readUpload(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const type = request.headers["content-type"] ?? ""
    if (type.split(";", 1)[0].trim().toLowerCase() !== "multipart/form-data")
      return yield* Effect.fail(new UploadError({ code: "invalid_upload" }))
    // multipasta 0.2.7 rejects raw Unicode filename parameters after decoding
    // headers as UTF-8. Bound the body before using Bun's Unicode-aware parser.
    const body = yield* request.stream.pipe(
      Stream.runFoldEffect(
        () => ({ chunks: [] as Uint8Array[], size: 0 }),
        (body, chunk) => {
          if (body.size + chunk.byteLength > WorkspaceUpload.MAX_BYTES + 8192)
            return Effect.fail(new UploadError({ code: "too_large" }))
          body.chunks.push(chunk)
          return Effect.succeed({ chunks: body.chunks, size: body.size + chunk.byteLength })
        },
      ),
      Effect.mapError((error) => (error instanceof UploadError ? error : new UploadError({ code: "invalid_upload" }))),
    )
    const form = yield* Effect.tryPromise({
      try: () => new Response(Buffer.concat(body.chunks, body.size), { headers: { "content-type": type } }).formData(),
      catch: () => new UploadError({ code: "invalid_upload" }),
    })
    const file = form.get("file")
    if ([...form.keys()].length !== 1 || !file || typeof file === "string")
      return yield* Effect.fail(new UploadError({ code: "invalid_upload" }))
    if (file.size > WorkspaceUpload.MAX_BYTES) return yield* Effect.fail(new UploadError({ code: "too_large" }))
    const name = yield* Effect.try({
      try: () => WorkspaceUpload.filename(file.name),
      catch: () => new UploadError({ code: "invalid_name" }),
    })
    const bytes = yield* Effect.tryPromise({
      try: async () => new Uint8Array(await file.arrayBuffer()),
      catch: () => new UploadError({ code: "invalid_upload" }),
    })
    return { name, bytes }
  })
}
