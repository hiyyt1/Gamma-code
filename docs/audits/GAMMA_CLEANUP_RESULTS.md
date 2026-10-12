# Gamma: результаты безопасной очистки

Дата: 12 октября 2026. Основание: [аудит наследия](GAMMA_OPENCODE_LEGACY_AUDIT.md). Изменения отсчитываются от рабочего дерева перед очисткой, а не от HEAD: в репозитории уже были многочисленные пользовательские изменения. Их не откатывали.

## Удалено

Выполнены S01–S09. Пути относительно `packages/app/src/`:

- `components/dialog-select-directory.tsx`
- `pages/home/home-projects.tsx`
- `pages/home/home-sessions.tsx`
- `pages/session/review-tab.tsx`
- `pages/session/session-side-panel.tsx`
- `pages/session/v2/review-panel-v2.tsx`
- `pages/skill-market.tsx`
- `pages/product-placeholder.tsx`
- В `app.tsx`: локальная невызываемая `LayoutCompatibility` и import `ProductPlaceholder`.

Повторный поиск символов и путей по packages, scripts, deploy, infra и hidden-файлам подтвердил выводы аудита. После очистки ссылок на удалённые exports в packages нет. Упоминания в исторических документах, CSS selectors и тестовых storage keys не являются imports; они сохранены. Общие controllers, views, state/helpers, CSS и backend skill-market сохранены.

Удалён `packages/docs` целиком: **24 файла**, включая Mintlify README/config, примерные MDX-страницы, SVG-логотипы/favicon, три PNG и локальный снимок `openapi.json`. Это автономный upstream-шаблон, без package.json, runtime entrypoint или потребителей Gamma. Поиск `packages/docs`, `@opencode-ai/docs` и Mintlify в scripts/deploy/infra/workflows не обнаружил использования. `script/generate.ts` пишет другую спецификацию — `packages/sdk/openapi.json`; она сохранена. Удалено единственное внешнее устаревшее исключение `packages/docs/ai-tools/cursor.mdx:curl-auth-header:127` из `.gitleaksignore`. Возможная внешняя публикация именно этого Mintlify-сайта больше не поддерживается; Gamma его не использует.

Полный перечень удалённых файлов с исходными размерами и SHA-256: [before.json](evidence/gamma-cleanup-2026-10-12/before.json). Файл также содержит записи резервированных, но не удалённых app.tsx, manifest, lockfile и ignore.

## Объём очистки

| Область | Файлы удалены | Текстовые строки удалены | Удалённые байты |
| --- | ---: | ---: | ---: |
| S01–S08 | 8 | 2 023 | 84 589 |
| S09 и import в app.tsx | 0 | 25 | 842 |
| packages/docs | 24 | 38 690 | 1 512 611 |
| .gitleaksignore | 0 | 1 | 55 |
| Всего | **32** | **40 739** | **1 598 097** |

Строки посчитаны по фактическим файлам до удаления, PNG исключены. Большая часть — 36 959 строк форматированного docs/openapi.json; это не объём удалённого исполняемого кода. История Git не очищалась, размер `.git` не уменьшался. Размер добавленных отчёта/evidence не включён в экономию исходников.

## Что сохранено

| Кандидат | Почему пропущен |
| --- | --- |
| packages/console | Общий infra/console.ts с handlers, build и core; root dev:console |
| packages/stats | infra/stats.ts, Docker/server/core и root dev:stats |
| packages/web | infra/app.ts и два docs workflow |
| packages/enterprise | infra/enterprise.ts |
| packages/function | infra/app.ts handler и turbo test task |

Это не доказательство необходимости этих продуктов для Gamma. Их удаление требует отделения общей SST-инфраструктуры, что исключено из данной быстрой очистки. Поэтому относящиеся к ним scripts, workspace globs и workflows сохранены. У packages/docs собственных scripts/workspace declarations/workflows не было; удалено **0 scripts/workflows**. Существующие app/dist, общие assets, SDK, инструменты и runtime не трогали.

Проверены семь app declarations: `@shikijs/transformers`, `@solid-primitives/{active-element,audio,scheduled,scroll,timer,websocket}`. Прямых потребителей в app не найдено, но пробный `bun install --lockfile-only --ignore-scripts` затребовал переразрешение более широкого workspace-графа и завершился `UnsupportedProxyProtocol`. По правилу «сложное пропускай» manifest восстановлен побайтно. **Удалённых dependency declarations: 0.** `bun.lock` побайтно совпадает с состоянием перед работой, включая существующие пользовательские изменения. Новых зависимостей не добавлено; успешная чистая установка не заявляется.

## Проверки

Сборки использовали `OPENCODE_CHANNEL=prod`, пустой `SENTRY_AUTH_TOKEN` и отдельные `/tmp/gamma-cleanup/{before,after}`. Работающий dist не перезаписывался. Browser suites использовали отдельные preview-порты 4518/4520 и тестовые API fixtures.

| Проверка | Результат |
| --- | --- |
| `bun typecheck` из packages/app | PASS |
| Production frontend до/после: `bun run build --outDir /tmp/gamma-cleanup/{before,after}` | PASS; стандартное предупреждение Vite о больших chunks |
| `bun run test:unit` из packages/app | **774 PASS, 3 FAIL** — существующие проблемы i18n parity |
| Browser unit: `bun test --conditions=browser --preload ./happydom.ts ./test-browser` | 44 PASS |
| Navigation Playwright suite, 3 цикла на профиль | 15 PASS; 4 phase-gated сценария отдельно запущены с GAMMA_NAV_PHASE=after: **4 PASS** |
| Gamma-light Playwright suite | 16 PASS, desktop/mobile, темы, loading и взаимодействия |
| deploy auth/auth-config/web tests | 28 PASS, включая SSE и WebSocket |
| `python3 -m unittest test_installer.py` из deploy/installer | 24 PASS |
| Ссылки на удалённые exports и diff whitespace | PASS |
| Manifest и lockfile против резервной копии перед работой | Побайтно одинаковы |

Три unit FAIL: неполные non-English keys, отсутствующие placeholder dictionaries и plural-категории `workspace.files.count.zero/two`. Они воспроизведены отдельно в `/tmp/gamma-cleanup/parity` только с копиями app/ui/desktop словарей и parity.test.ts: 2 PASS, те же 3 FAIL. Этот тест не импортирует удалённые модули; словари не изменялись. Исправление переводов вне объёма очистки.

Путь `bun run dev:gamma` проверен по коду: script/dev-gamma.ts → packages/app build → packages/opencode/src/index.ts serve → deploy/web.ts. Все пути сохранены. Installer build_release продолжает проверять runtime/agent-market/skill-market, выполнять frozen install и app production build; эти файлы и зависимости не менялись. Реальный production deployment и чистая установка не выполнялись. Рабочие backend/gateway PID 121161/121204 остались с прежним временем запуска; данные пользователей не изменялись.

## Измерения

Фактические размеры output, без gzip:

| Артефакты | До, байт | После, байт | Разница |
| --- | ---: | ---: | ---: |
| Все JS | 31 935 950 | 31 935 950 | 0 |
| Все CSS | 585 563 | 585 407 | −156 |
| Sourcemaps | 58 920 857 | 58 919 981 | −876 |

Мёртвые UI-модули уже исключались tree shaking; значимого уменьшения runtime bundle нет. Для проверки навигации выполнены отдельные последовательные desktop benchmark до/после на production builds, по 3 цикла. Медиана input→usable, мс: Agents 117,3→117,1; Knowledge 120,5→119,5; Projects 11,4→13,1; Chat 55,5→70,4; Home 19,0→19,4. Такая малая выборка не доказывает ускорения или регрессии; функциональные проверки прошли. Полный navigation suite выполнялся параллельно с light smoke и для количественного сравнения производительности не используется. CPU/RAM/startup выигрыш не заявляется.

[Логи и измерения](evidence/gamma-cleanup-2026-10-12/) сохранены вместе с отчётом. Основной результат: удалены девять подтверждённых единиц dead code и один изолированный upstream docs-продукт; спорная инфраструктура и dependency graph оставлены без изменений.
