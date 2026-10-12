---
name: 1c-skd-validate
description: "Валидация схемы компоновки данных 1С (СКД). Используй после создания или модификации СКД для проверки корректности"
---

## Gamma / OpenCode adaptation

This skill runs inside the selected Gamma 1C profile. Load other shipped skills with the native `skill` tool as `1c-development:<name>`; slash examples are skill references, not installed commands. Only names listed by the native skill tool are installed. Optional upstream skills (for example epf-build, erf-build, cf-load, skd-info or skd-styles) are not part of this bundle; do not call them. Use native read for source inspection, or report the missing capability. Binary build/load commands require the separately installed platform. Use native `read`, `glob`, `grep`, file editing and `bash` tools. Do not invoke Claude-only tools or unavailable commercial services. BSL semantic tools use the connected `gamma-bsl` MCP; its connection must be checked first. If unavailable, report that gap and use the supplied source validators. Never fabricate tool results.

Resource paths below are rendered from the verified installed bundle, independently of the project cwd. Use the configured Python interpreter (GAMMA_1C_PYTHON; Python 3.10+ with lxml), not PowerShell. Run scripts with explicit absolute project input/output paths; inspect their --help before use. Never modify installed resources or unrelated files. EDT sources can be inspected but these XML generators target Designer XML exports; do not rewrite EDT .mdo as Designer XML. Preserve UUIDs, format version, existing project conventions and unrelated changes. Check XML and BSL after editing. Source validation is not compilation/testing in 1C; building CF/CFE/EPF/ERF and running an infobase needs the separately installed licensed platform. Do not install or launch commercial MCPs or call paid APIs.


### Shipped Python entry points

- `"{{PYTHON}}" "{{SKILLS_ROOT}}/1c-skd-validate/scripts/skd-validate.py" --help`

# /skd-validate - валидация СКД (DataCompositionSchema)

Проверяет структурную корректность Template.xml схемы компоновки данных. Выявляет ошибки формата, битые ссылки, дубликаты имен.

## Параметры

| Параметр     | Обяз. | Умолч. | Описание                                              |
|--------------|:-----:|---------|---------------------------------------------------------|
| TemplatePath | да    | -       | Путь к Template.xml или каталогу макета                 |
| Detailed     | нет   | -       | Подробный вывод (все проверки, включая успешные)         |
| MaxErrors    | нет   | 20      | Остановиться после N ошибок                             |
| OutFile      | нет   | -       | Записать результат в файл                               |
| IndexPath    | нет   | -      | Индекс от `1c-config-index`: включает сверку наборов данных с конфигурацией |

## Команда



## Сверка наборов данных с конфигурацией

Набор данных типа `Query` несет текст запроса, типа `Object` - имя объекта. И то и другое
может ссылаться на объект, которого в конфигурации уже нет, - схема при этом остается
структурно корректной, и валидатор ее пропускал.

С `-IndexPath` разбирается ДВУХЧАСТНОЕ имя метаданных: `РегистрНакопления.Остатки` проверяется
на существование. Оба языка запроса. Третья часть не трогается: в запросе она бывает и
табличной частью, и виртуальной таблицей, и значением перечисления, а отличить их без разбора
структуры запроса нельзя.

Литералы и комментарии вырезаются до разбора. Тяжесть - предупреждение.

Полная проверка текста запроса - имена полей, псевдонимы, виртуальные таблицы - в отдельном
навыке `1c-query-validate`.

```bash
"{{PYTHON}}" {{SKILLS_ROOT}}/1c-config-index/scripts/config-index.py -ConfigPath src -OutFile .cache/index.json
"{{PYTHON}}" {{SKILLS_ROOT}}/1c-skd-validate/scripts/skd-validate.py -TemplatePath src/Reports/Продажи/Templates/Схема/Ext/Template.xml -IndexPath .cache/index.json
```
