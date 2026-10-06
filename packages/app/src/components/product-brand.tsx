import { useLanguage } from "@/context/language"

export function ProductBrand(props: { class?: string }) {
  const language = useLanguage()
  return <span class={`oreshnik-brand ${props.class ?? ""}`}>{language.t("app.name")}</span>
}
