---
name: 1c-meta-info
description: "Анализ структуры объекта метаданных 1С из XML-выгрузки - реквизиты, табличные части, формы, движения, типы. Используй для изучения структуры объектов (вместо чтения XML-файлов напрямую) и как подготовительный шаг при написании запросов и кода, работающего с объектами"
---

## Gamma / OpenCode adaptation

This skill runs inside the selected Gamma 1C profile. Load other shipped skills with the native `skill` tool as `1c-development:<name>`; slash examples are skill references, not installed commands. Only names listed by the native skill tool are installed. Optional upstream skills (for example epf-build, erf-build, cf-load, skd-info or skd-styles) are not part of this bundle; do not call them. Use native read for source inspection, or report the missing capability. Binary build/load commands require the separately installed platform. Use native `read`, `glob`, `grep`, file editing and `bash` tools. Do not invoke Claude-only tools or unavailable commercial services. BSL semantic tools use the connected `gamma-bsl` MCP; its connection must be checked first. If unavailable, report that gap and use the supplied source validators. Never fabricate tool results.

Resource paths below are rendered from the verified installed bundle, independently of the project cwd. Use the configured Python interpreter (GAMMA_1C_PYTHON; Python 3.10+ with lxml), not PowerShell. Run scripts with explicit absolute project input/output paths; inspect their --help before use. Never modify installed resources or unrelated files. EDT sources can be inspected but these XML generators target Designer XML exports; do not rewrite EDT .mdo as Designer XML. Preserve UUIDs, format version, existing project conventions and unrelated changes. Check XML and BSL after editing. Source validation is not compilation/testing in 1C; building CF/CFE/EPF/ERF and running an infobase needs the separately installed licensed platform. Do not install or launch commercial MCPs or call paid APIs.


### Shipped Python entry points

- `"{{PYTHON}}" "{{SKILLS_ROOT}}/1c-meta-info/scripts/meta-info.py" --help`

# /meta-info - Структура объекта метаданных 1С

Читает XML объекта метаданных из выгрузки конфигурации 1С и выводит компактное описание структуры.

## Параметры и команда

| Параметр | Описание |
|----------|----------|
| `ObjectPath` | Путь к XML-файлу объекта или каталогу (авто-резолв `<name>/<name>.xml`) |
| `Mode` | Режим: `overview` (default), `brief`, `full` |
| `Name` | Drill-down по имени элемента (реквизит, ТЧ, значение перечисления, шаблон URL, операция) |
| `Limit` / `Offset` | Пагинация (по умолчанию 150 строк) |
| `OutFile` | Записать результат в файл (UTF-8 BOM) |



## Три режима

| Режим | Что показывает |
|---|---|
| `overview` *(default)* | Заголовок + ключевые свойства + структура без раскрытия деталей |
| `brief` | Все одной-двумя строками: имена полей, счетчики |
| `full` | Все раскрыто: колонки ТЧ, список источников подписки, движения, формы |

`-Name` - drill-down: раскрыть конкретный элемент объекта (ТЧ, реквизит, шаблон URL, операцию веб-сервиса).

## Поддерживаемые типы (23)

**Ссылочные:** Справочник, Документ, Перечисление, Бизнес-процесс, Задача, План обмена, План счетов, ПВХ, ПВР
**Регистры:** Регистр сведений, Регистр накопления, Регистр бухгалтерии, Регистр расчета
**Сервисные:** Отчет, Обработка, HTTP-сервис, Веб-сервис, Общий модуль, Регламентное задание, Подписка на событие
**Прочие:** Константа, Журнал документов, Определяемый тип

## Примеры


