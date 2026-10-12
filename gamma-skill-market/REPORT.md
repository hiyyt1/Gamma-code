# Gamma Skill Market — отчёт

Проверено 8 октября 2026 года. Изменения не закоммичены. Существующие незакоммиченные изменения Gamma сохранены.

## Результат

В `/skills` работает продуктовый каталог из 20 реальных кандидатов: поиск по названию и описанию, семь категорий и «Все», адаптивные белые карточки, выбор проекта, подробности пакета, состояния загрузки, пустого поиска и ошибки. Карточки показывают автора, категорию, число навыков из манифеста, доступность и подтверждённое backend состояние подключения. Подробности содержат репозиторий, commit SHA, лицензию, реальные навыки, зависимости и результат проверки. Фиктивных рейтингов и установок нет.

Все 20 репозиториев получены для аудита с закреплением SHA. В контролируемую поставку включены исходники 17 пакетов с сохранением лицензий; у 16 из них исходники хранятся в инертных архивах. Один пакет, Superpowers v4.3.1, установлен и доступен для подключения в Gamma V1: 14 навыков. Остальные пакеты нельзя включить через API или интерфейс.

Статусы: **1 verified, 7 needs-adaptation, 9 needs-configuration, 3 unsupported**. Всего обнаружено **1276 файлов SKILL.md**, каталог содержит **1105 уникальных валидных имён внутри пакетов**. Дубликаты и ошибки frontmatter перечислены в `packages/<id>/audit.json`; эти числа не означают 1105 совместимых навыков.

`verified` означает проверенную интеграцию закреплённого адаптированного набора с native discovery и skill tool Gamma V1. Полное исполнение каждого workflow, GitHub PR, рендеринг диаграмм и работа с произвольными проектными SDK не проверялись. Зависимости этих сценариев явно показаны в UI. В текущем V2 нет task/subagent; Superpowers исключён из его discovery через поле `runtimes`, а не объявлен совместимым.

## Аудит кандидатов

| Пакет | Skills | Лицензия | Зависимости / настройка | Статус |
|---|---:|---|---|---|
| [Superpowers](https://github.com/obra/superpowers) | 14 | MIT | Git и инструменты тестирования текущего проекта — для рабочих процессов разработки; Необязательно: авторизованный gh CLI для GitHub PR; Node.js и Graphviz dot для render-graphs.js. В окружении проверки gh и dot отсутствуют; эти сценарии не проверены и недоступны без настройки.; Gamma V1 со штатным task (subagent_type: general). В V2 этой версии отсутствует инструмент делегирования — пакет недоступен. | `verified` |
| [Wshobson Agents](https://github.com/wshobson/agents) | 184 | MIT | Claude Code Agent Teams / hooks; CLI, SDK и тестовые инструменты зависят от навыка; облачные учётные данные не настроены | `needs-adaptation` |
| [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | 7 | MIT | Python 3; локальные CSV-ресурсы поиска; Node.js и внешние инструменты для отдельных дизайн-сценариев | `needs-adaptation` |
| [Addy Osmani Agent Skills](https://github.com/addyosmani/agent-skills) | 25 | MIT | Chrome DevTools MCP и браузер; Git и инструменты сборки/тестирования проекта | `needs-configuration` |
| [Softaworks Agent Toolkit](https://github.com/softaworks/agent-toolkit) | 43 | MIT | Codex/Gemini CLI; Datadog/Jira credentials для соответствующих навыков; Дополнительные Python/Node-зависимости скриптов не установлены | `needs-adaptation` |
| [OpenCode Skills](https://github.com/polip/opencode-skills) | 66 | MIT | Atlassian MCP и авторизация Jira/Confluence; Языковые SDK, Docker/Kubernetes и облачные CLI зависят от сценария | `needs-configuration` |
| [Composio OpenCode Skills](https://github.com/composio-community/opencode-skills) | 27 | Не обнаружена | Composio и внешние интеграции; авторизация зависит от навыка | `unsupported` |
| [Joshua Agent Skills](https://github.com/joshuadavidthomas/agent-skills) | 26 | MIT | jj 0.36+ для jj skill; Rust/Cargo и Coolify/Docker для соответствующих сценариев | `needs-configuration` |
| [Sentry Engineering Skills](https://github.com/getsentry/skills) | 28 | Apache-2.0 | GitHub CLI и авторизация для PR-workflows; Claude Code settings и отдельные внутренние workflows не поддержаны автоматически | `needs-adaptation` |
| [Better Auth Skills](https://github.com/better-auth/skills) | 6 | Не обнаружена | Better Auth и зависимости приложения | `unsupported` |
| [Agent Skills Collection](https://github.com/Emmraan/agent-skills) | 172 | MIT | Atlassian MCP; браузерные и облачные инструменты; Runtime-зависимости выбираются отдельно для каждого skill | `needs-configuration` |
| [Garden Skills](https://github.com/ConardLi/garden-skills) | 5 | MIT | API генерации изображений и ключ доступа; Python/Node.js и браузерные инструменты; ресурсы для retrieval и видео | `needs-configuration` |
| [Sentry for AI](https://github.com/getsentry/sentry-for-ai) | 34 | MIT | Sentry MCP и авторизация организации; SDK Sentry для выбранного языка / платформы | `needs-configuration` |
| [Anthropic Skills](https://github.com/anthropics/skills) | 20 | Mixed: Apache-2.0 / Anthropic proprietary | Зависимости Python/Node.js и офисные инструменты зависят от skill | `unsupported` |
| [Expo Skills](https://github.com/expo/skills) | 26 | MIT | Node.js, Expo/EAS CLI и авторизация EAS; Мобильные SDK/эмуляторы для платформенных проверок | `needs-adaptation` |
| [Cloudflare Skills](https://github.com/cloudflare/skills) | 16 | Apache-2.0 | Node.js и Wrangler CLI; Cloudflare account / API token с ограниченными правами; дополнительные MCP по сценарию | `needs-configuration` |
| [Microsoft Skills](https://github.com/microsoft/skills) | 200 | MIT | Azure CLI, Azure/M365 credentials и MCP; Python/.NET/Java/Node SDK по выбранному навыку | `needs-adaptation` |
| [Trail of Bits Skills](https://github.com/trailofbits/skills) | 85 | CC-BY-SA-4.0 | Semgrep, CodeQL, Slither, fuzzers и компиляторы по сценарию; Изолированное окружение; некоторые workflows требуют Docker/Claude hooks | `needs-configuration` |
| [Open-Hax Skills](https://github.com/open-hax/opencode-skills) | 74 | MIT | Bun/Node.js; PM2, Docker, Clojure и Nx для соответствующих навыков; MCP и конфигурация конкретного workspace | `needs-adaptation` |
| [AI Agent Skills](https://github.com/julweber/ai_agent_skills) | 47 | MIT | Claude/Codex/Pi/OpenCode CLI для соответствующих skills; Docker, Terraform, Ansible, tmux, uv и сервисные credentials по сценарию | `needs-configuration` |

Полные причины статусов, SHA, имена/описания навыков и зависимости находятся в [catalog.json](catalog.json) и `packages/<id>/manifest.json`. Source SHA фиксируется в [candidates.json](../script/skill-market/candidates.json); при изменении выбранной ревизии загрузчик требует повторного включения. Последняя доступная версия Superpowers не подменяет проверенную v4.3.1 автоматически.

Composio и Better Auth не распространяются в этой поставке: в закреплённых источниках не обнаружена подходящая лицензия. Anthropic не распространяется целиком из-за смешанных условий отдельных document skills. Каталог содержит их метаданные и объяснения блокировки. Разрешённые поднаборы потребуют самостоятельного состава и проверки. Вложенные лицензии и NOTICE остальных архивов сохранены; разрешение корневой лицензии не объявляется заменой условий всех вложенных материалов.

## Хранение и безопасность

```
gamma-skill-market/
  catalog.json
  packages/<id>/manifest.json
  packages/<id>/audit.json
  packages/<id>/source.tar.gz       # 16 непроверенных runtime-пакетов
  packages/superpowers/upstream/   # оригинал, вне discovery
  packages/superpowers/skills/     # адаптация с исходными resources
  packages/superpowers/files.json # SHA-256 всех runtime-ресурсов
  packages/superpowers/ADAPTATION.md
```

Архивы загружались через GitHub API/codeload по commit SHA. Распаковщик отклоняет traversal и абсолютные пути, пропускает symlinks/hardlinks и прочие нестандартные записи, ограничивает размер архива/распаковки. Инвентаризация использует существующий `ConfigMarkdown.parseOption`. Проверялись вызовы runtime-specific tools, hooks, MCP, subagents, commands, загрузка кода, shell-операции, секреты и системные изменения. Находки сохранены в audit.json; статический поиск не является доказательством безопасности исполнения всех сторонних scripts.

Сторонние install scripts, hooks, плагины и исполняемые ресурсы не запускались. Системные зависимости не устанавливались. Единственная адаптация подключаемого пакета добавляет явное соответствие инструментов Gamma, ограничения разрешений и namespace; оригинал сохранён отдельно. Необязательные scripts не считаются проверенными для исполнения. Skills не получают дополнительных прав: остаются обычными инструкциями под существующими разрешениями tool/runtime. Новая OS/container-песочница этой задачей не добавлена.

Перед выдачей источников проверяются хеши всех runtime-файлов, manifest и отсутствие symlinks в каждом компоненте пути. При повреждении пакет не попадает в discovery. Backend никогда не получает filesystem path пакета от клиента. Архивы и upstream не регистрируются как skill directories.

## Backend и поведение переключателя

Переиспользованы `ConfigMarkdown`, существующие `Skill.Service` V1 и `SkillV2`, native `SkillTool`, `InstanceStore`, `Location`, `ProductProjects`, Drizzle/SQLite и действующая `Authorization`. Market service отвечает за каталог, проверку поставки и выбор пакетов, не создавая второго skill engine. Inference/provider routing не изменялся.

HTTP API:

- `GET /product/skill-market/packages`
- `GET /product/skill-market/packages/:id`
- `GET /product/projects/:project/skills`
- `POST /product/projects/:project/skills/:id` с `{ "enabled": true | false }`

Проект проверяется существующим `ProductProjects` внутри серверного workspace root; traversal и symlink-подмена блокируются. Действует существующая серверная аутентификация Gamma. Это single-user граница доступа конкретного экземпляра сервера, а не новая multi-tenant ACL: у проекта нет отдельной owner-модели. Если несколько пользователей делят один экземпляр и credential, для SaaS необходимо сначала внедрить настоящую модель владельцев/tenant; нельзя считать этот API изоляцией таких пользователей.

Выбор хранится в таблице `skill_market_selection` существующей БД по каноническому каталогу проекта и ID пакета, с закреплённой ревизией. Это отличает проекты без Git, у которых legacy Project ID может быть общим. Отдельных JSON-файлов пользовательского состояния нет. Новая миграция подключена штатным генератором.

Включение валидирует пакет, runtime, Git, целостность и конфликт имён, сохраняет SQLite и возвращает фактический выбор. UI меняется только после ответа; при сетевой неопределённости перечитывает состояние. Известные ошибки отображаются понятным сообщением. Имена подключённых навыков имеют вид `superpowers:brainstorming`; локальный навык не перезаписывается молча. При конфликте включение отклоняется. Локальное добавление конфликта после включения сохраняет приоритет локального skill.

При каждом новом native discovery/call учитывается текущий выбор. Выключение удаляет только строку выбора, а не файлы и не уже загруженное содержимое. Следующий вызов выключенного skill отклоняется даже ранее инициализированным SkillTool. Содержимое, уже попавшее в историю сессии, не стирается.

## Проверки

После этапа frontend открыты и визуально проверены каталог, детали, поиск и мобильная версия. Затем реальные данные заменили временный preview. После аудита проверены схемы всех 20 манифестов, SHA и загрузка Superpowers штатным parser. После подключения проведены:

- Frontend unit: **736 passed, 0 failed**.
- Core регрессии skills/config/project/session/migrations: **81 passed, 0 failed**, дополнительно plugin/guidance checks; после runtime-коррекции повторно **8 passed, 0 failed** в четырёх затронутых файлах.
- Backend native skills/tool, market API, проекты и пустые сессии: **46 passed, 0 failed**; после последней правки повторно **2 passed, 0 failed** с реальным SkillTool и HTTP API.
- Playwright Chromium: **2 passed**, desktop 1440×1050 и mobile 390×844, поиск/категории, детали, A/B, refresh, enable/disable, сетевой сбой, catalog retry, отсутствие ошибок страницы и горизонтального overflow.
- `bun typecheck` из app/core/opencode, frontend e2e typecheck — успешно.
- `packages/client: bun run generate` — успешно; сгенерированные файлы вручную не правились.
- `packages/core: bun run migration --check` — успешно.
- Production frontend build и backend build `--single --skip-install --skip-embed-web-ui` — успешно. Backend собран отдельно от web assets; упаковка deployment должна включать оба результата. Vite сообщает обычные предупреждения о размере chunks/dynamic imports.

Интеграционный сценарий создаёт реальные сессии проектов A/B, проверяет отсутствие выключенного навыка, включает пакет, вызывает `superpowers:verification-before-completion` настоящим SkillTool с проверкой запроса permission, проверяет текст, выключает и повторяет вызов с отказом. Provider/LLM для этого не вызывается; это проверка реального engine/tool, а не качества модельного workflow.

Дополнительно дважды перезапущен только изолированный тестовый backend с той же файловой SQLite: A сохранил `superpowers`, B остался пустым, `/skill` для A вернул 14 навыков. Рабочие сервисы пользователя не перезапускались. Проверены неизвестный пакет, несовместимость, конфликт имён, отсутствие авторизации, выход за workspace, повреждённый ресурс и symlink. Полный набор тестов всего монорепозитория не запускался; регрессии проверялись указанными наборами.

## Скриншоты

- [Desktop](screenshots/desktop.png)
- [Подробности](screenshots/details.png)
- [Поиск](screenshots/search.png)
- [Mobile](screenshots/mobile.png)

## Поставка и воспроизведение

В deployment скопировать `gamma-skill-market/` вместе с backend и задать абсолютный `GAMMA_SKILL_MARKET_ROOT`; пример добавлен в `deploy/gamma.env.example`. Каталог должен управляться администратором и быть доступен агенту только для чтения, вне пользовательских workspace. Не назначать агенту права изменять каталог/манифесты. SQLite должна оставаться на постоянном томе; миграции применяются штатным запуском backend. Старый executable не поддерживает новую таблицу/API до пересборки. На production изменения автоматически не выкатывались.

Административное воспроизведение использует установленные Python 3, curl и Bun, без сторонних install scripts:

```bash
python3 script/skill-market/fetch.py
bun run script/skill-market/inventory.ts
python3 script/skill-market/package.py
```

Эти команды выполняются в checkout на этапе поставки, не в пользовательском запросе. Для отдельного чистого аудита указать новый `GAMMA_SKILL_MARKET_AUDIT_ROOT`. SHA заданы в candidates.json. Изменение состава/ревизии требует повторного ручного аудита decisions.json, лицензий и тестов; успешный разбор frontmatter не повышает статус автоматически.

Осталось для расширения каталога: адаптировать семь пакетов, настроить и безопасно проверить девять, получить подходящие права/выделить законно распространяемые поднаборы для трёх заблокированных; отдельно проверить V2 после реализации требуемого делегирования. Ни один из этих пунктов не скрыт за активным переключателем.
