import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { configuration, createPreview, discover } from "@/server/site-preview"
import { Authorization } from "./middleware/authorization"

class PreviewError extends Schema.TaggedErrorClass<PreviewError>()(
  "PreviewError",
  {
    code: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

const Api = HttpApi.make("sitePreview").add(
  HttpApiGroup.make("sitePreview")
    .add(
      HttpApiEndpoint.get("list", "/product/session/:sessionID/preview", {
        params: { sessionID: SessionID },
        success: Schema.Struct({
          enabled: Schema.Boolean,
          apps: Schema.Array(
            Schema.Struct({
              path: Schema.String,
              kind: Schema.Literals(["static", "dynamic"]),
              framework: Schema.optional(Schema.Literals(["HTML", "Vite", "React"])),
            }),
          ),
        }),
        error: PreviewError,
      }),
    )
    .add(
      HttpApiEndpoint.post("start", "/product/session/:sessionID/preview/start", {
        params: { sessionID: SessionID },
        payload: Schema.Struct({ path: Schema.String }),
        success: Schema.Struct({ id: Schema.String, url: Schema.String }),
        error: PreviewError,
      }),
    )
    .add(
      HttpApiEndpoint.post("renew", "/product/session/:sessionID/preview/renew", {
        params: { sessionID: SessionID },
        payload: Schema.Struct({ id: Schema.String }),
        success: Schema.Boolean,
        error: PreviewError,
      }),
    )
    .add(
      HttpApiEndpoint.post("stop", "/product/session/:sessionID/preview/stop", {
        params: { sessionID: SessionID },
        payload: Schema.Struct({ id: Schema.String }),
        success: Schema.Boolean,
        error: PreviewError,
      }),
    )
    .middleware(Authorization),
)

const handlers = HttpApiBuilder.group(Api, "sitePreview", (group) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const config = yield* Effect.sync(configuration)
    const preview = config ? createPreview(config) : undefined
    if (preview) {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const server = Bun.serve({
            hostname: "127.0.0.1",
            port: config?.localPort ?? Number(process.env.GAMMA_PREVIEW_PORT ?? 4097),
            maxRequestBodySize: 1024,
            fetch: preview.fetch,
            error: () => new Response("Preview unavailable", { status: 400 }),
          })
          const timer = setInterval(preview.sweep, 30_000)
          timer.unref()
          return { server, timer }
        }),
        (resource) =>
          Effect.sync(() => {
            clearInterval(resource.timer)
            preview.clear()
            void resource.server.stop(true)
          }),
      )
    }
    const operation = <T>(run: () => Promise<T> | T) =>
      Effect.tryPromise({
        try: async () => run(),
        catch: (error) =>
          new PreviewError({
            code:
              error instanceof Error && "code" in error && ["EACCES", "EPERM"].includes(String(error.code))
                ? "access_denied"
                : error instanceof Error &&
                    [
                      "scan_limit",
                      "preview_limit",
                      "site_missing",
                      "dynamic_unavailable",
                      "expired",
                      "preview_unconfigured",
                    ].includes(error.message)
                  ? error.message
                  : "preview_failed",
          }),
      })
    const enabled = () => {
      if (!preview) throw new Error("preview_unconfigured")
      return preview
    }
    return group
      .handle("list", (ctx) =>
        sessions.get(ctx.params.sessionID).pipe(
          Effect.mapError(() => new PreviewError({ code: "session_missing" })),
          Effect.flatMap((session) =>
            operation(async () => ({ enabled: !!preview, apps: await discover(session.directory) })),
          ),
        ),
      )
      .handle("start", (ctx) =>
        sessions.get(ctx.params.sessionID).pipe(
          Effect.mapError(() => new PreviewError({ code: "session_missing" })),
          Effect.flatMap((session) =>
            operation(() => enabled().start(session.id, session.directory, ctx.payload.path)),
          ),
        ),
      )
      .handle("renew", (ctx) =>
        operation(() => {
          enabled().renew(ctx.params.sessionID, ctx.payload.id)
          return true
        }),
      )
      .handle("stop", (ctx) =>
        operation(() => {
          enabled().stop(ctx.params.sessionID, ctx.payload.id)
          return true
        }),
      )
  }),
)

export const sitePreviewRoutes = HttpApiBuilder.layer(Api).pipe(Layer.provide(handlers))
