---
name: 1c-cfe-validate
description: "Валидация расширения конфигурации 1С (CFE). Используй после создания или модификации расширения для проверки корректности"
---

## Gamma / OpenCode adaptation

This skill runs inside the selected Gamma 1C profile. Load other shipped skills with the native `skill` tool as `1c-development:<name>`; slash examples are skill references, not installed commands. Only names listed by the native skill tool are installed. Optional upstream skills (for example epf-build, erf-build, cf-load, skd-info or skd-styles) are not part of this bundle; do not call them. Use native read for source inspection, or report the missing capability. Binary build/load commands require the separately installed platform. Use native `read`, `glob`, `grep`, file editing and `bash` tools. Do not invoke Claude-only tools or unavailable commercial services. BSL semantic tools use the connected `gamma-bsl` MCP; its connection must be checked first. If unavailable, report that gap and use the supplied source validators. Never fabricate tool results.

Resource paths below are rendered from the verified installed bundle, independently of the project cwd. Use the configured Python interpreter (GAMMA_1C_PYTHON; Python 3.10+ with lxml), not PowerShell. Run scripts with explicit absolute project input/output paths; inspect their --help before use. Never modify installed resources or unrelated files. EDT sources can be inspected but these XML generators target Designer XML exports; do not rewrite EDT .mdo as Designer XML. Preserve UUIDs, format version, existing project conventions and unrelated changes. Check XML and BSL after editing. Source validation is not compilation/testing in 1C; building CF/CFE/EPF/ERF and running an infobase needs the separately installed licensed platform. Do not install or launch commercial MCPs or call paid APIs.


### Shipped Python entry points

- `"{{PYTHON}}" "{{SKILLS_ROOT}}/1c-cfe-validate/scripts/cfe-validate.py" --help`

# /cfe-validate - валидация расширения конфигурации (CFE)

Проверяет структурную корректность расширения: XML-формат, свойства, состав, заимствованные объекты. Аналог `/cf-validate`, но для расширений. `version` у `Form` и `BaseForm` формы объекта и общей формы сверяется с `Configuration.xml` расширения.

## Параметры

| Параметр      | Обяз. | Умолч. | Описание                                        |
|---------------|:-----:|---------|-------------------------------------------------|
| ExtensionPath | да    | -       | Путь к каталогу или Configuration.xml расширения |
| ConfigPath    | нет   | -       | Путь к основной конфигурации: включает сверку путей к данным формы |
| Detailed      | нет   | -       | Подробный вывод (все проверки, включая успешные)  |
| MaxErrors     | нет   | 30      | Остановиться после N ошибок                      |
| OutFile       | нет   | -       | Записать результат в файл                        |

## Команда


