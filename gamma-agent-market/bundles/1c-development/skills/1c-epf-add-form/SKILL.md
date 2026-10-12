---
name: 1c-epf-add-form
description: "Добавить управляемую форму к внешней обработке 1С"
---

## Gamma / OpenCode adaptation

This skill runs inside the selected Gamma 1C profile. Load other shipped skills with the native `skill` tool as `1c-development:<name>`; slash examples are skill references, not installed commands. Only names listed by the native skill tool are installed. Optional upstream skills (for example epf-build, erf-build, cf-load, skd-info or skd-styles) are not part of this bundle; do not call them. Use native read for source inspection, or report the missing capability. Binary build/load commands require the separately installed platform. Use native `read`, `glob`, `grep`, file editing and `bash` tools. Do not invoke Claude-only tools or unavailable commercial services. BSL semantic tools use the connected `gamma-bsl` MCP; its connection must be checked first. If unavailable, report that gap and use the supplied source validators. Never fabricate tool results.

Resource paths below are rendered from the verified installed bundle, independently of the project cwd. Use the configured Python interpreter (GAMMA_1C_PYTHON; Python 3.10+ with lxml), not PowerShell. Run scripts with explicit absolute project input/output paths; inspect their --help before use. Never modify installed resources or unrelated files. EDT sources can be inspected but these XML generators target Designer XML exports; do not rewrite EDT .mdo as Designer XML. Preserve UUIDs, format version, existing project conventions and unrelated changes. Check XML and BSL after editing. Source validation is not compilation/testing in 1C; building CF/CFE/EPF/ERF and running an infobase needs the separately installed licensed platform. Do not install or launch commercial MCPs or call paid APIs.


### Shipped Python entry points

- `"{{PYTHON}}" "{{SKILLS_ROOT}}/1c-epf-add-form/scripts/add-form.py" --help`

# /epf-add-form - Добавление формы

Создает управляемую форму и регистрирует ее в корневом XML обработки.

## Usage

```
/epf-add-form <ProcessorName> <FormName> [Synonym] [--main]
```

| Параметр      | Обязательный | По умолчанию | Описание                                  |
|---------------|:------------:|--------------|-------------------------------------------|
| ProcessorName | да           | -            | Имя обработки (должна существовать)       |
| FormName      | да           | -            | Имя формы                                 |
| Synonym       | нет          | = FormName   | Синоним формы                             |
| --main        | нет          | авто         | Установить как форму по умолчанию (автоматически для первой формы) |
| SrcDir        | нет          | `src`        | Каталог исходников                        |

## Команда



## Что создается

```
<SrcDir>/<ProcessorName>/Forms/
├── <FormName>.xml                    # Метаданные формы (1 UUID)
└── <FormName>/
    └── Ext/
        ├── Form.xml                  # Описание формы (logform namespace)
        └── Form/
            └── Module.bsl           # BSL-модуль с 4 регионами
```

## Что модифицируется

- `<SrcDir>/<ProcessorName>.xml` - добавляется `<Form>` в `ChildObjects`, обновляется `DefaultForm` (автоматически если это первая форма, или явно при `--main`)

## Детали

- FormType: Managed
- UsePurposes: PlatformApplication, MobilePlatformApplication
- AutoCommandBar с id=-1
- Реквизит "Объект" с MainAttribute=true
- BSL-модуль содержит 5 регионов: ОбработчикиСобытийФормы, ОбработчикиСобытийЭлементовФормы, ОбработчикиКомандФормы, ОбработчикиОповещений, СлужебныеПроцедурыИФункции