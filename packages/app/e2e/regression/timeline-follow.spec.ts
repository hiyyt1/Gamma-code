import { expect, test } from "@playwright/test"
import {
  buildInitialStreamEvent,
  setupTimelineBenchmark,
} from "../performance/timeline/session-timeline-benchmark.fixture"

test("manual scroll suspends streaming follow until the user returns to latest", async ({ page }) => {
  const fixture = await setupTimelineBenchmark(page, { historyTurns: 30, eventBatch: 1 })
  fixture.transport.enqueue(buildInitialStreamEvent(1))
  await expect(fixture.text).toContainText("Implementation plan")
  await fixture.waitForStableGeometry()

  // Pause inside the virtualizer's former 80px end threshold. A resize must
  // respect user intent even when its independent end heuristic says otherwise.
  const top = await fixture.scroller.evaluate((element) => {
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: -50, bubbles: true }))
    element.scrollTop -= 50
    element.dispatchEvent(new Event("scroll"))
    return element.scrollTop
  })
  const update = buildInitialStreamEvent(1)
  const text = "Manual-follow regression output.\n\n".repeat(80)
  fixture.transport.enqueue({
    ...update,
    payload: {
      type: "message.part.delta",
      properties: { messageID: "msg_assistant_regression", partID: "prt_9999_text", field: "text", delta: text },
    },
  })
  await expect(fixture.text).toContainText("Manual-follow regression output.")
  await expect.poll(() => fixture.scroller.evaluate((element) => element.scrollTop)).toBe(top)
  const jump = page.getByRole("button", { name: "Jump to latest", exact: true })
  await expect(jump.locator("..")).toHaveCSS("opacity", "1")
  await jump.click()
  await fixture.waitForStableGeometry()

  // Real wheel input leaves follow mode again before busy -> idle and a late
  // completion resize. Neither status nor final output may reclaim the scroll.
  await fixture.scroller.hover()
  await page.mouse.wheel(0, -400)
  await expect
    .poll(() => fixture.scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeGreaterThan(100)
  const paused = await fixture.scroller.evaluate((el) => el.scrollTop)
  fixture.transport.enqueue({
    directory: update.directory,
    payload: {
      type: "session.status",
      properties: { sessionID: "ses_timeline_state_regression", status: { type: "idle" } },
    },
  })
  fixture.transport.enqueue({
    ...update,
    payload: {
      type: "message.part.delta",
      properties: {
        messageID: "msg_assistant_regression",
        partID: "prt_9999_text",
        field: "text",
        delta: "\n\nRun completed marker.",
      },
    },
  })
  await expect(fixture.text).toContainText("Run completed marker.")
  await expect.poll(() => fixture.scroller.evaluate((el) => el.scrollTop)).toBe(paused)

  await fixture.scroller.evaluate((el) => {
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: el.scrollHeight, bubbles: true }))
    el.scrollTop = el.scrollHeight
    el.dispatchEvent(new Event("scroll"))
  })
  fixture.transport.enqueue({
    ...update,
    payload: {
      type: "message.part.delta",
      properties: {
        messageID: "msg_assistant_regression",
        partID: "prt_9999_text",
        field: "text",
        delta: "\n\nFollowing again.\n".repeat(30),
      },
    },
  })
  await expect(fixture.text).toContainText("Following again.")
  await fixture.waitForStableGeometry()
})

test("new reasoning and tool rows, output growth and completion respect paused follow", async ({ page }) => {
  const fixture = await setupTimelineBenchmark(page, { historyTurns: 30, eventBatch: 1 })
  const update = buildInitialStreamEvent(1)
  fixture.transport.enqueue(update)
  await expect(fixture.text).toContainText("Implementation plan")
  await fixture.waitForStableGeometry()
  const top = await fixture.scroller.evaluate((el) => {
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -50, bubbles: true }))
    el.scrollTop -= 50
    el.dispatchEvent(new Event("scroll"))
    return el.scrollTop
  })
  fixture.transport.enqueue({
    directory: update.directory,
    payload: {
      type: "session.status",
      properties: { sessionID: "ses_timeline_state_regression", status: { type: "busy" } },
    },
  })
  const part = { sessionID: "ses_timeline_state_regression", messageID: "msg_assistant_regression" }
  fixture.transport.enqueue({
    directory: update.directory,
    payload: {
      type: "message.part.updated",
      properties: {
        part: {
          ...part,
          id: "prt_999a_reasoning",
          type: "reasoning",
          text: "Inspecting follow behavior",
          time: { start: 1700000003000 },
        },
      },
    },
  })
  for (const completed of [false, true]) {
    const marker = completed ? "tool-completion-marker" : "tool-stream-marker"
    fixture.transport.enqueue({
      directory: update.directory,
      payload: {
        type: "message.part.updated",
        properties: {
          part: {
            ...part,
            id: "prt_999b_tool",
            type: "tool",
            tool: "bash",
            callID: "follow-bash",
            state: {
              status: completed ? "completed" : "running",
              input: { command: "printf follow" },
              title: "Follow regression tool",
              output: `${marker}\n${"tool output line\n".repeat(completed ? 100 : 40)}`,
              metadata: { output: marker },
              time: { start: 1700000004000, ...(completed ? { end: 1700000005000 } : {}) },
            },
          },
        },
      },
    })
    await expect(page.getByText(marker, { exact: false })).toBeAttached()
    await expect.poll(() => fixture.scroller.evaluate((el) => el.scrollTop)).toBe(top)
  }
  fixture.transport.enqueue({
    directory: update.directory,
    payload: {
      type: "session.status",
      properties: { sessionID: "ses_timeline_state_regression", status: { type: "idle" } },
    },
  })
  await expect.poll(() => fixture.transport.pendingCount()).toBe(0)
  await expect.poll(() => fixture.scroller.evaluate((el) => el.scrollTop)).toBe(top)
})
