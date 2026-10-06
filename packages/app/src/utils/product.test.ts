import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { once } from "node:events"
import { productRequest } from "./product"

async function serve(body: string, status = 200, type = "application/json") {
  const server = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*")
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    response.setHeader("Access-Control-Allow-Headers", "Content-Type")
    if (request.method === "OPTIONS") {
      response.writeHead(204)
      response.end()
      return
    }
    response.writeHead(status, { "Content-Type": type })
    response.end(body)
  }).listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test address")
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => {
      server.closeAllConnections()
      server.close()
    },
  }
}

test("rejects an old server returning HTML with HTTP 200", async () => {
  const server = await serve("<!doctype html><html>old app</html>", 200, "text/html")
  try {
    await expect(productRequest(server, "projects", { name: "123" })).rejects.toThrow("invalid_response")
  } finally {
    server.close()
  }
})

test.each(["permission_denied", "exists", "invalid_name"])("preserves product error code %s", async (code) => {
  const server = await serve(JSON.stringify({ code }), 400)
  try {
    await expect(productRequest(server, "projects", { name: "123" })).rejects.toThrow(code)
  } finally {
    server.close()
  }
})

test("preserves HTTP status for authentication errors", async () => {
  const server = await serve("{}", 401)
  try {
    await expect(productRequest(server, "projects")).rejects.toThrow("http_401")
  } finally {
    server.close()
  }
})
