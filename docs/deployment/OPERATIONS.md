# Gamma: эксплуатация production-установки

[Установка](INSTALL.md) · [Конфигурация](CONFIGURATION.md) · [Permissions](PERMISSIONS.md) · [Приёмка](CHECKLIST.md)

Команды ниже — для оператора; при разработке на текущем production VPS они не выполнялись. Управляемая установка использует `/opt/gamma/releases/<id>`, не checkout непосредственно в `/opt/gamma`. Все команды с sudo выполняет SSH-администратор из полного checkout установщика.

## Статус, диагностика, restart

```bash
sudo ./install-gamma.sh --status
sudo ./install-gamma.sh --doctor
sudo systemctl status gamma-backend gamma-web --no-pager
sudo journalctl -u gamma-backend -u gamma-web --since '-15 min' --no-pager
sudo nginx -t
sudo ss -ltnp
sudo systemctl restart gamma-backend gamma-web
sudo ./install-gamma.sh --doctor
```

Status/doctor не создают login session, не выполняют agent tools и не пишут smoke files. Проверяют protected401 и active/enabled; doctor также versions/ownership/hash/policy drift/nginx syntax. Они не подтверждают provider streaming, фактическую доступность из Интернета, DNS, исправность сертификата existing или полноценную работоспособность UI. В install/upgrade есть дополнительный authenticated backend probe и TLS check.

Не печатать `backend.env`, `auth.json`, полный process env или systemd Environment в отчёт. Логи приложения тоже могут содержать пользовательские данные; перед передачей редактировать. Установщик скрывает stdout/stderr дочерних provisioning/build команд: ошибка называет этап и executable/exit code, не секреты. Для build failure исследовать тот же release SHA локально без production credentials; не включать shell tracing на secret-bearing этапе.

## Обновление

**Администратор:**

```bash
read -rp 'Проверенный Gamma commit SHA для обновления: ' GAMMA_RELEASE
sudo ./install-gamma.sh --upgrade --ref "$GAMMA_RELEASE"
sudo ./install-gamma.sh --doctor
```

`--upgrade` без ref получает remote HEAD. Для воспроизводимости нескольких серверов использовать одинаковый SHA. Обновление installer checkout производится отдельно обычным Git workflow с проверкой diff; root не делает `git pull` внутри работающего release. При изменении runtime pin/packageManager сначала обновить сам installer.

Сборка выполняется в новом UUID release под gamma-build, пока старый backend работает. Ошибка до переключения не меняет active units/data. Перед остановкой проверяется дополнительное backup space; затем запись transaction journal, остановка обоих сервисов, проверка освобождения портов, полная offline копия `/var/lib/gamma` и workspace. Managed configs и credentials также сохраняются. Длительность downtime зависит от размера данных.

После переключения выполняются smoke checks. При ошибке восстанавливаются прежние configs, полный snapshot данных и старый release; состояние неудавшегося запуска переносится в `failed...` quarantine, не уничтожается. SIGTERM/SIGINT запускают восстановление; после SIGKILL/power loss следующий `--install`/`--upgrade` сначала читает journal и восстанавливает транзакцию. Если recovery сам не прошёл, journal сохраняется; не удалять его и не повторять параллельно несколько запусков.

Манифест `/etc/gamma/install.json` хранит commit, release, lock hash, runtime/package versions, hashes managed files. Изменённые вручную файлы блокируют upgrade, а не перезаписываются. Смена профиля/домена/paths, global agent overrides и custom env требуют отдельной migration-функции; не подделывать hashes для обхода проверки.

## Backup, restore и rollback

Автоматические pre-activation snapshots лежат в `/var/backups/gamma/<UTC>-<id>`. Root0700 directory, содержат секреты. Внутри: `config/etc/...`, `data/var/lib/gamma`, `data/<workspace-path>`, `credentials/auth.json`, `credentials/backend.env`. Releases и system runtime не копируются: installer их сохраняет на месте. Нет retention/delete и off-host replication; контролировать диск и организовать зашифрованный off-host backup отдельно. Содержимое `/home/gamma` вне выбранного workspace, custom external MCP data, ОС, TLS private keys и чужие services не входят в этот snapshot.

Для отдельного согласованного backup (**администратор**, downtime; сначала ввести фактический workspace из install.json):

```bash
read -rp 'Абсолютный workspace path: ' GAMMA_WORKSPACES
sudo test -d "$GAMMA_WORKSPACES"
GAMMA_BACKUP="/var/backups/gamma/manual-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 0700 "$GAMMA_BACKUP"
sudo systemctl stop gamma-web gamma-backend
sudo tar --acls --xattrs -cpf "$GAMMA_BACKUP/state.tar" /etc/gamma /var/lib/gamma "$GAMMA_WORKSPACES"
sudo chmod 0600 "$GAMMA_BACKUP/state.tar"
sudo systemctl start gamma-backend gamma-web
sudo ./install-gamma.sh --doctor
```

Не допускать внешних writers в workspace. Если tar завершился с ошибкой, backup непригоден; запустить прежние сервисы, устранить место/permissions и повторить. Архив включает WAL/SHM в остановленном состоянии. Дополнительно сохранить соответствующий release/artifacts, systemd units, Nginx config и TLS через свой infrastructure backup.

Автоматический rollback с согласованной БД выполняется **только при неуспешном переключении**. `--upgrade --ref OLD_SHA` не является безопасным rollback после успешных DB migrations: старый код может не понимать новую БД. Для восстановления выбранного snapshot оператор обязан:

1. Остановить оба сервиса и любые writers. Сохранить текущее состояние целиком в новый приватный quarantine/backup.
2. Выбрать snapshot и соответствующий manifest/commit. Восстановить полные деревья `/var/lib/gamma` и workspace, **не накладывая** старую БД на новые WAL/SHM; сохранить owner gamma и0700. Existing данные сначала переместить в quarantine, не удалять.
3. Восстановить `config` по абсолютным путям, оба credential files с исходными ownership/mode; убедиться, что release из units существует и root-owned. На новом VPS получить тот же SHA и совместимые runtime, согласовать новые UUID paths — автоматический cross-host restore пока не реализован.
4. `sudo systemctl daemon-reload`, `sudo nginx -t`, затем старт backend/web и reload Nginx; выполнить doctor и CHECKLIST. Никогда не делать автоматический destructive restore из неизвестного архива.

Это намеренно ручной disaster recovery, а не отсутствующий CLI `--restore`. Формат snapshot/journal реализован в `begin_transaction`/`recover`; для одной незавершённой транзакции достаточно повторить исходную команду.

## Старая установка и clean install/reset

Installer отказывается усыновлять неизвестную Gamma с существующими users/paths/units. Поднять отдельный чистый VPS, перенести согласованный state после проверки схемы и release paths, выполнить приёмку, затем переключить DNS. При необходимости миграции на том же VPS сначала инвентаризировать и сохранить старую инфраструктуру; универсального безопасного import сейчас нет.

`--install` на готовой managed установке только проверяет её и сохраняет credentials. Это не reset. Clean install означает новый VPS/новые диски, не удаление workspaces или SQLite. Команды `--uninstall`, `--reset`, auto prune не реализованы. Данные старого хоста сохраняются до отдельного решения оператора.

## Типовые ошибки

| Ошибка | Действие |
| --- | --- |
| Unsupported OS/arch, RAM/disk | Ubuntu24.04 amd64, увеличить ресурсы; не обходить guard |
| Port4096/4444 occupied | Выяснить владельца через ss; не останавливать чужой сервис автоматически |
| Nginx server_name conflict/invalid config | Исправить конфликт существующего site, сохранив его назначение; повторить nginx -t |
| ACME failure | Проверить A/AAAA, reachability80 и rate limits; bootstrap обслуживает только challenge/404, не пароль |
| TLS existing probe failure | Исправить chain/SAN/expiry/key; не добавлять curl -k |
| Frozen lock/build failed | Исправить release в dev и опубликовать новый SHA; не обновлять lock на VPS |
| auth.json ownership/mode | gamma:gamma0600, backend.env root:root0600; не генерировать новые credentials поверх старых |
| Managed file drift/global overrides | Разобрать изменение и подготовить явную миграцию; не затирать его и не менять hashes вручную |
| Недостаточно места snapshot | Освободить/добавить backup storage без удаления Gamma data; active services ещё не остановлены |
| Interrupted transaction | Повторить install/upgrade, installer выполнит recovery; journal не удалять |
| Market agent спрашивает permission | Ожидаемый runtime boundary; см. PERMISSIONS, не обходить скрытым patch |
| LLM/Preview недоступны | Проверить подключение провайдера; Preview не включается базовым installer |

## Обнаруженные проблемы deployment

| Приоритет | Факт и доказательство | Практическое следствие |
| --- | --- | --- |
| Release gate | Installer добавлен локально; его файлы ещё нужно опубликовать в Gamma repository | Использовать hiyyt1/Gamma-code и проверенный SHA; локальный upstream origin не является источником installer |
| Blocker для shared multi-user | `deploy/auth.ts` имеет один username/passwordHash; Knowledge registry без пользователей/owners/roles | RESTRICTED не превращает один backend в безопасный многопользовательский сервис |
| Blocker для недоверенного кода | Shell, PTY и local MCP наследуют env backend, тот же Unix UID | Ключи провайдеров/внутренний пароль не изолированы от tools. Нужен executor boundary |
| Blocker для всех автономных специалистов | Market intersect сохраняет ask/deny; тест market-permissions подтверждает | Global allow достаточен для native Gamma, но не всех Market агентов |
| High | `workflow_tool_approval` вызывает permission с пустым ruleset | Provider-specific workflow может остановиться при global allow |
| High | Core V2 config loader не читает полный набор Legacy policy env | Единой env-политики для обоих runners нет; нельзя silently переключать engine |
| High | Units работают под общим gamma, без sandbox settings в исходном template | Нет полноценной изоляции проектов/secrets; installer генерирует basic systemd hardening, не sandbox |
| Medium | `deploy/gamma.env.example` не задаёт Knowledge root | Backup только `/var/lib/gamma` может пропустить fallback HOME Knowledge; INSTALL задаёт явно |
| Release gate | Installer orchestration реализован и проверен временными fixtures, но нет booted-VM acceptance | Нужен чистый Ubuntu 24.04 прогон, реальный reboot и upgrade drill до гарантии production |
| Medium | Node patch, OS package versions, browser assets, LLM catalog не закреплены единым release manifest (BSL downloader уже имеет version/hash) | Frozen Bun lock — необходимое, но недостаточное условие одинаковой поставки |
| Medium | Preview поддерживает static output, dynamic projects возвращают dynamic_unavailable | Нельзя обещать preview произвольного dev server |
| Medium | Preview domain validation проверяет hostname nesting, но не public suffix/site boundary | Оператор обязан использовать независимый регистрируемый домен; sibling subdomains одного domain недостаточны стандарту |
| Medium | Исходный Nginx template не описывает certificate bootstrap/renewal и wildcard DNS automation | Нельзя включать его до сертификата. INSTALL добавляет webroot renewal; DNS provider для preview ещё должен быть выбран |
| Medium | Gateway sessions, preview leases, WB/Bitrix connections — process memory | Restart требует relogin/reopen/reconnect; это не потеря SQLite истории |
| Medium | `Wants`/`After` backend не являются readiness | Gateway fail-closed стартует повторно, но нет внешнего readiness/alerting |
| Medium | `packages/app/vite.js` без OPENCODE_CHANNEL выбирает dev channel, даже при production build | INSTALL явно задаёт prod; необходима приёмка UI этого канала |
| Medium | App builds sourcemaps, gateway публично обслуживает assets | Возможна публикация исходников frontend; запрещены build secrets в VITE. Решение по maps принять на release stage |
| Medium | Knowledge blobs сохраняются после удалений; GC не реализован | Рост диска, нужен мониторинг и future GC без нарушения references |
| Medium | SQLite migrations применяются автоматически | Rollback кода без согласованного DB snapshot может быть несовместим |
| Medium | Shell long-lived child projects не имеют отдельного supervisor в Gamma deploy | Restart backend может остановить дочерние dev servers; Preview не является hosting supervisor |

Это findings по исходникам, а не утверждение о настройках текущего VPS. Существующие пользовательские изменения оставлены без изменений; README также не редактировался.


## Оставшаяся автоматизация

1. Booted Ubuntu24.04 CI VM: реальный apt/build, TLS staging, reboot/autostart, upgrade с миграциями и restore drill.
2. Signed release/artifact manifest и immutable APT image/snapshot; сейчас runtime archives проверены SHA, source фиксируется commit, package versions записываются.
3. Явная миграция managed env/profile/model и импорт legacy deployment; сейчас drift fail-closed.
4. Provider-specific DNS-01 и Preview opt-in, optional agent capabilities, без изменения runtime.
5. Off-host encrypted backup/retention, disk/expiry/readiness alerts, отдельная restore-команда с reviewable планом.
6. Полноценный executor sandbox/secret isolation и tenant auth/RBAC — отдельные продуктовые задачи. RESTRICTED их не заменяет.
7. Унифицированная Legacy/V2 policy и административный autonomy contract специалистов, если нужны; installer не патчит эти механизмы.

README: предлагается ссылка `[Развёртывание Gamma на VPS](docs/deployment/INSTALL.md)` после вводного описания. В этой работе README не редактировался.

## Уточнения финального аудита

* `UnsupportedProxyProtocol`: installer больше не игнорирует proxy variables; требуется разрешённый прямой egress. Не печатать URL proxy с паролем. Dev launcher отклоняет SOCKS с объяснением, HTTP proxy остаётся явной локальной настройкой.
* `Reached heap limit`: installer задаёт Node heap 4096 MiB; установка со сборкой требует минимум 8 GiB RAM. Build failure до переключения сохраняет старые services/data.
* Missing Chromium/LibreOffice/Poppler: `--upgrade` ставит стандартные зависимости; браузер находится внутри нового release, не в HOME gamma-build. `--doctor` дополнительно проверяет dpkg status обязательных пакетов. В тестах с новым XDG явно задавать browser path.
* Permission drift: не удалять пользовательский config ради upgrade. Согласовать отличия и процедуру миграции; прежний restricted сохраняется. Итоговые результаты см. [pre-deploy audit](../audits/GAMMA_PRE_DEPLOY_CHECK.md).
