---
name: 1c-query-optimization
description: "Advanced query patterns for 1C: temporary tables, joins, DCS optimization. Use for complex queries beyond basic rules in query-optimization-tips.md."
---

## Gamma / OpenCode adaptation

This skill runs inside the selected Gamma 1C profile. Load other shipped skills with the native `skill` tool as `1c-development:<name>`; slash examples are skill references, not installed commands. Only names listed by the native skill tool are installed. Optional upstream skills (for example epf-build, erf-build, cf-load, skd-info or skd-styles) are not part of this bundle; do not call them. Use native read for source inspection, or report the missing capability. Binary build/load commands require the separately installed platform. Use native `read`, `glob`, `grep`, file editing and `bash` tools. Do not invoke Claude-only tools or unavailable commercial services. BSL semantic tools use the connected `gamma-bsl` MCP; its connection must be checked first. If unavailable, report that gap and use the supplied source validators. Never fabricate tool results.

Resource paths below are rendered from the verified installed bundle, independently of the project cwd. Use the configured Python interpreter (GAMMA_1C_PYTHON; Python 3.10+ with lxml), not PowerShell. Run scripts with explicit absolute project input/output paths; inspect their --help before use. Never modify installed resources or unrelated files. EDT sources can be inspected but these XML generators target Designer XML exports; do not rewrite EDT .mdo as Designer XML. Preserve UUIDs, format version, existing project conventions and unrelated changes. Check XML and BSL after editing. Source validation is not compilation/testing in 1C; building CF/CFE/EPF/ERF and running an infobase needs the separately installed licensed platform. Do not install or launch commercial MCPs or call paid APIs.


# 1C Query Optimization Skill (Advanced Patterns)

Продвинутые паттерны оптимизации запросов. Базовые оптимизации (ВЫРАЗИТЬ, ПРЕДСТАВЛЕНИЕ, ВТ вместо подзапросов, ОБЪЕДИНИТЬ ВСЕ, индексы, СКД) - см. правило `references/query-optimization-tips.md`. Анти-паттерны (запрос в цикле, обращение через точку) - см. `references/anti_patterns.md`.

## Проверка запросов в Gamma

AI-EDT/validate_query не поставляются. Используй доступный BSL MCP для диагностики модулей и сверяй поля с индексом метаданных. Это не выполнение запроса, не проверка фактического плана и не измерение ускорения: эти проверки требуют платформы 1С и тестовой базы.

## When to Use

Invoke this skill when:
- Working with complex multi-step data processing
- Optimizing joins and subqueries
- Implementing DCS reports
- Processing large datasets in portions

## Temporary Tables - When to Use

Use temporary tables for:
- Complex multi-step data processing
- Joining data from multiple sources
- Reusing intermediate results

### Join vs Subquery (basic choice)

```bsl
// PREFERRED: Join (usually faster)
"ВЫБРАТЬ
|	Заказы.Ссылка КАК Заказ,
|	Контрагенты.ИНН КАК ИНН
|ИЗ
|	Документ.ЗаказКлиента КАК Заказы
|		ЛЕВОЕ СОЕДИНЕНИЕ Справочник.Контрагенты КАК Контрагенты
|		ПО Заказы.Контрагент = Контрагенты.Ссылка"

// AVOID: Subquery in SELECT (N+1 problem)
"ВЫБРАТЬ
|	Заказы.Ссылка КАК Заказ,
|	(ВЫБРАТЬ К.ИНН ИЗ Справочник.Контрагенты КАК К
|	 ГДЕ К.Ссылка = Заказы.Контрагент) КАК ИНН
|ИЗ
|	Документ.ЗаказКлиента КАК Заказы"
```

### Avoid Aggregation in Subqueries

```bsl
// SLOW: Subquery with aggregation
"ВЫБРАТЬ
|	Номенклатура.Ссылка,
|	(ВЫБРАТЬ СУММА(Остатки.Количество) ...) КАК Остаток
|ИЗ
|	Справочник.Номенклатура КАК Номенклатура"

// FAST: Join with pre-aggregated data
"ВЫБРАТЬ
|	Номенклатура.Ссылка КАК Номенклатура,
|	ЕСТЬNULL(Остатки.КоличествоОстаток, 0) КАК Остаток
|ИЗ
|	Справочник.Номенклатура КАК Номенклатура
|		ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.ТоварыНаСкладах.Остатки КАК Остатки
|		ПО Номенклатура.Ссылка = Остатки.Номенклатура"
```

---

**Reference**: [ITS Query Optimization Standards](https://its.1c.ru/db/v8std/browse/13/-1/26/28)
