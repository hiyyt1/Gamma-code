# Gamma: единый установщик Ubuntu VPS

Точка входа: [требования](REQUIREMENTS.md), [конфигурация](CONFIGURATION.md), [permissions](PERMISSIONS.md), [эксплуатация](OPERATIONS.md), [приёмка](CHECKLIST.md).

## Поддерживаемый сценарий

Чистый Ubuntu Server **24.04 или 26.04 LTS amd64** (включая **26.04.1**), systemd, минимум 2 vCPU, 6 GiB RAM (MemTotal Linux) и 30 GiB свободно на томах приложения/данных. Рекомендуется 4 vCPU/16 GiB при работе браузеров. Python 3 входит в обычный Ubuntu Server; для получения checkout нужны Git и CA certificates. Другие Ubuntu/ARM намеренно отклоняются до отдельной квалификации. Это целевая платформа установщика; полноценная проверка в загруженной чистой VM ещё не выполнена.

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

## Домашний сервер: Ubuntu 26.04.1 и Cloudflare Tunnel

Intel Core i5 с 4 ядрами, 8 GB RAM и HDD подходят при прохождении проверки доступной ОС памяти и свободного места. SSD ускоряет сборку и SQLite, но не обязателен. GPU и локальные модели не нужны. Wi-Fi допустим: настройте автоматическое подключение при загрузке и стабильный исходящий доступ; установщик сеть не перенастраивает.

После публикации изменений в Gamma repository, **администратор на новом сервере**:

```bash
sudo apt-get update
sudo apt-get install -y git ca-certificates python3
git clone https://github.com/hiyyt1/Gamma-code.git Gamma-code
cd Gamma-code
read -rp 'Публичный hostname Gamma в Cloudflare: ' GAMMA_HOST
GAMMA_RELEASE="$(git rev-parse HEAD)"
sudo ./install-gamma.sh --check
sudo ./install-gamma.sh --check --https cloudflare-tunnel --domain "$GAMMA_HOST"
sudo ./install-gamma.sh --install --ref "$GAMMA_RELEASE" --https cloudflare-tunnel --domain "$GAMMA_HOST"
sudo ./install-gamma.sh --status
sudo ./install-gamma.sh --doctor
```

Нужен постоянный hostname вашего домена, без `https://` и пути. Режим `cloudflare-tunnel` фиксирует `GAMMA_PUBLIC_ORIGIN=https://HOST`; cookie остаётся Secure/HttpOnly, проверка Origin сохраняется. Gateway и backend слушают только loopback. Nginx virtual host и локальный сертификат для Gamma не создаются; DNS может быть настроен после установки. Общие пакеты Nginx/Certbot пока входят в стандартный набор, их штатные настройки не удаляются.

На **этом же сервере** настройте `cloudflared` как системный сервис по [официальной инструкции Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/). Для published application задайте выбранный hostname и Service **HTTP → `127.0.0.1:4444`**. Cloudflare принимает внешний HTTPS и передаёт HTTP через локальный connector — [поддерживаемая схема](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/protocols/). Не направляйте tunnel на backend 4096. Включите перенаправление внешнего HTTP на HTTPS в Cloudflare; не задавайте Cache Everything для приложения/API. Проверяйте вход только по `https://HOST`.

Установщик не получает токен Cloudflare, не устанавливает connector и не управляет аккаунтом/DNS. Настройка tunnel требует ваших данных Cloudflare; это отдельный шаг публикации, а не исправление зависимостей Gamma. Проброс входящих портов на роутере не нужен. Не открывайте 4096/4444 наружу. `GAMMA_TRUST_PROXY=0` намеренно не доверяет входному `X-Real-IP`: лимит входа общий для локального connector.

После подключения проверьте внешний login/logout, SSE и terminal WebSocket. Локальные `--status`/`--doctor` **не подтверждают** доступность Cloudflare, внешний TLS или восстановление Wi-Fi после reboot. Область выполненных тестов: [аудит Ubuntu](UBUNTU.md).

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

## Tailscale Funnel и миграция существующей установки

Режим `tailscale-funnel` использует уже настроенный Tailscale: публичный HTTPS Origin направляется на `http://127.0.0.1:4444`. Установщик не устанавливает и не перенастраивает Tailscale, DNS, TLS или firewall. Backend остаётся на `127.0.0.1:4096`; публичные порты Gamma не открываются. Поддерживаются hostname вида `node.tailnet.ts.net`, стандартный HTTPS порт и порты 8443/10000. Origin указывать без завершающего `/`, пути или `:443`.

Для новой установки:

```bash
sudo ./install-gamma.sh --install --https tailscale-funnel \
  --public-origin https://nikita.tail9b440a.ts.net
```

Для существующей установки выполнить следующие команды **на Ubuntu iMac**, из полного checkout с этой версией установщика (не из macOS и не из старого release). Сначала доставить и проверить изменения кода: наличие этой инструкции не означает, что они уже опубликованы в GitHub. Перед применением сохранить обычный резервный снимок установки. Убедиться через `sudo tailscale funnel status`, что корневой маршрут нужного hostname ведёт на `http://127.0.0.1:4444`.

Если `GAMMA_PUBLIC_ORIGIN` уже вручную заменён на указанный адрес:

```bash
sudo ./install-gamma.sh --reconfigure --https tailscale-funnel \
  --public-origin https://nikita.tail9b440a.ts.net --adopt-public-origin --dry-run

sudo ./install-gamma.sh --reconfigure --https tailscale-funnel \
  --public-origin https://nikita.tail9b440a.ts.net --adopt-public-origin

sudo ./install-gamma.sh --doctor
sudo tailscale funnel status
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  https://nikita.tail9b440a.ts.net/auth/session
```

Ожидаемый HTTP status без cookie — `401`. Затем открыть сайт и войти заново, проверить чат, streaming и терминал. `--doctor` проверяет локальные сервисы, а не внешний Funnel/TLS. Установщик кратковременно перезапускает оба сервиса Gamma: выполнять вне активных задач агента. Текущие login-сессии в памяти сбрасываются; пользователи, проекты, знания, provider credentials и admin hash не меняются.

Если env не редактировали вручную, убрать `--adopt-public-origin` из обеих команд. Этот флаг разрешает **только** одну точную строку `GAMMA_PUBLIC_ORIGIN`, совпадающую с явно переданным адресом. Обратная замена строки должна восстановить прежний SHA-256 из манифеста. Любая другая правка, изменение другого managed file, небезопасные права или symlink блокируют миграцию. Не редактировать хеши manifest вручную. Dry run ничего не записывает и не перезапускает.

Миграция меняет только access settings в env и комментарий tunnel-конфигурации Nginx, сохраняет release и записывает новые проверенные хеши в manifest. Повтор с теми же параметрами ничего не перезапускает. `GAMMA_TRUST_PROXY=0`: cookies и Origin берутся из явной конфигурации, а не из непроверенных forwarded headers. HTTPS включает `__Host-` Secure/HttpOnly/SameSite=Lax cookie; mutations и WebSocket требуют точный Origin. SSE остаётся потоковым. Из-за отсутствия доверия forwarded IP ограничения входа применяются к адресу локального tunnel proxy совместно для клиентов.

Конфигурация сохраняется в приватном `/var/backups/gamma/config-…`. Ошибка активации автоматически возвращает точные исходные файлы; прерывание восстанавливается при следующей mutating-команде. При неудаче принятия ручной правки исходный drift тоже вернётся — это не повод переписывать manifest.

Откат успешной миграции (без отката БД или новых файлов проектов):

```bash
sudo ./install-gamma.sh --rollback-config --dry-run
sudo ./install-gamma.sh --rollback-config
sudo ./install-gamma.sh --doctor
```

При исходном `ssh-tunnel` вернётся `http://localhost:4444`; пользоваться SSH forwarding, а не прежним HTTPS адресом. Rollback проверяет хеш сохранённой конфигурации и принадлежность текущему release. Последующий `--upgrade` сохраняет Funnel Origin, но завершает окно `--rollback-config` для старого release. Для возврата к SSH после upgrade использовать `sudo ./install-gamma.sh --reconfigure --https ssh-tunnel --dry-run`, затем ту же команду без `--dry-run`. Ошибки самого upgrade восстанавливаются существующим механизмом offline snapshot. Автоматическая миграция между Nginx TLS и tunnel-режимами не выполняется; существующие режимы `letsencrypt`/`existing` продолжают работать.

Если Funnel ещё не настроен, его администратор отдельно включает его по [официальной инструкции Tailscale](https://tailscale.com/docs/reference/tailscale-cli/funnel), например `sudo tailscale funnel --bg --https=443 http://127.0.0.1:4444`. Для уже работающего туннеля эту команду повторять не требуется. Установщик не проверяет права аккаунта Tailscale и доступность сервиса извне.

Локальная регрессия: installer contract tests выполняются для Ubuntu VERSION_ID 24.04 и 26.04, включая миграцию, узкое принятие drift, rollback, ошибку активации и upgrade. Это тесты файлов/SQLite с заменёнными OS-командами, а не загрузка VM. Gateway integration tests выполняют настоящие HTTP/WS/SSE запросы с HTTPS Origin через локальный HTTP transport; они не заменяют проверку реального TLS/Funnel и браузера после применения.

## Все параметры

| Параметр | Значение / поведение |
| --- | --- |
| `--install` | Первая установка; готовую установку проверяет, не пересобирает |
| `--reconfigure` | Транзакционная смена tunnel-режима и Origin текущего release |
| `--rollback-config` | Проверенный откат последней конфигурации текущего release без отката данных |
| `--public-origin URL` | Явный публичный HTTPS Origin; обязателен для Funnel |
| `--adopt-public-origin` | Только reconfigure: принять строго Origin-only ручную правку |
| `--dry-run` | Только reconfigure/rollback-config: проверка без изменений |
| `--upgrade` | Новый immutable release, offline snapshot, переключение с восстановлением при ошибке |
| `--check` | Read-only ОС/arch/CPU/RAM/disk, порты, конфликт installation/Nginx, DNS |
| `--status` | Read-only manifest, active/enabled, anonymous/authenticated HTTP health и login HTML |
| `--doctor` | Дополнительно runtime versions, credentials modes/hash format, policy overrides, managed drift, nginx syntax |
| `--repo URL` | По умолчанию Gamma GitHub URL выше; только GitHub HTTPS без credentials |
| `--ref REF` | По умолчанию remote `HEAD`; branch/tag/40-character SHA, результат закрепляется в manifest |
| `--domain HOST` | Lowercase DNS hostname; IPv4 разрешён только с existing TLS |
| `--https MODE` | `letsencrypt`, `existing`, `ssh-tunnel`, `cloudflare-tunnel`, `tailscale-funnel`; интерактивный выбор |
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

## Глобальная конфигурация LLM и проверка overrides

`--doctor`, `--reconfigure`, `--rollback-config` и `--upgrade` проверяют содержимое всех существующих файлов `/var/lib/gamma/config/opencode/{config.json,opencode.json,opencode.jsonc}`. Наличие provider-only конфигурации больше не считается опасным override. Файлы должны быть обычными, без symlink, принадлежать `gamma` или root, иметь права `0600` и размер не более 1 MiB. Установщик читает их без изменения содержимого, владельца и прав; они не становятся immutable managed files.

Это строгий разрешённый subset реальной схемы OpenCode, а не разрешение всех расширений схемы:

- Верхний уровень: `$schema`, `disabled_providers`, `enabled_providers`, `model`, `small_model`, `provider`.
- Провайдер: `id`, `name`, `api`, `env`, `npm`, `whitelist`, `blacklist`, `options`, `models`.
- Provider options: `baseURL`, `apiKey`, `timeout`, `headerTimeout`, `chunkTimeout`, `setCacheKey` с проверкой типов. URL — HTTP/HTTPS без встроенного username/password. Локальные LLM endpoints допустимы; это не механизм сетевой изоляции.
- Модель: `id`, `name`, `family`, `release_date`, `attachment`, `reasoning`, `temperature`, `tool_call`, `experimental`, `status`, `limit`, `cost`, `modalities`, `provider`. Вложенные cost/limits/modalities/provider также имеют закрытые схемы. `tool_call` описывает способность модели, а не разрешения инструментов.
- `npm` на уровне провайдера и модели: только точные встроенные `@ai-sdk/{openai-compatible,openai,anthropic,azure,google,xai,mistral,groq,deepinfra,cerebras,cohere,togetherai,perplexity}` и `@openrouter/ai-sdk-provider`. Версии, пути, URL и произвольные npm packages запрещены: runtime может импортировать их как исполняемый код.

JSONC поддерживает комментарии и завершающие запятые. Невалидный JSONC, дубли ключей, неизвестные поля на любом структурном уровне, произвольные `options`/`variants` моделей, `headers`, policy/agent/tool/command/plugin/MCP/instructions и текстовые подстановки `{env:…}` / `{file:…}` блокируются. Последние обрабатываются OpenCode до JSON parsing, поэтому установщик не выполняет и не разрешает их. Для существующей конфигурации вне поддержанного subset требуется отдельный разбор; не удалять настройки ради прохождения проверки. Значения и ключи API не выводятся в диагностике.

OpenCode последовательно объединяет `config.json`, `opencode.json`, `opencode.jsonc`, затем custom config установщика. Deep merge может сохранить небезопасные вложенные настройки, поэтому проверяются все файлы, а не только последний. Legacy TOML `config` и глобальные каталоги `agent(s)`, `mode(s)`, `command(s)`, `plugin(s)`, `tool(s)`, `skill(s)` остаются заблокированы. Managed config, unit-файлы и env по-прежнему защищены манифестом. Проверка установщика — проверка конфигурации в момент запуска, не runtime sandbox для процессов того же UID.

Применение исправления на Ubuntu iMac: доставить **полный проверенный checkout с этим исправлением**, включая `deploy/installer/provider_config.py`. Изменения не появляются в GitHub автоматически. Исправление относится к установщику, поэтому для устранения ложной блокировки не требуется пересобирать или обновлять работающий runtime.

```bash
# Выполнять из обновлённого checkout на Ubuntu, не из старого release.
sudo ./install-gamma.sh --doctor
sudo ./install-gamma.sh --reconfigure --https tailscale-funnel \
  --public-origin https://nikita.tail9b440a.ts.net --dry-run
```

Если Origin всё ещё вручную изменён и не принят манифестом, первая команда закономерно сообщит managed drift: добавить `--adopt-public-origin` к reconfigure, как описано в разделе Funnel выше. После успешного dry run повторить reconfigure без `--dry-run` вне активных задач агента, затем выполнить `--doctor`. Уже завершённую миграцию повторять не требуется.

После отдельного согласованного опубликования релиза обновлять его из того же проверенного checkout: `sudo ./install-gamma.sh --upgrade --ref APPROVED_COMMIT_SHA`, заменив `APPROVED_COMMIT_SHA` реальным опубликованным SHA, затем `sudo ./install-gamma.sh --doctor`. Пока исправление не опубликовано, обычный `git pull` не доставит его. Не менять manifest и не удалять provider config. Upgrade сохраняет его через существующий механизм snapshots; ошибка upgrade восстанавливает исходные данные.

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

Сборка проверена с heap 4096 MiB; минимум установки со сборкой — 6 GiB MemTotal, рекомендация — 16 GiB. Недостаток heap на чистом Node 22 ранее приводил к `Reached heap limit`; исправление встроено в installer и dev launcher. Замеры с ограничением памяти и границы проверки: [UBUNTU.md](UBUNTU.md#память-на-машинах-с-8-gb-ram).

Сервис получает `LANG=C.UTF-8`, `LC_ALL=C.UTF-8`: без UTF-8 locale реальный Java BSL на чистой ОС возвращал пустые symbols для кириллических путей. Dev использует тот же default. Calc нужен для XLSX/CSV conversion; одного Impress недостаточно.

На машинах с номинальными 8 GB RAM часть памяти может быть зарезервирована прошивкой и устройствами. `--check` использует `MemTotal` из `/proc/meminfo` в KiB: минимум **6 291 456 KiB**, а не маркировку модулей. При 6–16 GiB выводится предупреждение о рекомендации 16 GiB; оно не блокирует установку. Swap не заменяет этот минимум. Не запускать тяжёлые параллельные задачи во время сборки/upgrade; проверка MemTotal не гарантирует свободную память при любой нагрузке.
