---
name: 1c-bsl-validate
description: "Проверка вызовов общих модулей в BSL по выгрузке конфигурации - существует ли модуль и экспортный ли у него метод; режим -Catalog - текстовый lint модулей по каталогу дефектов (транзакции, запросы, сообщения пользователю). Работает без платформы, по индексу от 1c-config-index"
---

## Gamma / OpenCode adaptation

This skill runs inside the selected Gamma 1C profile. Load other shipped skills with the native `skill` tool as `1c-development:<name>`; slash examples are skill references, not installed commands. Only names listed by the native skill tool are installed. Optional upstream skills (for example epf-build, erf-build, cf-load, skd-info or skd-styles) are not part of this bundle; do not call them. Use native read for source inspection, or report the missing capability. Binary build/load commands require the separately installed platform. Use native `read`, `glob`, `grep`, file editing and `bash` tools. Do not invoke Claude-only tools or unavailable commercial services. BSL semantic tools use the connected `gamma-bsl` MCP; its connection must be checked first. If unavailable, report that gap and use the supplied source validators. Never fabricate tool results.

Resource paths below are rendered from the verified installed bundle, independently of the project cwd. Use the configured Python interpreter (GAMMA_1C_PYTHON; Python 3.10+ with lxml), not PowerShell. Run scripts with explicit absolute project input/output paths; inspect their --help before use. Never modify installed resources or unrelated files. EDT sources can be inspected but these XML generators target Designer XML exports; do not rewrite EDT .mdo as Designer XML. Preserve UUIDs, format version, existing project conventions and unrelated changes. Check XML and BSL after editing. Source validation is not compilation/testing in 1C; building CF/CFE/EPF/ERF and running an infobase needs the separately installed licensed platform. Do not install or launch commercial MCPs or call paid APIs.


### Shipped Python entry points

- `"{{PYTHON}}" "{{SKILLS_ROOT}}/1c-bsl-validate/scripts/bsl-validate.py" --help`

# /bsl-validate - вызовы общих модулей против выгрузки, lint по каталогу дефектов

Отвечает на один вопрос: вызванный метод общего модуля вообще существует и экспортный ли он.
Переименовали метод или сняли `Экспорт` - вызовы в других модулях об этом не узнают до запуска.

Работает без EDT, без платформы и без базы. Синтаксис BSL этот навык НЕ проверяет - для синтаксиса
есть отдельный сервер `1c-syntax-checker-mcp`.

Второй режим - `-Catalog`: текстовый lint модулей по каталогу дефектов скила `1c-code-review`
(раздел ниже).

## Параметры

| Параметр      | Обяз. | Умолч. | Описание                                                       |
|---------------|:-----:|--------|-----------------------------------------------------------------|
| ModulePath    | да    | -      | Файл `.bsl` либо каталог - тогда обходится рекурсивно            |
| IndexPath     | да    | -      | Индекс от `1c-config-index`                                      |
| UnknownCalls  | нет   | -      | Дополнительно искать вызовы неизвестных имен (только общие модули) |
| Detailed      | нет   | -      | Показать счетчики даже когда есть замечания                      |
| MaxErrors     | нет   | 30     | Не выводить больше N замечаний                                   |

## Команда

```bash
"{{PYTHON}}" {{SKILLS_ROOT}}/1c-config-index/scripts/config-index.py -ConfigPath src -OutFile .cache/index.json
"{{PYTHON}}" {{SKILLS_ROOT}}/1c-bsl-validate/scripts/bsl-validate.py -ModulePath src -IndexPath .cache/index.json
```



## Основная проверка: метод общего модуля

Вызов вида `ОбщиеФункции.Метод()`, где `ОбщиеФункции` есть в индексе среди общих модулей,
проверяется точно: метод обязан быть в списке экспортных. Ложных срабатываний тут нет - левая часть
однозначно опознана как общий модуль по имени из конфигурации.

Работает в ЛЮБЫХ модулях: формы, объекта, менеджера, общего.

Список экспортных методов индекс собирает разбором `Ext/Module.bsl` с вырезанными строчными
комментариями. Закомментированная процедура призраком в список не попадет.

## Дополнительная проверка: неизвестные имена (флаг `-UnknownCalls`)

Ищет `Имя.Метод()`, где `Имя` не объявлено в модуле, не общий модуль и не глобальная коллекция
платформы. Так ловится вызов УДАЛЕННОГО общего модуля.

Проверка идет **только в общих модулях** и **только по флагу**. Причина простая: у общего модуля
список доступных имен замкнут - все, что не локальная переменная, параметр или глобальная
коллекция, обязано быть общим модулем. У модуля формы или объекта это не так: `Дерево.ПолучитьЭлементы()`
обращается к реквизиту формы, который нигде не объявлен, и такая проверка выдала бы ложное
срабатывание на каждый реквизит.

Локальными считаются: `Перем`, параметры процедур и функций (включая значения по умолчанию), цели
присваиваний, переменные циклов `Для` и `Для Каждого`.

Список глобальных коллекций платформы в навыке заведомо НЕПОЛНЫЙ - их сотни. Именно поэтому
проверка и включается флагом: с ним она полезна, без него ничего не портит.

## Чего НЕ проверяется

Это не компилятор BSL. Без платформы недоступны типы выражений, число и типы параметров вызова,
директивы компиляции, доступность метода с клиента или сервера.

Намеренно пропускается:

- **цепочки** - в `Справочники.Номенклатура.СоздатьЭлемент()` корнем считается `Справочники`,
  а не `Номенклатура`;
- **вызов через переменную** - если имя объявлено в модуле, оно не трогается;
- **строковые литералы и комментарии** вырезаются до разбора: тексты запросов внутри строк полны
  точек, иначе каждая вторая строка запроса стала бы вызовом.

Все замечания - предупреждения, код возврата всегда 0. Это самый шумный класс проверок из всех,
что можно сделать по выгрузке, и ошибка тут дороже пропуска.

## Режим каталога дефектов (-Catalog)

Триггеры: нужен быстрый текстовый прогон модулей по каталогу дефектов - перед ревью, в
конфигурации без EDT, в конвейере после правок. Вход - файл `.bsl` или каталог (обход
рекурсивный); индекс конфигурации НЕ нужен. Правила - реестр
`scripts/catalog-rules.json` рядом со скриптом: массив объектов `id`, `title`, `kind`
(`regex` - паттерн по строкам модуля, `query-regex` - по тексту запросного литерала
целиком с номером строки по смещению совпадения, `structure` - многошаговая проверка).
Идентификатор правила равен идентификатору карточки
каталога дефектов; фикстуры карточек (`tests/catalog/<ИД>`) задают ожидаемые строки.

```bash
"{{PYTHON}}" {{SKILLS_ROOT}}/1c-bsl-validate/scripts/bsl-validate.py -ModulePath src -Catalog
"{{PYTHON}}" {{SKILLS_ROOT}}/1c-bsl-validate/scripts/bsl-validate.py -ModulePath src -Catalog -RuleId TXN-01 -Json
```

| Параметр  | Обяз. | Описание                                            |
|-----------|:-----:|-----------------------------------------------------|
| Catalog   | да    | Включить режим lint по каталогу                      |
| RuleId    | нет   | Выполнить только правило карточки с этим идентификатором |
| Json      | нет   | Печатать только JSON вместо таблицы                  |

Выход: таблица находок `[<ИД>] <файл>:<строка>  <фрагмент>` и итог (порядок находок -
файл, строка, идентификатор); последняя строка
`EVIDENCE {...}` - компактный JSON одной строкой (разделители без пробелов) с полями
`check` (всегда `bsl_validate@configurator`),
`ids`, `inputHash` (полный sha256 входа, 64 hex), `status` (`pass` - находок нет,
`findings` - находки есть), `findings` (находки с `id`, `file`, `line`, `match`) для
писателя следа; оба порта (Python и PowerShell) дают одинаковую строку байт в байт.
Пример:
`EVIDENCE {"check":"bsl_validate@configurator","ids":["TXN-01"],"inputHash":"<64 hex>","status":"findings","findings":[...]}`.
Коды выхода:
0 - находок нет, 1 - есть находки, 2 - ошибка вызова (нет пути, битый реестр).

Ограничения: только текстовые признаки без семантики - типов выражений, областей видимости
и разрешенных имен здесь нет. Находка - предупреждение с отсылкой к карточке каталога, а не
приговор: часть правил ловит и законные формы (например, ОБЪЕДИНИТЬ без ВСЕ при ожидаемых
дубликатах), финальное решение за карточкой и ревьюером.

## Связанные навыки

- `1c-config-index` - строит индекс, без него проверка не работает
- `1c-query-validate` - проверка текста запроса по той же выгрузке
- `1c-cfe-patch-method` - перехват метода в расширении
