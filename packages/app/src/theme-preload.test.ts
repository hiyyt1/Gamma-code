import { beforeEach, describe, expect, test } from "bun:test"

const src = await Bun.file(new URL("../public/oc-theme-preload.js", import.meta.url)).text()
const run = () => Function(src)()

beforeEach(() => {
  document.head.innerHTML = '<meta name="theme-color" content="#080808">'
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  localStorage.clear()
})

describe("Gamma light preload", () => {
  for (const scheme of [null, "light", "dark", "system", "invalid"]) {
    test(`migrates ${scheme ?? "empty"} storage without applying cached CSS`, () => {
      if (scheme) localStorage.setItem("opencode-color-scheme", scheme)
      localStorage.setItem("opencode-theme-id", "nightowl")
      localStorage.setItem("opencode-theme-css-light", "--background-base:#000;")
      localStorage.setItem("opencode-theme-css-dark", "--background-base:#000;")
      run()
      expect(document.documentElement.dataset.theme).toBe("oc-2")
      expect(document.documentElement.dataset.colorScheme).toBe("light")
      expect(document.documentElement.style.colorScheme).toBe("only light")
      expect(localStorage.getItem("opencode-theme-id")).toBe("oc-2")
      expect(localStorage.getItem("opencode-color-scheme")).toBe("light")
      expect(localStorage.getItem("opencode-theme-css-light")).toBeNull()
      expect(localStorage.getItem("opencode-theme-css-dark")).toBeNull()
      expect(document.getElementById("oc-theme-preload")).toBeNull()
      expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#fafafa")
    })
  }

  test("sets light appearance even if storage throws", () => {
    Function(
      "localStorage",
      src,
    )(
      new Proxy(
        {},
        {
          get: () => {
            throw new Error("Storage unavailable")
          },
        },
      ),
    )
    expect(document.documentElement.dataset.colorScheme).toBe("light")
    expect(document.documentElement.style.colorScheme).toBe("only light")
  })
})
