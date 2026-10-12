import { useLanguage } from "@/context/language"
import type { SiteResult } from "@/utils/site-results"
import "./site-result-card.css"

export function SiteResultCard(props: { result: SiteResult; onOpen: (path: string) => void }) {
  const language = useLanguage()
  return (
    <article class="gamma-site-result" aria-label={language.t("sitePreview.result")}>
      <svg
        aria-hidden="true"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M3 9h18M6 6.5h1m2 0h1m2 0h1" />
      </svg>
      <div>
        <strong>{props.result.site.path.split("/").at(-1) || "index.html"}</strong>
        <span>{props.result.site.path ? `${props.result.site.path}/index.html` : "index.html"}</span>
        <span>{props.result.site.framework ?? "HTML"}</span>
      </div>
      <button type="button" disabled={!props.result.available} onClick={() => props.onOpen(props.result.site.path)}>
        {language.t("sitePreview.openSite")}
      </button>
      {!props.result.available && (
        <small role="status">
          {language.t(
            props.result.status === "unconfigured"
              ? "sitePreview.setupRequired"
              : props.result.status === "forbidden"
                ? "sitePreview.accessDenied"
                : props.result.status === "offline"
                  ? "sitePreview.offline"
                  : props.result.status === "missing"
                    ? "sitePreview.missing"
                    : props.result.status === "loading"
                      ? "sitePreview.loading"
                      : "sitePreview.backendError",
          )}
        </small>
      )}
    </article>
  )
}
