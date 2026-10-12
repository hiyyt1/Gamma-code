# Материалы аудита Gamma — 12 октября 2026

Это доказательства локальных экспериментов, а не telemetry production. Исходники приложения не исправлялись. Исследовано рабочее дерево с пользовательскими изменениями; commit и SHA-256 ключевых файлов находятся в `source-sha256.json`.

## Окружение и границы

- Bun 1.3.14, Vite production build, установленный Playwright Chromium headless, Linux 6.17, Ryzen 7 9700X, 16 логических CPU.
- Без CPU/network throttling и расширений; новые browser contexts. Настройки существующего профиля моделировались seeded localStorage. Настоящие профили пострадавших пользователей, Firefox и production не проверялись.
- Реальный frontend собран в `/tmp/gamma-performance-audit-build`. Backend, auth и события представлены fixtures существующего timeline benchmark с диагностическими дополнениями. LLM не вызывалась.
- Старый fixture не покрывает Gamma file API; соответствующие error toasts на скриншотах не доказывают дефекты production.
- Preview на `127.0.0.1:4517` запускался и завершался Playwright. Рабочие сервисы не перезапускались.

## Содержимое

| Материалы | Назначение |
| --- | --- |
| `gamma-audit-*.png`, шесть theme JSON | Снимки production UI и computed styles при разных темах/viewport/storage |
| `gamma-audit-theme-interaction.json` | Light → dark → light, свойства кнопки и hit-test |
| `gamma-audit-recovery.json` | Пропуск финального события, reconnect без refetch, восстановление после reload |
| `gamma-perf-0.json`, `gamma-perf-49.json`, `gamma-perf-249.json` | По одному baseline-прогону на 2, 100 и 500 сообщений, 20 последовательных deltas |
| `performance-summary.json` | Агрегация baseline; медианы и максимумы, не production percentiles |
| `gamma-perf-249-trace.json`, `renderer-trace.json.gz` | Отдельный instrumented прогон на 500 сообщений |
| `gamma-audit-trace-summary.json` | Trace timings и CPU samples с сопоставлением исходникам |
| `gamma-audit-catalog.jsonl` | Прямые read-only вызовы настоящей `AgentCatalog.bundle()` на существующих bundles, по пять повторов |
| `*.log` | Вывод сборки и выполненных браузерных проверок |
| `specs/`, `*.config.ts`, `*.ts` | Снимки временного диагностического harness и скриптов |

`gamma-audit-browser.log` содержит исходный **неуспешный** штатный benchmark: auth gate не пропустил fixture, ожидание заголовка завершилось timeout. Это не измерение latency Gamma. Остальные браузерные прогоны: 6 theme cases + 3 streaming baselines + 1 recovery + 1 theme interaction + 1 trace = 12 успешных проверок.

## Воспроизведение

Команды рассчитаны на тот же checkout с установленными зависимостями и браузером. Диагностические копии содержат абсолютный путь `/home/nikita/menti/mvp_platform`; в другом checkout нужно заменить его **в копиях harness**, включая imports. Не следует менять исходники приложения или запускать команды на production.

Из корня репозитория подготовить временные копии:

```bash
mkdir -p /tmp/gamma-audit-specs
cp docs/audits/evidence/2026-10-12/specs/*.ts /tmp/gamma-audit-specs/
cp docs/audits/evidence/2026-10-12/gamma-audit-incident.config.ts /tmp/
cp docs/audits/evidence/2026-10-12/gamma-audit-catalog.ts /tmp/
```

Сборку и browser tests запускать из `packages/app`, последовательно. Порт 4517 должен быть свободен; `reuseExistingServer:false` не допускает подключения к чужому сервису.

```bash
cd packages/app
SENTRY_AUTH_TOKEN= VITE_OPENCODE_SERVER_HOST=127.0.0.1 VITE_OPENCODE_SERVER_PORT=4517 bun run build --outDir /tmp/gamma-performance-audit-build
PLAYWRIGHT_PORT=4517 bunx --no-install playwright test --config /tmp/gamma-audit-incident.config.ts incident.spec.ts
PLAYWRIGHT_PORT=4517 bunx --no-install playwright test --config /tmp/gamma-audit-incident.config.ts performance.spec.ts
PLAYWRIGHT_PORT=4517 bunx --no-install playwright test --config /tmp/gamma-audit-incident.config.ts recovery.spec.ts
PLAYWRIGHT_PORT=4517 bunx --no-install playwright test --config /tmp/gamma-audit-incident.config.ts theme-interaction.spec.ts
GAMMA_AUDIT_TRACE=1 PLAYWRIGHT_PORT=4517 bunx --no-install playwright test --config /tmp/gamma-audit-incident.config.ts performance.spec.ts --grep history-500
```

Пустой `SENTRY_AUTH_TOKEN` предотвращает upload sourcemaps диагностической сборки. Результаты harness пишутся в `/tmp/gamma-*`; отчёты и сохранённые evidence автоматически не обновляются. Снимки скриптов — материалы эксперимента, не добавление нового штатного тестового набора.

Для отдельного измерения чтения/проверки bundles:

```bash
bun /tmp/gamma-audit-catalog.ts
```

Для просмотра сохранённого trace распаковать `renderer-trace.json.gz` и загрузить JSON в Chrome DevTools Performance. Скрипт `gamma-audit-trace-summary.ts` ожидает `/tmp/gamma-audit-renderer-trace.json` и sourcemaps **той же** сборки в `/tmp/gamma-performance-audit-build/assets`. Они не включены в evidence; сохранённый summary уже содержит сопоставления. Новая сборка с иным содержимым не подходит для расшифровки старого trace.

## Как интерпретировать числа

В streaming harness timestamp снимается при прохождении chunk через `TransformStream`, затем в `MutationObserver` и на следующем `requestAnimationFrame`. RAF не гарантирует физического отображения пикселей. Наблюдатели и обёртка fetch сами имеют стоимость. Setup duration включает fixture setup/navigation/readiness; это не click-to-first-answer.

Искусственные данные используются для измерения **реального рендера**. Последовательные 20 deltas не моделируют event storm или реальную скорость provider. Короткие SSE-ответы fixture намеренно вызывают reconnect; число таких запросов не является числом одновременных production connections. Recovery подтверждает отсутствие resync в данном порядке событий, а не частоту потерь в эксплуатации.

Baseline и trace запускались отдельно. Trace включает startup, вложенные категории нельзя складывать в end-to-end latency. JS heap — моментальный снимок, не доказательство утечки; CDP TaskDuration — время выполнения задач, не CPU utilization. Пять повторов catalog на реальных файлах не означают cold disk: OS page cache не сбрасывался. Нет измерений настоящего backend request, provider TTFT, INP пострадавшего пользователя или длительного soak.
