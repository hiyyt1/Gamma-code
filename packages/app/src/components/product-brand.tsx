import { useLanguage } from "@/context/language"

export function ProductBrand(props: { class?: string }) {
  const language = useLanguage()
  return (
    <span class={`gamma-brand ${props.class ?? ""}`}>
      <svg class="gamma-brand-mark" viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <path d="M18 2 32 10v6l-14-8-8 5v10l8 5 8-5v-3h-8v-6h14v13l-14 8L4 27V10Z" fill="#8057EF" />
        <path d="m18 2 14 8-7 4-7-4-8 5-6-5Z" fill="#A18AFF" />
        <path d="m4 10 6 5v10l8 5v5L4 27Z" fill="#6945DD" />
      </svg>
      <span>{language.t("app.name")}</span>
    </span>
  )
}
