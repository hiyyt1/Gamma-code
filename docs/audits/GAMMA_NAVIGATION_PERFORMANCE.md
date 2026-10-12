# Gamma: расследование зависаний навигации

Дата: 12 октября 2026. Frontend: SolidJS, production Vite build. Изменения выполнены в рабочем дереве; production не затронут.

## 1. Результат и границы доказательств

Воспроизведена конкретная причина «нажал, а ничего не произошло»: сетевые ресурсы второстепенных компонентов удерживали общую навигационную транзакцию Solid Router. Старые URL и содержимое оставались на экране до завершения запросов. Это **асинхронное ожидание, выглядящее как зависание**, а не обязательно занятый main thread.

Остановленный запрос каталога агентов удерживал также последующий переход на базу знаний: проверка не дождалась новой страницы за 15 секунд. При искусственной задержке product API 1000 мс каталог появлялся через ~1 секунду, чат — через ~2 секунды. В чате ожидались два последовательных запроса справочника знаний. Ещё одна независимая зависимость — каталог для отображения имени агента в поле ввода.

Исправлены пять frontend-компонентов и подтверждённая утечка Three.js через локальный dependency patch. Никаких новых кешей, задержек, спиннеров, CSS-изменений, изменений runtime, permissions, Auto mode или SSE. Существующие локальные состояния загрузки теперь могут отображаться без удержания всего маршрута. Полезный контент чата и ввод не зависят от справочников.

Различие между пользователями объяснимо условиями этой цепочки: быстрый API скрывает зависимость; тёплая lineage исключает один сетевой барьер; другие агенты меняют ветку чтения каталога; число посещений WebGL-страницы увеличивало объём удерживаемых ресурсов. Последний фактор подтверждён как утечка, но его вклад во время конкретного production-клика не измерен.

**Это локальное воспроизведение на настоящей production-сборке frontend с контролируемыми API fixtures, а не измерение production backend.** Доступного реального стенда нет. Причины медленных ответов реального backend/LLM здесь не установлены. Устранён доказанный механизм зависимости навигации от этих ответов; все возможные зависания у всех пользователей считать устранёнными нельзя.

## 2. Архитектура навигации

- `packages/app/src/app.tsx:646`: `/` — Home с карточками проектов, `/agents` — каталог, `/knowledge` — база знаний, `/server/:serverKey/session/:id` — чат, `/new-session` — черновик. Отдельной страницы `/projects` нет: в тестовом цикле «Проекты» означает возврат к карточкам Home, затем открытие проекта.
- `app.tsx:597`, `pages/layout-new.tsx:78`: Solid Router → постоянные Tabs/Permission/Notification/Query/Shared providers → GammaShell → `<main><Suspense>{children}</Suspense></main>`. Sidebar находится вне этой границы. Клик по ссылке принимается, но это не означает, что транзакция маршрута завершена.
- Установленный `@solidjs/router/dist/routing.js`, функция `transition`: изменение route reference выполняется внутри `startTransition`; `navigateEnd` обновляет native history после settlement транзакции. DOM и URL поэтому не обязаны меняться в порядке «сначала URL, затем DOM».
- `components/gamma-shell.tsx:88`: выбор проекта ждёт индекс сессий, выбирает существующую сессию либо создаёт черновик. До исправления дополнительно ожидал `lineage.resolve` **до** вызова открытия вкладки.
- `pages/session.tsx:225`, `pages/session/session-lineage.ts:27`: целевой маршрут уже самостоятельно разрешает lineage, игнорирует устаревшие результаты и создаёт SDK/Directory providers только после получения directory. Дублирующий предварительный сетевой барьер не нужен для этой гарантии.
- `app.tsx:69`: Home, Agents, Knowledge, Session импортируются статически. Только NewSession здесь lazy. При исследованных SPA-переходах route code уже загружен; отдельного сетевого route chunk на критическом пути этих ссылок нет.
- `components/knowledge-graph.tsx`: `3d-force-graph`, `three`, material module загружаются динамически при монтировании графа. PDF viewer также загружается отдельно. Во время полного цикла с пустой базой знаний запросов graph/three не было.
- `pages/knowledge.tsx:100`: ручная загрузка в store: IndexedDB → локальный server cache → remote API → применение данных. Это потенциальный waterfall больших пользовательских данных, но он **не удерживал переход на пустую страницу** в измерениях. Секундную блокировку main thread в этой ветке не установили.

Критический путь до исправления:

```text
click → router transition → component reads pending resource
      → persistent Suspense holds transition
      → old DOM / old URL remain visible
      → API settles → render → URL commit → paint
```

После исправления для необязательных справочников:

```text
click → router transition → page / chat DOM → URL commit → paint
                          ↘ API → local component content update
```

Смена сессий одного сервера сохраняет серверный контекст; workspace subtree имеет отдельную защиту по directory. Полную перестройку всех глобальных providers на каждый sidebar-клик код не делает. Очистка пустой сессии запускается асинхронно и не была блокирующим await обработчика.

## 3. Методика и окружение

Production builds: `/tmp/gamma-navigation-before` и итоговая `/tmp/gamma-navigation-fixed` (`/tmp/gamma-navigation-after` — промежуточная сборка до lifecycle-исправления), отдельные чистые output directories. Chrome for Testing 147.0.7727.15 (headless) через Playwright 1.59.1, Linux x86_64, AMD Ryzen 7 9700X / 16 logical CPUs, viewport 1440×900, locale ru-RU, 1 worker, без retries. Детальные Chrome traces собирались отдельными прогонами, чтобы не смешивать стоимость tracing с основными числами.

Основная матрица: desktop, CPU throttling ×6, задержка **каждого product API ответа** 100 и 1000 мс. Это модель задержки API, не эмуляция пропускной способности/потерь пакетов всей сети. В каждом профиле 20 циклов по 5 переходов, то есть 100 переходов и n=20 на маршрут. Другие запросы fixtures быстрые. История: 2 сообщения, 1 проект, 1 агент; база знаний пуста. В отдельных lifecycle-тестах открыт реальный WebGL demo graph, не заглушка canvas.

Основные замеры используют v1 compatibility fixture. Отдельные проверки зависшего справочника чата выполнены также с v2 protocol fixture. Оба протокола воспроизвели зависимость до исправления и проверены после него.

В браузер добавлен только тестовый product probe:

| Стадия | Что действительно измерено |
|---|---|
| Input → handler | `click.timeStamp` → первый document capture listener. Это приближение очереди dispatch, **не** точное начало Solid handler и не физический input latency. |
| Handler → URL | От capture listener до native `history.pushState/replaceState`. |
| URL → route code | Не отдельная загрузка: код перечисленных страниц входит в entry до клика. Для графа dynamic imports исследованы отдельно. |
| Route → first meaningful DOM | MutationObserver фиксирует вставку корневого содержимого целевой страницы/поля ввода чата. |
| DOM → readiness | DOM-контракт: доступна кнопка агента; завершена загрузка пустой базы; доступна карточка; история чата и поле ввода присутствуют. Работоспособность дополнительно проверена реальными действиями. |
| Click → visible feedback | В трассах: ближайший main-thread Paint после метки нового DOM. Это paint opportunity, не аппаратный display presentation. |
| Click → usable | Основная таблица использует browser readiness marker. В raw data отдельно сохранён `usable` — время завершения Playwright assertion; оно включает polling и IPC и не выдаётся за время появления UI. |

p50 — медиана, p95 — nearest-rank. n=20 даёт ограниченную точность хвоста. Первый переход сохранён отдельно от 19 повторных; статистику «cold p95» по одному открытию не строим. Long tasks извлекаются из main-thread `RunTask` в Chrome trace; отдельный LoAF Observer не устанавливался. Для памяти — CDP DOM counters и JSHeapUsedSize после explicit GC, без вывода об отсутствии утечек только по одной паре значений.

## 4. Профилирование до изменений

Сырые результаты: [before-playwright.json](evidence/gamma-navigation-2026-10-12/before-playwright.json), [before-diagnostics.json](evidence/gamma-navigation-2026-10-12/before-diagnostics.json), [before-extra.json](evidence/gamma-navigation-2026-10-12/before-extra.json).

Незавершённые запросы контролировались promise gate: серверный ответ освобождался **после** проверки поведения. Это сильнее проверки «быстро ответившего mock API».

- Agents: до освобождения ответа URL `/`, Home виден, каталог и его skeleton отсутствуют.
- Agents → Knowledge: следующий переход не завершился за 15 секунд при незавершённом первом запросе. [Скриншот](evidence/gamma-navigation-2026-10-12/before-abandoned-api.png).
- Chat + pending knowledge: в v1 остаётся Home, prompt отсутствует; в v2 также не фиксируется URL чата и отсутствует prompt, но старый DOM уже может исчезнуть. В обычном профиле +1000 мс два последовательных запроса превращались в ~2030 мс до UI чата.
- Chat + pending agent catalog: тот же эффект, независимо от запроса знаний.
- Project + pending lineage: до получения метаданных URL оставался `/`.
- Graph → Agents + pending catalog: граф оставался видимым на старой странице до завершения запроса. Его lifecycle cleanup ещё не наступал, потому что переход не завершён; это не доказательство ошибки destructor.

## 5. Подтверждённые причины и исправления

| Приоритет | Причина и место | Исправление | Риск / проверка |
|---|---|---|---|
| High | `pages/agent-market.tsx:57`: eager memo читает pending `catalog()` до собственного loading/error UI; ресурс захватывает общую transition. | Не читать значение ресурса при `loading`/`error`; использовать существующие skeleton/error/retry. | Каталог обязан появиться после ответа; проверены повторный запрос и локальная ошибка 503. |
| High | `components/project-knowledge.tsx:37`: optional knowledge/project metadata в шапке чата читалось под общей Suspense; два последовательных запроса попадали на критический путь чата. | Единый локальный `loaded()` возвращает данные только после загрузки; все чтения этого компонента проходят через него. | Пустые/загружающиеся данные нельзя использовать для записи. `toggle` проверяет готовый project и directory. Существующий порядок двух запросов сохранён: код документирует общий publication lock; backend не менялся. |
| High | `components/prompt-agent-control.tsx:19`: отображение имени нестандартного/неразрешённого агента ждало полный каталог и приостанавливало чат; стандартный `gamma` уже обходил это чтение. | Пока каталог загружается, показывается уже имеющийся current agent/fallback; затем отображаемое имя обновляется. | Выбор агента, session lock, permissions не меняются; ввод проверен при намеренно неотвечающем API. |
| Medium | `components/gamma-shell.tsx:88`: предварительный `lineage.resolve` задерживал сам факт навигации. | Сразу открыть целевой маршрут; разрешение и workspace guard остаются в существующем `createSessionLineage`/`ResolvedTargetSessionRoute`. | Поздний результат не должен вернуть пользователя в оставленную сессию; проверены уход до ответа, back/forward и 7 lineage unit tests. |

Это снятие ненужных зависимостей на критическом пути, а не ускорение backend и не имитация результата. Сам каталог по-прежнему не может показать карточки до ответа API. Различие: страница, поиск, категории и навигация уже доступны; чат может показывать историю и принимать ввод без каталога/knowledge metadata.

`ProjectAgent` дополнительно проверен по месту вызова: компонент находится в содержимом меню дополнительных действий. Гипотеза о безусловной загрузке подробного профиля этого компонента при каждом открытии чата не подтвердилась; он не изменён. Размер bundle сам по себе также не принят за доказательство причины.

Дополнительная подтверждённая проблема lifecycle:

| Приоритет | Причина | Исправление и доказательство |
|---|---|---|
| High (накопление ресурсов) | Three.js 0.186.1: глобальный `DFG_LUT` сохраняет `dispose` callback каждого renderer. `WebGLRenderer.dispose()` не удаляет эту подписку; callback удерживает WebGL context → canvas → закрытую `.kb-page`. | `patches/three@0.186.1.patch`: перед очисткой property tables вызывается renderer-local texture disposal; снимается только его callback/texture. Версия библиотеки не меняется. Патч зарегистрирован в `package.json` и `bun.lock`. |
| Medium | `three-render-objects` публикует production `window.scene`; Gamma освобождала часть своих ресурсов уже после уничтожения renderer. | `components/knowledge-graph.tsx:606`: остановить RAF, отключить environment, освободить собственные targets/materials до destructor, удалить debug reference только если он принадлежит закрываемой scene. |

Одна перестановка cleanup и удаление `window.scene` **не устранили** линейное накопление. После этого отдельный heap snapshot выявил сильный путь через `DFG_LUT._listeners.dispose` без опоры на условные WeakMap edges: [retaining path](evidence/gamma-navigation-2026-10-12/graph-retaining-paths-strong.txt). Поэтому применён дополнительный dependency patch, а не объявлена победа после удаления canvas.

Патч не вызывает глобальный `texture.dispose()` для общей LUT: это затронуло бы другие активные renderers. Browser regression создаёт два настоящих WebGL renderers, уничтожает первый и проверяет сохранение GPU texture второго, точное совпадение пикселей и удаление оставшейся подписки после закрытия второго. Патч проверен отдельной чистой установкой Bun с frozen lockfile; SHA-256 её `three.module.js` совпал с файлом итоговой сборки. Попытка стандартного `bun patch` в полном workspace упёрлась в `UnsupportedProxyProtocol` при разрешении посторонних зависимостей; изменения зарегистрированы точечно, без их обновления. Полная переустановка monorepo не подтверждена.

## 6. Профилирование после изменений и сравнение

Основной прогон без подробного tracing: значения **p50 / p95 / max, миллисекунды**, n=20 в каждой ячейке. DOM — появление оболочки страницы (для чата — поля ввода); Ready — контракт полезного содержимого, описанный выше.

| Профиль / маршрут | DOM до | DOM после | Ready до | Ready после |
|---|---:|---:|---:|---:|
| desktop / agents | 15.8 / 16.9 / 16.9 | 2.6 / 3.8 / 4.2 | 15.9 / 16.9 / 16.9 | 14.4 / 15.0 / 15.3 |
| desktop / knowledge | 3.0 / 3.6 / 4.9 | 3.0 / 4.5 / 5.8 | 18.3 / 29.4 / 34.9 | 19.0 / 24.4 / 41.6 |
| desktop / projects | 3.3 / 4.0 / 4.3 | 3.4 / 4.2 / 4.5 | 3.3 / 4.0 / 4.3 | 3.4 / 4.2 / 4.5 |
| desktop / chat | 31.3 / 48.3 / 98.9 | 20.8 / 24.0 / 88.4 | 31.3 / 48.3 / 98.9 | 20.8 / 24.0 / 88.4 |
| desktop / home | 5.3 / 6.6 / 6.7 | 5.9 / 6.7 / 6.9 | 5.3 / 6.6 / 6.7 | 5.9 / 6.7 / 6.9 |
| cpu6 / agents | 26.0 / 37.7 / 43.4 | 16.8 / 20.2 / 24.6 | 26.0 / 37.7 / 43.4 | 49.8 / 65.1 / 109.7 |
| cpu6 / knowledge | 18.4 / 21.3 / 32.4 | 18.9 / 21.4 / 35.5 | 111.2 / 143.6 / 170.7 | 115.1 / 151.6 / 152.2 |
| cpu6 / projects | 18.6 / 21.4 / 21.6 | 19.8 / 24.2 / 25.3 | 18.7 / 21.5 / 21.7 | 20.0 / 25.0 / 26.0 |
| cpu6 / chat | 219.3 / 261.4 / 575.6 | 133.6 / 144.2 / 516.1 | 219.3 / 261.4 / 575.6 | 133.6 / 144.2 / 517.2 |
| cpu6 / home | 32.2 / 37.9 / 40.6 | 33.1 / 36.9 / 38.9 | 32.2 / 37.9 / 40.6 | 33.3 / 37.0 / 38.9 |
| api100 / agents | 105.8 / 107.1 / 107.7 | 2.7 / 3.7 / 3.9 | 105.9 / 107.1 / 107.7 | 106.1 / 107.0 / 107.1 |
| api100 / knowledge | 3.2 / 3.9 / 5.0 | 3.0 / 4.3 / 5.1 | 117.6 / 122.8 / 125.3 | 118.0 / 122.8 / 123.5 |
| api100 / projects | 3.0 / 3.4 / 3.4 | 3.0 / 3.7 / 4.7 | 3.0 / 3.4 / 3.4 | 3.1 / 3.7 / 4.7 |
| api100 / chat | 226.5 / 229.5 / 266.4 | 19.1 / 24.1 / 84.4 | 226.5 / 229.5 / 266.4 | 19.1 / 24.1 / 84.4 |
| api100 / home | 4.8 / 5.4 / 6.3 | 5.6 / 6.3 / 6.4 | 4.8 / 5.4 / 6.3 | 5.6 / 6.3 / 6.5 |
| api1000 / agents | 1006.5 / 1007.7 / 1008.7 | 2.6 / 3.8 / 4.5 | 1006.6 / 1007.7 / 1008.7 | 1005.8 / 1008.3 / 1008.4 |
| api1000 / knowledge | 2.8 / 3.5 / 4.2 | 2.8 / 3.6 / 4.5 | 1019.7 / 1020.8 / 1022.6 | 1019.9 / 1023.3 / 1024.8 |
| api1000 / projects | 3.0 / 3.6 / 4.0 | 3.1 / 3.6 / 3.8 | 3.0 / 3.7 / 4.0 | 3.2 / 3.6 / 3.8 |
| api1000 / chat | 2029.8 / 2034.9 / 2067.6 | 19.8 / 25.2 / 91.3 | 2029.8 / 2034.9 / 2067.6 | 19.8 / 25.3 / 91.3 |
| api1000 / home | 5.1 / 5.8 / 6.3 | 5.3 / 6.5 / 7.1 | 5.1 / 5.8 / 6.3 | 5.3 / 6.5 / 7.1 |

При +1000 мс API: p95 оболочки Agents **1007,7 → 3,8 мс**, p95 готового чата **2034,9 → 25,3 мс**. Карточки Agents остаются зависимыми от API: p50 Ready **1006,6 → 1005,8 мс**, это не ускорение получения данных.

CPU×6: p50 чата **219,3 → 133,6 мс**, первый холодный чат **575,6 → 517,2 мс**. У Agents Ready на CPU×6 стало **26,0 → 49,8 мс**: появление промежуточного локального UI добавляет работу до окончательной карточки, хотя первый DOM появляется раньше (**26,0 → 16,8 мс**). Это измеренный trade-off, не скрытый общий выигрыш. Готовность пустой Knowledge при +1000 мс осталась ~1020 мс; её оболочка и раньше появлялась за ~3 мс.

Отдельные traces (4 цикла, n=4 на маршрут, **не объединены с основной статистикой**): при +1000 мс API click→Paint p50 для Agents **1009,3 → 13,0 мс**, для Chat **2041,0 → 31,8 мс**. Это подтверждает, что изменение касается отображения, а не только URL. Максимальный navigation-overlapping RunTask CPU×6 **342,1 → 354,8 мс**, число таких задач ≥50 мс **15 → 15**: main-thread нагрузка холодного чата не устранена. Desktop: 0 → 1 такая задача (61,9 мс). Этот шум/оставшаяся работа не объясняют прежнее двухсекундное ожидание при медленном API.

Полные стадии (input→capture, capture→URL, DOM→Ready), first/warm, память и resource URLs: [summary.json](evidence/gamma-navigation-2026-10-12/summary.json). Paint и long tasks: [traces-summary.json](evidence/gamma-navigation-2026-10-12/traces-summary.json). Raw after: [after-playwright.json](evidence/gamma-navigation-2026-10-12/after-playwright.json).

## 7. Lifecycle, bundle и оставшиеся риски

Повторное открытие WebGL demo 11 раз с уходом на Agents выявило накопление **16 DOM listeners и ~724 nodes за цикл**, хотя canvas исчезал из активного документа. Это преимущественно обработчики удерживаемых detached subtrees, а не 16 новых глобальных window handlers на каждом шаге. Их наличие само по себе не доказывает продолжающийся RAF: цикл renderer останавливался.

До исправления: после последнего ухода **10317 nodes / 264 listeners**, в heap — **12 `.kb-page` DOM nodes**. После патча: **2353 nodes / 88 listeners**, циклы остаются около 2353–2360 nodes и 88 listeners (одна временная точка 92); heap содержит **1 `.kb-page` node** вместо 12. Это подтверждает устранение линейного удержания через LUT, но не отсутствие всех detached DOM: оставшийся узел имеет путь через Worker callback/context; его роль как шаблона или последнего экземпляра отдельно не установлена ([путь после исправления](evidence/gamma-navigation-2026-10-12/graph-retaining-path-after.txt)). Сырые результаты (exploratory report также сохраняет первоначальную ошибку поиска минифицированного module export в тесте; исправленный тест прошёл в `final-regressions.json`): [до](evidence/gamma-navigation-2026-10-12/graph-heap-before-fix.json), [после](evidence/gamma-navigation-2026-10-12/graph-heap-after-fix.json). Полные snapshots сохранены локально в `/tmp/gamma-navigation-graph.heapsnapshot` и `/tmp/gamma-navigation-graph-patched.heapsnapshot`.

Дополнительный прогон **25 round trips / 50 переходов** после исправления: 2353–2360 nodes, **88 listeners во всех 25 точках**, после последнего ухода 2353/88. Проверено также отсутствие принадлежащего закрытому графу `window.scene`: [raw report](evidence/gamma-navigation-2026-10-12/graph-50-transitions.json).

Это подтверждённое исправление линейного удержания ресурсов. Насколько оно влияло на секунды задержки конкретного пользователя после длительной работы, без production trace не измерено. Native GPU memory на реальном устройстве отдельно не измерялась: используется headless SwiftShader. Подход к освобождению textures/materials соответствует [документации Three.js о disposal](https://github.com/mrdoob/three.js/blob/dev/manual/pages/how-to-dispose-of-objects.html); диагноз DFG LUT основан на локальном исходном коде 0.186.1 и heap snapshots, не на общем совете документации.

Entry JS до изменений — 2 814 446 байт (файл entry), ~845 kB gzip. Home/Agents/Knowledge/Session статически входят в граф entry; это риск холодного запуска на слабом CPU. Graph/three не запрашивались в основных циклах. Не обнаружены route chunk failures в выполненных сценариях; несогласованные assets после реального deploy не проверялись. Разбиение entry не добавлялось без доказательства выигрыша и проверки новых Suspense/network boundaries.

В отдельном цикле без WebGL DOM counters после CPU×6 переходов колебались/росли при относительно стабильном JS heap. Это **не позволяет заявить отсутствие накопления detached documents**. Количество listeners не росло линейно с количеством переходов, но counters без retaining paths не доказывают отсутствие утечки. Нужны heap snapshots и сравнение после завершения всех фоновых запросов/idle GC. Отдельная отмена всех pending product requests при unmount здесь не вводилась; неответившие запросы остаются отдельным риском ресурсов, хотя больше не блокируют маршрут.

Ручной loader Knowledge продолжает читать IndexedDB/cache последовательно и не имеет полноценного generation/disposed guard вокруг всех поздних результатов. Большой личный граф/объём local data в этой работе не измерен; потенциальную стоимость JSON/clone/filter не выдаём за причину наблюдавшихся секунд ожидания простых страниц.

## 8. Регрессионные проверки

- Production navigation regressions: 12/12; отдельный WebGL lifecycle test: 1/1; дополнительные rapid-click/focus-handler regressions: 2/2. Включены незавершённые API v1/v2, уход с pending route, ошибка 503/retry, back/forward, выбранная session identity, независимость двух WebGL renderers.
- Основные performance-сценарии: 4/4 до и после; traces: 3/3 на сторону. 100 переходов на профиль, отдельные diagnostic runs не смешаны с основной статистикой.
- `bun typecheck`, `bun run typecheck:e2e`: успешно. `session-lineage.test.ts`: 7/7, 21 assertions, включая late error, смену target и store.
- Светлая тема: 16/16 на production build, desktop 1440 и mobile 390, OS light/dark, saved dark/system, stale CSS cache, blocked storage и old-tab storage event. CSS, preload и ThemeProvider проверены SHA-256 относительно начала этой работы.
- Одна проверенная корректировка snapshot: `390-chat.png`. Старой v1-fixture не задан agent в session metadata. До изменений имя оставалось `Gamma` от начального состояния memo; после — предусмотренный существующим кодом `Agent not determined`. Обе версии сохраняют disabled agent control; в корректно заполненной v2-fixture агент `build` не меняется. Проверены обе сборки и computed control state. Обновлён только этот ожидаемый fallback; [pixel diff](evidence/gamma-navigation-2026-10-12/legacy-agent-label-diff.png) касается подписи/контрола, не палитры или компоновки страницы. Английский fallback в ru locale — существующий пробел локализации, не изменение переводов этой задачей.


Матрица фактического покрытия:

| Сценарий | Статус |
|---|---|
| Home → Agents → Knowledge → Projects/Home → Chat → Home | 20 циклов × 4 профиля до и после, production frontend |
| Повторные переходы / ≥50 переходов | 100 на профиль; статистика каждого маршрута |
| CPU×6, API +100 / +1000 мс | Выполнено; delay только product API, не полный WAN |
| Быстрая серия из 5 кликов, уход с pending route, late response, back/forward | Gate-тесты; до был воспроизводимый fail, после проверяется успешный уход |
| Работа ввода при неответившем optional API | Реальный fill и enabled Send, v1 и v2 fixtures; сообщение LLM не отправлялось |
| WebGL graph mount/unmount | 11 открытий с WebGL/heap snapshots и дополнительно 25 round trips / 50 переходов; устранено линейное удержание через LUT |
| Desktop/mobile, light-only theme | Существующий полный gamma-light suite на новой production-сборке |
| Холодный первый / повторные SPA-переходы | Первый замер и 19 повторных отдельно; нет серии 20 полностью холодных browser startups |
| 30 минут работы без reload | Не выполнено; 100 переходов не подменяют 30-минутный soak |
| Настоящая фоновая вкладка / browser timer suspension | Не выполнено (отдельно проверен synthetic focus handler при зависшем API); обычный headless Playwright отключает часть background throttling |
| Реальный streaming / параллельные агенты / LLM | Недоступно без стенда; fixture SSE не является измерением production streaming |
| Реальный WAN, Firefox/Safari, пользовательские расширения | В этой навигационной работе не измерены |
| 100–500 сообщений / большой личный граф | Не измерены этой серией; не экстраполируем историю из 2 сообщений |

## 9. Воспроизведение и диагностические артефакты

Из `packages/app` (тесты из корня запрещены):

```bash
SENTRY_AUTH_TOKEN= VITE_OPENCODE_SERVER_HOST=127.0.0.1 VITE_OPENCODE_SERVER_PORT=4520 bun run build --outDir /tmp/gamma-navigation-after
GAMMA_NAV_PHASE=after bunx playwright test -c e2e/performance/navigation/playwright.config.ts
GAMMA_NAV_PHASE=after GAMMA_NAV_SAMPLES=4 OPENCODE_PERFORMANCE_TRACE_DIR=/tmp/gamma-navigation-final-traces-after bunx playwright test -c e2e/performance/navigation/playwright.config.ts --grep 'navigation (desktop|cpu6|api1000)'
PLAYWRIGHT_SERVER_PORT=4520 GAMMA_LIGHT_BUILD=/tmp/gamma-navigation-after bunx playwright test -c e2e/gamma-light/playwright.config.ts
GAMMA_NAV_PHASE=after GAMMA_NAV_GRAPH_CYCLES=25 bunx playwright test -c e2e/performance/navigation/playwright.config.ts --grep "graph lifecycle"
bun typecheck
bun run typecheck:e2e
bun test --conditions=browser --preload ./happydom.ts ./test-browser/session-lineage.test.ts
```

Повторная сборка в существующий внешний outDir может оставить старые hashed files. Для нового baseline нужен новый пустой каталог; нельзя считать все оставшиеся файлы runtime-дубликатами. Не направлять эти команды на production backend. Preview port 4520 должен быть свободен; существующие сервисы не перезапускать.

Тесты: `packages/app/e2e/performance/navigation/`. Manual performance suite запускается отдельным config и не добавлена в обычную E2E discovery. Дополнение fixture позволяет выбрать protocol v2, default fixture сохранён. В `e2e/performance/chrome-trace.ts` исправлена только типизация записи CDP stream через Buffer при подключении helper к E2E typecheck; категории и содержание trace не менялись.

Метрики можно пересчитать: `bun e2e/performance/navigation/summarize.ts` из `packages/app` (нужны raw reports и сохранённые traces).

Малые raw reports, summaries, логи и скриншоты сохранены в [evidence](evidence/gamma-navigation-2026-10-12/). Сборки, исходники и dependency patch описаны в `build-manifest.json` и `source-manifest.json`; собственный diff реализации — `implementation.diff`. Полные Chrome traces — отдельные JSON в `/tmp/gamma-navigation-final-traces-before` и `/tmp/gamma-navigation-final-traces-after`; это локальные артефакты, не вложенные огромные файлы в git. Они сохранены без усечения; manifest содержит пути/размеры/SHA-256. Первичные exploratory traces дополнительно остаются в `/tmp/gamma-navigation-traces-before`.

Патч Three.js привязан к 0.186.1 и должен быть пересмотрен при обновлении зависимости. Сценарий двух renderers защищает от случайного глобального освобождения общей LUT. В production проект по-прежнему должен проходить обычную полную сборку/установку в CI.

## 10. Необходимые production-измерения и ответ на главный вопрос

Для оставшихся жалоб нужны: Chrome Performance trace с screenshots от клика до результата; HAR с timings и версиями entry/chunks; browser/OS/CPU/GPU и foreground/background status; route до/после, время клика и первого feedback; resource pending/error flags; количество сообщений/знаний и объём IndexedDB. В HAR и логах следует удалить токены, тексты запросов и содержимое файлов. Для memory — одинаковые точки после warmup и 50 переходов, pending request count, JS/native heap snapshots и retaining paths. Отдельно выполнить настоящий 30-минутный soak, активный streaming, большие диалоги и переключение вкладок в обычном браузере.

**Почему несколько простых страниц иногда переключались секунды?** Дело не в их количестве: дочерние сетевые ресурсы попадали в общую транзакцию Solid Router и задерживали commit всего маршрута. У пользователя с более медленным API это проявлялось сильнее. Незавершённый запрос мог удерживать и следующий выбор страницы. В чате эффект удваивался из-за двух последовательных запросов необязательного справочника; имя агента добавляло ещё одну независимую зависимость. Предварительное разрешение lineage также откладывало открытие проекта.

**Что сделано:** чтение pending необязательных ресурсов отделено от навигации; существующий контент/локальные loading/error states могут отобразиться сразу; lineage разрешается уже целевым маршрутом с сохранением workspace guard. Неответившие API больше не мешают проверенным действиям ухода, открытия истории и ввода. Дополнительно устранено удержание закрытых страниц графа через глобальную DFG LUT Three.js. Скорость LLM/backend, все возможные long tasks и длительная деградация этим исправлением не объявляются решёнными.
