# Gamma: расследование frontend-инцидента

Дата: 12 октября 2026. Статус: аудит завершён в пределах доступного локального окружения; исправления не выполнялись.

## 1. Основной вывод

**Смешение тем, почти невидимые кнопки и текст воспроизведены в чистом Chromium на production-сборке текущего рабочего дерева.** Для этого не потребовались расширения, повреждённый кеш или старый профиль. Достаточно включить системную тёмную тему либо сохранить `opencode-color-scheme=dark`.

Причина — конфликт двух систем оформления. OpenCode корректно переключает semantic tokens на dark, а добавленные стили Gamma принудительно задают белые поверхности и тёмный Markdown независимо от темы. В результате одновременно появляются:

- светлый текст на белом sidebar, заголовке и composer;
- тёмный текст Markdown на тёмной поверхности диалога;
- светлые файловая панель и header рядом с тёмными сообщениями и инструментами.

**Подтверждён и отдельный дефект восстановления сообщений после reconnect SSE.** В контролируемом браузерном сценарии финальный ответ был доступен через обновлённый API fixture, но не появился после reconnect; reload страницы его восстановил. Это объясняет часть симптомов «агент не отвечает», независимо от CSS.

Короткие замеры streaming не воспроизвели многосекундного зависания main thread. На 500 сообщениях задержка уже полученного chunk → изменение DOM была медианно 9,95 мс, максимум 16,50 мс. Это **не** измерение реального API или LLM.

## 2. Область исследования и доказательства

Исследовался рабочий каталог, а не чистый upstream OpenCode. HEAD: `768f18ffe3f35c81bbbd65ee8cae802ef53c35b9`; до аудита существовало много изменённых и новых файлов. [SHA-256 ключевых исходников](evidence/2026-10-12/source-sha256.json) фиксирует исследованное состояние точнее одного commit ID.

UI — **SolidJS 1.9.10**, Solid stores и TanStack Solid Query, а не React/Zustand. Поэтому React commit duration здесь неприменим. Исследовались DOM mutations, реактивные зависимости, layout, Long Tasks, CPU samples и JS heap.

Сборка: Vite production, Bun 1.3.14, отдельный `/tmp/gamma-performance-audit-build`, без изменения production dist. Браузер: установленный Playwright Chromium, headless, без CPU/network throttling; Linux 6.17, Ryzen 7 9700X, 16 логических CPU. Остальные процессы машины не останавливались: это не выделенный benchmark-host.

Локальные Gamma backend/gateway не работали; пользователь подтвердил отсутствие доступного тестового экземпляра. Не запускались реальные агенты, запросы LLM, production-сервисы. API и авторизация в браузерных проверках были fixtures, код UI/CSS — реальная production-сборка. Файловые API старого harness не моделируют Gamma полностью: сообщения об ошибке файлов на тестовых скриншотах не считаются production-дефектом.

Доказательства:

- [Светлая тема](evidence/2026-10-12/gamma-audit-clean-light.png), [тёмная тема](evidence/2026-10-12/gamma-audit-clean-dark.png), [мобильный dark](evidence/2026-10-12/gamma-audit-dark-mobile.png).
- [Computed styles и hit-testing при light → dark → light](evidence/2026-10-12/gamma-audit-theme-interaction.json).
- [SSE recovery experiment](evidence/2026-10-12/gamma-audit-recovery.json).
- [Метрики streaming](evidence/2026-10-12/performance-summary.json), [Chrome trace, gzip](evidence/2026-10-12/renderer-trace.json.gz), [разбор trace с sourcemaps](evidence/2026-10-12/gamma-audit-trace-summary.json).
- [Методика и воспроизведение](evidence/2026-10-12/README.md), [performance-аудит всей цепочки](GAMMA_PERFORMANCE_AUDIT.md).

В доступных материалах найден и просмотрен `фотки /Вставленное изображение.png`: это светлый экран оформления файла базы знаний, визуально похожий на дизайн-макет. На нём нет однозначного воспроизведения описанного тёмного инцидента. Присутствуют также изображения в `gamma-agent-market/*validation` и `gamma-skill-market/screenshots`; нельзя объявлять их скриншотами пострадавшего пользователя без происхождения и контекста. Скриншот конкретного инцидента достоверно не идентифицирован.

## 3. Архитектура темы и локального состояния

Путь темы:

1. `packages/app/index.html:20` подключает синхронный `oc-theme-preload.js` до module entry.
2. `packages/app/public/oc-theme-preload.js:1` читает `opencode-theme-id`, `opencode-color-scheme`, CSS-cache темы. При `system` вызывает `matchMedia`. Ставит `html[data-theme]`, `html[data-color-scheme]` и inline background.
3. `packages/ui/src/theme/context.tsx:176` инициализирует ThemeProvider из тех же ключей; `:133` генерирует legacy и V2 tokens вместе и помещает их в `style#oc-theme`.
4. `context.tsx:233` слушает storage events, `:258` — изменение системной темы. На смену system mode приложение реагирует без перезагрузки.
5. `packages/app/src/index.css:1` импортирует общие стили, V2 стили, затем `gamma.css`. В `gamma.css` много unlayered правил с фиксированными цветами. Они не обязаны следовать `data-color-scheme`; часть перекрывает стили компонентов из CSS layers.

Две группы tokens сами по себе не являются доказанным дефектом: ThemeProvider обновляет обе. Воспроизведённая поломка возникает после применения Gamma overrides.

Дополнительное локальное состояние:

- `settings.v3`: видимость search/status/terminal, настройки layout, история поведения UI (`packages/app/src/context/settings.tsx:185,228`).
- `app-version.v1`: миграция интерфейса. После `oldInterfaceSunset = new Date(2026, 8, 14)` старый layout принудительно заменяется новым (`settings.tsx:63,128,341`). На дату аудита `newLayoutDesigns=false` не возвращает legacy UI — проверено браузером.
- `opencode-theme-css-light/dark`: сохранённый CSS custom theme, без явной версии схемы tokens.
- IndexedDB/draft storage хранит черновики, но в исследованном пути не выбирает цветовую тему. Доказательства, что IndexedDB вызывает смешение цветов, отсутствуют.

## 4. Подтверждённые дефекты

### F-01 — Critical: Dark tokens несовместимы с фиксированными цветами Gamma

**Файлы и точные участки:**

| Участок | Поведение |
| --- | --- |
| `packages/app/src/gamma.css:604` | Sidebar всегда `background: #fdfdff` |
| `gamma.css:700,704,710` | Workspace, контент и заголовок получают фиксированные светлые поверхности |
| `gamma.css:801` | Markdown всегда `color: #343049` |
| `gamma.css:816` | Composer всегда `background: white` |
| `gamma.css:863,877` | Code wrappers/pre всегда светлые |
| `packages/ui/src/v2/components/button-v2.css:70` | Neutral button использует текущие semantic tokens |
| `packages/ui/src/v2/styles/theme.css:383` | Dark tokens задают светлые текст/иконки, тёмные поверхности |
| `packages/app/src/pages/session.tsx:320` | Поверхность сессии продолжает использовать `bg-v2-background-bg-base` |

**Измеренное проявление:**

| Элемент | В dark | Контраст, приблизительно |
| --- | --- | --- |
| «Новый чат» | Текст `rgb(250,250,250)`, background `rgba(255,255,255,.06)` поверх `rgb(253,253,255)` | 1,03:1 |
| Ввод composer | Текст `rgb(250,250,250)` поверх белого | 1,04:1 |
| Markdown paragraph | Текст `rgb(52,48,73)` поверх `rgb(22,22,22)` | 1,43:1 |
| «Новый чат» в light | Текст `rgb(22,22,22)` поверх белого | 18,10:1 |

Контраст рассчитан из computed RGB через относительную яркость; прозрачный фон кнопки скомпозирован с sidebar, округление не влияет на вывод.

У «Новый чат» в обеих темах `disabled=false`, `display:flex`, `visibility:visible`, `opacity:1`; `elementFromPoint` попадает в кнопку. Значит, в этом воспроизведении кнопка **визуально исчезает из-за цвета**, а не удаляется из DOM и не блокируется overlay. При возврате light контраст возвращается, код и данные не меняются.

Влияние: основной ввод, навигация и чтение ответов практически непригодны в dark. Даже быстрый streaming не помогает, если пользователь не видит уже нарисованный текст.

Исправление: согласовать все поверхности/foreground Gamma через semantic tokens для light/dark, включая состояния hover/focus/disabled и syntax highlighting. Проверить также `workspace-files.css`, `knowledge.css`, market/login и portal-компоненты: там есть фиксированные светлые цвета. Не заменять всё одним `color:white` и не принудительно отключать dark. Разработать парные Gamma tokens, если существующие tokens не соответствуют дизайну.

Риск: изменение светлой палитры, контраста code tokens, прозрачных overlays и кастомных тем. Проверка должна сравнивать эффективный фон с учётом предков, а не только собственный `background-color` элемента.

### F-02 — High: Reconnect SSE не восстанавливает пропущенные сообщения активной сессии

**Код:** `packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts:16` отправляет SSE с `id: undefined`; replay отсутствует. `packages/app/src/context/server-sync.tsx:531–570` обрабатывает `server.connected` через bootstrap/refresh директорий. `global-sync/bootstrap.ts:375–410` перечитывает metadata/status, но не transcript. `server-session.ts:836–846` считает закешированную историю достаточной без `force`.

Сценарий: UI загрузил сессию; API fixture получил новый финальный текст без delivery соответствующего события; транспорт выдал минимум пять новых `server.connected`. Результат: **0 history refetch**, финального текста нет; reload → тот же текст появляется. Всего наблюдалось 11 fixture connections с учётом начального состояния и reload. Эти connections короткие по конструкции harness, не свидетельство production reconnect storm.

Важное ограничение: `pages/session/timeline/model.ts:27–35` умеет обновлять stale cache при повторном входе в сессию после 15 секунд. Это частичное восстановление при навигации, не обработка разрыва уже открытого потока. Итоговый full-part event также может восстановить текст, если он придёт после reconnect. Дефект наиболее заметен, когда пропущено именно завершение ответа либо parent/part creation.

Исправление: явный connection epoch и восстановление активных/подписанных сессий при reconnect; reconcile persisted history, status, permissions/questions с корректным merge пришедших параллельно deltas. Затем проектировать cursor/replay отдельно. Нельзя повторно запускать prompt/model execution вместо перечитывания истории.

Риск: потеря live delta при гонке snapshot/event, дубли, bootstrap storm, неправильное восстановление optimistic prompt. Требуются targeted tests с управляемым порядком событий.

### F-03 — Medium: Текущий штатный performance harness не проходит Gamma auth gate

`packages/app/src/entry.tsx` включает `GammaAuthGate`; `context/gamma-auth.tsx:33` требует `/auth/session` с `{username:string}`. Старый `e2e/utils/mock-server.ts:51` этого ответа не предоставляет. Штатный streaming benchmark остановился на ожидании заголовка сессии; screenshot/error-context показывают login и network error. Метрики этого запуска — `null`, не «30 секунд задержки чата».

Для аудита временный harness подставил только fake `/auth/session` и оставил production UI неизменным. Получено 12 успешных проверок: 6 theme cases, 3 history/streaming, 1 hit-test, 1 recovery, 1 отдельный trace run. Это количество выполненных проверок, не покрытие всего продукта.

Исправление: обновить test fixtures под Gamma auth/product API и запускать visual/performance smoke на production build. Риск: слишком permissive mocks могут скрыть настоящие ошибки авторизации; production auth не менять.

## 5. Матрица воспроизведения

Во всех подтверждённых строках — новая изолированная Chromium context без расширений. «Сохранённая настройка» означает явно seeded storage, а не доступ к настоящему профилю пострадавшего пользователя.

| Окружение/состояние | Результат | Статус |
| --- | --- | --- |
| 1366×768, пустая тема, OS light | Проверенные текст и кнопка читаемы | Воспроизведено |
| 1366×768, пустая тема, OS dark | Смешение тем, низкий контраст | Воспроизведено |
| OS light + saved dark | Та же поломка | Воспроизведено |
| OS dark + saved light | Проверенные элементы читаемы | Воспроизведено |
| OS light → dark → light, одна страница | Контраст ломается и восстанавливается; кнопка остаётся hittable | Воспроизведено |
| 390×844, OS dark | Тот же конфликт composer/header; sidebar скрыт responsive-правилом | Воспроизведено |
| `newLayoutDesigns=false`, текущая дата | Всё равно новый layout, конфликт dark сохраняется | Воспроизведено |
| 2/100/500 сообщений | Стоимость chunk → DOM растёт; фриз >50 мс в streaming-окне не обнаружен | Измерено на fixtures |
| Несколько reconnect без пропущенного финального события | Само соединение восстанавливается | Механизм harness работает |
| API обновлён, финальное событие пропущено | Reconnect не восстанавливает текст; reload восстанавливает | Воспроизведено на fixtures |
| Настоящий старый профиль / обычный Chrome против Incognito | Нет профиля пострадавшего | Не проверено |
| Firefox, Safari, старые Chromium, forced dark | Полной автоматизированной проверки нет; native Firefox найден, Playwright Firefox не подготовлен | Не проверено |
| Обновление реально открытой старой версии frontend | Нет старого deployment/build и production HAR | Не проверено |
| Реальная сеть с задержками, VPN/proxy, потеря пакетов | Нет test endpoint | Не проверено |
| Часы работы, много агентов, CPU pressure, расширения | Короткие проверки не заменяют soak/load test | Не проверено |

## 6. Почему поведение различается между пользователями

Главное подтверждённое различие — **effective color scheme**. Значение по умолчанию `system` зависит от ОС. Сохранённый `dark` продолжает действовать на светлой ОС, а `light` скрывает конфликт даже на тёмной. Это не гипотеза о повреждённом профиле: четыре соответствующих комбинации проверены.

Остальные независимые оси:

- На ширине ≤760 px навигация сворачивается (`gamma.css:540`); `home-new-session` скрыт в Gamma shell (`:527`) при наличии sidebar-альтернативы. На ≤767 px скрывается подпись KB и session icon (`:984`). Это предусмотренное responsive-поведение, не доказанное исчезновение функций. Нужно проверять доступность замены через меню и клавиатуру.
- `settings.v3` действительно хранит флаги видимости. «Не вижу кнопку» следует отличать от скрытого preference и от контраста. Тестовый `newLayoutDesigns=false` сегодня не помогает из-за sunset migration.
- Состояние кеша и разрывы SSE различаются. Разработчик с надёжным localhost может никогда не попасть в F-02.
- Быстрый CPU, короткая история и тёплые assets уменьшают задержки; измерения выполнены на мощной машине.
- Страница, оставшаяся открытой во время deploy, и новая страница могут использовать разные JS release. Это правдоподобный отдельный фактор, но текущий dark-дефект от него не зависит.

Не доказано, что у разработчика выбран light; это надо сопоставить с его computed state. Доказано, что такой выбор объясняет отсутствие именно воспроизведённого визуального дефекта.

## 7. Непроверенные гипотезы и исключённые объяснения

| Гипотеза | Доказательства/контрдоказательства | Приоритет проверки |
| --- | --- | --- |
| Старые/недоступные chunks после deploy | `deploy/web.ts:163–177`: assets immutable, отсутствующие `/assets/*` → 404; HTML no-store. Installer задаёт конкретный release root. Старому tab может понадобиться lazy chunk старого release. Обработчик `vite:preloadError` в entry не найден | High при chunk errors в HAR |
| Cached custom-theme CSS не соответствует текущим tokens | Preloader использует CSS до загрузки темы, cache не versioned; ThemeProvider обновляет его после успешного import | Medium; проверить custom themes и 404 theme chunk |
| Некорректный storage value | Scheme приводится `as ColorScheme` без runtime validation (`theme/context.tsx:182,249`); preloader читает localStorage без try/catch | Medium; контролируемые corrupt/blocked storage tests ещё нужны |
| Dark Reader / Auto Dark / forced-colors | Не использовались в воспроизведении; могут добавлять свои styles и менять цвета | Проверять только с данными клиента |
| Hydration mismatch | Web entry вызывает Solid `render`, не `hydrate`. Для этого пути mismatch SSR/CSR не подтверждён | Low |
| FOUC | Preloader призван уменьшать flash; auth/JS/chunk delays и custom cache могут дать переходное состояние. Наш дефект сохраняется после готовности UI | Medium для отдельного transient incident |
| Service Worker отдаёт старые файлы | Регистрация SW/workbox в просмотренных app/src, public и deploy не найдена. Manifest сам по себе не SW. Исторический SW на origin проверяется в браузере | Low, пока нет registration/controller |
| Overlay блокирует все кнопки | Для проверенной «Новый чат» опровергнуто hit-test. Mobile backdrop, dialogs, TabsInfoPopup существуют и требуют отдельных target-specific проверок | Medium при конкретном заблокированном control |
| Общая утечка listeners/timers | Просмотренные SSE, workspace polling, theme listeners имеют cleanup. Есть bounded кеши. Длительный heap-профиль отсутствует | Не объявлять подтверждённой утечкой |

`deploy/web.ts:113–147` передаёт upstream body потоком, выставляет `X-Accel-Buffering:no`; пример nginx отключает buffering. Это исключает утверждение «gateway обязательно буферизует весь ответ» по текущему коду. Фактическую конфигурацию production nginx не читали.

## 8. Производительность

Полный анализ backend/runtime — в [GAMMA_PERFORMANCE_AUDIT.md](GAMMA_PERFORMANCE_AUDIT.md).

| Сообщений в fixture | chunk → DOM median / max | chunk → ближайший RAF median / max | JS heap после серии | Смонтировано timeline rows |
| --- | --- | --- | --- | --- |
| 2 | 2,00 / 3,00 мс | 9,60 / 17,30 мс | 16,86 MiB | 4 |
| 100 | 4,05 / 5,90 мс | 12,05 / 20,40 мс | 18,09 MiB | 22 |
| 500 | 9,95 / 16,50 мс | 17,75 / 31,20 мс | 41,55 MiB | 22 |

20 последовательных marker deltas на scenario, один прогон каждой длины. RAF — callback opportunity, не физический paint и не INP. Heap — snapshot CDP counter, не доказательство утечки. Ноль Long Tasks в streaming-окне; в cold theme matrix наблюдались startup tasks около 56–63 мс. Профилирование отдельно включало CPU tracing; эти результаты не смешаны с baseline.

Trace содержит layout/scroll работу, sanitizer, Solid cleanup, Shiki worker startup и SDK transport. Стек SDK существенно отражает искусственные короткие SSE-ответы fixture. Нельзя переносить ranking samples на production. Обнаружена причина роста вычислений: `timeline/projection.ts:32` строит строки по всей загруженной истории, `message-part.tsx:711` читает `part.text.trim()` внутри этой реактивной проекции. Virtualization ограничивает DOM, но не устраняет пересчёт истории. Это candidate optimization, а не доказанное объяснение секундных зависаний.

## 9. План исправления и регрессионные сценарии

| Этап | Изменение | Сложность / эффект | Обязательная проверка и риск |
| --- | --- | --- | --- |
| 1 | Заменить несогласованные цвета Gamma парными semantic tokens; закончить dark palette всех поверхностей | M / устраняет F-01 при проверенных условиях | Light/dark/system, live switch, sidebar, composer с введённым текстом, headings/p/code/links, menus/dialogs, selected/disabled/focus; риск светлого visual regression |
| 2 | Исправить fixtures auth/product API и добавить production visual matrix | S–M / предотвращает пропуск повторения | Assertions на computed contrast + screenshot + hittability; не только наличие DOM |
| 3 | Восстанавливать transcript/status активных сессий после reconnect | M–L / устраняет воспроизведённый missed-event сценарий | Disconnect до part-start, в середине текста, перед final, во время tools/permission; snapshot racing with deltas; prompt нельзя отправлять повторно |
| 4 | Добавить release-aware asset diagnostics и безопасное предложение reload с сохранением draft | M / уменьшает время диагностики старых tabs | Старый tab → deploy → lazy route/theme/worker; пропавший chunk, offline; нельзя зациклить reload |
| 5 | Валидировать storage schema, version theme-cache; единообразный preload/runtime fallback | S–M / устойчивость к старым настройкам | `oc-1`, неизвестная тема, неверный scheme, denied storage, cross-tab storage events, cache without V2 tokens |
| 6 | Измерить и оптимизировать projection/layout, polling и pre-provider стадии | M–L / эффект определяется production traces | 100–500 сообщений, много tools/code/diffs, ввод при stream, быстрая навигация, параллельные агенты, file panel |

Нельзя обещать устранение всех пользовательских инцидентов без их воспроизведения. Семантически согласованная палитра устраняет именно доказанный конфликт цветов; reconnect resync с корректным merge устраняет доказанный сценарий пропущенного persisted ответа. Гарантия должна опираться на зелёные регрессии после реализации — реализации в рамках аудита нет.

Отдельная soak-регрессия: 2–4 часа stream/reconnect/navigation, десятки сессий, периодический heap snapshot, число SSE/listeners/timers, retained detached DOM, память workers. Обязательно проверить input latency при открытой файловой панели и active child sessions. Не отключать инструменты, snapshot или permissions ради прохождения теста.

## 10. Что собрать у пострадавшего клиента и в production

Минимальный пакет конкретного инцидента:

1. Browser/OS version, масштаб страницы, viewport/DPR, системная тема, выбранная тема Gamma, active forced-colors/forced-dark, расширения; точное время и часовой пояс, URL route и release ID.
2. Скриншот всей страницы и проблемного control; наличие элемента в DOM, `disabled`, `aria-disabled`, `display`, `visibility`, `opacity`, `pointer-events`, его rect и `elementFromPoint`.
3. Computed color/background проблемного текста и предков; `html.dataset.theme`, `html.dataset.colorScheme`, matchMedia result, `style#oc-theme` / `#oc-theme-preload`, список CSS sources. Не нужен дамп всех данных пользователя.
4. Только релевантные keys: `opencode-theme-id`, `opencode-color-scheme`, наличие/хеш CSS theme-cache, `settings.v3` appearance/visibility/layout, `app-version.v1`. Черновики, содержимое сообщений, cookies, credentials не включать.
5. HAR с Preserve log: `/auth/session`, health probes, prompt, history, SSE headers/status/reconnect, CSS/JS/worker/theme chunks; убрать auth/cookies/request contents. Console: chunk/CSP/CSS/network/storage errors. Для SSE отдельно сохранить arrival timestamps и типы событий без текста.
6. Chrome Performance trace 10–20 секунд вокруг действия, Long Tasks, input-to-next-paint, memory counter, DOM node count. Два прогона: в обычном профиле и в чистом при той же теме, resolution, route и истории.
7. Backend trace с request/session/message correlation: admission, history, snapshot wait/work, tools/MCP/context, provider request/headers/first meaningful delta, publish, gateway write. Сопоставить browser event receive → DOM; не вычитать сырые часы разных хостов без синхронизации.

Предлагаемая production-диагностика: sampled performance marks, connection epoch и counters reconnect/resync/queue, release ID в UI и ответах, агрегированные histograms по browser/build/effective theme. Отдельно считать first reasoning/tool/text event и первый видимый текст. Существующий Sentry включается только при `VITE_SENTRY_DSN` (`entry.tsx`); нельзя предполагать, что он уже собирает нужные данные.

## 11. Прямые ответы

1. **Почему исчезают кнопки?** Для воспроизведённой «Новый чат» — почти белый dark-token текст на фиксированном почти белом sidebar; кнопка существует и hittable. Другие пропавшие controls требуют проверки их settings, viewport и overlay.
2. **Почему смешиваются темы?** ThemeProvider переключает OpenCode tokens, а Gamma CSS оставляет light-only surfaces и fixed dark foreground. Одного корректного theme attribute недостаточно.
3. **Почему интерфейс задерживается?** Подтверждён missed-event recovery gap; часть «ожидания» может быть уже нарисованным, но нечитаемым ответом. Вычислительная стоимость растёт с историей. Реальные секундные задержки provider/backend/main thread без production trace не локализованы окончательно.
4. **Почему у разработчика нормально?** Светлая системная/сохранённая тема не запускает воспроизведённый конфликт; стабильная сеть и короткая история обходят другие проблемные условия. Настройки самого разработчика пока не получены.
5. **Что гарантированно устранит подтверждённые причины?** Согласованная light/dark палитра без конфликтующих overrides и race-safe восстановление истории после reconnect — для двух доказанных сценариев, после проверки исправлений регрессиями. Устранение всех внешних/неизмеренных причин гарантировать нельзя.
