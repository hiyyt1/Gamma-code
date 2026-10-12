---
name: 1c-meta-validate
description: "Валидация объекта метаданных 1С. Используй после создания или модификации объекта конфигурации для проверки корректности"
---

## Gamma / OpenCode adaptation

This skill runs inside the selected Gamma 1C profile. Load other shipped skills with the native `skill` tool as `1c-development:<name>`; slash examples are skill references, not installed commands. Only names listed by the native skill tool are installed. Optional upstream skills (for example epf-build, erf-build, cf-load, skd-info or skd-styles) are not part of this bundle; do not call them. Use native read for source inspection, or report the missing capability. Binary build/load commands require the separately installed platform. Use native `read`, `glob`, `grep`, file editing and `bash` tools. Do not invoke Claude-only tools or unavailable commercial services. BSL semantic tools use the connected `gamma-bsl` MCP; its connection must be checked first. If unavailable, report that gap and use the supplied source validators. Never fabricate tool results.

Resource paths below are rendered from the verified installed bundle, independently of the project cwd. Use the configured Python interpreter (GAMMA_1C_PYTHON; Python 3.10+ with lxml), not PowerShell. Run scripts with explicit absolute project input/output paths; inspect their --help before use. Never modify installed resources or unrelated files. EDT sources can be inspected but these XML generators target Designer XML exports; do not rewrite EDT .mdo as Designer XML. Preserve UUIDs, format version, existing project conventions and unrelated changes. Check XML and BSL after editing. Source validation is not compilation/testing in 1C; building CF/CFE/EPF/ERF and running an infobase needs the separately installed licensed platform. Do not install or launch commercial MCPs or call paid APIs.


### Shipped Python entry points

- `"{{PYTHON}}" "{{SKILLS_ROOT}}/1c-meta-validate/scripts/meta-validate.py" --help`

# /meta-validate - валидация объекта метаданных 1С

Проверяет XML объекта метаданных из выгрузки конфигурации на структурные ошибки.

## Параметры

| Параметр   | Обяз. | Умолч. | Описание                                      |
|------------|:-----:|---------|-------------------------------------------------|
| ObjectPath | да    | -       | Путь к XML-файлу или каталогу. Через `\|` для batch |
| Detailed   | нет   | -       | Подробный вывод (все проверки, включая успешные) |
| MaxErrors  | нет   | 30      | Остановиться после N ошибок (per object)        |
| OutFile    | нет   | -       | Записать результат в файл (UTF-8 BOM)           |
| IndexPath  | нет   | -       | Индекс конфигурации от `1c-config-index`: включает сверку ссылочных типов с остальной конфигурацией |

## Команда



## Сверка ссылочных типов (проверка 16)

Реквизит с типом `CatalogRef.Контрагенты` при отсутствующем справочнике проходил валидацию: объект
проверялся сам по себе. Проверка 16 закрывает это - она сверяет типы реквизитов, измерений,
ресурсов, реквизитов табличных частей и значение самого объекта с тем, что есть в конфигурации.

Два источника ответа:

- **`-IndexPath`** - индекс от навыка `1c-config-index`. Точный ответ: индекс несет ВСЕ порождаемые
  типы конфигурации, включая `Characteristic.ВидыСубконто` и `DefinedType.МойТип`. Строится один раз
  на прогон, поэтому годится для проверки всей конфигурации подряд.
- **Без него** - резерв: объект ищется файлом в каталоге конфигурации. Для одного объекта дешево, на
  всей конфигурации - обход каталога на каждую ссылку.

Нет ни того, ни другого (одиночный файл вне выгрузки) - проверка не выполняется и прямо об этом
сообщает. Молчать нельзя: молчание читалось бы как "нарушений нет".

Тяжесть всегда предупреждение, не ошибка. Проверяется ОДИН объект, и валидатор не знает, полна ли
выгрузка: файл могли достать из конфигурации побольше. В расширении и у заимствованного объекта
(`ObjectBelonging = Adopted`) формулировка мягче - там ссылка на основную конфигурацию нормальна.

Ссылочный тип узнается по форме имени: часть до первой точки кончается на `Ref` либо это
`Characteristic` или `DefinedType`. Прочее с точкой не трогается - ложное срабатывание дороже
пропуска.

```bash
"{{PYTHON}}" {{SKILLS_ROOT}}/1c-config-index/scripts/config-index.py -ConfigPath src -OutFile .cache/index.json
"{{PYTHON}}" {{SKILLS_ROOT}}/1c-meta-validate/scripts/meta-validate.py -ObjectPath src/Catalogs/Контрагенты.xml -IndexPath .cache/index.json
```
