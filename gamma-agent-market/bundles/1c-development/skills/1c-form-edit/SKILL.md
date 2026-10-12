---
name: 1c-form-edit
description: "Добавление элементов, реквизитов и команд в существующую управляемую форму 1С. Используй когда нужно точечно модифицировать готовую форму"
---

## Gamma / OpenCode adaptation

This skill runs inside the selected Gamma 1C profile. Load other shipped skills with the native `skill` tool as `1c-development:<name>`; slash examples are skill references, not installed commands. Only names listed by the native skill tool are installed. Optional upstream skills (for example epf-build, erf-build, cf-load, skd-info or skd-styles) are not part of this bundle; do not call them. Use native read for source inspection, or report the missing capability. Binary build/load commands require the separately installed platform. Use native `read`, `glob`, `grep`, file editing and `bash` tools. Do not invoke Claude-only tools or unavailable commercial services. BSL semantic tools use the connected `gamma-bsl` MCP; its connection must be checked first. If unavailable, report that gap and use the supplied source validators. Never fabricate tool results.

Resource paths below are rendered from the verified installed bundle, independently of the project cwd. Use the configured Python interpreter (GAMMA_1C_PYTHON; Python 3.10+ with lxml), not PowerShell. Run scripts with explicit absolute project input/output paths; inspect their --help before use. Never modify installed resources or unrelated files. EDT sources can be inspected but these XML generators target Designer XML exports; do not rewrite EDT .mdo as Designer XML. Preserve UUIDs, format version, existing project conventions and unrelated changes. Check XML and BSL after editing. Source validation is not compilation/testing in 1C; building CF/CFE/EPF/ERF and running an infobase needs the separately installed licensed platform. Do not install or launch commercial MCPs or call paid APIs.


### Shipped Python entry points

- `"{{PYTHON}}" "{{SKILLS_ROOT}}/1c-form-edit/scripts/form-edit.py" --help`

# /form-edit - Редактирование формы

Добавляет элементы, реквизиты и/или команды в существующий Form.xml. Автоматически выделяет ID из правильного пула, генерирует companion-элементы (ContextMenu, ExtendedTooltip, и др.) и обработчики событий.

## Использование

```
/form-edit <FormPath> <JsonPath>
```

## Параметры

| Параметр  | Обязательный | Описание                         |
|-----------|:------------:|----------------------------------|
| FormPath  | да           | Путь к существующему Form.xml    |
| JsonPath  | да           | Путь к JSON с описанием добавлений |

## Команда



## JSON формат

```json
{
  "into": "ГруппаШапка",
  "after": "Контрагент",
  "elements": [
    { "input": "Склад", "path": "Объект.Склад", "on": ["OnChange"] }
  ],
  "attributes": [
    { "name": "СуммаИтого", "type": "decimal(15,2)" }
  ],
  "commands": [
    { "name": "Рассчитать", "action": "РассчитатьОбработка" }
  ]
}
```

### Расширения (extension-формы)

Для заимствованных форм (с `<BaseForm>`) автоматически активируется extension-режим: ID начинаются с 1000000+. Доступны дополнительные секции:

```json
{
  "formEvents": [
    { "name": "OnCreateAtServer", "handler": "Расш1_ПриСозданииПосле", "callType": "After" },
    { "name": "OnOpen", "handler": "Расш1_ПриОткрытии", "callType": "Before" }
  ],
  "elementEvents": [
    { "element": "Банк", "name": "OnChange", "handler": "Расш1_БанкПриИзменении", "callType": "Before" }
  ],
  "commands": [
    { "name": "Подбор", "action": "Расш1_ПодборПосле", "callType": "After" },
    { "name": "Запрос", "actions": [
      { "callType": "Before", "handler": "Расш1_ЗапросПеред" },
      { "callType": "After", "handler": "Расш1_ЗапросПосле" }
    ]}
  ],
  "elements": [
    { "input": "Поле", "path": "Объект.Поле", "on": [{ "event": "OnChange", "callType": "After" }] }
  ]
}
```

### Позиционирование элементов

| Ключ | По умолчанию | Описание |
|------|-------------|----------|
| `into` | корневой ChildItems | Имя группы/таблицы/страницы, куда вставлять |
| `after` | в конец | Имя элемента, после которого вставлять |

### Типы элементов

Те же DSL-ключи, что в `/form-compile`:

| Ключ | XML тег | Companions |
|------|---------|------------|
| `input` | InputField | ContextMenu, ExtendedTooltip |
| `check` | CheckBoxField | ContextMenu, ExtendedTooltip |
| `label` | LabelDecoration | ContextMenu, ExtendedTooltip |
| `labelField` | LabelField | ContextMenu, ExtendedTooltip |
| `group` | UsualGroup | ExtendedTooltip |
| `table` | Table | ContextMenu, AutoCommandBar, Search*, ViewStatus* |
| `pages` | Pages | ExtendedTooltip |
| `page` | Page | ExtendedTooltip |
| `button` | Button | ExtendedTooltip |

Группы и таблицы поддерживают `children`/`columns` для вложенных элементов.

### Кнопки: command и stdCommand

- `"command": "ИмяКоманды"` → `Form.Command.ИмяКоманды`
- `"stdCommand": "Close"` → `Form.StandardCommand.Close`
- `"stdCommand": "Товары.Add"` → `Form.Item.Товары.StandardCommand.Add` (стандартная команда элемента)

### Допустимые события (`on`)

Компилятор предупреждает об ошибках в именах событий. Основные:

- **input**: `OnChange`, `StartChoice`, `ChoiceProcessing`, `Clearing`, `AutoComplete`, `TextEditEnd`
- **check**: `OnChange`
- **table**: `OnStartEdit`, `OnEditEnd`, `OnChange`, `Selection`, `BeforeAddRow`, `BeforeDeleteRow`, `OnActivateRow`
- **label/picture**: `Click`, `URLProcessing`
- **pages**: `OnCurrentPageChange`
- **button**: `Click`

### Система типов (для attributes)

`string`, `string(100)`, `decimal(15,2)`, `boolean`, `date`, `dateTime`, `CatalogRef.XXX`, `DocumentObject.XXX`, `ValueTable`, `DynamicList`, `Type1 | Type2` (составной).

### Секции расширений

| Секция | Назначение |
|--------|-----------|
| `formEvents` | События уровня формы с `callType` (Before/After/Override) |
| `elementEvents` | События на существующих элементах заимствованной формы |
| `callType` на `commands` | callType на Action команды |
| `callType` на `on` | callType на событиях новых элементов (объектный формат) |

Все extension-секции опциональны - без них навык работает как с обычными формами.

## Workflow

1. `/form-info` - посмотреть текущую структуру формы
2. Создать JSON с описанием добавлений
3. `/form-edit` - добавить в форму
4. `/form-validate` - проверить корректность
5. `/form-info` - убедиться что добавилось правильно
