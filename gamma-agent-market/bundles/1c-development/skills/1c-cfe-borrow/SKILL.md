---
name: 1c-cfe-borrow
description: "Заимствование объектов из конфигурации 1С в расширение (CFE). Используй когда нужно перехватить метод, изменить форму или добавить реквизит к существующему объекту конфигурации"
---

## Gamma / OpenCode adaptation

This skill runs inside the selected Gamma 1C profile. Load other shipped skills with the native `skill` tool as `1c-development:<name>`; slash examples are skill references, not installed commands. Only names listed by the native skill tool are installed. Optional upstream skills (for example epf-build, erf-build, cf-load, skd-info or skd-styles) are not part of this bundle; do not call them. Use native read for source inspection, or report the missing capability. Binary build/load commands require the separately installed platform. Use native `read`, `glob`, `grep`, file editing and `bash` tools. Do not invoke Claude-only tools or unavailable commercial services. BSL semantic tools use the connected `gamma-bsl` MCP; its connection must be checked first. If unavailable, report that gap and use the supplied source validators. Never fabricate tool results.

Resource paths below are rendered from the verified installed bundle, independently of the project cwd. Use the configured Python interpreter (GAMMA_1C_PYTHON; Python 3.10+ with lxml), not PowerShell. Run scripts with explicit absolute project input/output paths; inspect their --help before use. Never modify installed resources or unrelated files. EDT sources can be inspected but these XML generators target Designer XML exports; do not rewrite EDT .mdo as Designer XML. Preserve UUIDs, format version, existing project conventions and unrelated changes. Check XML and BSL after editing. Source validation is not compilation/testing in 1C; building CF/CFE/EPF/ERF and running an infobase needs the separately installed licensed platform. Do not install or launch commercial MCPs or call paid APIs.


### Shipped Python entry points

- `"{{PYTHON}}" "{{SKILLS_ROOT}}/1c-cfe-borrow/scripts/cfe-borrow.py" --help`

# /cfe-borrow - Заимствование объектов из конфигурации

Заимствует объекты из основной конфигурации в расширение. Создает XML-файлы с `ObjectBelonging=Adopted` и `ExtendedConfigurationObject`, добавляет запись в ChildObjects расширения.

## Предусловие

Расширение должно быть создано (`/cfe-init`) и содержать валидный `Configuration.xml`.

### Авто-определение ConfigPath

Если пользователь не указал `-ConfigPath` - попробуй определить автоматически:
1. Прочитай `.v8-project.json` из корня проекта
2. Разреши целевую базу (по имени, ветке или `default` - алгоритм из `/db-list`)
3. Если у базы есть поле `configSrc` - используй как `-ConfigPath`
4. Если `configSrc` нет - спроси у пользователя

## Параметры

| Параметр | Описание |
|----------|----------|
| `ExtensionPath` | Путь к каталогу расширения (обязат.) |
| `ConfigPath` | Путь к конфигурации-источнику (обязат.) |
| `Object` | Что заимствовать (обязат.), batch через `;;` |
| `BorrowMainAttribute` | Заимствовать основной реквизит формы. Без параметра - не заимствует. `Form` - реквизиты, используемые на форме. `All` - все реквизиты объекта. Требует форму в -Object |

## Формат -Object

- `Catalog.Контрагенты` - справочник
- `CommonModule.РаботаСФайлами` - общий модуль
- `Document.РеализацияТоваров` - документ
- `Enum.ВидыОплат` - перечисление
- `Catalog.Контрагенты.Form.ФормаЭлемента` - форма объекта (заимствование формы)
- `Catalog.X ;; CommonModule.Y ;; Enum.Z` - несколько объектов
Поддерживаются все 44 типа объектов конфигурации.

### Заимствование форм

Формат `Тип.Имя.Form.ИмяФормы` заимствует форму конкретного объекта. Если родительский объект еще не заимствован - он будет заимствован автоматически.

Создается:
1. **Метаданные формы** - `Forms/ИмяФормы.xml` с `ObjectBelonging=Adopted`, `FormType=Managed`
2. **Form.xml** - `Forms/ИмяФормы/Ext/Form.xml` с копией исходной формы + `<BaseForm>` (начальное состояние)
3. **Module.bsl** - пустой файл `Forms/ИмяФормы/Ext/Form/Module.bsl`
4. **Регистрация** - `<Form>` в ChildObjects родительского объекта

### Заимствование основного реквизита формы (-BorrowMainAttribute)

**Когда нужно**: пользователь хочет добавить новый реквизит в существующий объект конфигурации и вывести его на заимствованную форму. Без `-BorrowMainAttribute` форма заимствуется "пустой" - только визуальные элементы, без привязки к данным объекта. С `-BorrowMainAttribute` форма сохраняет привязки к реквизитам объекта (DataPath), что позволяет затем добавить на нее новые элементы через `/form-edit`.

**Два режима**:
- `Form` (по умолчанию) - заимствует только те реквизиты объекта, которые уже выведены на форму. Оптимальный выбор для большинства случаев
- `All` - заимствует все реквизиты и табличные части объекта. Используй если планируешь выводить на форму реквизиты, которых на ней еще нет

**Типовой сценарий** (добавление реквизита + вывод на форму):
1. `/cfe-borrow` с `-BorrowMainAttribute` - заимствовать форму с реквизитами
2. `/meta-edit` - добавить новый реквизит в объект расширения
3. `/form-edit` - вывести реквизит на заимствованную форму

**Защита существующих данных**: если зависимый объект уже заимствован с содержимым (реквизитами, формами) - скрипт не перезаписывает его, а добавляет только недостающее.

## Команда



## Примеры



## Верификация

```
/cfe-validate <ExtensionPath>
```

