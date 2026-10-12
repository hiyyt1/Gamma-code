# Gamma: единый установщик Ubuntu VPS

Точка входа: [требования](REQUIREMENTS.md), [конфигурация](CONFIGURATION.md), [permissions](PERMISSIONS.md), [эксплуатация](OPERATIONS.md), [приёмка](CHECKLIST.md).

## Поддерживаемый сценарий

Чистый Ubuntu Server **24.04 LTS amd64**, systemd, минимум 2 vCPU, 8 GiB RAM и 30 GiB свободно на томах приложения/данных. Рекомендуется 4 vCPU/16 GiB при работе браузеров. Python 3 входит в обычный Ubuntu Server; для получения checkout нужны Git и CA certificates. Другие Ubuntu/ARM намеренно отклоняются до отдельной квалификации. Это целевая платформа установщика; полноценная проверка в загруженной чистой VM ещё не выполнена.

Установщик состоит из корневого `install-gamma.sh` и `deploy/installer/gamma_installer.py` (Python stdlib). Нужен **полный checkout**, один скачанный shell-файл недостаточен. Все команды ниже выполняет администратор со своего SSH-аккаунта; `sudo` запускает provisioning от root. Приложение работает как `gamma`, сборка как отдельный `gamma-build`. Ни у одного нет sudo/docker membership.

Перед использованием с GitHub необходимо опубликовать эти новые файлы вместе с проверенным релизом. Скрипт не публикует изменения самостоятельно. Целевой repository — `https://github.com/hiyyt1/Gamma-code.git`; не использовать локальный upstream OpenCode как источник Gamma.

## Установка одной командой

На стандартном Ubuntu Server с Git (**администратор**):

```bash
git clone https://github.com/hiyyt1/Gamma-code.git Gamma-code && cd Gamma-code && sudo ./install-gamma.sh --install
```

Если в минимальном образе нет Git (**администратор**, отдельный bootstrap):

```bash
sudo apt-get update
sudo apt-get install -y git ca-certificates python3
```

Интерактивный запуск спросит домен либо доступ по IP через SSH-туннель, способ TLS, email ACME при необходимости, каталог проектов, логин и пароль администратора (скрытый ввод, повтор). Пароль не передаётся в argv/env и не выводится. Не запускать под `bash -x`, не записывать пароль в shell history, checkout или CI command line.

Для проверки без установки (**администратор**, из checkout):

```bash
sudo ./install-gamma.sh --check
```

Без параметров домена эта проверка оценивает вариант SSH-туннеля. Проверка DNS/public портов требует тех же `--domain` и `--https`, что будут при установке. `--check` не скачивает runtime и не выполняет пробную сборку.

## Домен и HTTPS

Заранее направить A и, если существует, AAAA выбранного домена на этот VPS. Разрешить входящие TCP 80/443 в панели облака/существующем firewall, сохранив SSH. Установщик **не меняет firewall и SSH**, не удаляет чужие Nginx sites. Домен вводится в переменную, адреса-примеры не выдаются за рабочие (**администратор**):

```bash
read -rp 'Домен Gamma: ' GAMMA_HOST
read -rp 'Email для ACME: ' GAMMA_EMAIL
sudo ./install-gamma.sh --install --domain "$GAMMA_HOST" --https letsencrypt --email "$GAMMA_EMAIL"
```

Сначала создаётся HTTP virtual host с ACME webroot и **404 для приложения**. Certbot получает сертификат; только после готовности приложения включается HTTPS proxy. HTTP затем перенаправляет на HTTPS. Настраиваются `certbot.timer`, renewal deploy-hook (`nginx -t` перед reload), выполняется renewal dry-run. Согласие с ACME terms передаётся Certbot; выбор `letsencrypt` означает согласие оператора.

Для уже выданного **доверенного** сертификата: `--https existing --domain HOST --tls-cert /абсолютный/fullchain.pem --tls-key /абсолютный/private.pem`. Здесь HOST и два пути — значения оператора, не буквальные команды. Private key должен принадлежать root, без group/other доступа; проверяются SAN/hostname, срок > суток, соответствие key, затем настоящая TLS chain через curl без `-k`. Продление existing-сертификата обеспечивает оператор. Self-signed сертификат не считается готовым public production.

## Без домена: доступ по IP через SSH

**Администратор на VPS:**

```bash
sudo ./install-gamma.sh --install --https ssh-tunnel
```

Публичный интерфейс не включается. Backend слушает `127.0.0.1:4096`, gateway — `127.0.0.1:4444`, origin — `http://localhost:4444`.

**Пользователь на своём компьютере**, вводит обычный SSH destination, например своё имя пользователя и реальный IP:

```bash
read -rp 'SSH destination user@IP: ' GAMMA_SSH
ssh -N -L 4444:127.0.0.1:4444 "$GAMMA_SSH"
```

Открыть **http://localhost:4444**, не публичный IP и не другой hostname. Незашифрованный HTTP существует только на loopback; путь компьютер↔VPS защищён SSH. Альтернатива — заранее выданный доверенный сертификат с IP SAN и `--https existing`. Автоматическая выдача сертификатов для IP не реализована.

## Все параметры

| Параметр | Значение / поведение |
| --- | --- |
| `--install` | Первая установка; готовую установку проверяет, не пересобирает |
| `--upgrade` | Новый immutable release, offline snapshot, переключение с восстановлением при ошибке |
| `--check` | Read-only ОС/arch/CPU/RAM/disk, порты, конфликт installation/Nginx, DNS |
| `--status` | Read-only manifest, active/enabled, anonymous/authenticated HTTP health и login HTML |
| `--doctor` | Дополнительно runtime versions, credentials modes/hash format, policy overrides, managed drift, nginx syntax |
| `--repo URL` | По умолчанию Gamma GitHub URL выше; только GitHub HTTPS без credentials |
| `--ref REF` | По умолчанию remote `HEAD`; branch/tag/40-character SHA, результат закрепляется в manifest |
| `--domain HOST` | Lowercase DNS hostname; IPv4 разрешён только с existing TLS |
| `--https MODE` | `letsencrypt`, `existing`, `ssh-tunnel`; интерактивный выбор |
| `--email EMAIL` | ACME contact, обязателен с letsencrypt |
| `--tls-cert PATH`, `--tls-key PATH` | Абсолютные пути для existing TLS |
| `--admin-user LOGIN` | Один администратор gateway, не системный пользователь |
| `--admin-password-file PATH` | Вне checkout, regular root-owned 0600 файл; вместо скрытого ввода; пароль не печатается |
| `--permission-profile PROFILE` | `trusted-auto` (default) либо `restricted` |
| `--workspaces PATH` | Default `/home/gamma/workspaces`; новый пустой дочерний каталог `/home/gamma`, `/srv` или `/mnt`; без symlink, пробелов, `..` |
| `--non-interactive` | Не задавать вопросов; на первой установке нужны TLS inputs, admin login и password file |
| `--help` | Справка без root |

Выбирается ровно одна команда. Остальные команды требуют root для доступа к protected metadata. При повторе профиль, домен, TLS и workspace должны совпадать с manifest; их миграция не спрятана в `--upgrade`. Уже существующие credentials не переписываются, новые admin-параметры их не ротируют. При alternate repo передавать `--repo` также при upgrade; default всегда Gamma URL. Для одинакового кода на нескольких VPS передавать **один и тот же SHA** через `--ref`; remote HEAD намеренно означает актуальный код, а не фиксированный релиз.

## Что происходит автоматически

1. Read-only preflight до изменения системы; конфликт чужих каталогов/users/ports/config — остановка.
2. APT зависимости, отдельные Unix accounts, persistent directories с ownership/modes.
3. Bun **1.3.14** baseline и Node **22.22.0** из официальных HTTPS archives, проверка зашитых SHA-256 до распаковки. `curl | bash` не используется.
4. Свежий release checkout как `gamma-build`, проверка обязательных Gamma файлов и packageManager, `bun install --frozen-lockfile`, `OPENCODE_CHANNEL=prod NODE_OPTIONS=--max-old-space-size=4096 bun run build` в `packages/app`. Production secrets не передаются build. Lockfile не должен измениться. Chromium устанавливается из закреплённого Playwright в `<release>/.playwright`; systemd получает этот путь. APT также ставит LibreOffice Impress/Calc, Poppler, шрифты, Chromium libraries и python3-lxml.
5. Root-owned read-only для runtime release, JSON policy, explicit env, Argon2id hash администратора, случайный внутренний backend password.
6. TLS bootstrap, offline snapshot, systemd units и `systemd-analyze verify`, enable/start. Nginx `-t` до reload, SSE/WS proxy.
7. Backend anonymous401/authenticated200, gateway unauth denial, первый admin login/logout/revocation, loopback bind, enabled units и реальная shell/file проверка как gamma. Public TLS probe ожидает401 без cookie. Записывается manifest с SHA/lock/runtime/package versions.

Полные источники генерации — [gamma_installer.py](../../deploy/installer/gamma_installer.py). Базовые `deploy/*.service` и `.env.example` остаются образцами для ручных установок; не копировать их поверх managed files.

## Провайдер, специалисты и Preview

После установки войти в UI, подключить доступного LLM-провайдера и выбрать модель. Provider credentials сохраняются отдельно от admin auth в XDG data. Установщик не может выдать API key/подписку, не делает платных LLM вызовов и не обещает streaming без провайдера. Не помещать provider secrets в `VITE_*` или Git. [Полный env inventory](CONFIGURATION.md) описывает дополнительные провайдеры.

`trusted-auto` включён без флага и без вопроса о permissions. Он задаёт Legacy `permission: {"*":"allow","external_directory":"deny"}` и `default_agent: "gamma"`. Обычные инструменты готовых и новых пользовательских агентов наследуют allow. Shipped-профили больше не добавляют bash/task ask. Сохраняются явные пользовательские политики, role deny, Guide ограничения, границы команды и business workflow approvals. Это явно сообщается в конце установки. `restricted` оставляет bash/edit/task/web/MCP под ask, внешние каталоги deny, чтение dotenv deny. Ни один профиль не является sandbox или tenant isolation; shell того же UID может читать service secrets. Подробности [PERMISSIONS](PERMISSIONS.md).

Site Preview по умолчанию выключен. Ему нужны независимый регистрируемый домен, wildcard DNS/cert DNS-01, provider-specific renewal и отдельный Nginx virtual host из `deploy/gamma-preview.nginx.conf.example`. Preview только static/dist; не supervisor Node/Next. Установщик пока **не управляет Preview**, custom MCP и дополнительные project toolchains. См. [site-preview](../site-preview.md) и [REQUIREMENTS](REQUIREMENTS.md). Добавление этих возможностей должно быть отдельной проверенной миграцией: ручные правки managed env будут обнаружены как drift, а не затёрты при upgrade.

## Старая Gamma и локальная разработка

Наличие старого `/opt/gamma`, `/etc/gamma`, одноимённых users/units без installer manifest блокирует установку. Автоматический import неизвестной схемы может повредить БД или права. Снять backup, развернуть новый VPS этим установщиком, восстановить **согласованные** данные по [OPERATIONS](OPERATIONS.md), выполнить полную приёмку и только затем переключить DNS. Не удалять старую Gamma ради прохождения preflight.

Локальный dev не запускается installer-ом. Из рабочего checkout **обычным пользователем**: `bun install --frozen-lockfile`, затем `bun run dev:gamma` (root script `script/dev-gamma.ts`). Требуются отдельные dev state/provider credentials; не указывать production БД/workspaces. Конкретные dev variables перечислены в CONFIGURATION.

## Предел воспроизводимости

Конфигурация, runtime archives и release SHA фиксируются. APT packages, удалённый model catalog и внешние API не заморожены: версии записываются, но битовая идентичность VPS не обещается. Необходимы apt snapshot/image, release signing и VM acceptance CI. Локальные тесты и их границы описаны в [CHECKLIST](CHECKLIST.md).

## Прокси и память сборки

Installer использует прямой HTTPS/APT egress. Если до него дошли `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` или lowercase-варианты, он останавливается **до provisioning** с именами переменных, без значений/credentials. SOCKS не передаётся Bun: иначе возможен `UnsupportedProxyProtocol`. Если прямой выход разрешён, явно очистить переменные перед запуском; не обходить обязательный корпоративный proxy. Для proxy-only сети нужен отдельный проверенный provisioning — этот installer такой режим не поддерживает. `sudo` может очищать переменные ещё до входа в installer; оператор должен обеспечить заявленный прямой egress.

Сборка проверена с heap 4096 MiB; минимум установки со сборкой повышен до 8 GiB RAM. Недостаток heap на чистом Node 22 ранее приводил к `Reached heap limit`; исправление встроено в installer и dev launcher. Полный итог и границы проверки: [GAMMA_PRE_DEPLOY_CHECK](../audits/GAMMA_PRE_DEPLOY_CHECK.md).

Сервис получает `LANG=C.UTF-8`, `LC_ALL=C.UTF-8`: без UTF-8 locale реальный Java BSL на чистой ОС возвращал пустые symbols для кириллических путей. Dev использует тот же default. Calc нужен для XLSX/CSV conversion; одного Impress недостаточно.
