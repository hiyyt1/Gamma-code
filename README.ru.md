# Gamma

Gamma — веб-приложение для работы с AI-агентом, проектами и файлами на базе OpenCode.

Для локального запуска из корня репозитория нужен Bun 1.3.14:

```bash
bun install
bun deploy/setup-auth.ts ~/.local/share/gamma-dev/auth
bun run dev:gamma
```

Страница входа: `http://localhost:4456/login`, внутренний backend: `http://127.0.0.1:4108`. `dev:gamma` собирает frontend и запускает его через тот же защищённый шлюз, что и production; прямой Vite не является точкой входа Gamma. После изменений frontend запустите новую сборку; HMR в этом режиме не используется. Данные разработки по умолчанию находятся в `~/.local/share/gamma-dev`. Настройки: `GAMMA_DEV_DATA_ROOT`, `GAMMA_DEV_SERVER_PORT`, `GAMMA_DEV_WEB_PORT` и `GAMMA_WORKSPACES_ROOT`.

Шаблоны развёртывания: `deploy/gamma.env.example`, `deploy/gamma-backend.service` и `deploy/gamma-web.service`. Они используют пользователя `gamma`, каталог приложения `/opt/gamma`, конфигурацию `/etc/gamma/gamma.env`, данные `/var/lib/gamma` и проекты `/home/gamma/workspaces`. Перед применением к существующей установке необходимо перенести данные и обновить пользователя, пути и переменные окружения. Переименование исходников не переносит работающую установку автоматически.

Авторизация Gamma использует одного администратора. Команда `deploy/setup-auth.ts` интерактивно запрашивает логин и пароль без эха, сохраняет только Argon2id-хеш (64 MiB, 3 прохода) в `auth.json` с правами `0600` и создаёт отдельный случайный сервисный секрет в `backend.env`. Файлы должны находиться вне репозитория и быть доступны пользователю процесса. Существующие файлы команда не перезаписывает. Для другого локального каталога задайте `GAMMA_DEV_AUTH_DIR`.

В production укажите точный HTTPS-origin в `GAMMA_PUBLIC_ORIGIN` и путь к приватному `auth.json` в `GAMMA_AUTH_CONFIG`. Оба systemd-сервиса читают один `/etc/gamma/backend.env`; не используйте пароль администратора как `OPENCODE_SERVER_PASSWORD`. Backend слушает только loopback и сохраняет внутренний Basic Auth. Шлюз не запустится, если backend отвечает без авторизации. Nginx должен отправлять **все** маршруты приложения в шлюз, а не напрямую в backend; пример — `deploy/gamma.nginx.conf.example`. `GAMMA_TRUST_PROXY=1` допустим только за таким доверенным прокси, перезаписывающим `X-Real-IP`.

Вход: откройте адрес Gamma, введите заданные при настройке логин и пароль. Выход: меню пользователя внизу боковой панели → «Выйти из аккаунта». Cookie `HttpOnly; SameSite=Lax` получает `Secure` и префикс `__Host-` на HTTPS. Сессия действует до 12 часов, сохраняется при обновлении страницы и отзывается сервером при выходе. Токен не попадает в URL или localStorage. Для MVP используется один процесс шлюза; его перезапуск отзывает все входы, но не удаляет проекты и чаты.

API, SSE и WebSocket проверяют сессию до передачи запроса backend. Изменяющие запросы и WebSocket требуют точного `Origin`; запросы из другого сайта, поддомена и sandboxed Preview отклоняются. Лимиты входа: 5 попыток с одного адреса, восстановление одной попытки за 3 минуты; дополнительно общий лимит и максимум две параллельные проверки Argon2id. SSE передаётся без буферизации, а выход и истечение сессии закрывают связанные потоки и WebSocket. Уже выданные изолированные Preview-ссылки сохраняют собственный короткий срок действия по существующему протоколу Preview; создание и продление доступны только после входа.

Переход с Nginx Basic Auth: сначала сохранить действующие конфигурации и резервную копию данных; установить шлюз и приватную конфигурацию за существующей защитой; проверить вход, выход, API/SSE/WebSocket и рабочие функции на отдельном закрытом адресе. Только затем применить `auth_basic off` из шаблона и убрать прямые маршруты к backend. Внутренний Basic Auth не отключать. При откате сначала вернуть внешнюю защиту, затем прежний web-сервис. Пути к текущим проектам, базе и настройкам сохраняются; данная реализация не требует миграции данных. Изменения VPS в рамках локальной реализации не выполняются.

Проверки выполняются из соответствующих каталогов:

```bash
cd deploy
bun typecheck
bun test
cd ../packages/app
bun typecheck
bun typecheck:auth
bun run build
bun run e2e/auth-smoke.ts
```

Smoke-тест использует временную базу, HTTPS, настоящие API Gamma и локальный тестовый LLM; платных вызовов провайдеров и изменений пользовательских проектов нет. Он проверяет вход, ошибку пароля, обновление страницы, выход и повторное использование отозванной cookie, мобильный экран, агента, файлы, базу знаний и Preview.

Справочные материалы для проверки защиты: [OWASP — серверные сессии](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP — CSRF и Origin](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html). Термины экрана входа сверены с [русской локализацией Mozilla](https://github.com/mozilla/fxa-content-server-l10n/blob/main/locale/ru/LC_MESSAGES/client.po), [интерфейсом Microsoft](https://support.microsoft.com/ru-ru/accounts-billing/security/user-account-access-in-windows) и [словарём «Грамоты»](https://gramota.ru/meta/login); спорных региональных вариантов в добавленных строках нет.

Имена пакетов, импорты и внутренние API OpenCode сохранены. Ниже приведена документация исходного проекта.

---

<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Открытый AI-агент для программирования.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Установка

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Менеджеры пакетов
npm i -g opencode-ai@latest        # или bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS и Linux (рекомендуем, всегда актуально)
brew install opencode              # macOS и Linux (официальная формула brew, обновляется реже)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # любая ОС
nix run nixpkgs#opencode           # или github:anomalyco/opencode для самой свежей ветки dev
```

> [!TIP]
> Перед установкой удалите версии старше 0.1.x.

### Десктопное приложение (BETA)

OpenCode также доступен как десктопное приложение. Скачайте его со [страницы релизов](https://github.com/anomalyco/opencode/releases) или с [opencode.ai/download](https://opencode.ai/download).

| Платформа             | Загрузка                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm` или AppImage        |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Каталог установки

Скрипт установки выбирает путь установки в следующем порядке приоритета:

1. `$OPENCODE_INSTALL_DIR` - Пользовательский каталог установки
2. `$XDG_BIN_DIR` - Путь, совместимый со спецификацией XDG Base Directory
3. `$HOME/bin` - Стандартный каталог пользовательских бинарников (если существует или можно создать)
4. `$HOME/.opencode/bin` - Fallback по умолчанию

```bash
# Примеры
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

В OpenCode есть два встроенных агента, между которыми можно переключаться клавишей `Tab`.

- **build** - По умолчанию, агент с полным доступом для разработки
- **plan** - Агент только для чтения для анализа и изучения кода
  - По умолчанию запрещает редактирование файлов
  - Запрашивает разрешение перед выполнением bash-команд
  - Идеален для изучения незнакомых кодовых баз или планирования изменений

Также включен сабагент **general** для сложных поисков и многошаговых задач.
Он используется внутренне и может быть вызван в сообщениях через `@general`.

Подробнее об [agents](https://opencode.ai/docs/agents).

### Документация

Больше информации о том, как настроить OpenCode: [**наши docs**](https://opencode.ai/docs).

### Вклад

Если вы хотите внести вклад в OpenCode, прочитайте [contributing docs](./CONTRIBUTING.md) перед тем, как отправлять pull request.

### Разработка на базе OpenCode

Если вы делаете проект, связанный с OpenCode, и используете "opencode" как часть имени (например, "opencode-dashboard" или "opencode-mobile"), добавьте примечание в README, чтобы уточнить, что проект не создан командой OpenCode и не аффилирован с нами.

---

**Присоединяйтесь к нашему сообществу** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
