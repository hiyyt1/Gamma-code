# Gamma — финальный pre-deployment аудит

Дата: 12 октября 2026. Итог: **NOT READY для безусловного production deployment**. Исправления реализованы и проверены на реальном Ubuntu-контейнере, но полный lifecycle установщика под загруженным systemd, reboot и rollback с настоящими сервисами ещё не квалифицирован. Также остаются отмеченные ниже нестабильные subprocess-сбои общего тестового процесса.

Production не изменялся. Проверки использовали отдельный Docker container без privileged/host mounts, временные БД и каталоги, случайные loopback-порты, синтетические credentials и fixture LLM. Платных LLM-запросов не было. Предыдущие изменения рабочего дерева сохранены; проверялось изменённое дерево, а не один опубликованный commit. [Хэши исходников](evidence/gamma-predeploy-2026-10-12/source-sha256.json) идентифицируют проверенные файлы.

## Исправленные проблемы

| Проблема | Исправление и доказательство |
| --- | --- |
| Installer уже имел default `trusted-auto`, но спрашивал профиль; shipped специалисты добавляли bash/task ask, dev не задавал production policy | Убрана необходимость выбирать auto в диалоге. Dev получает `deploy/opencode.json`; Python renderer имеет ту же policy. В 35 shipped профилях нет permission ask; 25 наследуют shell, 10 сохраняют намеренный shell deny. Hash manifest обновлён. Реальные tool и fixture delegation tests проходят без approval handler |
| Auto мог разрешать выход за границы tool workspace | Default policy: `{"*":"allow","external_directory":"deny"}`. Существующие разрешения на чтение bundled resources и запреты их изменения сохранены. Shell не является OS sandbox |
| Неполный toolchain готовых агентов | Installer ставит Chromium libraries, закреплённый Chromium, LibreOffice Impress **и Calc**, Poppler, шрифты, Python lxml, Java 21 и BSL JAR с проверкой SHA-256. Chromium/JAR находятся внутри релиза; runtime paths рендерятся вместе с ним |
| На чистом Node 22 production build падал `Reached heap limit` | Build получает `NODE_OPTIONS=--max-old-space-size=4096`; минимум RAM повышен с 4 до 8 GiB. Повторная Ubuntu/Node 22 production build прошла при лимите container 8 GiB, 2 CPU |
| BSL был connected, но возвращал пустые symbols для кириллических путей при locale C | Явные `LANG=C.UTF-8`, `LC_ALL=C.UTF-8` в production env и defaults dev. После изменения настоящий Java BSL test проверил symbols, definitions, references, обновление файла и запрет внешних путей |
| `UnsupportedProxyProtocol` и молчаливое игнорирование proxy settings | Ошибка воспроизведена Bun 1.3.14 на отдельном mini-project с фиктивным SOCKS proxy. Installer теперь отклоняет inherited proxy variables до provisioning, не печатает их значения. Dev отклоняет SOCKS вместо скрытого переключения на direct egress. UnsupportedProxyProtocol из subprocess имеет отдельную диагностику |
| Проверка готовности могла не заметить отсутствующий frontend; status/doctor проверяли только anonymous 401 | Smoke/status/doctor проверяют login HTML; status/doctor также требуют authenticated backend health 200. Добавлен rollback regression при frontend 404. Doctor проверяет dpkg status обязательных пакетов; missing executable диагностируется явно |
| Три i18n parity FAIL | Добавлены 103 отсутствовавших product keys в существующий явный English fallback, необходимые locale plural variants и три UI status/error keys. Fallback применяется перед English/Russian overrides, поэтому существующие переводы сохраняются. Финальный parity и весь frontend unit suite проходят. Это fallback, а не завершённый перевод всех языков |

Не менялись версии npm-библиотек и lockfile. SHA-256 `bun.lock`: `d6dcd3e16e23683b34ed71404ea50f24020fdab8319887f7347f8960d69fff04`. Public Protocol/HttpApi не менялись; регенерация SDK не требовалась.

## Действительные requirements

* Поддерживаемая установщиком ОС: **Ubuntu Server 24.04 LTS amd64**, загруженный systemd. Ubuntu 22.04, другие версии и ARM не квалифицированы.
* Минимум 2 vCPU, **8 GiB RAM**, 30 GiB свободного места на используемых томах. Для параллельных browsers/1C рекомендуется 16 GiB. Для backup требуется дополнительное место: удвоенный размер данных/workspaces и 2 GiB резерва.
* Bootstrap полного checkout: Git, Python 3, CA certificates и sudo. Один отдельно скачанный `install-gamma.sh` недостаточен.
* Bun **1.3.14 baseline**, Node **22.22.0**. Оба официальных архива реально скачаны в Ubuntu и проверены SHA-256 до выполнения. Реальные версии проверяет `install_runtimes`.
* Полный APT список находится в `deploy/installer/gamma_installer.py:PACKAGES`: Git/build utilities, Python/venv/lxml, ripgrep, nginx/certbot, SQLite CLI, TLS/сетевые utilities, office/PDF/fonts, Java и Chromium libraries. Не нужны PostgreSQL/Redis или host Docker socket для базовой Gamma.
* Knowledge PDF/DOCX использует lockfile `pdfjs-dist`/`mammoth`; graph — Three.js/3d-force-graph; терминал/watcher — platform-specific native dependencies. Fresh frozen install успешно разрешил workspace graph после удаления legacy-кода; native postinstall и backend/PTY tests прошли. Это квалификация amd64/glibc, не других платформ.
* Chromium закреплён Playwright **1.59.1**, revision **1217**. Общая необходимость отдельно устанавливать browser binaries описана в [официальной документации Playwright](https://playwright.dev/docs/intro). Проверен настоящий headless launch от gamma. Загрузка Chromium от gamma-build и работа от gamma используют один release-local path.
* Презентации: Impress/Calc, Poppler, шрифты, Python stdlib и lockfile JS libraries. Отсутствие Calc реально обнаружено XLSX→CSV тестом, после установки проверка прошла. Vision-провайдер нужен для настоящего visual approval; fixture test не выдаётся за анализ изображений моделью.
* 1C: OpenJDK 21, BSL **1.1.0-rc.6** с SHA-256 из существующего download script, Ubuntu **lxml 5.2.1**. Реальные shipped XML generators/validators проверены с этим APT-пакетом. Ручной venv recipe в bundle по-прежнему закрепляет lxml 6.0.2; installer не устанавливает этот recipe и не меняет bundle. Дополнительная зависимость provisioning от PyPI не нужна; прямой PyPI egress в проверочном окружении оказался недоступен.
* Нужен разрешённый прямой исходящий доступ к APT, GitHub, nodejs.org, npm registries, Playwright CDN и выбранным внешним API. Proxy-only provisioning не поддерживается и завершается понятной ошибкой до изменений. NO_PROXY не считается outbound proxy. Sudo может очистить proxy env ещё до запуска installer.
* Provider credentials, Bitrix24 portal/scopes, WB token/scopes, коммерческая платформа 1C, отдельный Preview domain и произвольные toolchains пользовательских проектов не создаются установщиком. Их prerequisites документированы отдельно.

## Auto permissions: эффективное поведение

Обычный `sudo ./install-gamma.sh --install` выбирает auto без дополнительного флага. Основной Gamma и новый custom agent наследуют разрешения обычных инструментов. Shipped специалисты не добавляют ask для shell или допустимых членов команды. `Permission.intersect` продолжает учитывать project/user restrictions; explicit deny/ask не удаляются.

`installer-permissions.test.ts` получает policy непосредственно из Python, декодирует настоящей ConfigV1 schema, проверяет effective rules всех доступных профилей и custom agent. Он выполняет **ReadTool, WriteTool и ShellTool через настоящий Permission.Service**, включая website-builder; проверяет созданные файлы и отсутствие pending permissions. Тест повторён в Ubuntu под gamma. Session test с fixture LLM реально делегирует работу web/1C/Bitrix24-командам без `permissions.reply`, сохраняет прежнюю историю и создаёт корректные дочерние сессии.

Ограничения не скрыты:

* Guide остаётся help-only; reviewer/explorer/auditor сохраняют edit deny. Presentation/WB используют свой набор tools и сохраняют bash deny. Auto означает отсутствие подтверждений разрешённых обычных операций, а не отмену назначения роли.
* Делегирование вне команды, внешние tool directories и изменение bundled resources остаются запрещёнными.
* Bitrix24/WB подтверждают внешние записи собственной процедурой; `question` остаётся пользовательским диалогом. GitLab workflow approval handler с пустым ruleset остаётся отдельным ask: его не обходили.
* Квалифицирован активный Gamma Legacy runtime. Core V2 имеет отдельный config loader; production-переключение на него этим installer не квалифицировано.
* Сервисы работают как gamma, build — gamma-build. Sudo/docker membership, root service, chmod 777 не добавлялись; root-owned releases/config, private data, NoNewPrivileges/ProtectSystem/PrivateTmp сохранены. Tool permissions не заменяют Linux isolation: процесс того же UID может получить Gamma-readable credentials/environment. Для недоверенного кода или нескольких tenants нужен отдельный executor/VM; текущая схема — trusted single administrator.

## Fresh install, повтор, upgrade и rollback

Fresh install создаёт auto policy, persistent directories и credentials. `--permission-profile restricted` — явный выбор ограниченного режима. `bun run dev:gamma` использует ту же default policy, UTF-8 locale и heap setting, сохраняя явно заданные локальные overrides; dev admin credentials предварительно создаются setup-auth.

Повторный `--install` готовой managed установки проверяет её без rebuild/reset credentials. Upgrade сохраняет профиль из manifest: ранее выбранный restricted **не переключается** в auto без решения пользователя. Drift managed files и обнаруженные global/HOME policy overrides останавливают upgrade, а не удаляют пользовательские политики. Поэтому произвольно изменённая установка может требовать явного согласования конфигурации.

Build/download идут до остановки старых сервисов. Перед переключением создаётся offline snapshot БД, Knowledge, проектов, config и credentials. Ошибка activation/health/frontend восстанавливает прежние данные/units/config, новые данные сохраняет в quarantine. Journal позволяет повторить прерванное действие. Browser/JAR paths возвращаются с release env. APT package changes не являются транзакционно откатываемыми; snapshot требует прекращения внешних writers.

Эти lifecycle ветки проверены **OS contract tests** с реальными Git/SQLite/files/snapshots и заменёнными systemd/APT/network. Это не реальный reboot или rollback работающей VM. Ручной rollback после уже успешных DB migrations требует согласованного snapshot; `--upgrade --ref OLD_SHA` его не заменяет.

## Реальные запуски и результаты

Ubuntu image: `ubuntu:24.04`, digest `sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55`. Отдельная container filesystem, source archive без host node_modules, без privileged и без writable host checkout. Dependencies установлены с нуля; повторные прогоны использовали тот же проверочный container. Runtime запускался от gamma, build — gamma-build. Сервисы тестового runtime завершались по PID; чужие процессы не перезапускались.

| Проверка | Результат и граница |
| --- | --- |
| Package typecheck | PASS: app, ui, session-ui, core, opencode, schema, protocol, client, server, deploy; `bun typecheck` из package directories |
| Production build | PASS локально и в Ubuntu с закреплёнными Bun/Node и heap 4096; остаются Vite chunk-size warnings |
| Frontend unit / i18n | **777 pass, 0 fail**; первоначальные 3 parity FAIL исправлены |
| Browser unit | **44 pass, 0 fail** |
| Installer | **29 pass, 0 fail**, включая fresh/repeat/upgrade, snapshot recovery, simulated reboot, drift, proxy diagnostics, restricted preservation, frontend failure rollback, missing packages |
| Auth/gateway | **28 pass, 0 fail**: auth, origin/CSRF, session revocation, реальные HTTP/SSE/WS sockets с fixture upstream |
| Backend targeted suite | **161 pass, 0 fail**: agents/permissions, sessions, Knowledge, workspace files/uploads, projects, HTTP events/PTY, WB |
| Core targeted suite | **41 pass, 0 fail**: agent market, native agents, permissions, session creation |
| Дополнительный market regression на host | **3 pass, 1 skip, 0 fail**; BSL skip на host закрыт отдельным реальным Ubuntu run |
| Ubuntu native permissions + session delegation + 1C | **7 pass, 0 fail**, включая настоящий BSL MCP и Python generators; без платного LLM |
| Ubuntu presentations | **10 pass, 0 fail**: настоящие PPTX, LibreOffice/PDF/PNG, XLSX/CSV, Chromium HTML export, preservation и boundaries |
| Navigation regression | **19 pass, 0 skip**; повтор на production artifact из Ubuntu/Node 22 также **19 pass** |
| Настоящий backend + gateway | PASS на host и в Ubuntu: protected health, login HTML, login/logout/revocation, project, session, применение website-builder, agent rules, SSE. Отдельная БД/fixtures |
| SHA / frozen dependencies | PASS: Bun/Node archives, BSL JAR, frozen workspace install, неизменный bun.lock |

Не все тесты monorepo запускались. Полный V2/desktop/console набор не заявлен как проверенный; таблица отражает реально выполненную область.

Сохранены и отрицательные результаты:

* Initial clean Node build: OOM — исправлено heap/minimum RAM, повтор PASS.
* Без UTF-8 BSL symbols пусты; без Calc нет sales.csv — причины исправлены, повторные реальные suites PASS.
* Host combined backend/presentation suite показывал **170 pass / 1 fail**: в разных прогонах EBADF/epoll_ctl либо timeout внешнего render subprocess. Отдельный host presentation suite и финальный Ubuntu presentation suite прошли. Причина этой нестабильности общего процесса не установлена; тесты не ослаблялись и runtime retry не добавлялся. Это остаётся риском, а не объявленным исправлением.
* Промежуточные test harness ошибки (фиксированное число SSE строк, устаревшие task-ask expectations, проверка BSL tools внутри уже активного profile) исправлены; финальные проверки используют фактический контракт.

Логи, smoke scripts и hashes: [evidence](evidence/gamma-predeploy-2026-10-12/README.md). Секреты production не собирались.

## Что не проверено и что блокирует production verdict

1. **Полный запуск CLI lifecycle на чистой загруженной Ubuntu VM**: `--check → --install → --status/--doctor → reboot → --upgrade → failed activation rollback → повтор`. Docker test запускал настоящие provisioning/build/runtime этапы, но не systemd PID 1. Нельзя приравнять contract mock к реальному service manager. Подготовленной VM не было; доступного свободного места на host было меньше заявленных installer 30 GiB. Production как тестовый стенд не использовался.
2. **Нестабильность общего renderer test process** должна быть воспроизведена/локализована либо исключена повторяемой VM qualification на целевом runtime. Изолированный PASS не стирает ранее полученный FAIL.
3. Public Nginx/TLS/ACME issuance, renewal, Nginx SSE/WebSocket под нагрузкой, host reboot, backup restore на другой машине и реальные внешние credentials не проверены. Для выбранной public deployment topology эти пункты приёмки нужно закрыть на staging. Gateway SSE/WS tests не доказывают весь TLS proxy chain.
4. Нужно опубликовать проверенный полный Gamma release и закрепить его SHA. По умолчанию installer получает remote HEAD, который не обязательно содержит это локальное дерево. Публикация/деплой в задаче не выполнялись.

Дополнительные ограничения: trusted single-admin topology; Preview требует отдельного домена и конфигурации; policy overrides могут остановить upgrade; translations вне EN/RU частично используют явный English fallback; APT/external services не заморожены как npm lockfile. Нет утверждения о нагрузочной квалификации, полной защите same-UID secrets или поддержке любой пользовательской toolchain.

**Вердикт: NOT READY.** Исправленный код и подтверждённые Ubuntu/runtime результаты готовы для заключительной VM приёмки. Разрешение на безусловный production deployment пока не подтверждено перечисленными обязательными проверками.
