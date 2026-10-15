// Real Chromium and listener: no network mocks can hide an isolation failure.
import { chromium, expect } from "@playwright/test"
const bundle = await Bun.build({
  entrypoints: [new URL("../src/utils/site-preview-document.ts", import.meta.url).pathname],
  target: "browser",
})
if (!bundle.success) throw new Error("renderer build failed")
const requests: string[] = []
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/renderer.js")
      return new Response(bundle.outputs[0], { headers: { "Content-Type": "text/javascript" } })
    if (url.pathname !== "/") {
      requests.push(url.pathname)
      return new Response("secret")
    }
    return new Response(
      '<script type="module">import {preparePreview} from "/renderer.js";window.preparePreview=preparePreview</script><iframe title="wrapper" sandbox="allow-scripts"></iframe>',
      { headers: { "Content-Type": "text/html", "Set-Cookie": "gamma=secret; SameSite=Strict" } },
    )
  },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto(server.url.href)
  await page.waitForFunction(() => "preparePreview" in window)
  await page.evaluate(() => localStorage.setItem("gamma", "secret"))
  const mount = async (files: Record<string, string>) => {
    await page.evaluate((files) => {
      const render = (
        window as unknown as { preparePreview: (input: unknown) => (route?: string) => string }
      ).preparePreview({
        revision: "test",
        files: Object.entries(files).map(([path, content]) => ({
          path,
          mime: path.endsWith("svg") ? "image/svg+xml" : "text/javascript",
          data: btoa(content),
        })),
      })
      document.querySelector("iframe")!.srcdoc = render()
    }, files)
    return page.frameLocator('iframe[title="wrapper"]').frameLocator("iframe")
  }
  const font = Buffer.from(
    await Bun.file(
      new URL("../../ui/src/assets/fonts/JetBrainsMonoNerdFontMono-Regular.woff2", import.meta.url),
    ).arrayBuffer(),
  ).toString("binary")
  const frame = await mount({
    "index.html":
      '<html lang="ru"><head><link rel="stylesheet" href="style.css"></head><body class="site"><h1>Offline site</h1><button>Count 0</button><img alt="pixel" src="images/pixel.svg"><a href="#route">Route</a><script type="module" src="main.js"></script></body></html>',
    "style.css":
      '@import "nested/extra.css";@font-face{font-family:PreviewFont;src:url("font.woff2")}h1{font-family:PreviewFont;color:rgb(120,30,90);background-image:url("images/pixel.svg")}',
    "main.js":
      'import {label} from "./nested/module.js";document.querySelector("button").onclick=()=>document.querySelector("button").textContent=label;document.body.dataset.ready="yes"',
    "font.woff2": font,
    "nested/extra.css": "body.site{background-color:rgb(1,2,3)}",
    "nested/module.js": 'export const label="Count 1"',
    "images/pixel.svg":
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
  })
  await expect(frame.locator("body")).toHaveAttribute("data-ready", "yes")
  await expect(frame.locator("html")).toHaveAttribute("lang", "ru")
  await expect(frame.locator("body")).toHaveCSS("background-color", "rgb(1, 2, 3)")
  expect(
    await frame.locator("body").evaluate(async () => {
      await document.fonts.ready
      return document.fonts.check("12px PreviewFont")
    }),
  ).toBe(true)
  await frame.getByRole("button", { name: "Count 0" }).click()
  await expect(frame.getByRole("button")).toHaveText("Count 1")
  await expect(frame.getByRole("heading")).toHaveCSS("color", "rgb(120, 30, 90)")
  await expect.poll(() => frame.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(10)
  await frame.getByRole("link", { name: "Route" }).click()
  await expect.poll(() => frame.locator("body").evaluate(() => location.hash)).toBe("#route")
  expect(
    await frame.locator("body").evaluate(() => {
      const read = (fn: () => unknown) => {
        try {
          return fn()
        } catch {
          return "blocked"
        }
      }
      return [
        read(() => document.cookie),
        read(() => localStorage.getItem("gamma")),
        read(() => parent.document.body.textContent),
        read(() => top!.document.body.textContent),
      ]
    }),
  ).toEqual(["blocked", "blocked", "blocked", "blocked"])
  const baseline = requests.length
  const attacker = await mount({
    "index.html": `<button id="attack">Attack</button><script>
    document.querySelector('button').onclick=async()=>{
      try{await fetch('${server.url}product/projects',{credentials:'include'})}catch{}
      const image=new Image();image.src='${server.url}image-leak';document.body.append(image);
      const child=document.createElement('iframe');child.src='${server.url}frame-leak';document.body.append(child);
      const script=document.createElement('script');script.src='${server.url}script-leak';document.body.append(script);
      try{window.open('${server.url}popup')}catch{}
      try{top.location='${server.url}escape'}catch{}
      document.body.dataset.attacked='yes';
    }</script>`,
  })
  await attacker.getByRole("button", { name: "Attack" }).click()
  await expect(attacker.locator("body")).toHaveAttribute("data-attacked", "yes")
  const violation = page.waitForEvent("console", {
    predicate: (message) => message.text().includes("frame-src") && message.text().includes("violates"),
  })
  await attacker.locator("body").evaluate((url) => {
    location.href = `${url}navigation-leak`
  }, server.url.href)
  await violation
  expect(requests.slice(baseline)).toEqual([])
  expect(page.url()).toBe(server.url.href)
  expect(await page.evaluate(() => localStorage.getItem("gamma"))).toBe("secret")
  console.log(
    "PASS: modules, CSS, nested images, hash navigation, opaque storage, API/network/navigation/popup isolation",
  )
} finally {
  await browser.close()
  server.stop(true)
}
