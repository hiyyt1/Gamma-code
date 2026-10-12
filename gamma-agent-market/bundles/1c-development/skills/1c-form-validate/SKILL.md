---
name: 1c-form-validate
description: "Валидация управляемой формы 1С. Используй после создания или модификации формы для проверки корректности. При наличии BaseForm автоматически проверяет callType и ID расширений"
---

## Gamma / OpenCode adaptation

This skill runs inside the selected Gamma 1C profile. Load other shipped skills with the native `skill` tool as `1c-development:<name>`; slash examples are skill references, not installed commands. Only names listed by the native skill tool are installed. Optional upstream skills (for example epf-build, erf-build, cf-load, skd-info or skd-styles) are not part of this bundle; do not call them. Use native read for source inspection, or report the missing capability. Binary build/load commands require the separately installed platform. Use native `read`, `glob`, `grep`, file editing and `bash` tools. Do not invoke Claude-only tools or unavailable commercial services. BSL semantic tools use the connected `gamma-bsl` MCP; its connection must be checked first. If unavailable, report that gap and use the supplied source validators. Never fabricate tool results.

Resource paths below are rendered from the verified installed bundle, independently of the project cwd. Use the configured Python interpreter (GAMMA_1C_PYTHON; Python 3.10+ with lxml), not PowerShell. Run scripts with explicit absolute project input/output paths; inspect their --help before use. Never modify installed resources or unrelated files. EDT sources can be inspected but these XML generators target Designer XML exports; do not rewrite EDT .mdo as Designer XML. Preserve UUIDs, format version, existing project conventions and unrelated changes. Check XML and BSL after editing. Source validation is not compilation/testing in 1C; building CF/CFE/EPF/ERF and running an infobase needs the separately installed licensed platform. Do not install or launch commercial MCPs or call paid APIs.


### Shipped Python entry points

- `"{{PYTHON}}" "{{SKILLS_ROOT}}/1c-form-validate/scripts/form-validate.py" --help`

# /form-validate - валидация управляемой формы 1С

Проверяет Form.xml на структурные ошибки: уникальность ID, наличие companion-элементов, корректность ссылок DataPath и команд. `version` в Form.xml и в BaseForm сверяется с дескриптором: Configuration.xml конфигурации или расширения, либо корневой XML внешней обработки.

## Параметры

| Параметр  | Обяз. | Умолч. | Описание                                |
|-----------|:-----:|---------|-----------------------------------------|
| FormPath  | да    | -       | Путь к файлу Form.xml                   |
| Detailed  | нет   | -       | Подробный вывод (все проверки, включая успешные) |
| MaxErrors | нет   | 30      | Остановиться после N ошибок              |
| IndexPath | нет   | -      | Индекс конфигурации от `1c-config-index`: включает сверку путей данных с объектом-владельцем |

## Команда



## Сверка путей данных с объектом-владельцем (проверка 13)

Проверка 5 убеждается, что КОРЕНЬ пути данных - существующий реквизит формы. Дальше путь не
разбирался вовсе: `Объект.ИНН` при отсутствующем `ИНН` у справочника проходил молча, потому что
валидатор ничего не знал про конфигурацию.

С `-IndexPath` он узнает. Владелец определяется по ТИПУ реквизита формы (`cfg:CatalogObject.Контрагенты`),
а не по пути файла: так работает и для формы записи регистра, и для формы, лежащей не там, где
принято. Дальше сверяются вторая часть пути (реквизит, табличная часть, измерение, ресурс,
стандартный реквизит) и третья (колонка табличной части).

Чего проверка НЕ делает намеренно:

- реквизит формы составного типа пропускается - путь может вести в любой из типов;
- реквизит типа `DynamicList` или `ValueTable` пропускается: его состав задается запросом или
  колонками формы, а не метаданными;
- объект без блока `StandardAttributes` пропускается целиком, иначе любой `Объект.Code` был бы
  объявлен несуществующим;
- дальше третьей части путь не разбирается - навигация по ссылке потребовала бы разрешать типы
  цепочкой.

Тяжесть - предупреждение. Проверка новая и кросс-объектная, а ложное срабатывание в валидаторе
дороже пропуска: тот, кто однажды получил ложную ошибку, отключает проверку целиком.

Стандартные реквизиты в путях данных пишутся внутренними английскими именами (`Объект.Description`,
`Объект.Code`, `Запись.Period`) - индекс отдает их ровно в таком виде, потому что берет из блока
`StandardAttributes` самой выгрузки.

```bash
"{{PYTHON}}" {{SKILLS_ROOT}}/1c-config-index/scripts/config-index.py -ConfigPath src -OutFile .cache/index.json
"{{PYTHON}}" {{SKILLS_ROOT}}/1c-form-validate/scripts/form-validate.py -FormPath src/Catalogs/Контрагенты/Forms/ФормаЭлемента -IndexPath .cache/index.json
```
