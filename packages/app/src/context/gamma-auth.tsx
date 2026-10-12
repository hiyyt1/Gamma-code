import { createContext, onCleanup, onMount, Show, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { ProductBrand } from "@/components/product-brand"
import "@/pages/login.css"

const GammaAuthContext = createContext<{ username: () => string; logout: () => Promise<void> }>()
export const useGammaAuth = () => useContext(GammaAuthContext)

export function GammaAuthGate(props: ParentProps) {
  const language = useLanguage()
  const [state, setState] = createStore({
    authenticated: false,
    checking: true,
    busy: false,
    username: "",
    login: "",
    password: "",
    showPassword: false,
    error: "" as "" | "invalid" | "rate" | "network",
  })
  let revision = 0
  const signedOut = () => {
    revision++
    setState({ authenticated: false, checking: false, busy: false, username: "", password: "", error: "" })
    window.history.replaceState(null, "", "/login")
  }
  const check = async () => {
    if (state.busy) return
    const current = ++revision
    const response = await fetch("/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(10000),
    }).catch(() => undefined)
    if (current !== revision) return
    if (response?.status === 401) {
      signedOut()
      return
    }
    const body =
      response?.ok && response.headers.get("content-type")?.includes("application/json")
        ? await response.json().catch(() => undefined)
        : undefined
    if (current !== revision) return
    if (!body || typeof body.username !== "string") {
      if (!state.authenticated) setState({ checking: false, error: "network" })
      return
    }
    if (window.location.pathname === "/login") return window.location.replace("/")
    setState({ authenticated: true, username: body.username, checking: false, error: "" })
  }
  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (state.busy || state.checking) return
    revision++
    setState({ busy: true, error: "" })
    const response = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username: state.login, password: state.password }),
      signal: AbortSignal.timeout(15000),
    }).catch(() => undefined)
    setState("password", "")
    if (response?.ok && response.headers.get("content-type")?.includes("application/json")) {
      window.location.replace("/")
      return
    }
    setState({
      busy: false,
      error: response?.status === 429 ? "rate" : response?.status === 401 ? "invalid" : "network",
    })
  }
  const logout = async () => {
    if (state.busy) return
    revision++
    setState({ busy: true, error: "" })
    const response = await fetch("/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      signal: AbortSignal.timeout(10000),
    }).catch(() => undefined)
    if (response?.ok || response?.status === 401) {
      signedOut()
      return
    }
    setState({ busy: false, error: "network" })
  }
  onMount(() => {
    void check()
    const timer = window.setInterval(() => void check(), 30000)
    const focus = () => {
      if (document.visibilityState === "visible") void check()
    }
    window.addEventListener("focus", focus)
    window.addEventListener("pageshow", focus)
    document.addEventListener("visibilitychange", focus)
    onCleanup(() => {
      revision++
      window.clearInterval(timer)
      window.removeEventListener("focus", focus)
      window.removeEventListener("pageshow", focus)
      document.removeEventListener("visibilitychange", focus)
    })
  })
  return (
    <GammaAuthContext.Provider value={{ username: () => state.username, logout }}>
      <Show
        when={state.authenticated}
        fallback={
          <main class="gamma-login">
            <section
              class="gamma-login-card"
              aria-labelledby="gamma-login-title"
              aria-busy={state.busy || state.checking}
            >
              <ProductBrand />
              <h1 id="gamma-login-title">{language.t("auth.login.title")}</h1>
              <form onSubmit={submit}>
                <label for="gamma-login-name">{language.t("auth.login.username")}</label>
                <input
                  id="gamma-login-name"
                  name="username"
                  autocomplete="username"
                  autocapitalize="none"
                  spellcheck={false}
                  required
                  maxlength={128}
                  value={state.login}
                  disabled={state.busy || state.checking}
                  onInput={(event) => setState("login", event.currentTarget.value)}
                />
                <label for="gamma-login-password">{language.t("auth.login.password")}</label>
                <div class="gamma-login-password">
                  <input
                    id="gamma-login-password"
                    name="password"
                    type={state.showPassword ? "text" : "password"}
                    autocomplete="current-password"
                    required
                    maxlength={1024}
                    value={state.password}
                    disabled={state.busy || state.checking}
                    aria-describedby={state.error ? "gamma-login-error" : undefined}
                    onInput={(event) => setState("password", event.currentTarget.value)}
                  />
                  <button
                    type="button"
                    class="gamma-login-reveal"
                    aria-controls="gamma-login-password"
                    aria-pressed={state.showPassword}
                    onClick={() => setState("showPassword", !state.showPassword)}
                    aria-label={language.t(state.showPassword ? "auth.login.hidePassword" : "auth.login.showPassword")}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                      <circle cx="12" cy="12" r="3" />
                      <Show when={state.showPassword}>
                        <path d="m3 3 18 18" />
                      </Show>
                    </svg>
                  </button>
                </div>
                <div class="gamma-login-status" aria-live="polite">
                  <Show when={state.error}>
                    <p id="gamma-login-error" role="alert">
                      {language.t(
                        state.error === "invalid"
                          ? "auth.login.invalid"
                          : state.error === "rate"
                            ? "auth.login.rateLimited"
                            : "auth.login.networkError",
                      )}
                    </p>
                  </Show>
                </div>
                <button type="submit" class="gamma-login-submit" disabled={state.busy || state.checking}>
                  {language.t(
                    state.checking ? "auth.login.checking" : state.busy ? "auth.login.submitting" : "auth.login.submit",
                  )}
                </button>
              </form>
            </section>
          </main>
        }
      >
        {props.children}
        <Show when={state.error}>
          <div class="gamma-auth-error" role="alert">
            {language.t("auth.login.networkError")}
          </div>
        </Show>
      </Show>
    </GammaAuthContext.Provider>
  )
}
