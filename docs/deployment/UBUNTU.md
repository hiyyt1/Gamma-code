# Аудит установщика Ubuntu 24.04 / 26.04.1

Дата: 14 октября 2026. Изменения проверены в рабочем дереве, не опубликованы автоматически. Команды нового сервера: [INSTALL.md](INSTALL.md); эксплуатация: [OPERATIONS.md](OPERATIONS.md).

## Найдено и исправлено

1. Проверка ОС принимала только `VERSION_ID=24.04`. Теперь допускаются ровно Ubuntu 24.04 и 26.04; point release 26.04.1 имеет `VERSION_ID=26.04`. Проверки amd64, systemd, ресурсов, чужих users/configs/ports и symlink сохранены.
2. Playwright 1.59.1 формировал платформу `ubuntu26.04-x64`, для которой у него отсутствовали download URLs. После простой замены OS guard установка Chromium всё равно завершалась бы ошибкой. `playwright` и catalog `@playwright/test` закреплены на **1.61.1**, lockfile обновлён Bun 1.3.14. Поддержка Ubuntu 26.04 появилась в [Playwright 1.61](https://playwright.dev/docs/release-notes#version-161). Не используются platform override, подмена os-release или отключение browser dependency validation.
3. `Host.run(user=...)` исключал `/usr/sbin` из PATH и одновременно запускал `runuser` по короткому имени. Реальный запуск от gamma на чистом образе падал до выполнения команды. Теперь вызывается `/usr/sbin/runuser`; очищенная среда и отдельные Unix users сохранены. Это исправление относится и к Ubuntu 24.04.
4. Для Cloudflare не было подходящего managed режима: SSH фиксировал localhost origin, остальные варианты требовали локальный TLS. Добавлен `--https cloudflare-tunnel --domain HOST`: HTTPS origin и Secure cookie, локальный connector → gateway 4444, без локального Gamma listener в Nginx/ACME. Входному X-Real-IP не доверяем. Connector/DNS/token Cloudflare настраивает владелец отдельно.
5. В тестах SQLite connection context manager не закрывал connection; Python 3.14 стал сообщать ResourceWarning. Fixture теперь явно закрывает соединение.

## Проверенные зависимости и архитектура

| Область | Результат |
| --- | --- |
| Python | Python 3.12 на текущем Ubuntu 24.04, Python 3.14.4 в Ubuntu 26.04.1: stdlib installer и 70 тестов работают; lxml из APT импортируется |
| APT | Весь список `PACKAGES` реально установлен в отдельных контейнерах Ubuntu 24.04 и 26.04.1; переименований пакетов для 26.04 не потребовалось. Нужны стандартные main/universe repositories |
| Node/Bun | Официальные архивы Node 22.22.0 и Bun 1.3.14 baseline скачаны, проверены встроенными SHA-256, распакованы и запущены на обеих Ubuntu. Системный Node не используется |
| Browser | Playwright 1.61.1; Chromium 149.0.7827.55. На обеих Ubuntu скачан и реально отрисовал HTML от непривилегированного пользователя; на 26.04.1 также сохранён screenshot; не требуется GPU |
| Frontend | Чистый `bun install --frozen-lockfile` и Vite production build на 26.04.1 от gamma-build; отдельно повторён build с лимитами 4 CPU / 8 GiB, swap контейнера отключён, OOM не было. HDD/Wi-Fi физически не эмулировались |
| Backend/OpenCode | Не отдельная компиляция в бинарник: installer запускает исходники `packages/opencode/src/index.ts` под Bun. Реальный backend и gateway стартовали от gamma на 26.04.1 с generated env и root-owned release |
| Native/данные | Реальные Bun PTY и watcher (6 тестов) работают на glibc 2.43; SQLite migrations прошли при запуске backend. Shell/file permission tests: 4 PASS на 26.04.1 и на текущем 24.04 |
| Java/1C | APT Java 21; BSL 1.1.0-rc.6 скачан с проверкой штатного SHA-256, `java -jar ... --version` успешен на 26.04.1 |
| Nginx | 1.28.3 на 26.04.1: `nginx -t` для сгенерированного HTTPS virtual host прошёл с временным тестовым сертификатом. Это проверка синтаксиса, не публичного TLS. SSE/WS directives сохранены |
| systemd | 259 на 26.04.1: generated units проходят настоящий `systemd-analyze verify`; User/Group, paths, EnvironmentFile, hardening и network-online dependencies сохранены |
| Директории/права | Build от gamma-build, runtime от gamma, root-owned release, private credentials. Тесты drift/symlink/unsafe modes/rollback сохранены. Нет изменений SSH/firewall или существующих installations |
| Удаление | `--uninstall`/`--reset` в архитектуре отсутствуют; автоматическое удаление не добавлялось. Snapshot/recovery и повторный install сохраняют данные |

ОС образа 26: `ubuntu:26.04`, image digest `sha256:f144425ff09be612d6d9ad965196e9cdc23dae1f42110a8a11a3e9a8198759f7`, PRETTY_NAME `Ubuntu 26.04.1 LTS`. Контейнеры использовали собственные rootfs, без host network, published ports, bind mounts production-каталогов или host Docker socket. `/etc/os-release` не изменялся нигде.

## Автоматические тесты

Из `deploy/installer`:

```bash
python3 -B -m unittest -v test_installer.py
```

**70 PASS** на Python 3.12 и 3.14. Полная suite выполняется для fixtures Ubuntu 24.04 и 26.04.1. Добавлены реальный CLI dispatcher с изолированным OS boundary для check/install/status/doctor/repeat/upgrade, отвергаемые ОС, обязательный booted systemd, ресурсы домашнего сервера, Cloudflare install/repeat/upgrade и runuser PATH regression. Покрыты snapshots, SQLite/Knowledge/files/credentials, ошибки сборки/активации, recovery, permissions и ACME/TLS contracts. В этих тестах **APT, загрузки, сборка и systemd подменены**, Git/SQLite/files/hash/password hashing настоящие. Это не интеграционная установка.

Дополнительные проверки:

- `deploy`: `bun test` — **28 PASS** (cookie/auth/CSRF/SSE/WebSocket), `bun typecheck`.
- `packages/opencode`: `bun typecheck`; `bun test test/tool/installer-permissions.test.ts test/agent/market-permissions.test.ts` — **4 PASS**.
- `packages/app`: `bun typecheck`.
- Контейнер 26.04.1, `packages/core`: `bun test test/filesystem/watcher.test.ts` — **6 PASS**.
- `bash -n install-gamma.sh`, `git diff --check`.

Реальная контейнерная проверка компонентов использовала те же `PACKAGES`, `install_runtimes`, `create_users`, `credentials`, `rendered`, clean env/PATH и команды сборки из installer. Backend/gateway запускались отдельными процессами, **не через systemd**. Подтверждены anonymous 401, authenticated backend 200, login HTML, HTTPS-origin login с `__Host-gamma_session; Secure`, authenticated gateway 200, logout/revocation. Тестовые credentials не связаны с пользовательскими установками.

## Что НЕ подтверждено

Реальные shell entrypoints `--check`, `--install`, `--status`, `--doctor` были вызваны от root **в контейнере**. Check/install корректно отказали из-за отсутствия booted systemd, status/doctor — из-за отсутствия managed manifest. Проверки не отключались. Успешный end-to-end `sudo ./install-gamma.sh --install` в Ubuntu VM в этом прогоне **не выполнен**.

Перед окончательной приёмкой на отдельном Ubuntu Server 26.04.1 необходимо пройти [CHECKLIST.md](CHECKLIST.md): успешный check/install/status/doctor, repeat install, upgrade/recovery с реальными сервисами, reboot/autostart, работа Wi-Fi и cloudflared после загрузки, внешний HTTPS/SSE/WebSocket, live LLM API. Отдельно проверить browser/LibreOffice/1C сценарии, которые реально используются. Container kernel — kernel хоста, поэтому проверка не доказывает поведение AppArmor/ядра полноценного Ubuntu 26.04 сервера.

8 GiB/4 CPU build прошёл под cgroup-лимитами; это не нагрузочная гарантия для параллельных браузеров и пользовательских проектов. Реальный Intel i5, HDD и сеть остаются частью приёмки владельца. Требования не вводят SSD/GPU/проводную сеть как обязательные условия.
