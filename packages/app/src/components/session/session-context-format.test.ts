import { expect, test } from "bun:test"
import { createSessionContextFormatter } from "./session-context-format"

test("distinguishes unavailable usage from small nonzero context", () => {
  const format = createSessionContextFormatter("en-US")
  expect(format.percent(undefined)).toBe("—")
  expect(format.percent(null)).toBe("—")
  expect(format.percent(NaN)).toBe("—")
  expect(format.percent(0.015)).toBe("<0.1%")
  expect(format.percent(12.34)).toBe("12.3%")
  expect(format.percent(0)).toBe("0%")
})
