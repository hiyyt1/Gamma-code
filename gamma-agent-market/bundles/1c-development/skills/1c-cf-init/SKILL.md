---
name: 1c-cf-init
description: "Создать пустую конфигурацию 1С (scaffold XML-исходников). Используй когда нужно начать новую конфигурацию с нуля"
---

## Gamma / OpenCode adaptation

This skill runs inside the selected Gamma 1C profile. Load other shipped skills with the native `skill` tool as `1c-development:<name>`; slash examples are skill references, not installed commands. Only names listed by the native skill tool are installed. Optional upstream skills (for example epf-build, erf-build, cf-load, skd-info or skd-styles) are not part of this bundle; do not call them. Use native read for source inspection, or report the missing capability. Binary build/load commands require the separately installed platform. Use native `read`, `glob`, `grep`, file editing and `bash` tools. Do not invoke Claude-only tools or unavailable commercial services. BSL semantic tools use the connected `gamma-bsl` MCP; its connection must be checked first. If unavailable, report that gap and use the supplied source validators. Never fabricate tool results.

Resource paths below are rendered from the verified installed bundle, independently of the project cwd. Use the configured Python interpreter (GAMMA_1C_PYTHON; Python 3.10+ with lxml), not PowerShell. Run scripts with explicit absolute project input/output paths; inspect their --help before use. Never modify installed resources or unrelated files. EDT sources can be inspected but these XML generators target Designer XML exports; do not rewrite EDT .mdo as Designer XML. Preserve UUIDs, format version, existing project conventions and unrelated changes. Check XML and BSL after editing. Source validation is not compilation/testing in 1C; building CF/CFE/EPF/ERF and running an infobase needs the separately installed licensed platform. Do not install or launch commercial MCPs or call paid APIs.


### Shipped Python entry points

- `"{{PYTHON}}" "{{SKILLS_ROOT}}/1c-cf-init/scripts/cf-init.py" --help`

# /cf-init - Создание пустой конфигурации 1С

Создает scaffold исходников пустой конфигурации 1С: `Configuration.xml`, `Languages/Русский.xml`,
`Ext/ClientApplicationInterface.xml` (раскладка командного интерфейса, на нее ссылается `InternalInfo`
конфигурации).

## Параметры и команда

| Параметр | Описание |
|----------|----------|
| `Name` | Имя конфигурации (обязат.) |
| `Synonym` | Синоним (= Name если не указан) |
| `OutputDir` | Каталог для создания (default: `src`) |
| `Version` | Версия конфигурации |
| `Vendor` | Поставщик |
| `CompatibilityMode` | Режим совместимости (default: `Version8_3_24`) |
| `FormatVersion` | Версия формата выгрузки: `2.17`, `2.18`, `2.20`, `2.21` (default: `2.17`) |

## Версия формата

Версия формата задает, какие теги платформа примет при загрузке. Ставить надо не "поновее", а под ту
платформу, куда конфигурация будет грузиться.

| Версия | Платформа | Что добавляет |
|--------|-----------|---------------|
| `2.17` | 8.3.24 и ниже | базовый набор |
| `2.18` | 8.3.25 | мобильная функциональность `TextToSpeech`, тег `TypeReductionMode` |
| `2.19` | 8.3.26 | своих признаков за версией не закреплено |
| `2.20` | 8.3.27 | то же, что 2.18 |
| `2.21` | 8.5 | пространство имен `pal`, свойства главного окна 8.5, формы `Auxiliary*` |

Полная лестница с отметкой, какие ступени сверены с живой платформой, - в
`docs/1c-configuration-spec.md` (§7.1). Она же эталон для навыков: диапазон правится там.

Грабля: `TextToSpeech` на формате 2.17 ломает загрузку XDTO-ошибкой, поэтому на 2.17 тег не пишется
вовсе. Обратное тоже верно - платформа 8.3.24 не примет выгрузку 2.21.



## Примеры



## Верификация

```
/cf-init TestConfig -OutputDir test-tmp/cf
/cf-info test-tmp/cf          - проверить созданное
/cf-validate test-tmp/cf      - валидировать
```
