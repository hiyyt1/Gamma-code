// HTTPS reverse proxy for the auth smoke: real sockets, no mocked API responses.
import { createServer } from "node:https"
import { request } from "node:http"
import { readFileSync } from "node:fs"

const server = createServer(
  { key: readFileSync(process.argv[2]), cert: readFileSync(process.argv[3]) },
  (incoming, outgoing) => {
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port: Number(process.argv[5]),
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode, response.headers)
        response.pipe(outgoing)
        response.on("error", () => outgoing.destroy())
      },
    )
    upstream.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502)
      outgoing.end()
    })
    outgoing.on("close", () => upstream.destroy())
    incoming.pipe(upstream)
  },
)
server.listen(Number(process.argv[4]), "127.0.0.1", () => process.stdout.write("ready\n"))
