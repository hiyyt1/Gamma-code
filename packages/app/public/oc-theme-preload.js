;(function () {
  // Gamma has one palette. Never inject CSS cached by an older theme picker.
  document.documentElement.dataset.theme = "oc-2"
  document.documentElement.dataset.colorScheme = "light"
  document.documentElement.style.colorScheme = "only light"
  document.documentElement.style.backgroundColor = "#fafafa"
  var meta = document.querySelector("meta[name='theme-color']")
  if (meta) meta.setAttribute("content", "#fafafa")

  // Storage may be unavailable in restricted browser profiles. Appearance must
  // still be correct before the application mounts.
  try {
    localStorage.setItem("opencode-theme-id", "oc-2")
    localStorage.setItem("opencode-color-scheme", "light")
    localStorage.removeItem("opencode-theme-css-light")
    localStorage.removeItem("opencode-theme-css-dark")
  } catch {}
})()
