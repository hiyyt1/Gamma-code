import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createAutoScroll } from "@opencode-ai/ui/hooks"

test("upward intent wins inside the near-bottom threshold until scrolling down", async () => {
  const root = document.createElement("div")
  Object.defineProperties(root, { scrollHeight: { value: 2000 }, clientHeight: { value: 600 } })
  document.body.append(root)
  const state = createRoot((dispose) => {
    const follow = createAutoScroll({ working: () => true, bottomThreshold: 100 })
    follow.scrollRef(root)
    return { follow, dispose }
  })
  await Promise.resolve()
  root.scrollTop = 1400
  state.follow.syncScroll()
  root.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }))
  expect(state.follow.userScrolled()).toBe(true)
  root.scrollTop = 1350
  state.follow.handleScroll()
  expect(state.follow.userScrolled()).toBe(true)
  state.follow.scrollToBottom()
  expect(root.scrollTop).toBe(1350)
  root.scrollTop = 1370
  state.follow.handleScroll()
  expect(state.follow.userScrolled()).toBe(false)
  state.dispose()
  root.remove()
})

test("streaming and busy to idle preserve pause; explicit resume follows again", async () => {
  const root = document.createElement("div")
  Object.defineProperties(root, { scrollHeight: { value: 3000 }, clientHeight: { value: 600 } })
  document.body.append(root)
  const state = createRoot((dispose) => {
    const [working, setWorking] = createSignal(true)
    const follow = createAutoScroll({ working, bottomThreshold: 100 })
    follow.scrollRef(root)
    return { follow, setWorking, dispose }
  })
  await Promise.resolve()
  root.scrollTop = 800
  state.follow.pause()
  state.follow.scrollToBottom()
  state.setWorking(false)
  state.follow.scrollToBottom()
  expect(root.scrollTop).toBe(800)
  expect(state.follow.userScrolled()).toBe(true)
  state.setWorking(true)
  expect(root.scrollTop).toBe(800)
  state.follow.resume()
  expect(state.follow.userScrolled()).toBe(false)
  expect(root.scrollTop).toBeGreaterThan(800)
  state.dispose()
  root.remove()
})

test("scrolling a nested tool output does not disable conversation follow", async () => {
  const root = document.createElement("div")
  const tool = document.createElement("div")
  tool.dataset.scrollable = ""
  root.append(tool)
  Object.defineProperties(root, { scrollHeight: { value: 2000 }, clientHeight: { value: 600 } })
  document.body.append(root)
  const state = createRoot((dispose) => {
    const follow = createAutoScroll({ working: () => true })
    follow.scrollRef(root)
    return { follow, dispose }
  })
  await Promise.resolve()
  tool.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }))
  expect(state.follow.userScrolled()).toBe(false)
  state.dispose()
  root.remove()
})
