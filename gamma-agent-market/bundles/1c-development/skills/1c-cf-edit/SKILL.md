---
name: 1c-cf-edit
description: "Точечное редактирование конфигурации 1С. Используй когда нужно изменить свойства конфигурации, добавить или удалить объект из состава, настроить роли по умолчанию"
---

## Gamma / OpenCode adaptation

This skill runs inside the selected Gamma 1C profile. Load other shipped skills with the native `skill` tool as `1c-development:<name>`; slash examples are skill references, not installed commands. Only names listed by the native skill tool are installed. Optional upstream skills (for example epf-build, erf-build, cf-load, skd-info or skd-styles) are not part of this bundle; do not call them. Use native read for source inspection, or report the missing capability. Binary build/load commands require the separately installed platform. Use native `read`, `glob`, `grep`, file editing and `bash` tools. Do not invoke Claude-only tools or unavailable commercial services. BSL semantic tools use the connected `gamma-bsl` MCP; its connection must be checked first. If unavailable, report that gap and use the supplied source validators. Never fabricate tool results.

Resource paths below are rendered from the verified installed bundle, independently of the project cwd. Use the configured Python interpreter (GAMMA_1C_PYTHON; Python 3.10+ with lxml), not PowerShell. Run scripts with explicit absolute project input/output paths; inspect their --help before use. Never modify installed resources or unrelated files. EDT sources can be inspected but these XML generators target Designer XML exports; do not rewrite EDT .mdo as Designer XML. Preserve UUIDs, format version, existing project conventions and unrelated changes. Check XML and BSL after editing. Source validation is not compilation/testing in 1C; building CF/CFE/EPF/ERF and running an infobase needs the separately installed licensed platform. Do not install or launch commercial MCPs or call paid APIs.


### Shipped Python entry points

- `"{{PYTHON}}" "{{SKILLS_ROOT}}/1c-cf-edit/scripts/cf-edit.py" --help`

# /cf-edit - редактирование конфигурации 1С

Точечное редактирование Configuration.xml: свойства, состав ChildObjects, роли по умолчанию.

## Параметры и команда

| Параметр | Описание |
|----------|----------|
| `ConfigPath` | Путь к Configuration.xml или каталогу выгрузки |
| `Operation` | Операция (см. таблицу) |
| `Value` | Значение для операции (batch через `;;`) |
| `DefinitionFile` | JSON-файл с массивом операций |
| `NoValidate` | Пропустить авто-валидацию |



## Операции

| Операция | Формат Value | Описание |
|----------|-------------|----------|
| `modify-property` | `Ключ=Значение` (batch `;;`) | Изменить свойство |
| `add-childObject` | `Type.Name` (batch `;;`) | Зарегистрировать уже существующий файл объекта в ChildObjects. Для создания нового объекта используй `/meta-compile`, `/role-compile`, `/subsystem-compile` - они регистрируют автоматически |
| `remove-childObject` | `Type.Name` (batch `;;`) | Удалить объект из ChildObjects |
| `add-defaultRole` | `Role.Name` или `Name` | Добавить роль по умолчанию |
| `remove-defaultRole` | `Role.Name` или `Name` | Удалить роль по умолчанию |
| `set-defaultRoles` | Имена через `;;` | Заменить список ролей по умолчанию |

Допустимые значения свойств, формат DefinitionFile (JSON), каноничный порядок: [reference.md](reference.md)

## Примеры


