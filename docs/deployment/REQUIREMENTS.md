# Gamma: требования к развёртыванию

Точка входа: [INSTALL.md](INSTALL.md). Конфигурация: [CONFIGURATION.md](CONFIGURATION.md), разрешения: [PERMISSIONS.md](PERMISSIONS.md), эксплуатация и результаты аудита: [OPERATIONS.md](OPERATIONS.md), приёмка: [CHECKLIST.md](CHECKLIST.md).

## Статус доказательств

Аудит исходников 12 октября 2026 года выполнен на изменённом рабочем дереве. Целевой источник установщика — `https://github.com/hiyyt1/Gamma-code.git`; локальный `origin` upstream OpenCode не используется. `--ref` разрешается в immutable SHA и записывается в `/etc/gamma/install.json`. Новые файлы установщика требуется опубликовать перед запуском из GitHub. Сам аудит/разработка ничего не публикуют.

Исследована конфигурация из репозитория, а не состояние работающего VPS. Системные env, секреты, unit-файлы и Nginx текущего production не читались. Чистая VM, реальный DNS/TLS и платный LLM в рамках аудита не проверялись. Ни один размер сервера ниже не является результатом нагрузочного теста. Полную гарантию даёт только прошедший приёмку фиксированный релиз, образ ОС и манифест зависимостей.

## ОС и ресурсы

| Компонент | Базовый профиль | Основание / ограничение |
| --- | --- | --- |
| ОС | Ubuntu Server 24.04 LTS, amd64 | Предлагаемый стандарт; в проекте нет сертифицированной матрицы Ubuntu |
| Ubuntu 22.04 LTS | Кандидат совместимости, отдельная приёмка | glibc/Linux подходят; нужен отдельный Node, Java 21 для 1C. Не считать проверенной платформой |
| Другие Ubuntu / arm64 | Не включены в стандарт до CI-проверки | Нативные PTY, watcher, FFI, браузер и зависимости требуют проверки на целевой архитектуре |
| CPU | Плановый минимум 2 vCPU; рекомендовано 4 | Один пользователь, внешний LLM; сборки и браузеры требуют дополнительных CPU |
| RAM | Минимум 8 GiB для установки со сборкой; рекомендовано 16 GiB | При Chromium/LibreOffice/1C и параллельных проектах начать с 16 GiB; измерить peak RSS |
| Диск | Минимум 30 GiB SSD; рекомендовано 80 GiB | Без больших пользовательских данных; хранить запас не менее 20%, backup вне VPS |
| ФС | Локальная ext4; `/proc`, glibc | Knowledge использует `bun:ffi`, `libc.so.6`, `flock`, `renameat2(RENAME_EXCHANGE)`, `/proc`; SQLite WAL. NFS и object mount не квалифицированы |
| GPU | Не требуется | Модели вызываются через провайдеров; локальный inference — отдельный sizing |

Ubuntu публикует жизненный цикл LTS: [Canonical](https://ubuntu.com/about/release-cycle). Это поддержка ОС, не обещание совместимости Gamma. Дистрибутив musl/Alpine не заменяет Ubuntu для текущей Knowledge implementation.

## Обязательные зависимости стандартного профиля

| Зависимость | Версия / назначение |
| --- | --- |
| Bun | **1.3.14**, закреплён в корневом `package.json`; backend и gateway используют Bun APIs, SQLite/FFI; Node не заменяет Bun |
| Node.js и npm | Installer закрепляет Node **22.22.0**, проверяет SHA-256 архива и записывает версию в manifest. Нужен для npm CLI, shebang инструментов, пользовательских проектов и части MCP |
| Vite | Lockfile проекта, catalog 7.1.4; Node должен быть 20.19+ или 22.12+ по [Vite 7](https://vite.dev/blog/announcing-vite7). Bun запускает backend, но это не отменяет Node-зависимости сторонних инструментов |
| git, ca-certificates, curl, unzip, xz-utils | Clone, HTTPS, установка runtime |
| build-essential, python3, pkg-config | Страховка сборки native dependencies при отсутствии подходящих prebuild; не ставить compiler от имени агента через sudo |
| bash, coreutils, findutils, util-linux, procps, tar | Shell, flock, диагностика/backup; обычно уже есть в Ubuntu |
| ripgrep | Поиск; исключает зависимость от runtime скачивания поискового бинарника |
| nginx, certbot | HTTPS reverse proxy и сертификат; Ubuntu-пакеты, конкретные версии записать в manifest |
| systemd | Два процесса приложения, restart/autostart; штатный systemd Ubuntu |
| sqlite3 | Операционная проверка/backup; сервер БД не нужен, библиотека встроена в Bun |

Установка Bun фиксированной версии описана в [Bun installation](https://bun.com/docs/installation). Современная документация Bun может описывать более новую версию; проверять фактический binary на CPU целевого VPS. В этом стандарте версия не заменяется автоматически на latest.

PostgreSQL, Redis, Docker, Kubernetes, PM2, внешний vector DB не требуются. SQLite migrations выполняются backend при открытии БД (`packages/core/src/database/database.ts`). Не запускать вручную Drizzle push поверх production.

## Опциональные возможности

| Возможность | Что установить / настроить |
| --- | --- |
| Presentation agents | `libreoffice-impress libreoffice-calc poppler-utils python3 fontconfig fonts-liberation`; Chromium для `playwright@1.59.1`, его OS dependencies; vision-capable модель. Проверки инструментов: `packages/opencode/src/presentation/service.ts:health` |
| 1C source tools | Installer использует Ubuntu `python3-lxml` + `/usr/bin/python3`; ручной venv-вариант закреплён отдельно в `gamma-agent-market/bundles/1c-development/requirements.txt` |
| 1C BSL MCP | Installer ставит Java 21 и проверенный JAR; BSL Language Server `1.1.0-rc.6` exec.jar; `GAMMA_BSL_JAR`, `GAMMA_BSL_JAVA`, `GAMMA_1C_PYTHON`. Java запускается с `-Xmx1g`; это дополнительная память |
| Bitrix24 | Настроенное подключение портала и scopes, исходящий HTTPS, UI approval key; docs MCP опционально. Credentials соединения в памяти, reconnect после restart |
| Wildberries | Подключение с токеном и разрешёнными scopes; `GAMMA_WB_ON_PREMISE=1` только при необходимости personal token; соединения в памяти, аудит на диске |
| Skills | Доставленные каталоги плюс зависимости конкретных SKILL.md. Наличие инструкции не устанавливает Python/CLI автоматически |
| MCP пользователя | Явные `mcp` entries и закреплённые команды/пакеты; Node/Python/uv/Java/Docker только если конкретный сервер требует их |
| Playwright-тесты | Chromium и системные browser dependencies; installer ставит release-local Chromium, тесты должны явно задавать PLAYWRIGHT_BROWSERS_PATH при изолированном XDG |
| Docker-проекты | Отдельный executor/VM желательно; membership в host `docker` group эквивалентно опасному доступу к хосту. В базовую Gamma его не добавлять |
| Другие проекты | Python venv, Go, Rust, PHP и др. — per-project toolchain. Нет универсальной гарантии запуска любого проекта после одного `bun install` |

## Сеть

* Входящие: TCP 443 пользователям, TCP 80 для HTTP→HTTPS и ACME; SSH на фактическом порту только администраторам. Не открывать 4096, 4444, 4097, Vite 3000 и порты пользовательских dev servers.
* Исходящие: DNS к resolver, синхронизация времени, HTTPS к GitHub, package registries, Bun/Node downloads, `models.opencode.ai` (каталог ModelsDev), выбранным LLM и MCP. Git SSH 22 нужен только при SSH clone. Список разрешённых destinations зависит от провайдеров/проектов.
* DNS A на IP VPS; AAAA только при реально настроенном IPv6. `GAMMA_PUBLIC_ORIGIN` — точный HTTPS origin без `/` в конце, без path, userinfo.
* Preview: второй независимый регистрируемый домен, wildcard DNS и wildcard TLS. Например приложение `gamma.example.com`, preview `*.preview.example.net`; это примеры, домены нужно заменить на принадлежащие владельцу.
* Nginx обязан проксировать все application/API маршруты через gateway, поддерживать SSE без buffering и WebSocket Upgrade. Прямой public upstream на backend обходил бы пользовательскую авторизацию.

## Production topology и каталоги

```text
browser -- HTTPS:443 --> nginx --> 127.0.0.1:4444 deploy/web.ts
                                     | cookie auth + static app/dist
                                     +--> Basic-auth --> 127.0.0.1:4096 OpenCode serve
                                                        | SQLite, files, LLM, MCP
preview browser --> nginx (отдельный домен) --> 127.0.0.1:4097 static preview
```

Backend — `packages/opencode/src/index.ts serve` (Legacy Gamma endpoints плюс доступная V2 инфраструктура). Gateway — `deploy/web.ts`, frontend — Vite production assets `packages/app/dist`. `packages/server` не надо запускать отдельным третьим сервером. Активная Gamma `/session` orchestration идёт через Legacy SessionPrompt; Core V2 не является взаимозаменяемым полным продуктовым backend.

| Путь стандарта | Владелец / данные |
| --- | --- |
| `/opt/gamma/releases/<id>` | Новый UUID-каталог каждого build, root:root после сборки; точный путь хранится в install.json и units, без current symlink |
| `/home/gamma` | gamma:gamma 0700, домашний каталог service user без sudo |
| `/opt/gamma/runtime` | Root-owned Bun 1.3.14 и Node 22.22.0; pins/SHA-256 в installer |
| `/home/gamma/workspaces` | gamma:gamma 0700; все проекты; не класть в checkout |
| `/var/lib/gamma/opencode.db` | SQLite плюс `-wal`/`-shm`, история, project/session/market state, V2 permissions |
| `/var/lib/gamma/data/opencode` | auth.json провайдеров, mcp-auth.json, repos, snapshots/другие данные, log, integration audit |
| `/var/lib/gamma/knowledge` | Независимая Knowledge root: spaces, registry, blobs; не пересекается с workspaces, без symlink ancestors |
| `/var/lib/gamma/config/opencode` | Global config/agent/skill/plugin; штатно доступен runtime |
| `/var/lib/gamma/state/opencode` | State и lock files |
| `/var/lib/gamma/cache/opencode` | Cache и скачанные bin; не первичный backup |
| `/etc/gamma/gamma.env`, `backend.env` | root:root 0600, читает systemd; backend.env содержит внутренний пароль |
| `/etc/gamma/auth.json` | gamma:gamma **0600**, читает gateway, Argon2id; это не provider auth.json |
| `/etc/gamma/opencode.json` | root:root 0644, фиксированная несекретная политика Legacy |
| `<release>/gamma-agent-market`, `<release>/gamma-skill-market` | Read-only полные каталоги с manifests и hashes |
| journal + `/var/log/nginx` | Operational logs; preview access_log отключён: hostname содержит capability |

Пути выведены из `deploy/*.service`, `deploy/web.ts`, `packages/core/src/global.ts`, `packages/core/src/database/database.ts`, `packages/opencode/src/server/{product-projects,knowledge-store,site-preview}.ts`. Knowledge root явно добавлен в стандарт: имеющийся `gamma.env.example` его не задаёт и оставляет данные в другом HOME-based каталоге.

## Дополнительные требования установщика

[install-gamma.sh](../../install-gamma.sh) поддерживает только Ubuntu 24.04 amd64 с systemd, 2 vCPU, 8 GiB RAM, 30 GiB свободно на используемых томах. Это целевая матрица, ещё не подтверждённая clean-VM прогоном. Перед остановкой сервисов нужно свободное место на `/var/backups`: не менее двойного фактического размера `/var/lib/gamma` + workspaces и 2 GiB резерва (snapshot и quarantine). Большие проекты увеличивают время downtime. Не писать в workspaces внешними процессами во время snapshot.

Сборка выполняется отдельным `gamma-build`; `gamma` не имеет доступа к домашнему каталогу сборщика, sudo, docker group. Устанавливаются `ca-certificates curl unzip xz-utils git ripgrep build-essential python3 python3-venv pkg-config nginx certbot sqlite3 openssl iproute2`. Git/Python/CA нужны для bootstrap полного checkout. Docker и DNS provider plugins не входят в базовую установку. Java 21, Chromium, office/PDF/fonts и Python lxml входят; полный актуальный список — PACKAGES в installer. В `/etc/gamma/install.json` нет паролей, но файл root0600; snapshot `/var/backups/gamma` включает secrets и должен быть приватным.

## Дополнения финального pre-deploy аудита

Обязательный стандартный install включает `libreoffice-impress`, `libreoffice-calc`, `poppler-utils`, `fontconfig`, DejaVu/Liberation/Noto Emoji, `python3-lxml` и Linux Chromium libraries (список сверён с `playwright-core@1.59.1` Ubuntu 24.04 manifest). Chromium загружается CLI из frozen lockfile от пользователя gamma-build; runtime получает `PLAYWRIGHT_BROWSERS_PATH=<release>/.playwright`. Browser revision откатывается вместе с релизом. Новые npm-версии не добавлялись.

Knowledge PDF/DOCX: `pdfjs-dist` и `mammoth` в frontend lockfile. Презентации: `@office-kit/pptx`, `pptxgenjs`, Playwright; PDF/render требуют Poppler/LibreOffice и шрифтов. Graph: `3d-force-graph`/Three.js из lockfile. PTY/watcher/FFI: platform-specific glibc amd64 пакеты; Python extractor и WB analytics используют stdlib, часть 1C XML scripts требует lxml. Python/pip packages глобально не устанавливаются. OpenJDK 21 и BSL Language Server 1.1.0-rc.6 ставятся автоматически; JAR проверяется SHA-256 существующим `script/1c-agent/download-bsl.ts`. Для source tools используется Ubuntu `python3-lxml`, `GAMMA_1C_PYTHON=/usr/bin/python3`; версия записывается в dpkg manifest. Это отдельная qualification Ubuntu-пакета, а не установка pip requirements (ручной venv recipe закрепляет lxml 6.0.2). `GAMMA_BSL_JAR` указывает внутрь release и откатывается с ним. Внешняя платформа 1C и credentials остаются интеграционными prerequisites.

Heap production build: `NODE_OPTIONS=--max-old-space-size=4096`, минимум 8 GiB RAM. Прокси: installer требует прямой egress и явно отклоняет унаследованные proxy variables до изменений. Browser download требует доступа к Playwright CDN дополнительно к GitHub, nodejs.org и npm registry. Общие правила загрузки browsers описаны в [Playwright documentation](https://playwright.dev/docs/browsers).

Сервис получает `LANG=C.UTF-8`, `LC_ALL=C.UTF-8`: без UTF-8 locale реальный Java BSL на чистой ОС возвращал пустые symbols для кириллических путей. Dev использует тот же default. Calc нужен для XLSX/CSV conversion; одного Impress недостаточно.
