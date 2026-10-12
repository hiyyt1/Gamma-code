---
name: 1c-meta-compile
description: "Создать объект метаданных 1С. Используй когда пользователь просит создать или добавить справочник, документ, регистр, перечисление, константу, общий модуль, обработку, отчет и др."
---

## Gamma / OpenCode adaptation

This skill runs inside the selected Gamma 1C profile. Load other shipped skills with the native `skill` tool as `1c-development:<name>`; slash examples are skill references, not installed commands. Only names listed by the native skill tool are installed. Optional upstream skills (for example epf-build, erf-build, cf-load, skd-info or skd-styles) are not part of this bundle; do not call them. Use native read for source inspection, or report the missing capability. Binary build/load commands require the separately installed platform. Use native `read`, `glob`, `grep`, file editing and `bash` tools. Do not invoke Claude-only tools or unavailable commercial services. BSL semantic tools use the connected `gamma-bsl` MCP; its connection must be checked first. If unavailable, report that gap and use the supplied source validators. Never fabricate tool results.

Resource paths below are rendered from the verified installed bundle, independently of the project cwd. Use the configured Python interpreter (GAMMA_1C_PYTHON; Python 3.10+ with lxml), not PowerShell. Run scripts with explicit absolute project input/output paths; inspect their --help before use. Never modify installed resources or unrelated files. EDT sources can be inspected but these XML generators target Designer XML exports; do not rewrite EDT .mdo as Designer XML. Preserve UUIDs, format version, existing project conventions and unrelated changes. Check XML and BSL after editing. Source validation is not compilation/testing in 1C; building CF/CFE/EPF/ERF and running an infobase needs the separately installed licensed platform. Do not install or launch commercial MCPs or call paid APIs.


### Shipped Python entry points

- `"{{PYTHON}}" "{{SKILLS_ROOT}}/1c-meta-compile/scripts/meta-compile.py" --help`

# /meta-compile - генерация объектов метаданных из JSON DSL

Принимает JSON-определение объекта метаданных → генерирует XML + модули в структуре выгрузки конфигурации + регистрирует в Configuration.xml.

## Порядок работы

1. Составь JSON по синтаксису и примерам ниже → запиши во временный файл
2. Запусти скрипт meta-compile
3. Если нужно изменить созданный объект - `/meta-edit`
4. Если нужно проверить - `/meta-validate`

## Команда



| Параметр | Описание |
|----------|----------|
| `JsonPath` | Путь к JSON-файлу (один объект `{...}` или массив `[{...}, ...]`) |
| `OutputDir` | Корень выгрузки конфигурации (где `Configuration.xml`, `Catalogs/`, `Documents/` и т.д.) |

## JSON DSL

### Общая структура

```json
{ "type": "Catalog", "name": "Номенклатура", ...свойства типа... }
```

`type` и `name` - обязательные. `synonym` генерируется из `name` автоматически (CamelCase → слова через пробел). Можно задать явно: `"synonym": "Мой синоним"`.

### Shorthand реквизитов

Используется в `attributes`, `dimensions`, `resources`, `tabularSections`:

```
"ИмяРеквизита"                    → String(10) по умолчанию
"ИмяРеквизита: Тип"               → с типом
"ИмяРеквизита: Тип | req, index"  → с флагами
```

Типы: `String(100)`, `Number(15,2)`, `Boolean`, `Date`, `DateTime`, `CatalogRef.Xxx`, `DocumentRef.Xxx`, `EnumRef.Xxx`, `DefinedType.Xxx` и др. ссылочные.

Составной тип: `"Значение: String + Number(15,2) + CatalogRef.Контрагенты"`.

Флаги: `req`, `index`, `indexAdditional`, `nonneg`, `master`, `mainFilter`, `denyIncomplete`, `useInTotals`.

### Свойства по типам

Примеров и shorthand-синтаксиса выше достаточно для типовых задач. Если нужны свойства типа, не показанные в примерах, и их допустимые значения - см. reference-файл:

- `reference/types-basic.md` - Catalog, Document, Enum, Constant, DefinedType, Report, DataProcessor
- `reference/types-registers.md` - InformationRegister, AccumulationRegister, AccountingRegister, CalculationRegister, ChartOfAccounts, ChartOfCharacteristicTypes, ChartOfCalculationTypes
- `reference/types-process.md` - BusinessProcess, Task, ExchangePlan, CommonModule, ScheduledJob, EventSubscription, DocumentJournal
- `reference/types-web.md` - HTTPService, WebService
- `reference/types-config.md` - CommonAttribute, CommonCommand, CommandGroup, CommonForm, CommonTemplate, CommonPicture, FilterCriterion, Sequence, DocumentNumerator, SessionParameter, SettingsStorage, FunctionalOption, FunctionalOptionsParameter, WSReference

Эта инструкция и reference-файлы - полная документация для генерации. Не ищи примеры XML в выгрузках конфигураций.

## Примеры паттернов DSL

### Минимальный объект

```json
{ "type": "Catalog", "name": "Валюты" }
```

### С реквизитами

```json
{
  "type": "Catalog", "name": "Организации",
  "descriptionLength": 100,
  "attributes": ["ИНН: String(12)", "КПП: String(9)", "Директор: CatalogRef.ФизическиеЛица"]
}
```

### С табличной частью

```json
{
  "type": "Document", "name": "ПриходнаяНакладная",
  "registerRecords": ["AccumulationRegister.ОстаткиТоваров"],
  "attributes": ["Организация: CatalogRef.Организации", "Контрагент: CatalogRef.Контрагенты"],
  "tabularSections": { "Товары": ["Номенклатура: CatalogRef.Номенклатура", "Количество: Number(15,3)", "Цена: Number(15,2)"] }
}
```

Табличная часть задается списком колонок либо объектом, если нужен свой синоним:

```json
"tabularSections": {
  "Товары": { "synonym": "Строки заказа", "attributes": ["Номенклатура: CatalogRef.Номенклатура"] }
}
```

Поддержаны ключи `attributes`, `synonym` и `comment`. Любой другой ключ навык не применит и скажет об
этом предупреждением - молча он их больше не проглатывает.

### Регистровый паттерн (измерения + ресурсы)

```json
{
  "type": "InformationRegister", "name": "КурсыВалют", "periodicity": "Day",
  "dimensions": ["Валюта: CatalogRef.Валюты | master, mainFilter, denyIncomplete"],
  "resources": ["Курс: Number(15,4)", "Кратность: Number(10,0)"]
}
```

### Batch - несколько объектов в одном файле

```json
[
  { "type": "Enum", "name": "Статусы", "values": ["Новый", "Закрыт"] },
  { "type": "Catalog", "name": "Валюты" },
  { "type": "Constant", "name": "ОсновнаяВалюта", "valueType": "CatalogRef.Валюты" }
]
```

