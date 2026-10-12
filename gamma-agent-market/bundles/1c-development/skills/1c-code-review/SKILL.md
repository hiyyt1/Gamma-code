---
name: 1c-code-review
description: "Ревью BSL-кода по каталогу дефектов: каждая находка получает идентификатор карточки, важность и ключ локации. Триггеры: ревью BSL, проверь код по антипаттернам, code review 1С, проверь код перед коммитом, а также вызов из команды закрытия задачи."
---

## Gamma / OpenCode adaptation

This skill runs inside the selected Gamma 1C profile. Load other shipped skills with the native `skill` tool as `1c-development:<name>`; slash examples are skill references, not installed commands. Only names listed by the native skill tool are installed. Optional upstream skills (for example epf-build, erf-build, cf-load, skd-info or skd-styles) are not part of this bundle; do not call them. Use native read for source inspection, or report the missing capability. Binary build/load commands require the separately installed platform. Use native `read`, `glob`, `grep`, file editing and `bash` tools. Do not invoke Claude-only tools or unavailable commercial services. BSL semantic tools use the connected `gamma-bsl` MCP; its connection must be checked first. If unavailable, report that gap and use the supplied source validators. Never fabricate tool results.

Resource paths below are rendered from the verified installed bundle, independently of the project cwd. Use the configured Python interpreter (GAMMA_1C_PYTHON; Python 3.10+ with lxml), not PowerShell. Run scripts with explicit absolute project input/output paths; inspect their --help before use. Never modify installed resources or unrelated files. EDT sources can be inspected but these XML generators target Designer XML exports; do not rewrite EDT .mdo as Designer XML. Preserve UUIDs, format version, existing project conventions and unrelated changes. Check XML and BSL after editing. Source validation is not compilation/testing in 1C; building CF/CFE/EPF/ERF and running an infobase needs the separately installed licensed platform. Do not install or launch commercial MCPs or call paid APIs.


# 1c-code-review - ревью BSL по каталогу дефектов

Каталог дефектов - данные: карточки `references/catalog/<ИДЕНТИФИКАТОР>.md`, каждая с триггером,
законной формой и фикстурой. Ревью идет от измененного кода к каталогу, а не пересказом
карточек.

## Порядок работы

1. **Архетипы правки.** Определи архетипы измененного кода по списку: транзакция, блокировка,
   права, запрос, модуль формы, событие объекта, новый общий модуль, перехват в расширении,
   изменение метаданных, любой BSL. Архетипы задают, какие группы каталога просматривать
   в первую очередь.
2. **Находки инструментов.** Выполни `gamma-bsl_analyze_file` и `1c-bsl-validate -Catalog -Json` для изменённых модулей. MCP не подключён — явно запиши отсутствие семантической проверки. Прочитай результаты, а не только exit code (BSL warning validator может вернуть 0). Не используй отсутствующие AI-EDT/Напарник/code_review services.
3. **Проход по индексу.** Открой `references/catalog/INDEX.md`. Для каждой строки таблицы
   проверь: есть ли триггер в измененном коде. Карточку читай ТОЛЬКО при попадании триггера -
   за формулировкой триггера, законной формой и способом чинить. Законная форма отсекает
   ложное срабатывание: код, совпадающий с ней, находкой не является.
4. **Отчет.** Оформи по `references/report-format.md`: ключ находки `<путь>::<Метод>:<строка>`,
   одна локация - одна находка, важность по `references/severity.md`, разделы "Проверено" и
   "Не проверено" обязательны.

## Границы

- Вердикт "чисто" требует выполненных обязательных проверок: непроверенное - "с пробелами",
  не "чисто".
- Детекторы карточек (раздел "Детекторы") описывают автоматическую проверку с уровнем
  доказательности (semantic, static, llm, read); значение "чтение" означает, что
  детерминированного детектора нет, дефект ловится проходом по индексу. Сводная матрица
  детекторов и пороги покрытия - `references/detectors.md`; гейтовый конфиг
  bsl-language-server с диагностиками карточек - `assets/bsl-ls-gate.json` (передача -
  `assets/README.md`).
- Номера стандартов проверяй по доступным официальным источникам. MCP `v8std` не поставляется; неподтвержденный номер не используй.
