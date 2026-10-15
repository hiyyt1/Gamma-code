# Gamma: Production Acceptance Checklist

[Установка](INSTALL.md) · [Эксплуатация](OPERATIONS.md) · [Политика](PERMISSIONS.md)

Заполняется на новом/staging VPS оператором после установки. Поля: дата, OS image, архитектура, release SHA, Bun/Node versions, lock hash, domain, профиль, provider/model, optional capabilities. Secrets/preview capability URLs в публичный отчёт не писать. Статусы: PASS / FAIL / N/A с причиной, а не автоматически отмеченные галочки. В рамках аудита production-пункты **не выполнялись**.

## Release и инфраструктура

- [ ] Clone содержит именно Gamma, все product endpoints, deploy, agent/skill markets; SHA опубликован, checkout чистый, frozen lock сохранён.
- [ ] Bun 1.3.14; утверждённый Node patch; app/dist существует; OS/packages/browser/JAR manifest сохранён.
- [ ] gamma не root, без sudo/docker group; root-owned checkout/policy, workspace/DB/Knowledge writable gamma; auth.json ровно 0600.
- [ ] Workspaces и Knowledge не вложены друг в друга, Knowledge без symlink ancestors; диск local FS с запасом.
- [ ] Снаружи доступны только утверждённые SSH/80/443; backend 4096, gateway 4444, preview 4097 только 127.0.0.1.
- [ ] HTTPS certificate/chain/hostname валидны без ignore errors; HTTP redirect и ACME renewal dry-run работают.
- [ ] Nginx configuration test проходит; application/API трафик только через gateway.

## Авторизация

**root или внешний оператор:** `curl -i https://<реальный host>/auth/session` и `/global/health` без cookie должны вернуть 401; `/` — redirect login. Здесь `<реальный host>` — значение GAMMA_HOST из INSTALL, не буквальный аргумент.

- [ ] Неверный login/password отвергается, настоящий работает; нет browser Basic challenge.
- [ ] Cookie `__Host-gamma_session`, Secure, HttpOnly, SameSite=Lax, Path=/, без Domain.
- [ ] Нет доступа без cookie к `/product`, `/session`, `/provider`, `/config`, `/event`, `/pty` и V2 API.
- [ ] Logout отзывает cookie, активные SSE и WS; старый cookie не работает.
- [ ] POST login/logout/API с чужим или `null` Origin отвергается; при валидном Origin работает.
- [ ] После restart web требуется повторный login; это ожидаемо. Нет обхода auth через прямой backend или публичный Vite.
- [ ] Для нескольких независимых пользователей выделены отдельные installations/VM. Один общий gateway не помечен как multi-user secure.

## Агент, permissions, инструменты

**В UI под администратором**, создать отдельный тестовый проект `deployment-acceptance`. Не использовать пользовательский рабочий проект.

- [ ] Новый обычный чат использует `gamma`, Guide не является случайным default.
- [ ] Выбор специалиста создаёт новую сессию. Старый session ID/agent не меняется; после reload связь сохраняется.
- [ ] В TRUSTED_AUTO основном Gamma, при выключенном UI autoAccept, попросить создать `acceptance/index.html`, прочитать его, изменить заголовок, выполнить `pwd` и `printf`. Реальные tool results и файлы есть; `permission.asked` для этих обычных действий отсутствует.
- [ ] Повторить ту же проверку в новой сессии после backend/web restart; это доказывает durable config, а не remembered approvals.
- [ ] Непривилегированная установка зависимости в тестовый subdirectory (например `npm init -y` и `npm install --save-exact is-number@7.0.0`) проходит без sudo, lock создан. Это сетевой smoke, не требование этой библиотеки к Gamma.
- [ ] Попросить Gamma создать простой локальный сайт с index.html/CSS/JS; сайт и assets реально существуют, результат не только текст в чате.
- [ ] File panel показывает новые/изменённые файлы без смены проекта; reload сохраняет правильный directory.
- [ ] Проверить `website-builder`: стандартный shell выполняется без permission request при global auto и выключенном browser autoAccept. Проверить, что explicit restricted/user policy по-прежнему требует подтверждения.
- [ ] В RESTRICTED edit/bash спрашивают, external_directory запрещён; read `.env` запрещён. Не считать это защитой от shell обхода.
- [ ] Gamma Guide не выполняет shell/read private files/MCP; presentation/WB ограничения сохранены.
- [ ] Не предоставлены host root secrets/SSH keys/docker socket. Требование защиты **Gamma service credentials** от недоверенного кода отмечено FAIL до отдельного executor; не проверять секреты командой env из чата.

## Модели и streaming

- [ ] Provider подключён, default `providerID/modelID` записан; реальные права на модель подтверждены, не только наличие в каталоге.
- [ ] Получен настоящий ответ LLM с несколькими видимыми streaming deltas; DevTools показывает поток, а не целиком buffered response.
- [ ] Tool call → tool result → продолжение LLM работает в одном запросе.
- [ ] Нет 401/403 provider, 429/quota failures, бесконечной loading; ошибка provider корректно видна.
- [ ] При workflow provider проверены дополнительные approvals; global allow не обещает их отключение.

## Данные, Knowledge, skills и MCP

- [ ] История созданной сессии, файлы и agent pin сохраняются после restart backend/web.
- [ ] Knowledge: создать space, заметку и небольшой документ, открыть оригинал, связать space с проектом; попросить Gamma прочитать материал по доступному пути.
- [ ] В UI «Проверить файлы на сервере» / authenticated `/product/knowledge/verify` подтверждает физические файлы и hashes; просто HTTP 200 каталога недостаточно.
- [ ] После restart содержимое Knowledge/оригиналы/связи доступны. На миграции старого браузера создан export с originals и выполнен server import.
- [ ] Agent Market доступен без integrity_failed; выбранный specialist/pinned version разрешается после restart.
- [ ] Skill Market и встроенные skills загружены; один реальный skill вызван. Optional dependencies конкретного skill проверены.
- [ ] Каждый включённый MCP показывает connected и выполняет безопасную read-only операцию. Для disabled MCP указать N/A, а не общий PASS.
- [ ] 1C (если включён): Python+lxml, Java 21+, JAR, registration workspace и read-only analysis; Presentation: health/render/vision; Bitrix/WB: безопасный read. Не выполнять финансовые/CRM mutations ради smoke.
- [ ] После restart Bitrix/WB reconnect проверен; process-memory credentials не ошибочно считаются сохранёнными.

## Preview, SSE и WebSocket

- [ ] Встроенный Preview открывается через origin Gamma без Preview env, DNS или отдельного listener.
- [ ] Static site и готовая Vite/React/Vue-сборка работают: CSS/JS/assets, ширины экрана, разворачивание, refresh и автообновление.
- [ ] Переходы между HTML-страницами и hash-навигация сохраняются при refresh. Dev-сервер автоматически не запускается.
- [ ] Cookies/localStorage/parent/API недоступны; внешние ресурсы, popup и навигация из iframe блокируются.
- [ ] Закрытие/смена проекта удаляет iframe и прекращает загрузку снимков; повторное открытие работает.
- [ ] При использовании legacy внешнего Preview дополнительно проверить отдельный домен, wildcard TLS, снятие credentials и отзыв lease.
- [ ] Authenticated SSE через внешний Nginx получает события по мере появления; после logout поток закрыт.
- [ ] Terminal WebSocket получает 101, принимает ввод/возвращает вывод через Nginx, закрывается при logout; cross-origin WS отвергается.

## Эксплуатация

- [ ] `systemctl is-enabled gamma-backend gamma-web nginx` успешно; после согласованной перезагрузки **тестового VPS** сервисы active и сайт доступен.
- [ ] Restart loop/OOM отсутствуют, journal не содержит credentials, log retention и disk monitoring настроены.
- [ ] Backup создан и перенесён в защищённое внешнее хранилище; restore выполнен на отдельной VM, SQLite integrity ok и Knowledge originals проверены.
- [ ] Upgrade с предыдущей версией и rollback пары release/state проверены на staging; не только `git checkout`.
- [ ] Известные blockers записаны с ответственным и решением; формулировка «готово» ограничена реально проверенным профилем.

## Автоматические проверки перед release

**Разработчик/deploy account в isolated checkout**, без production env/credentials:

```bash
cd deploy
bun test
bun typecheck
cd ../packages/opencode
bun test test/agent/market-permissions.test.ts test/server/site-preview.test.ts
bun typecheck
cd ../app
bun typecheck
OPENCODE_CHANNEL=prod bun run build
```

Тесты не запускать из корня репозитория. Дополнительные browser suites `packages/app/e2e/auth-smoke.ts`, `preview-smoke.ts` и regression agent/knowledge tests требуют соответствующих browser dependencies/fixtures; перед запуском прочитать их setup, не направлять E2E в production. Изолированные mock/fixture тесты не заменяют live LLM, DNS, TLS и clean-VM acceptance.

## Проверки именно установщика

Выполнены локально, без root provisioning/production изменений:

| Проверка | Результат / границы |
| --- | --- |
| Python installer suite | **24 pass**; temporary filesystem, настоящий Git checkout/commit, SQLite, Argon2id, snapshot/copy/restore; apt/download/build/systemd/Nginx/HTTP заменены OS fixtures |
| Native permissions + existing Market regression | **4 pass**, 16 assertions; реальный Legacy Config/Agent/Permission, WriteTool и ShellTool; native allow, restricted ask/deny, Market intersection |
| Gateway deploy suite | **28 pass**, 110 assertions; реальные loopback fixtures, auth/CSRF/fail-closed startup/SSE/WebSocket/logout |
| `bun typecheck` в packages/opencode | PASS |
| Shell syntax / CLI help | Проверяются без root, не вызывают provisioning |
| Clean Ubuntu apt/build/TLS | **Не выполнялось**; требуется disposable VM |
| Reboot | Проверен только контракт enabled units в симуляции; реальная перезагрузка VM остаётся обязательной |
| LLM/npm network/live UI | Не выполнялось; provider/user acceptance выше обязательна |

Python suite покрывает clean/repeat install, upgrade, preservation SQLite/files/Knowledge/credentials, отсутствие secrets в output/argv/manifest, unsafe credential modes, build errors до activation, port conflict, Nginx syntax rollback без reload, failed activation, interrupted transaction recovery, drift и symlink guards, нехватку backup space до service stop, existing TLS, ACME bootstrap/renewal contract. Подмена OS boundary запрещает неизвестные команды: эти тесты не могут случайно вызвать apt/systemctl текущего VPS. Тестового CLI-флага перенаправления production root нет.

**Разработчик**, из полного checkout; тесты запускаются из соответствующих подкаталогов:

```bash
cd deploy/installer
python3 -B -m unittest -v test_installer.py
cd ../../packages/opencode
bun test test/tool/installer-permissions.test.ts test/agent/market-permissions.test.ts
bun typecheck
cd ../../deploy
bun test
```

Перед публикацией статуса «проверенный production installer» дополнительно:

- [ ] Disposable Ubuntu 24.04 и 26.04.1 amd64: clone опубликованного installer SHA, `--check`, `--install` с ACME staging/тестовым DNS, реальная production app build.
- [ ] Repeat install оставляет credentials byte-for-byte, unit/NGINX не дублируются.
- [ ] Второй release upgrade сохраняет сессии, Knowledge и файлы; миграции + намеренно неуспешная activation возвращают согласованный snapshot.
- [ ] Перезагрузка только тестовой VM: enabled services действительно стартуют и доступ по HTTPS восстанавливается.
- [ ] Отдельно SSH tunnel profile не открывает application по public HTTP; после ACME failure наружу доступен только challenge/404.
- [ ] Real shell/file/dependency operations через UI до/после restart, provider streaming, SSE/WS через настоящий Nginx.

Не считать mock HTTP200 или состояние simulated systemd доказательством этих пунктов. Deployment-код готов к этой проверке; гарантия clean-VPS результата требует её фактического прохождения.

Актуальные результаты финального прогона, clean Ubuntu container и явно непроверенный systemd/VM lifecycle: [GAMMA_PRE_DEPLOY_CHECK](../audits/GAMMA_PRE_DEPLOY_CHECK.md).

## Дополнительно для Ubuntu 26.04.1 / Cloudflare Tunnel

- [ ] Записаны VERSION_ID, kernel, systemd, Python, Node/Bun, Playwright/browser и APT manifest; нет platform override.
- [ ] На i5/8 GB/HDD завершена сборка; измерены память и свободное место под snapshots.
- [ ] Внешний HTTPS hostname ведёт через локальный cloudflared на gateway 4444; прямые backend/gateway не опубликованы.
- [ ] HTTP на edge перенаправляется на HTTPS; login/logout и Secure cookie работают; SSE/WS проверены через настоящий tunnel.
- [ ] После reboot Wi-Fi, cloudflared и обе Gamma units стартуют; проверены повтор установки, upgrade и restore на отдельной VM.

Контейнерный прогон и тесты orchestration не отмечают эти пункты автоматически: [UBUNTU.md](UBUNTU.md).

## Регрессии HTTPS / Preview перед публикацией

- `cd deploy && bun test && bun typecheck`: auth/cookies/Origin/CSRF, Host,
  межустановочные sessions, локальные SSE/WebSocket relay и revoke.
- `cd packages/opencode && bun test test/server/site-preview.test.ts test/server/site-preview-nginx.test.ts && bun typecheck`:
  static assets/SPA, traversal/symlink/hardlink, TTL/revoke и изоляция leases.
  Nginx-тест использует реальный example config, приватный Unix socket и временный TLS
  сертификат с проверкой trust/hostname; без nginx/openssl/curl он явно пропускается.
- `cd deploy/installer && python3 -B -m unittest discover`: режимы HTTPS, migrations,
  legacy schema-1 upgrade, Preview-only Nginx reconfigure, rollback и диагностика.
- `cd deploy/installer && ./test-ubuntu.sh`: те же OS-boundary проверки в disposable
  Ubuntu 24.04/26.04 containers; source mounted read-only. Это не booted-systemd VM.

Перед production acceptance проверить настоящий DNS/TLS, certificate renewal,
Preview и SSE/терминал через Nginx с внешнего устройства. Тестовые локальные
сертификаты и подменённый OS boundary не подтверждают готовность реального VPS.
