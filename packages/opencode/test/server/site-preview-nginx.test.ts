import { expect, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ProductProjects } from "../../src/server/product-projects"
import { createPreview } from "../../src/server/site-preview"

// A private Unix listener keeps this real Nginx/TLS test off public TCP ports.
// The temporary certificate is trusted explicitly by curl, never with --insecure.
test.skipIf(!Bun.which("nginx") || !Bun.which("openssl") || !Bun.which("curl"))(
  "serves and revokes Preview through the supplied Nginx HTTPS configuration without a tunnel",
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "gamma-nginx-"))
    const previous = process.env.GAMMA_WORKSPACES_ROOT
    process.env.GAMMA_WORKSPACES_ROOT = path.join(directory, "projects")
    const preview = createPreview({ domain: "preview.example.net", main: "https://gamma.example.com" })
    const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: preview.fetch })
    const resources: { nginx?: ReturnType<typeof Bun.spawn> } = {}
    try {
      const project = await ProductProjects.create("nginx")
      await Bun.write(path.join(project.path, "index.html"), "<html><head></head><body>VPS Preview</body></html>")
      await Bun.write(path.join(project.path, "style.css"), "body{color:blue}")
      const lease = await preview.start("nginx-session", project.path, "")
      const cert = Bun.spawn(
        [
          "openssl",
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-days",
          "1",
          "-subj",
          "/CN=*.preview.example.net",
          "-addext",
          "subjectAltName=DNS:*.preview.example.net",
          "-keyout",
          path.join(directory, "key.pem"),
          "-out",
          path.join(directory, "cert.pem"),
        ],
        { stdout: "ignore", stderr: "ignore" },
      )
      expect(await cert.exited).toBe(0)
      const example = await Bun.file(
        path.resolve(import.meta.dir, "../../../../deploy/gamma-preview.nginx.conf.example"),
      ).text()
      const config = example
        .replace("listen 443 ssl;", `listen unix:${directory}/nginx.sock ssl;`)
        .replace("/etc/letsencrypt/live/preview.example.net/fullchain.pem", `${directory}/cert.pem`)
        .replace("/etc/letsencrypt/live/preview.example.net/privkey.pem", `${directory}/key.pem`)
        .replace("http://127.0.0.1:4097", upstream.url.origin)
      await Bun.write(
        path.join(directory, "nginx.conf"),
        `pid ${directory}/nginx.pid; error_log ${directory}/error.log; events {} http { ${config} }`,
      )
      resources.nginx = Bun.spawn(["nginx", "-p", directory, "-c", `${directory}/nginx.conf`, "-g", "daemon off;"], {
        stdout: "ignore",
        stderr: "ignore",
      })
      const deadline = Date.now() + 5000
      while (!(await stat(`${directory}/nginx.sock`).catch(() => undefined))) {
        if (resources.nginx.exitCode !== null || Date.now() >= deadline)
          throw new Error("Fixture Nginx did not become ready")
        await Bun.sleep(20)
      }
      const request = async (relative = "") => {
        const response = Bun.spawn(
          [
            "curl",
            "--silent",
            "--show-error",
            "--noproxy",
            "*",
            "--max-time",
            "5",
            "--unix-socket",
            `${directory}/nginx.sock`,
            "--cacert",
            `${directory}/cert.pem`,
            "--include",
            lease.url + relative,
          ],
          { stdout: "pipe", stderr: "ignore" },
        )
        const body = await new Response(response.stdout).text()
        expect(await response.exited).toBe(0)
        return body
      }
      expect(await request()).toContain("VPS Preview")
      expect(await request("style.css")).toContain("body{color:blue}")
      const html = await request()
      expect(html.toLowerCase()).toContain("content-security-policy: sandbox allow-scripts")
      expect(html.toLowerCase()).toContain("cache-control: no-store")
      expect(html.toLowerCase()).not.toContain("set-cookie:")
      preview.stop("nginx-session", lease.id)
      expect(await request()).toContain("404 Not Found")
    } finally {
      resources.nginx?.kill()
      if (resources.nginx) await resources.nginx.exited
      await upstream.stop(true)
      preview.clear()
      if (previous === undefined) delete process.env.GAMMA_WORKSPACES_ROOT
      else process.env.GAMMA_WORKSPACES_ROOT = previous
      await rm(directory, { recursive: true, force: true })
    }
  },
  15_000,
)
