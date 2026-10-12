import { NodeHttpServer } from "@effect/platform-node"
import { expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { knowledgeRoutes } from "../../src/server/routes/instance/httpapi/knowledge"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { ServerAuth } from "../../src/server/auth"
import { testEffect } from "../lib/effect"
import { tmpdir } from "../fixture/fixture"

const api = HttpRouter.serve(knowledgeRoutes.pipe(Layer.provide(authorizationLayer)), {
  disableListenLog: true,
  disableLogger: true,
}).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide(ServerAuth.Config.configLayer({ password: Option.some("knowledge-test"), username: "opencode" })),
)
const it = testEffect(api)
it.live("knowledge routes retain server auth and persist exact compact-state payloads", () =>
  Effect.gen(function* () {
    const temp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (value) => Effect.promise(() => value[Symbol.asyncDispose]()),
    )
    const previous = process.env.GAMMA_KNOWLEDGE_ROOT
    process.env.GAMMA_KNOWLEDGE_ROOT = `${temp.path}/knowledge`
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.GAMMA_KNOWLEDGE_ROOT
        else process.env.GAMMA_KNOWLEDGE_ROOT = previous
      }),
    )
    const denied = yield* HttpClient.execute(HttpClientRequest.get("/product/knowledge"))
    expect(denied.status).toBe(401)
    const headers = { authorization: ServerAuth.header({ username: "opencode", password: "knowledge-test" })! }
    const response = yield* HttpClient.execute(
      HttpClientRequest.get("/product/knowledge").pipe(HttpClientRequest.setHeaders(headers)),
    )
    expect(response.status).toBe(200)
    expect(yield* response.json).toMatchObject({ version: 0, data: { spaces: [] } })
    const body = {
      expectedVersion: 0,
      requestID: "http-import",
      originals: {},
      data: {
        spaces: [{ id: "a", name: "Space", description: "", createdAt: "", updatedAt: "" }],
        sources: [],
        relations: [],
        jobs: [],
      },
    }
    const request = yield* HttpClientRequest.post("/product/knowledge/publish").pipe(
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.bodyJson(body),
    )
    const published = yield* HttpClient.execute(request)
    expect(published.status).toBe(200)
    expect(yield* published.json).toMatchObject({ version: 1, data: { spaces: [{ id: "a", name: "Space" }] } })
    const stale = yield* HttpClientRequest.post("/product/knowledge/publish").pipe(
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.bodyJson({ ...body, requestID: "stale" }),
    )
    const conflict = yield* HttpClient.execute(stale)
    expect(conflict.status).toBe(409)
    expect(yield* conflict.json).toMatchObject({ code: "conflict" })
  }),
)
