import { expect, test, type Page } from "@playwright/test"
import { setTimeout } from "node:timers/promises"
import { writeFile } from "node:fs/promises"
import { setupGamma } from "../../gamma-light/fixture"
import { startChromeTrace } from "../chrome-trace"

async function setup(page: Page, options: { protocol?: "v1" | "v2" } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
    )
    // A product probe: timestamp the navigation click, native URL commit and
    // route-specific DOM insertion. Paint and long tasks remain in Chrome traces.
    const marks: {
      click: number
      input: number
      url?: number
      dom?: number
      ready?: number
      selector: string
      readySelector?: string
    } = { click: 0, input: 0, selector: "" }
    Object.defineProperty(window, "gammaNavigation", { value: marks })
    document.addEventListener(
      "click",
      (event) => {
        marks.click = performance.now()
        marks.input = event.timeStamp
        delete marks.url
        delete marks.dom
        delete marks.ready
        performance.mark("gamma-nav:click")
      },
      true,
    )
    const push = history.pushState.bind(history)
    history.pushState = (...args) => {
      push(...args)
      marks.url = performance.now()
    }
    const replace = history.replaceState.bind(history)
    history.replaceState = (...args) => {
      replace(...args)
      marks.url = performance.now()
    }
    new MutationObserver(() => {
      if (!marks.click) return
      if (!marks.dom && marks.selector && document.querySelector(marks.selector)) {
        marks.dom = performance.now()
        performance.mark("gamma-nav:dom")
      }
      if (
        !marks.ready &&
        marks.readySelector &&
        document.querySelector(marks.readySelector) &&
        (marks.selector !== '[contenteditable="true"]' ||
          document.querySelector("main")?.textContent?.includes("Текст ответа должен быть видимым."))
      ) {
        marks.ready = performance.now()
        performance.mark("gamma-nav:ready")
      }
    }).observe(document, { childList: true, subtree: true, attributes: true, characterData: true })
  })
  await setupGamma(page, options)
}

const ready = (page: Page) =>
  page.locator(".gamma-dashboard-card").filter({ has: page.getByRole("heading", { name: "Gamma Light", exact: true }) })

test("pending catalog diagnostic", async ({ page }, info) => {
  await setup(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/product/agent-market/agents", async (route) => {
    await gate
    await route.fallback()
  })
  await page.goto("/")
  await expect(ready(page)).toBeEnabled()
  const trace = await startChromeTrace(page, "pending-catalog")
  const request = page.waitForRequest("**/product/agent-market/agents")
  await page.locator('a[href="/agents"]').click()
  await request
  const beforeRelease = {
    url: page.url(),
    homeVisible: await ready(page).isVisible(),
    agentsVisible: await page.locator(".agent-market").isVisible(),
    skeletonVisible: await page.locator('.agent-market-list[aria-busy="true"]').isVisible(),
  }
  await info.attach("pending-api", { body: JSON.stringify(beforeRelease), contentType: "application/json" })
  await page.screenshot({ path: info.outputPath("pending-api.png") })
  if (process.env.GAMMA_NAV_PHASE === "after") {
    await expect(page).toHaveURL(/\/agents$/)
    await expect(page.locator('.agent-market-list[aria-busy="true"]')).toBeVisible()
    await page.locator('a[href="/knowledge"]').click()
    await expect(page).toHaveURL(/\/knowledge$/)
  }
  release()
  if (process.env.GAMMA_NAV_PHASE !== "after") await expect(page).toHaveURL(/\/agents$/)
  await trace?.()
})

for (const profile of [
  { name: "desktop", cpu: 1, latency: 0 },
  { name: "cpu6", cpu: 6, latency: 0 },
  { name: "api100", cpu: 1, latency: 100 },
  { name: "api1000", cpu: 1, latency: 1000 },
]) {
  test(`navigation ${profile.name}`, async ({ page }, info) => {
    await setup(page)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu })
    if (profile.latency)
      await page.route("**/product/**", async (route) => {
        // Deliberately controlled API latency, never readiness synchronization.
        await setTimeout(profile.latency)
        await route.fallback()
      })
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto("/")
    await expect(ready(page)).toBeEnabled()
    const trace = await startChromeTrace(page, profile.name)
    const samples: unknown[] = []
    const checkpoints: unknown[] = []
    await cdp.send("Performance.enable")
    const routes = [
      {
        name: "agents",
        selector: ".agent-market",
        readySelector: '[data-agent="test-designer"] .skill-market-toggle:not([disabled])',
        click: () => page.locator('a[href="/agents"]').click(),
        usable: () => expect(page.getByRole("button", { name: "Использовать", exact: true })).toBeEnabled(),
      },
      {
        name: "knowledge",
        selector: ".kb-page",
        readySelector: ".kb-empty:not([aria-busy])",
        click: () => page.locator('a[href="/knowledge"]').click(),
        usable: () => expect(page.getByText("Начните свою историю знаний", { exact: true })).toBeVisible(),
      },
      {
        name: "projects",
        selector: ".gamma-dashboard-card",
        readySelector: ".gamma-dashboard-card:not([disabled])",
        click: () => page.locator(".gamma-home-link").click(),
        usable: () => expect(ready(page)).toBeEnabled(),
      },
      {
        name: "chat",
        selector: '[contenteditable="true"]',
        readySelector: '[contenteditable="true"]',
        click: () => ready(page).click(),
        usable: () => expect(page.getByText("Текст ответа должен быть видимым.", { exact: true })).toBeVisible(),
      },
      {
        name: "home",
        selector: ".gamma-dashboard-card",
        readySelector: ".gamma-dashboard-card:not([disabled])",
        click: () => page.locator(".gamma-home-link").click(),
        usable: () => expect(ready(page)).toBeEnabled(),
      },
    ]
    await cdp.send("HeapProfiler.collectGarbage")
    const memoryBefore = await cdp.send("Memory.getDOMCounters")
    for (let iteration = 0; iteration < Number(process.env.GAMMA_NAV_SAMPLES ?? 20); iteration++) {
      for (const route of routes) {
        await page.evaluate(
          ({ selector, readySelector }) => {
            const marks = Reflect.get(window, "gammaNavigation")
            marks.selector = selector
            marks.readySelector = readySelector
            marks.click = 0
          },
          { selector: route.selector, readySelector: route.readySelector },
        )
        await route.click()
        await route.usable()
        samples.push(
          await page.evaluate(
            ({ name, iteration }) => ({
              name,
              iteration,
              ...Reflect.get(window, "gammaNavigation"),
              usable: performance.now(),
            }),
            { name: route.name, iteration },
          ),
        )
      }
      if ([3, 9, 19].includes(iteration)) {
        await cdp.send("HeapProfiler.collectGarbage")
        checkpoints.push({
          iteration,
          counters: await cdp.send("Memory.getDOMCounters"),
          metrics: await cdp.send("Performance.getMetrics"),
        })
      }
    }
    await cdp.send("HeapProfiler.collectGarbage")
    const memoryAfter = await cdp.send("Memory.getDOMCounters")
    const resources = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => /\.js/.test(name)),
    )
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
    expect(errors).toEqual([])
    await info.attach("measurements", {
      body: JSON.stringify({ profile, samples, memoryBefore, memoryAfter, checkpoints, resources, errors }),
      contentType: "application/json",
    })
    await trace?.()
    await cdp.detach()
  })
}

test("pending lineage diagnostic", async ({ page }, info) => {
  await setup(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/\/(?:api\/)?session\/ses_gamma_light(?:\?|$)/, async (route) => {
    await gate
    await route.fallback()
  })
  const request = page.waitForRequest(/\/(?:api\/)?session\/ses_gamma_light(?:\?|$)/)
  await page.goto("/")
  await expect(ready(page)).toBeEnabled()
  await ready(page).click()
  await request
  await info.attach("pending-lineage", {
    body: JSON.stringify({ url: page.url(), homeVisible: await ready(page).isVisible() }),
    contentType: "application/json",
  })
  if (process.env.GAMMA_NAV_PHASE === "after") {
    await expect(page).toHaveURL(/\/session\/ses_gamma_light$/)
    await page.locator('a[href="/knowledge"]').click()
    await expect(page).toHaveURL(/\/knowledge$/)
  }
  release()
  if (process.env.GAMMA_NAV_PHASE !== "after")
    await expect(page.getByText("Текст ответа должен быть видимым.", { exact: true })).toBeVisible()
})

test("abandon pending catalog", async ({ page }, info) => {
  await setup(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/product/agent-market/agents", async (route) => {
    await gate
    await route.fallback()
  })
  await page.goto("/")
  await expect(ready(page)).toBeEnabled()
  const request = page.waitForRequest("**/product/agent-market/agents")
  await page.locator('a[href="/agents"]').click()
  await request
  await page.locator('a[href="/knowledge"]').click()
  await expect(page.getByText("Начните свою историю знаний", { exact: true })).toBeVisible()
  await info.attach("abandoned", { body: JSON.stringify({ url: page.url() }), contentType: "application/json" })
  release()
  await page.locator(".gamma-home-link").click()
  await expect(ready(page)).toBeEnabled()
  await page.goBack()
  await expect(page).toHaveURL(/\/knowledge$/)
  await page.goForward()
  await expect(ready(page)).toBeEnabled()
})

test("graph lifecycle", async ({ page }, info) => {
  await setup(page)
  await page.goto("/knowledge?demo=ziorna")
  const graph = page.locator(".kb-webgl")
  await expect(graph).toHaveAttribute("aria-busy", "false")
  const cdp = await page.context().newCDPSession(page)
  const trace = await startChromeTrace(page, "graph-lifecycle")
  await cdp.send("HeapProfiler.collectGarbage")
  const initial = await cdp.send("Memory.getDOMCounters")
  await page.locator('a[href="/agents"]').click()
  await expect(page.getByRole("button", { name: "Использовать", exact: true })).toBeEnabled()
  await expect(page.locator(".kb-webgl canvas")).toHaveCount(0)
  await cdp.send("HeapProfiler.collectGarbage")
  const after = await cdp.send("Memory.getDOMCounters")
  const cycles = []
  for (let index = 0; index < Number(process.env.GAMMA_NAV_GRAPH_CYCLES ?? 10); index++) {
    await page.locator('a[href="/knowledge"]').click()
    await page.getByRole("button", { name: "Посмотреть демо-карту", exact: true }).click()
    await expect(graph).toHaveAttribute("aria-busy", "false")
    await page.locator('a[href="/agents"]').click()
    await expect(page.getByRole("button", { name: "Использовать", exact: true })).toBeEnabled()
    await expect(page.locator(".kb-webgl canvas")).toHaveCount(0)
    await cdp.send("HeapProfiler.collectGarbage")
    cycles.push(await cdp.send("Memory.getDOMCounters"))
    if (process.env.GAMMA_NAV_PHASE === "after")
      expect(await page.evaluate(() => Reflect.get(window, "scene"))).toBeUndefined()
  }
  if (process.env.GAMMA_NAV_HEAP === "1") {
    const listeners = []
    for (const expression of ["window", "document"]) {
      const target = await cdp.send("Runtime.evaluate", { expression, objectGroup: "navigation-listeners" })
      const list = await cdp.send("DOMDebugger.getEventListeners", { objectId: target.result.objectId! })
      listeners.push({
        expression,
        listeners: list.listeners.map((item) => ({
          type: item.type,
          scriptId: item.scriptId,
          line: item.lineNumber,
          description: item.handler?.description?.slice(0, 160),
        })),
      })
    }
    await cdp.send("Runtime.releaseObjectGroup", { objectGroup: "navigation-listeners" })
    await info.attach("listeners", { body: JSON.stringify(listeners), contentType: "application/json" })
    const chunks: string[] = []
    cdp.on("HeapProfiler.addHeapSnapshotChunk", (event) => chunks.push(event.chunk))
    await cdp.send("HeapProfiler.takeHeapSnapshot")
    const path = info.outputPath("graph.heapsnapshot")
    await writeFile(path, chunks.join(""))
    await info.attach("graph-heap", { path, contentType: "application/json" })
  }
  await info.attach("graph", { body: JSON.stringify({ initial, after, cycles }), contentType: "application/json" })
  await trace?.()
  await cdp.detach()
})

for (const protocol of ["v1", "v2"] as const)
  for (const endpoint of ["knowledge", "agent-market/agents"]) {
    test(`chat ${protocol} independent of ${endpoint}`, async ({ page }, info) => {
      await setup(page, { protocol })
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      await page.route(`**/product/${endpoint}`, async (route) => {
        await gate
        await route.fallback()
      })
      await page.goto("/")
      await expect(ready(page)).toBeEnabled()
      const request = page.waitForRequest(`**/product/${endpoint}`)
      await ready(page).click()
      await request
      await info.attach("pending-chat", {
        body: JSON.stringify({
          endpoint,
          url: page.url(),
          homeVisible: await ready(page).isVisible(),
          promptVisible: await page.getByRole("textbox", { name: "Промпт", exact: true }).isVisible(),
        }),
        contentType: "application/json",
      })
      if (process.env.GAMMA_NAV_PHASE === "after") {
        await expect(page.getByText("Текст ответа должен быть видимым.", { exact: true })).toBeVisible()
        await page.getByRole("textbox", { name: "Промпт", exact: true }).fill("Ввод при незавершённом справочнике")
        await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled()
        await page.locator('a[href="/knowledge"]').click()
        await expect(page).toHaveURL(/\/knowledge$/)
      }
      release()
      if (process.env.GAMMA_NAV_PHASE !== "after")
        await expect(page.getByText("Текст ответа должен быть видимым.", { exact: true })).toBeVisible()
    })
  }

test("catalog failure stays local and can be retried", async ({ page }) => {
  test.skip(process.env.GAMMA_NAV_PHASE !== "after", "Regression contract")
  await setup(page)
  await page.route("**/product/agent-market/agents", (route) =>
    route.fulfill({ status: 503, json: { code: "unavailable" } }),
  )
  await page.goto("/")
  await expect(ready(page)).toBeEnabled()
  await page.locator('a[href="/agents"]').click()
  const error = page.locator('.skill-market-state[role="alert"]')
  await expect(error).toBeVisible()
  await expect(page.locator(".agent-market")).toBeVisible()
  await page.unroute("**/product/agent-market/agents")
  await error.getByRole("button").click()
  await expect(page.getByRole("button", { name: "Использовать", exact: true })).toBeEnabled()
  await page.locator('a[href="/knowledge"]').click()
  await expect(page.getByText("Начните свою историю знаний", { exact: true })).toBeVisible()
})

test("leaving graph does not wait for catalog", async ({ page }, info) => {
  await setup(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/product/agent-market/agents", async (route) => {
    await gate
    await route.fallback()
  })
  await page.goto("/knowledge?demo=ziorna")
  await expect(page.locator(".kb-webgl")).toHaveAttribute("aria-busy", "false")
  const request = page.waitForRequest("**/product/agent-market/agents")
  await page.locator('a[href="/agents"]').click()
  await request
  if (process.env.GAMMA_NAV_PHASE === "after") {
    await expect(page.locator(".kb-webgl")).toHaveCount(0)
    await expect(page.locator('.agent-market-list[aria-busy="true"]')).toBeVisible()
  }
  await info.attach("pending-graph", {
    body: JSON.stringify({ graphVisible: await page.locator(".kb-webgl").isVisible(), url: page.url() }),
    contentType: "application/json",
  })
  release()
  await expect(page.getByRole("button", { name: "Использовать", exact: true })).toBeEnabled()
})

for (const protocol of ["v1", "v2"] as const)
  test(`selected session controls ${protocol}`, async ({ page }, info) => {
    await setup(page, { protocol })
    await page.goto("/")
    await expect(ready(page)).toBeEnabled()
    await ready(page).click()
    await expect(page.getByText("Текст ответа должен быть видимым.", { exact: true })).toBeVisible()
    const agent = page.locator('[data-action="prompt-agent"]')
    await info.attach("session-control", {
      body: JSON.stringify({
        protocol,
        url: page.url(),
        text: await agent.innerText(),
        disabled: await agent.isDisabled(),
        agent: await agent.getAttribute("data-agent"),
      }),
      contentType: "application/json",
    })
    if (process.env.GAMMA_NAV_PHASE === "after") {
      await expect(agent).toBeDisabled()
      if (protocol === "v2") await expect(agent).toHaveAttribute("data-agent", "build")
      if (protocol === "v1") await expect(agent).toHaveText("Agent not determined")
    }
  })

test("disposing one WebGL renderer preserves another", async ({ page }) => {
  test.skip(process.env.GAMMA_NAV_PHASE !== "after", "Dependency disposal regression")
  await setup(page)
  await page.goto("/knowledge?demo=ziorna")
  await expect(page.locator(".kb-webgl")).toHaveAttribute("aria-busy", "false")
  const moduleURL = await page.evaluate(
    () => performance.getEntriesByType("resource").find((entry) => /\/three\.module-.*\.js$/.test(entry.name))?.name,
  )
  expect(moduleURL).toBeTruthy()
  await page.locator(".gamma-home-link").click()
  await expect(ready(page)).toBeEnabled()
  const result = await page.evaluate(async (url) => {
    const { WebGLRenderer, Scene, PerspectiveCamera, Mesh, MeshPhysicalMaterial, SphereGeometry, DirectionalLight } =
      Object.values(await import(url!)).find(
        (value) => typeof value === "object" && value !== null && "WebGLRenderer" in value,
      ) as typeof import("three")
    const first = new WebGLRenderer({ preserveDrawingBuffer: true })
    const second = new WebGLRenderer({ preserveDrawingBuffer: true })
    const scene = new Scene()
    const camera = new PerspectiveCamera(45, 1, 0.1, 10)
    camera.position.z = 3
    const material = new MeshPhysicalMaterial({ color: 0x7755ff })
    const geometry = new SphereGeometry(0.7, 12, 8)
    scene.add(new Mesh(geometry, material), new DirectionalLight(0xffffff, 3))
    first.setSize(32, 32)
    second.setSize(32, 32)
    first.render(scene, camera)
    second.render(scene, camera)
    const lut = (
      second.properties.get(material) as {
        uniforms: { dfgLUT: { value: import("three").Texture & { _listeners: { dispose: unknown[] } } } }
      }
    ).uniforms.dfgLUT.value
    const currentTexture = () => (second.properties.get(lut) as { __webglTexture: WebGLTexture }).__webglTexture
    const texture = currentTexture()
    const gl = second.getContext()
    const before = new Uint8Array(32 * 32 * 4)
    gl.readPixels(0, 0, 32, 32, gl.RGBA, gl.UNSIGNED_BYTE, before)
    first.dispose()
    first.forceContextLoss()
    second.render(scene, camera)
    const after = new Uint8Array(before.length)
    gl.readPixels(0, 0, 32, 32, gl.RGBA, gl.UNSIGNED_BYTE, after)
    const result = {
      keptTexture: currentTexture() === texture && gl.isTexture(texture),
      samePixels: before.every((value, index) => value === after[index]),
      hasColor: before.some((value, index) => index % 4 !== 3 && value > 0),
      listenersBeforeLastDispose: lut._listeners.dispose.length,
    }
    material.dispose()
    geometry.dispose()
    second.dispose()
    second.forceContextLoss()
    return { ...result, listenersAfterLastDispose: lut._listeners.dispose.length }
  }, moduleURL)
  expect(result).toEqual({
    keptTexture: true,
    samePixels: true,
    hasColor: true,
    listenersBeforeLastDispose: 1,
    listenersAfterLastDispose: 0,
  })
})

test("rapid navigation keeps the last destination after late responses", async ({ page }) => {
  test.skip(process.env.GAMMA_NAV_PHASE !== "after", "Regression contract")
  await setup(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/product/agent-market/agents", async (route) => {
    await gate
    await route.fallback()
  })
  await page.goto("/")
  await expect(ready(page)).toBeEnabled()
  const request = page.waitForRequest("**/product/agent-market/agents")
  await page.locator('a[href="/agents"]').click()
  await request
  await page.locator('a[href="/knowledge"]').click()
  await page.locator(".gamma-home-link").click()
  await page.locator('a[href="/agents"]').click()
  await page.locator('a[href="/knowledge"]').click()
  await expect(page.getByText("Начните свою историю знаний", { exact: true })).toBeVisible()
  const response = page.waitForResponse("**/product/agent-market/agents")
  release()
  await response
  await expect(page).toHaveURL(/\/knowledge$/)
  await expect(page.locator(".agent-market")).toHaveCount(0)
})

test("focus refresh cannot hide or block an open chat", async ({ page }) => {
  test.skip(process.env.GAMMA_NAV_PHASE !== "after", "Regression contract")
  await setup(page)
  await page.goto("/")
  await expect(ready(page)).toBeEnabled()
  const loaded = page.waitForResponse("**/product/knowledge/projects")
  await ready(page).click()
  await loaded
  await expect(page.getByText("Текст ответа должен быть видимым.", { exact: true })).toBeVisible()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/product/knowledge", async (route) => {
    await gate
    await route.fallback()
  })
  const request = page.waitForRequest("**/product/knowledge")
  // Tests the application's focus handler, not browser background throttling.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await request
  await page.getByRole("textbox", { name: "Промпт", exact: true }).fill("После возврата фокуса")
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled()
  await page.locator('a[href="/agents"]').click()
  await expect(page.getByRole("button", { name: "Использовать", exact: true })).toBeEnabled()
  release()
})
