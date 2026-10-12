---
name: 1c-meta-edit
description: "Точечное редактирование объекта метаданных 1С. Используй когда нужно добавить, удалить или изменить реквизиты, табличные части, измерения, ресурсы или свойства существующего объекта конфигурации"
---

## Gamma / OpenCode adaptation

This skill runs inside the selected Gamma 1C profile. Load other shipped skills with the native `skill` tool as `1c-development:<name>`; slash examples are skill references, not installed commands. Only names listed by the native skill tool are installed. Optional upstream skills (for example epf-build, erf-build, cf-load, skd-info or skd-styles) are not part of this bundle; do not call them. Use native read for source inspection, or report the missing capability. Binary build/load commands require the separately installed platform. Use native `read`, `glob`, `grep`, file editing and `bash` tools. Do not invoke Claude-only tools or unavailable commercial services. BSL semantic tools use the connected `gamma-bsl` MCP; its connection must be checked first. If unavailable, report that gap and use the supplied source validators. Never fabricate tool results.

Resource paths below are rendered from the verified installed bundle, independently of the project cwd. Use the configured Python interpreter (GAMMA_1C_PYTHON; Python 3.10+ with lxml), not PowerShell. Run scripts with explicit absolute project input/output paths; inspect their --help before use. Never modify installed resources or unrelated files. EDT sources can be inspected but these XML generators target Designer XML exports; do not rewrite EDT .mdo as Designer XML. Preserve UUIDs, format version, existing project conventions and unrelated changes. Check XML and BSL after editing. Source validation is not compilation/testing in 1C; building CF/CFE/EPF/ERF and running an infobase needs the separately installed licensed platform. Do not install or launch commercial MCPs or call paid APIs.


### Shipped Python entry points

- `"{{PYTHON}}" "{{SKILLS_ROOT}}/1c-meta-edit/scripts/meta-edit.py" --help`

# /meta-edit - точечное редактирование метаданных 1С

Атомарные операции модификации существующих XML объектов метаданных.

## Команда

### Inline mode (простые операции)



### JSON mode (сложные/комбинированные)



| Параметр | Описание |
|----------|----------|
| ObjectPath | XML-файл или директория объекта (обязательный, авторезолв `<dirName>.xml`) |
| Operation | Inline-операция (альтернатива DefinitionFile) |
| Value | Значение для inline-операции |
| DefinitionFile | JSON-файл с операциями (альтернатива Operation) |
| NoValidate | Не запускать meta-validate после правки |

## Операции - сводная таблица

Batch через `;;` во всех операциях. Подробный синтаксис - в файлах по ссылкам.

### Дочерние элементы - [child-operations.md](child-operations.md)

| Операция | Формат Value | Пример |
|----------|-------------|--------|
| `add-attribute` | `Имя: Тип \| флаги` | `"Сумма: Число(15,2) \| req, index"` |
| `add-ts` | `ТЧ: Рекв1: Тип1, Рекв2: Тип2` | `"Товары: Ном: CatalogRef.Ном, Кол: Число(15,3)"` |
| `add-dimension` | `Имя: Тип \| флаги` | `"Организация: CatalogRef.Организации \| master"` |
| `add-resource` | `Имя: Тип` | `"Сумма: Число(15,2)"` |
| `add-enumValue` | `Имя` | `"Значение1 ;; Значение2"` |
| `add-column` | `Имя: Тип` | `"Тип: EnumRef.ТипыДокументов"` |
| `add-command` | `Имя` | `"Печать"` |
| `add-ts-attribute` | `ТЧ.Имя: Тип` | `"Товары.Скидка: Число(15,2)"` |
| `remove-*` | `Имя` | `"СтарыйРеквизит ;; ЕщеОдин"` |
| `remove-ts-attribute` | `ТЧ.Имя` | `"Товары.УстаревшийРекв"` |
| `modify-attribute` | `Имя: ключ=значение` | `"СтароеИмя: name=НовоеИмя, type=Строка(500)"` |
| `modify-ts-attribute` | `ТЧ.Имя: ключ=значение` | `"Товары.Рекв: name=НовоеИмя"` |
| `modify-ts` | `ТЧ: ключ=значение` | `"Товары: synonym=Товарный состав"` |

Позиционная вставка: `"Склад: CatalogRef.Склады >> after Организация"`.

Формы и макеты этим скилом не добавляются и не удаляются: регистрация в `ChildObjects` это имя,
а описатель лежит в отдельном файле. Добавление - `form-add` и `template-add`, удаление -
`form-remove` и `template-remove`; определение с `forms` или `templates` в `add` или `remove`
отклоняется до первой записи.

### Свойства объекта - [properties-reference.md](properties-reference.md)

| Операция | Формат Value | Пример |
|----------|-------------|--------|
| `modify-property` | `Ключ=Значение` | `"CodeLength=11 ;; DescriptionLength=150"` |
| `add-owner` | `MetaType.Name` | `"Catalog.Контрагенты ;; Catalog.Организации"` |
| `add-registerRecord` | `MetaType.Name` | `"AccumulationRegister.ОстаткиТоваров"` |
| `add-basedOn` | `MetaType.Name` | `"Document.ЗаказКлиента"` |
| `add-inputByString` | `Путь поля` | `"StandardAttribute.Description"` |
| `set-owners` / `set-registerRecords` / `set-basedOn` / `set-inputByString` | Замена всего списка | `"Catalog.Орг ;; Catalog.Контр"` |
| `remove-owner` / `remove-registerRecord` / ... | Удаление из списка | `"Catalog.Контрагенты"` |

### JSON DSL - [json-dsl.md](json-dsl.md)

Для комбинированных операций (add + remove + modify в одном файле), синонимы ключей/типов, таблица поддерживаемых объектов.

## Быстрые примеры



## Верификация

```
/meta-validate <ObjectPath>    - валидация после редактирования
/meta-info <ObjectPath>        - визуальная сводка
```
