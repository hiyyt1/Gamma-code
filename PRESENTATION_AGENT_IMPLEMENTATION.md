# Создатель презентаций — реализация Gamma

## 1. Архитектура

Профиль `presentation-creator` находится в существующем Agent Market, категория `business`, подкатегория «Бизнес / Документы и презентации». Выбор сохраняется существующим `AgentMarketService` в привязке к директории проекта. Конфигурации и ресурсы защищены существующими SHA-256 manifests.

Проверенная текущая интеграция Market работает через **OpenCode V1**. Используются существующие SessionPrompt, ToolRegistry, permissions, TaskTool и provider registry. V2 SessionRunner, протокол выполнения и история сессий не изменялись. Второй чат, авторский LLM runner и отдельный оркестратор не созданы.

Основные файлы:

- `packages/opencode/src/presentation/`: schemas, файловые операции, HTML conversion, PptxGenJS, office-kit, импорт данных, render/review/finalize, MCP и vision adapter.
- `gamma-agent-market/profiles/presentation-*.json`: главный агент и четыре помощника.
- `gamma-agent-market/bundles/presentation-creation/`: навыки, контракты и provenance.
- `packages/app/src/components/presentation-preview.tsx`: предпросмотр в существующей файловой панели.

## 2. Исследованные репозитории и выбор

Полные commit pins и реально использованные файлы: `gamma-agent-market/bundles/presentation-creation/sources.json`.

| Проект | Зафиксированная версия / commit | Лицензия | Использование |
|---|---|---|---|
| [PPTAgent Skill](https://github.com/icip-cas/PPTAgent/tree/833cda553b343be0e486a93b0b57cac962cdd566/skills/pptagent) | `833cda553b343be0e486a93b0b57cac962cdd566` | MIT для skill | Основной творческий workflow: host authoring → HTML → editable export → slide/deck review → finalize |
| [PptxGenJS](https://github.com/gitbrent/PptxGenJS/tree/3c9ec1b687c174952166f6a34b5e87ebf69fa469) | npm `4.0.1` | MIT | Нативные текст, shapes, таблицы, диаграммы, изображения, notes |
| [office-kit/pptx](https://github.com/office-kit/pptx/tree/141a7b01cc768f2362163d7a1154625bf7e045b8) | npm `0.22.0` | MIT | Чтение, инспекция, диапазоны текста, изображения, геометрия, диаграммы, copyShape, сохранение и валидация |
| [Presentation Skill](https://github.com/PoplarPoplar/presentation-skill_-PPTskill/tree/3a22eed290fa2205b6a1e2de5549b4429c5fffd0) | `3a22eed290fa2205b6a1e2de5549b4429c5fffd0` | MIT | Идеи source-first outline, evidence/planning artifacts и QA; код не включён |
| [slides-skill](https://github.com/Rich627/slides-skill/tree/db697da83e97c4498e9ea1d2abbab7869308534c) | `db697da83e97c4498e9ea1d2abbab7869308534c` | MIT | Исследованы narrative/slide types; не установлен |
| [ninehills pptx-generator](https://github.com/ninehills/skills/tree/f3e82a7e2bfbed54fc2b4a715a1986f5f467e827/pptx-generator) | `f3e82a7e2bfbed54fc2b4a715a1986f5f467e827` | Skill декларирует MIT; общая лицензия repo не установлена | Только исследование; файлы не распространяются |
| [Presenton](https://github.com/presenton/presenton/tree/7376573fb30e4faf6225ff77d2cc74d06634b2e0) | `7376573fb30e4faf6225ff77d2cc74d06634b2e0` | Apache-2.0 | Исследован как самостоятельное приложение; не установлен, чтобы не дублировать Gamma |

При исследовании office-kit main был `0.24.0`, но установлен `0.22.0`: он проходит действующее ограничение возраста npm-релизов репозитория. Тесты выполняются именно с установленной версией.

### Отличие от upstream PPTAgent

Upstream Skill сам рекомендует host authoring без второго авторского агента. Его Python CLI содержит `review-slides`, `review-deck`, `finalize`; Visual MCP предоставляет `review_slides`/`review_deck` для text-only host. Converter берётся из `pptagent==1.1.37` / `deeppresenter.utils.webview`; зависимости включают Python Playwright, Pillow, PyMuPDF, FastMCP, PyYAML и Node runtime.

У старого `html2pptx.js` есть указание на происхождение из Anthropic Skills, а вложенный package.json указывает ISC, при MIT в корне PPTAgent. Его код **не скопирован** и не распространяется под предположением об общей MIT-лицензии. В Gamma адаптированы workflow и task contract; используется собственный небольшой HTML→нативные объекты converter на Playwright + PptxGenJS. Это **адаптация PPTAgent Skill, не установка полного upstream Python runtime**. Upstream `install.py` не запускался.

## 3. Зависимости и лицензии

Прямые npm-зависимости OpenCode закреплены точно: `pptxgenjs@4.0.1`, `@office-kit/pptx@0.22.0`, `fflate@0.8.3`, `playwright@1.59.1`; разрешённые транзитивные версии фиксируются `bun.lock`.

`dependency-licenses.json` содержит аудит их установленного dependency graph: MIT, ISC, Apache-2.0, Zlib; для JSZip используется разрешённая MIT-ветвь dual license. При распространении сохраняйте LICENSE/NOTICE соответствующих npm-пакетов. Chromium имеет собственный набор third-party notices. Python-экстрактор использует только стандартную библиотеку. Шрифты, стоковые изображения и чужие шаблоны в продукт не добавлялись.

## 4. Skills

Подключаются **8** навыков только к этому профилю/его помощникам:

1. `pptagent` — общий жизненный цикл, маршрутизация, контракт HTML и delivery gate.
2. `presentation-planning` — аудитория, цель, план, требования и outline schema.
3. `presentation-storytelling` — деловые, инвестиционные, коммерческие и обучающие сценарии.
4. `presentation-design` — композиция, типографика; Editorial Minimal, Business Consulting, Tech Premium, Visual Storytelling, Corporate, Data-driven как направления, а не фиксированные макеты.
5. `presentation-data` — детерминированные расчёты, источники и выбор диаграмм.
6. `presentation-branding` — фактические шрифты/цвета/canvas из шаблона, сохранение оформления.
7. `presentation-pptx-editing` — объектные правки и проверки сохранности.
8. `presentation-visual-qa` — дефекты, повторный рендер, ограничения и окончательная проверка.

PPTAgent не дублирует семь предметных навыков: он задаёт общий workflow и инструментальный контракт. Ресурсы доступны через существующий native skill tool. Глобальные skills других агентов не изменены.

## 5. MCP и инструменты

`gamma-presentation` подключается через существующий MCP manager с `InMemoryTransport`; отдельный процесс MCP не нужен. На смене профиля клиент закрывается, перед/после операций проверяется актуальная привязка проекта.

Инструменты: `health`, `create`, `ingest`, `inspect`, `write_source`, `aggregate`, `build`, `edit`, `redesign_slide`, `render`, `review_slides`, `review_deck`, `finalize`, `status`.

Это конкретные файловые/вычислительные действия. MCP не управляет ходом диалога и не вызывает следующий шаг сам; шаги выбирает существующий OpenCode агент. На workspace действует исключение одновременных операций. Рендеры в одном процессе сервера выполняются по одному; при занятости возвращается явная ошибка.

`write_source` принимает либо полный `content`, либо `edit: {find, replace}` для точной уникальной замены в существующем исходнике. Неоднозначная замена и невалидный JSON отклоняются до записи. Это позволяет исправлять короткий текст без повторной генерации большого outline; операция не даёт доступа к QA или экспортам.

`create.brief` сохраняет исходный запрос для проверки фактов. Vision получает его вместе с рассчитанными datasets; при отсутствии источников неподтверждённые бюджеты, результаты и численность команды должны отмечаться как ошибки данных.

Бюджет QA считается по уникальным hash экспортированного PPTX, а не по количеству вызовов инструментов: `review_slides` + `review_deck` одной версии составляют один цикл. Повторный вызов для той же версии возвращает сохранённый результат; нельзя переоценивать неизменённую неудачную версию до случайного одобрения. Отчёты сохраняются и по revision, а старые manifests мигрируют с сохранением исторического бюджета. Три последовательные ошибки endpoint также останавливают повторные запросы.

После трёх проверенных версий без успешного завершения `build`/`edit`/`redesign_slide` отклоняют дальнейший экспорт: нужно вернуть непроверенный черновик с замечаниями. У успешно финализированной презентации следующая пользовательская правка начинает новый бюджет.

## 6. Subagents и permissions

`presentation-researcher`, `presentation-storyteller`, `presentation-designer`, `presentation-reviewer` зарегистрированы как скрытые native subagent profiles. Фактические имена TaskTool имеют префикс `gamma-`.

Главный агент вызывает TaskTool, передаёт конкретные исходники/выходы и сериализует писателей. Researcher получает импорт/инспекцию/расчёты и запись результатов исследования; storyteller — исходники; designer — сборку/редактирование/рендер; reviewer — инспекцию/рендер/vision review. Bash и произвольные сетевые tools запрещены. Помощники не могут создавать собственных помощников. Запись исходников выполняется через `write_source`: workspace + имя файла, без возможности выйти из sources/. Native write/edit не предоставляются. Оригиналы, данные, история, отчёты и `answer.*` изменяются только инструментами сервиса. Vision tools доступны reviewer, поэтому главный агент обязан делегировать ревью через TaskTool.

Существующие ограничения проекта и платформы пересекаются с профилем, а не обходятся им. В marketAgent сохранены настройки модели профиля/проектного agent config; это позволяет назначить reviewer отдельную настроенную модель.

## 7. Три маршрута

**A — с нуля:** brief → story → HTML sources → собственный converter адаптированного PPTAgent workflow → PptxGenJS native objects → настоящий PPTX render → vision → исправления → finalize. Canvas HTML: 1280×720, статический локальный CSS, размеченные простые элементы `data-pptx`. Произвольные scripts, remote resources, SVG/canvas, gradients, nested formatting и неподдержанная геометрия не исполняются и не скрываются растеризацией.

**B — по данным:** исходный CSV/XLSX копируется в originals, Python считает Decimal-суммы по колонкам; сохраняются точные значения, колонки, hash источника. Диаграмма ссылается на dataset ID, числовые массивы от LLM не принимаются. Перед сборкой/правкой диаграмм данные вычисляются заново. XLSX с формулами требует values-only export: устаревший cached value не выдаётся за факт. Дополнительные вычисления требуют воспроизводимого источника, а не умственного расчёта LLM.

**C — редактирование:** ingest → inspect IDs → office-kit range/image/bounds/chart edit → перенос только выбранного слайда и его эксклюзивных зависимостей в исходный ZIP → preservation report → render/review. Для превращения одного слайда в схему `redesign_slide` принимает одно-слайдовый outline с тем же canvas и копирует native shapes через office-kit. Неизвестные/анимированные объекты выбранного слайда блокируют его полную замену; полный редизайн допускается в отдельном файле с инвентаризацией содержания.

## 8. Системные зависимости и лимиты

`health` проверяет LibreOffice, `pdftoppm`, `pdftotext`, Python 3, `fc-match`, Chromium и image capability провайдера. Наличие программы не равно успешному открытию документа: последнее проверяется самим render.

Лимиты: 40 слайдов; 50 MiB на вход; 200 MiB распакованного ZIP, 10 000 entries, до 16 MiB на XML part при импорте DOCX/XLSX; 80 объектов на слайд; 50 000 строк данных, 200 колонок, 100 категорий; Decimal с точностью 50 знаков, до 20 дробных знаков в исходных числах; до трёх циклов QA и трёх последовательных ошибок vision endpoint; subprocess timeouts и ограниченный вывод. LibreOffice получает отдельный временный профиль. ActiveX/VBA/бинарные активные вложения и внешние ресурсные связи запрещены для рендера; hyperlinks не загружаются как ресурсы. Макросы и Excel-формулы не выполняются.

На production ограничьте процесс серверным cgroup/container по RAM/CPU и запретите renderer доступ к сети. Код не устанавливает тяжёлые программы автоматически и не создаёт распределённую очередь.

## 9. Vision

Vision использует существующий `Provider.Service.getModel/getLanguage`, совместимый endpoint и уже настроенные credentials. Выбор: `GAMMA_PRESENTATION_VISION_MODEL` → `agent.gamma-presentation-reviewer.model` → `config.model` → default provider model. Формат: `providerID/modelID`.

В модели нужно явно указать `modalities.input: ["text", "image"]`. Пример добавления к существующему провайдеру:

```json
{
  "provider": {
    "local": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://vision-host:8000/v1" },
      "models": {
        "vision-model": {
          "name": "Vision reviewer",
          "modalities": { "input": ["text", "image"], "output": ["text"] },
          "limit": { "context": 128000, "output": 5000 }
        }
      }
    }
  },
  "agent": { "gamma-presentation-reviewer": { "model": "local/vision-model" } }
}
```

Параметры модели (`options`, включая поддерживаемое провайдером ограничение reasoning) передаются через существующий ProviderTransform. Обрезанный/пустой ответ отклоняется. Это пример конфигурации, не установка модели и не скрытая регистрация платного API. Ключи задаются обычным механизмом Gamma, не в source artifacts. Capabilities проверяются перед inference. Отказ, таймаут, невалидный JSON или отсутствие image input не дают успешного QA. Статус `ready` требует успешных hash-bound результатов обоих видов review. Доступной бесплатной локальной vision-модели достаточно; конкретный коммерческий сервис не обязателен.

## 10. Артефакты

```text
presentation-<uuid>/
  originals/                 копии входных файлов
  sources/                   brief, story, outline, HTML, журнал объектных правок
  data/                      рассчитанные datasets и provenance
  assets/                    изображения и ресурсы
  history/                   предыдущие PPTX и compiled outline revisions
  renders/<pptx-sha256>/      PNG всех экспортированных слайдов
  qa/                        structure, preservation, slide/deck reviews, final report
  answer.pptx
  answer.pdf
  answer.presentation.json   текущий revision/status, ссылки и hashes
```

Файлы записываются через временный файл и rename. Изменение исходников, данных, ресурсов или экспортированного PPTX делает старый finalization непригодным. Последующие запросы используют тот же workspace. Изображения являются отдельными объектами, текст/shapes/charts остаются нативными; абсолютная редактируемость каждого пикселя не обещается.

## 11. Предпросмотр Gamma

Открытие `answer.pptx` или `answer.presentation.json` в существующей файловой панели показывает слайды, миниатюры, номер/общее количество, клавиши ←/→, полноэкранный режим, статус, ошибки и скачивание PPTX/PDF. Manifest обновляется опросом раз в 3 секунды; PNG имеют hash-based пути, поэтому правка не остаётся в старом browser cache.

Используются существующие session/project bindings и read-only content API. Добавлен authenticated download endpoint `/product/session/:sessionID/download?path=...` с теми же проверками путей и symlink boundaries, без общего public file server. Данные HTML не исполняются в веб-интерфейсе. Презентации открываются в preview, а не во втором редакторе. Термины русской локализации сверены со справкой [LibreOffice Impress](https://help.libreoffice.org/latest/ru/text/simpress/04/01020000.html) и [Firefox](https://support.mozilla.org/ru/kb/kak-ispolzovat-firefox-i-veb-sajty-v-polnoekrannom); PPTX/PDF остаются названиями форматов.

## 12. Сохранность PPTX

office-kit сохранение может пересериализовать ZIP parts. Gamma не принимает это как достаточную точечность: берётся исходный ZIP и заменяются только выбранный slide XML, его rels и эксклюзивные media/chart/workbook dependencies. Остальные part payloads остаются byte-identical. ZIP container/compression bytes могут отличаться.

Общие редактируемые ресурсы блокируют изменение, способное затронуть другие слайды. Недоступные объекты не удаляются. Заметки/masters/layouts нетронутых слайдов сохраняются. `qa/edit-N.json` содержит список changed parts и hashes. Сохранение произвольных custom объектов в каждом возможном PPTX не гарантируется: неизвестные сложные сценарии должны завершаться явной ошибкой/проверкой, а не обещанием идеальной совместимости.

После объектной правки актуальны `answer.pptx` и журнал `sources/edit-N.json`; старый HTML/outline не переписывается с потерей неизвестных объектов. Повторная полная сборка такого workspace блокируется, чтобы не отменить точечные правки устаревшими исходниками. Следующие правки выполняются над текущим PPTX; полный редизайн — в отдельном workspace.

## 13. Проверки

Автоматические проверки реальных инструментов отделены от поведения LLM и эстетической оценки.

- `packages/opencode/test/presentation/presentation.test.ts`: настоящий PPTX на 10 слайдов, LibreOffice/Poppler, native text/chart, CSV/XLSX Decimal sums, правка slide 4, OOXML preservation и PNG equality остальных 9 слайдов; HTML export; brand/theme/font/notes сохранение; one-slide/full redesign; повреждённый/частичный файл, неподдержанный объект, missing font, limits, path/symlink escapes; отсутствие LibreOffice в изолированном PATH; отсутствие vision; настоящий MCP protocol и stale profile rejection.
- `packages/core/test/agent-market.test.ts`: валидация профилей, binding, идемпотентность, integrity checks.
- `packages/opencode/test/server/agent-market.test.ts`, `test/agent/market-permissions.test.ts`: реальные HTTP/SQLite и restrictions.
- `packages/app/e2e/regression/presentation.spec.ts`: настоящий backend и реальные сгенерированные PPTX/PDF/PNG, выбор профиля, подключение MCP, preview, thumbnails, fullscreen, download, изменение слайда и обновление изображения. Никаких подменённых файлов/HTTP-ответов. Это UI E2E, **не E2E с LLM**.
- Отдельный smoke test Bun executable: скомпилированный native/data exporter и HTML exporter действительно создали PPTX, открыли его в LibreOffice и получили PNG/PDF. Playwright оставлен внешней runtime-зависимостью: его внутренние optional modules не совместимы с включением целиком в executable.

Команды из соответствующих package directories:

```bash
# packages/opencode
PLAYWRIGHT_BROWSERS_PATH=/path/to/existing/browsers bun test test/presentation/presentation.test.ts --timeout 120000
bun test test/server/agent-market.test.ts test/agent/market-permissions.test.ts
bun typecheck
# packages/core
bun test test/agent-market.test.ts
# packages/app (изолированный backend уже запущен)
GAMMA_PRESENTATION_E2E=1 PLAYWRIGHT_SERVER_PORT=4173 PLAYWRIGHT_PORT=4473 bun run test:e2e -- e2e/regression/presentation.spec.ts --workers=1
bun typecheck
# packages/client
bun run generate
```

Воспроизводимый live E2E с настоящей настроенной моделью (только на отдельном тестовом backend/workspace root):

```bash
# packages/opencode; использует обычные credentials настроенного backend
GAMMA_PRESENTATION_TEST_SERVER=http://127.0.0.1:4173 \
GAMMA_PRESENTATION_TEST_MODEL=provider/model \
bun run script/presentation-live.ts
```

Скрипт создаёт отдельный проект, применяет профиль, запускает обычный `prompt_async`, ждёт до 30 минут, выводит native task children/статусы/артефакты. Успех — только реальный `ready`; timeout прерывает тестовую сессию и оставляет непроверенные артефакты. Дополнительно поддерживаются `GAMMA_PRESENTATION_TEST_AUTH`, `GAMMA_PRESENTATION_TEST_PROMPT` и `GAMMA_PRESENTATION_TEST_TIMEOUT_MS` (1–60 минут).

После намеренного изменения ресурсов/профилей выполните `bun run script/presentation-bundle.ts` до публикации bundle. Скрипт обновляет pins и проверяет все файлы через реальный `AgentCatalog.bundle`. Не изменяйте bundle по частям во время активной генерации: runtime отклоняет несовпадение integrity hashes.

### Фактические результаты проверки реализации

Автоматические проверки: 10 presentation tests (250 assertions), 21 проверка permissions/TaskTool/HTTP/проектных файлов в OpenCode и 3 проверки каталога Core — 34 теста. Отдельно прошёл один браузерный E2E с настоящими PPTX/PDF/PNG и обновлением после правки. Typecheck OpenCode и приложения проходит. SDK client generation выполнена. В существующем регрессионном тесте TaskTool используется mock LLM; он не засчитывается как подтверждение работы настоящей модели.

В отдельных тестовых backend/workspaces выполнены запросы к уже настроенному пользователем провайдеру с `qwen/qwen3.5-plus`. Секреты и конфигурация рабочего Gamma не изменялись. Настройки image modality и reasoning применялись только в изолированной тестовой конфигурации.

Настоящая LLM вызвала все четыре native subagents, создала десять редактируемых слайдов, получила PPTX/PDF/PNG и замечания от реального vision endpoint. Проверка обнаружила перекрытый заголовок, неподтверждённую численность участников и несогласованные сроки. Автор исправлял исходники и повторял сборку/рендер. Повторный QA действительно отклонял оставшиеся ошибки; export сам по себе не давал `ready`.

Полностью автономный прогон **не прошёл**: модель допускала ошибки HTML-контракта и содержания; дополнительно выявлена и исправлена ошибка двойного учёта slide/deck review в бюджете. Были реальные временные HTTP 503, таймаут и обрезанный ответ vision; ошибки не превращались в положительное ревью. Попытки модели вручную записать успешный QA были заблокированы permissions. После технической миграции счётчика агент самостоятельно пересобрал revision 5 и повторно вызвал reviewer. Настоящая третья проверка всех десяти изображений снова отклонила результат: на слайде 6 осталось неподтверждённое «5–7 менеджеров» без пометки о допущении. Сохранились предупреждения о непроверенной статистике, заглушке даты и контрасте сносок. Статус `ready` не получен. Это технически сопровождаемое продолжение, не успешный автономный E2E. Unit-тесты и браузерный E2E не подтверждают профессиональное визуальное качество презентаций.

## 14. Ограничения

- Creative route — адаптированный workflow PPTAgent и ограниченный Gamma HTML converter, не полный upstream converter/runtime.
- Профессиональный дизайн зависит от модели и review; успешный export не доказывает его качество.
- Таблицы/текстовые числовые утверждения требуют сверки reviewer; автоматическая арифметическая гарантия относится к datasets/charts, не ко всем возможным фактам.
- Не исполняются XLSX-формулы. Нужен values-only экспорт или воспроизводимый вычислительный источник.
- OCR сканированных PDF не встроен: извлечение PDF работает с текстовым слоем; изображения могут быть проверены vision-моделью.
- Встроенный анализ данных считает точные групповые суммы. Произвольные финансовые формулы/проценты не исполняются; для них нужен подготовленный источник значений. Импорт текста ограничен 150 000 символами, PDF — первыми 200 страницами; truncation/scope возвращаются явно.
- Для нового deck можно воспроизвести корпоративные размеры/цвета/шрифты; arbitrary master cloning в PptxGenJS route не реализован. Для сохранения исходных masters используйте edit route.
- Шрифты не встраиваются в PPTX: для одинаковой вёрстки они должны быть доступны и на машине, где открывается PowerPoint. Автоматическое открытие проверено в LibreOffice; Microsoft PowerPoint на Windows/macOS в этой среде не запускался.
- HTML не поддерживает произвольный CSS, вложенную rich-text разметку, SVG/canvas, скрипты и remote assets. PNG/JPEG — поддержанные image inputs.
- Без LibreOffice/Poppler или vision можно подготовить исходники/PPTX-черновик, но нельзя честно получить `ready`.
- Рендерер процесс-локальный; distributed scheduling и жёсткие kernel resource limits обеспечивает инфраструктура.
- Предпросмотр требует server-side render: открытие произвольного загруженного PPTX само по себе его не запускает.

## 15. Развёртывание

1. Выполнить обычную сборку Gamma с обновлённым `bun.lock`, `packages/opencode` и `packages/app`; включить `gamma-agent-market` целиком. При нестандартном размещении указать `GAMMA_AGENT_MARKET_ROOT`.
2. Администратор отдельно устанавливает системные зависимости. Например Debian/Ubuntu: `apt-get install libreoffice-impress poppler-utils python3 fontconfig fonts-liberation`. Не выполнять автоматически из agent tools.
3. Установить Chromium для закреплённого Playwright из `packages/opencode`: `bun ./node_modules/playwright/cli.js install chromium`. Подготовить system browser dependencies отдельно. При общем cache указать `PLAYWRIGHT_BROWSERS_PATH` доступный пользователю Gamma.
   Для поставки в виде скомпилированного Bun-бинарника дополнительно установите `playwright@1.59.1` в отдельную runtime-директорию и задайте `GAMMA_PRESENTATION_PLAYWRIGHT_MODULE=/opt/gamma/presentation-runtime/node_modules/playwright/index.mjs`. Playwright нельзя упаковывать внутрь executable; при запуске Gamma из исходников он разрешается из обычного `node_modules`. `health.chromium=false` означает недоступность runtime или браузера.
4. Настроить существующий provider и image modality, при необходимости `GAMMA_PRESENTATION_VISION_MODEL`. Проверить доступность endpoint с production-сервера и его payload/context limits.
5. Сохранить существующие Gamma authentication, HTTPS и project workspace permissions. Секреты не хранить в профилях и презентациях.
6. Проверить `gamma-presentation_health`, маленький реальный build/render и оба vision review, затем finalize. При ошибке не считать deployment готовым к полноценной выдаче.
7. Задать RAM/CPU/disk quotas и изолировать renderer от сети. Контролировать размер history/renders и резервное копирование originals; автоматическое удаление пользовательских артефактов не добавлено.
