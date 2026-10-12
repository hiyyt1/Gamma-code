import path from "node:path"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "./fixture"
import { Wildberries } from "../../src/wildberries/store"

export async function wildberriesFixture() {
  const temp = await tmpdir()
  const a = path.join(temp.path, "a")
  const b = path.join(temp.path, "b")
  await mkdir(a)
  await mkdir(b)
  const state = { writes: 0, price: 100 }
  const mock = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === "/ping") return Response.json({ Status: "OK" })
      if (url.pathname.endsWith("seller-info")) return Response.json({ sid: "fixture-store" })
      if (url.pathname.endsWith("goods/filter"))
        return Response.json({ data: { listGoods: [{ nmID: 1, discount: 0, sizes: [{ price: state.price }] }] } })
      if (url.pathname.endsWith("upload/task")) {
        state.writes++
        state.price = (await req.json()).data[0].price
        return Response.json({ data: { id: 5 } })
      }
      return new Response("unknown", { status: 400 })
    },
  })
  const store = new Wildberries.Store({
    auditRoot: path.join(temp.path, "audit"),
    mockOrigin: mock.url.origin,
    interval: 0,
  })
  const approvalKey = "fixture-browser-secret-01234567890123456789"
  const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, t: true, acc: 2, sid: "fixture-store", s: 8430 })).toString("base64url")}.signature`
  return {
    root: temp.path,
    a,
    b,
    store,
    state,
    approvalKey,
    input: { token, mode: "sandbox", categories: ["prices"], allowWrites: true, approvalKey },
    async [Symbol.asyncDispose]() {
      store.close()
      await mock.stop(true)
      await temp[Symbol.asyncDispose]()
    },
  }
}
