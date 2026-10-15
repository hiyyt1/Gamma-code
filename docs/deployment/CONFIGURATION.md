# Gamma: конфигурация и env

[Установка](INSTALL.md) · [Permissions](PERMISSIONS.md) · [Эксплуатация](OPERATIONS.md)

## Область инвентаризации

Таблицы описывают defaults **кода**, а не содержимое действующего VPS. «Да (стандарт)» означает обязательность для воспроизводимого рецепта, даже если fallback существует. Env systemd читается при запуске процесса, изменение файла требует restart. `VITE_*` фиксируется при build, требует rebuild frontend; секреты в нём оказываются в браузере. Nginx не подставляет Gamma env автоматически: host, порты и certificate paths согласуются отдельно.

Проверены `deploy/`, `script/dev-gamma.ts`, runtime исходники `packages/{opencode,core,server,llm,app}/src` и app Vite config/plugin; дополнительно build scripts и поставляемые agent scripts. Тестовые/CI/cloud-console/desktop env не являются требованиями VPS. Дополнительная таблица ниже перечисляет оставшиеся статически именованные переключатели этой области. Набор env стороннего MCP/SDK/user project **открытый**: config поддерживает произвольные environment/headers и `{env:NAME}`, provider names загружаются из каталога моделей. Поэтому конечного универсального перечня всех потенциальных env нет; динамические источники описаны отдельно.

## Основные переменные

| Variable | Required | Default | Description | Example | Secret |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | Да (стандарт) | runtime-dependent | Режим Node/Bun libraries; не выбирает протокол Gamma | production | Нет |
| `HOME` | Да (стандарт) | HOME Unix user | Домашний каталог tools, browser cache, fallback Knowledge | /home/gamma | Нет |
| `PATH` | Да | окружение процесса | Installer units задают закреплённые Bun/Node, /usr/bin и /bin | /opt/gamma/runtime/bun-1.3.14:/opt/gamma/runtime/node-v22.22.0-linux-x64/bin:/usr/bin:/bin | Нет |
| `GAMMA_WORKSPACES_ROOT` | Да (стандарт) | /home/gamma/workspaces | ProductProjects root; не sandbox shell | /home/gamma/workspaces | Нет |
| `GAMMA_KNOWLEDGE_ROOT` | Да (стандарт) | $HOME/.local/share/gamma/knowledge | Отдельный корень Knowledge; не вложен в workspaces и наоборот | /var/lib/gamma/knowledge | Нет |
| `GAMMA_AGENT_MARKET_ROOT` | Да (стандарт) | gamma-agent-market относительно core source | Каталог profiles, manifests, bundles; для compiled backend обязательно указать | /opt/gamma/releases/<id>/gamma-agent-market | Нет |
| `GAMMA_SKILL_MARKET_ROOT` | Да (стандарт) | gamma-skill-market относительно core source | Каталог Skill Market с integrity metadata | /opt/gamma/releases/<id>/gamma-skill-market | Нет |
| `OPENCODE_DB` | Да (стандарт) | $XDG_DATA_HOME/opencode/opencode[-channel].db | Абсолютный SQLite path устраняет разницу local/prod channel; :memory: не production | /var/lib/gamma/opencode.db | Нет |
| `XDG_DATA_HOME` | Да (стандарт) | ~/.local/share | OpenCode добавляет /opencode; не добавляйте его дважды | /var/lib/gamma/data | Нет |
| `XDG_STATE_HOME` | Да (стандарт) | ~/.local/state | OpenCode добавляет /opencode; не добавляйте его дважды | /var/lib/gamma/state | Нет |
| `XDG_CACHE_HOME` | Да (стандарт) | ~/.cache | OpenCode добавляет /opencode; не добавляйте его дважды | /var/lib/gamma/cache | Нет |
| `XDG_CONFIG_HOME` | Да (стандарт) | ~/.config | OpenCode добавляет /opencode; не добавляйте его дважды | /var/lib/gamma/config | Нет |
| `GAMMA_BACKEND_PORT` | Да для unit | нет default в unit | Подстановка systemd в --port; сам backend не читает эту Gamma env | 4096 | Нет |
| `GAMMA_BACKEND_URL` | Нет | http://127.0.0.1:4096 | Gateway upstream, только HTTP 127.0.0.1 без credentials в URL | http://127.0.0.1:4096 | Нет |
| `GAMMA_WEB_PORT` | Нет | 4444 | Gateway loopback listener | 4444 | Нет |
| `GAMMA_WEB_ROOT` | Нет | ../packages/app/dist относительно deploy/web.ts | Production static assets | /opt/gamma/releases/<id>/packages/app/dist | Нет |
| `GAMMA_PUBLIC_ORIGIN` | Да | нет; startup error | Точный origin без trailing slash; HTTPS вне loopback | https://gamma.example.com | Нет |
| `GAMMA_AUTH_CONFIG` | Да | нет; startup error | Путь к 0600 JSON с username/passwordHash; не provider credentials | /etc/gamma/auth.json | Нет |
| `GAMMA_TRUST_PROXY` | 1 за данным Nginx; 0 для SSH/Cloudflare Tunnel | false | Только строка 1 доверяет X-Real-IP; Nginx обязан перезаписывать header | 1 | Нет |
| `OPENCODE_SERVER_USERNAME` | Нет | opencode | Внутренний Basic login, не browser admin; setup-auth создаёт gamma-internal | gamma-internal | Нет |
| `OPENCODE_SERVER_PASSWORD` | Да для gateway | нет; backend без auth, gateway откажет | Случайный внутренний пароль >=32 символов, создан setup-auth | генерируется setup-auth | Да |
| `GAMMA_PREVIEW_DOMAIN` | Только legacy внешний Preview | нет; встроенный режим работает | Base для capability hosts на независимом регистрируемом домене | preview.example.net | Нет |
| `GAMMA_PREVIEW_PORT` | Нет | 4097 | Listener backend; изменение требует изменения Nginx upstream | 4097 | Нет |
| `OPENCODE_CONFIG` | Да (Legacy стандарт) | нет | Дополнительный файл до project config; не читается native V2 loader | /etc/gamma/opencode.json | Нет |
| `OPENCODE_CONFIG_DIR` | Нет | global XDG config в V2 | Дополнительный каталог Legacy; global directory V2; возможны plugins/agents | /var/lib/gamma/config/opencode | Нет |
| `OPENCODE_CONFIG_CONTENT` | Нет | нет | Inline JSON Legacy после directory config; не policy ceiling | не задавать одновременно с базовым профилем | Возможно |
| `OPENCODE_PERMISSION` | Нет | нет | Legacy JSON deep merge; не обходит Market boundary | {"bash":"ask"} | Нет |
| `OPENCODE_DISABLE_PROJECT_CONFIG` | Да (Legacy стандарт) | false | Отключает project JSON/.opencode discovery, но не все источники инструкций | 1 | Нет |
| `OPENCODE_AUTH_CONTENT` | Нет | нет | JSON provider auth override, вместо чтения auth.json; секретный | не использовать без отдельной схемы доставки | Да |
| `OPENCODE_LOG_LEVEL` | Нет | INFO | Core logging; Legacy CLI также --log-level | INFO | Нет |
| `OPENCODE_PRINT_LOGS` | Нет | false | Значение 1 добавляет stderr; unit --print-logs устанавливает флаг | 1 | Нет |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Нет | нет | Endpoint exporter traces | https://otel.example.net/v1/traces | Нет |
| `OTEL_EXPORTER_OTLP_HEADERS` | Нет | нет | Заголовки exporter authentication | задаётся secret manager | Да |
| `OTEL_RESOURCE_ATTRIBUTES` | Нет | нет | Resource labels telemetry, формат key=value | service.name=gamma | Нет |
| `OPENCODE_MODELS_URL` | Нет | https://models.opencode.ai | Источник каталога: добавляется /api.json; не URL inference | https://models.opencode.ai | Нет |
| `OPENCODE_MODELS_PATH` | Нет | нет | Локальный каталог моделей, приоритет перед snapshot/network | /etc/gamma/models.json | Нет |
| `OPENCODE_DISABLE_CHANNEL_DB` | Нет | false | 1/true отключает channel suffix, не нужен при абсолютном OPENCODE_DB | 1 | Нет |
| `OPENCODE_WORKSPACE_ID` | Нет | нет | Экспериментальная placement identity, не GAMMA_WORKSPACES_ROOT | не задавать для local placement | Нет |
| `OPENCODE_WEBSEARCH_PROVIDER` | Нет | выбор tools/model/flags | Только exa или parallel как override | exa | Нет |
| `EXA_API_KEY` | При выбранном search backend | нет | API key поиска; не LLM credential | через backend.env | Да |
| `PARALLEL_API_KEY` | При выбранном search backend | нет | API key поиска; не LLM credential | через backend.env | Да |
| `GAMMA_1C_PYTHON` | Для 1C с venv | python3 | Python >=3.10 с lxml; skill substitution и sourceTools probe | /var/lib/gamma/1c-python/bin/python | Нет |
| `GAMMA_BSL_JAR` | Для BSL MCP | нет | Absolute JAR BSL LS 1.1.0-rc.6 exec.jar | /opt/gamma-tools/bsl/bsl-language-server.jar | Нет |
| `GAMMA_BSL_JAVA` | Нет | java | Java >=21 executable | /usr/bin/java | Нет |
| `GAMMA_BITRIX24_DOCS_DISABLED` | Нет | false | 1 отключает встроенный Bitrix docs MCP | 1 | Нет |
| `GAMMA_BITRIX24_PORTAL_ORIGINS` | При custom portal | пустой список | Comma-separated дополнительные разрешённые portal origins | https://portal.example.net | Нет |
| `GAMMA_WB_ON_PREMISE` | Нет | false | Только 1 разрешает on-premise personal-token сценарий | 1 | Нет |
| `GAMMA_PRESENTATION_VISION_MODEL` | Нет | agent gamma-presentation-reviewer.model → model → provider default | Выбранная модель presentation vision; проверить image capability | providerID/modelID | Нет |
| `GAMMA_PRESENTATION_PLAYWRIGHT_MODULE` | Нет | playwright | Импорт внешнего Playwright, особенно compiled distribution | /opt/gamma/presentation-runtime/node_modules/playwright/index.mjs | Нет |
| `PLAYWRIGHT_BROWSERS_PATH` | Нет | Playwright HOME cache | Library env; одинаковый install/runtime путь | /var/lib/gamma/browser-cache | Нет |
| `GAMMA_DEV_DATA_ROOT` | Нет | $HOME/.local/share/gamma-dev | Изоляция dev launcher | /home/developer/.local/share/gamma-dev | Нет |
| `GAMMA_DEV_AUTH_DIR` | Нет | GAMMA_DEV_DATA_ROOT/auth | Файлы dev login/internal auth | /home/developer/.local/share/gamma-dev/auth | Нет |
| `GAMMA_DEV_SERVER_PORT` | Нет | 4108 | Backend dev:gamma launcher | 4108 | Нет |
| `GAMMA_DEV_WEB_PORT` | Нет | 4456 | Web dev launcher; origin принудительно http://localhost:port | 4456 | Нет |
| `VITE_OPENCODE_SERVER_HOST` | Только HMR | localhost | Build-time dev API host, production использует текущий origin | localhost | Нет |
| `VITE_OPENCODE_SERVER_PORT` | Только HMR | 4096 | Build-time dev API port | 4108 | Нет |
| `VITE_OPENCODE_CHANNEL` | Производное | dev | Vite define из OPENCODE_CHANNEL; direct VITE env не управляет им надёжно. UI defaults, не переключатель Legacy/V2 | не задавать напрямую | Нет |
| `VITE_DISABLE_DEBUG_BAR` | Нет | не задан | 1 скрывает dev debug bar | 1 | Нет |
| `VITE_SENTRY_DSN` | Нет | нет | Client monitoring; не класть приватные API credentials в VITE | public DSN | Публичный идентификатор |
| `VITE_SENTRY_ENVIRONMENT` | Нет | import.meta.env.MODE | Build-time monitoring environment | production | Нет |
| `VITE_SENTRY_RELEASE` | Нет | web@package.version | Build-time release label | gamma@release-sha | Нет |
| `SENTRY_AUTH_TOKEN` | Только upload sourcemaps | нет | Vite plugin upload credential, только build process | secret CI variable | Да |
| `SENTRY_ORG` | Только upload sourcemaps | нет | Организация и проект Sentry build plugin | идентификатор в Sentry | Нет |
| `SENTRY_PROJECT` | Только upload sourcemaps | нет | Организация и проект Sentry build plugin | идентификатор в Sentry | Нет |
| `SENTRY_RELEASE` | Нет | VITE_SENTRY_RELEASE | Build plugin release label | gamma@release-sha | Нет |
| `HTTP_PROXY` | Нет | нет | Proxy для исходящих запросов; dev launcher отклоняет SOCKS; credentials в URL секретны | http://127.0.0.1:3128 | Возможно |
| `HTTPS_PROXY` | Нет | нет | Proxy для исходящих запросов; dev launcher отклоняет SOCKS; credentials в URL секретны | http://127.0.0.1:3128 | Возможно |
| `ALL_PROXY` | Нет | нет | Proxy для исходящих запросов; dev launcher отклоняет SOCKS; credentials в URL секретны | http://127.0.0.1:3128 | Возможно |
| `http_proxy` | Нет | нет | Proxy для исходящих запросов; dev launcher отклоняет SOCKS; credentials в URL секретны | http://127.0.0.1:3128 | Возможно |
| `https_proxy` | Нет | нет | Proxy для исходящих запросов; dev launcher отклоняет SOCKS; credentials в URL секретны | http://127.0.0.1:3128 | Возможно |
| `all_proxy` | Нет | нет | Proxy для исходящих запросов; dev launcher отклоняет SOCKS; credentials в URL секретны | http://127.0.0.1:3128 | Возможно |
| `NO_PROXY` | Нет | нет | Обход proxy для локальных listeners, если proxy используется | localhost,127.0.0.1,::1 | Нет |
| `no_proxy` | Нет | нет | Обход proxy для локальных listeners, если proxy используется | localhost,127.0.0.1,::1 | Нет |
| `OPENAI_API_KEY` | Один нужный provider либо UI auth | нет | Стандартные provider keys; реальные имена проверяются по provider.env каталога модели; UI auth альтернатива | через provider UI либо backend.env | Да |
| `ANTHROPIC_API_KEY` | Один нужный provider либо UI auth | нет | Стандартные provider keys; реальные имена проверяются по provider.env каталога модели; UI auth альтернатива | через provider UI либо backend.env | Да |
| `OPENROUTER_API_KEY` | Один нужный provider либо UI auth | нет | Стандартные provider keys; реальные имена проверяются по provider.env каталога модели; UI auth альтернатива | через provider UI либо backend.env | Да |
| `OPENCODE_API_KEY` | Один нужный provider либо UI auth | нет | Стандартные provider keys; реальные имена проверяются по provider.env каталога модели; UI auth альтернатива | через provider UI либо backend.env | Да |
| `AWS_ACCESS_KEY_ID` | При Bedrock без другого credential source | нет | AWS credential chain SDK; bearer альтернативен ключам | через секретное окружение | Да |
| `AWS_SECRET_ACCESS_KEY` | При Bedrock без другого credential source | нет | AWS credential chain SDK; bearer альтернативен ключам | через секретное окружение | Да |
| `AWS_SESSION_TOKEN` | При Bedrock без другого credential source | нет | AWS credential chain SDK; bearer альтернативен ключам | через секретное окружение | Да |
| `AWS_BEARER_TOKEN_BEDROCK` | При Bedrock без другого credential source | нет | AWS credential chain SDK; bearer альтернативен ключам | через секретное окружение | Да |
| `AWS_PROFILE` | Нет | SDK default | Named AWS profile; не root profile | gamma | Нет |
| `AWS_REGION` | При Bedrock | us-east-1 | Регион Bedrock; explicit provider options имеют приоритет | us-east-1 | Нет |
| `AWS_WEB_IDENTITY_TOKEN_FILE` | При AWS federation | нет | Путь к токену SDK | /run/gamma/token | Путь к секрету |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` | При AWS role | нет | Credential endpoint SDK; не настраивать на обычном VPS | не задавать | Возможно |
| `AWS_CONTAINER_CREDENTIALS_FULL_URI` | При AWS role | нет | Credential endpoint SDK; не настраивать на обычном VPS | не задавать | Возможно |
| `GOOGLE_VERTEX_PROJECT` | При Vertex | нет | Project fallback chain в указанном порядке; explicit options могут перекрывать | my-gamma-project | Нет |
| `GOOGLE_CLOUD_PROJECT` | При Vertex | нет | Project fallback chain в указанном порядке; explicit options могут перекрывать | my-gamma-project | Нет |
| `GCP_PROJECT` | При Vertex | нет | Project fallback chain в указанном порядке; explicit options могут перекрывать | my-gamma-project | Нет |
| `GCLOUD_PROJECT` | При Vertex | нет | Project fallback chain в указанном порядке; explicit options могут перекрывать | my-gamma-project | Нет |
| `GOOGLE_VERTEX_LOCATION` | При Vertex | global (зависит от adapter) | Location fallback chain; сверить модель/регион | global | Нет |
| `GOOGLE_CLOUD_LOCATION` | При Vertex | global (зависит от adapter) | Location fallback chain; сверить модель/регион | global | Нет |
| `VERTEX_LOCATION` | При Vertex | global (зависит от adapter) | Location fallback chain; сверить модель/регион | global | Нет |
| `GOOGLE_APPLICATION_CREDENTIALS` | При ADC file | ADC chain | Google SDK credential file, не прямой Gamma parser | /etc/gamma/google-service-account.json | Путь к секрету |
| `AZURE_RESOURCE_NAME` | При Azure | нет | Resource hostname prefix respective adapter | gamma-resource | Нет |
| `AZURE_COGNITIVE_SERVICES_RESOURCE_NAME` | При Azure | нет | Resource hostname prefix respective adapter | gamma-resource | Нет |
| `CLOUDFLARE_ACCOUNT_ID` | При Cloudflare | provider options/auth metadata | Cloudflare adapter routing | идентификатор аккаунта/gateway | Нет |
| `CLOUDFLARE_GATEWAY_ID` | При Cloudflare | provider options/auth metadata | Cloudflare adapter routing | идентификатор аккаунта/gateway | Нет |
| `CLOUDFLARE_API_KEY` | При Cloudflare | provider options/auth fallback | CF_AIG_TOKEN альтернативен API_TOKEN в gateway adapter | через secret storage | Да |
| `CLOUDFLARE_API_TOKEN` | При Cloudflare | provider options/auth fallback | CF_AIG_TOKEN альтернативен API_TOKEN в gateway adapter | через secret storage | Да |
| `CF_AIG_TOKEN` | При Cloudflare | provider options/auth fallback | CF_AIG_TOKEN альтернативен API_TOKEN в gateway adapter | через secret storage | Да |
| `GITLAB_INSTANCE_URL` | Нет | https://gitlab.com | GitLab provider endpoint | https://gitlab.com | Нет |
| `GITLAB_TOKEN` | При GitLab provider | auth/options fallback | Provider token | через secret storage | Да |
| `SNOWFLAKE_ACCOUNT` | При Snowflake | provider options fallback | Snowflake account routing | account identifier | Нет |
| `SNOWFLAKE_CORTEX_TOKEN` | При Snowflake | auth fallback | Token/PAT alternatives | через secret storage | Да |
| `SNOWFLAKE_CORTEX_PAT` | При Snowflake | auth fallback | Token/PAT alternatives | через secret storage | Да |
| `AICORE_SERVICE_KEY` | При SAP | auth fallback | SAP service credential JSON | через secret storage | Да |
| `AICORE_DEPLOYMENT_ID` | При SAP | нет | SAP deployment selection | идентификатор из SAP | Нет |
| `AICORE_RESOURCE_GROUP` | При SAP | нет | SAP deployment selection | идентификатор из SAP | Нет |
| `MODAL_PROXY_TOKEN` | При Modal | auth fallback | Modal plugin token | через secret storage | Да |

Основные consumers: [gateway](../../deploy/web.ts), [auth](../../deploy/auth.ts), [unit](../../deploy/gamma-backend.service), [dev](../../script/dev-gamma.ts), [Global](../../packages/core/src/global.ts), [DB](../../packages/core/src/database/database.ts), [models](../../packages/core/src/models-dev.ts), [Legacy provider](../../packages/opencode/src/provider/provider.ts), [provider plugins](../../packages/core/src/plugin/provider), [Vite](../../packages/app/vite.config.ts), [entry](../../packages/app/src/entry.tsx), [preview](../../packages/opencode/src/server/site-preview.ts), [Knowledge](../../packages/opencode/src/server/knowledge-store.ts), [BSL](../../packages/opencode/src/mcp/bsl.ts), [presentation](../../packages/opencode/src/presentation).

## Остальные runtime/build переключатели

Не добавлять весь список в production env. У флагов false/unset означает штатное поведение, а не рекомендацию включить feature. Для experimental семейства значения по умолчанию могут наследовать `OPENCODE_EXPERIMENTAL`; в стандарте весь экспериментальный набор unset. Ссылка у строки показывает конкретный consumer, включая платформенные и CLI-only случаи. `не задана` означает отсутствие env, дальнейший fallback указан в consumer; это не пустая строка, которую нужно экспортировать.

| Variable | Required | Default | Description | Example | Secret |
| --- | --- | --- | --- | --- | --- |
| `AGENT` | Нет | не задана | CLI marker, выставляется автоматически в 1; [consumer](../../packages/opencode/src/index.ts#L75) | не задавать | Нет |
| `COMSPEC` | Нет | не задана | Windows shell; не Ubuntu; [consumer](../../packages/core/src/shell.ts#L101) | не задавать | Нет |
| `DEV` | Нет | не задана | Vite встроенная build константа, не service env; [consumer](../../packages/app/src/components/terminal.tsx#L69) | не задавать | Нет |
| `DOTNET_CLI_HOME` | Нет | не задана | C# LSP HOME; [consumer](../../packages/opencode/src/lsp/server.ts#L779) | не задавать | Нет |
| `GITHUB_RUN_ID` | Нет | не задана | GitHub action run identifier; [consumer](../../packages/opencode/src/cli/cmd/github.handler.ts#L675) | не задавать | Нет |
| `GITHUB_TOKEN` | Нет | не задана | GitHub CLI workflow token; [consumer](../../packages/opencode/src/cli/cmd/github.handler.ts#L474) | не задавать | Да |
| `GIT_ASKPASS` | Нет | не задана | IDE integration helper; [consumer](../../packages/opencode/src/ide/index.ts#L24) | не задавать | Нет |
| `LANG` | Нет | не задана | Locale дочернего PTY; Windows принудительно C.UTF-8, Linux наследует окружение; [consumer](../../packages/core/src/pty.ts#L179) | не задавать | Нет |
| `LC_ALL` | Нет | не задана | Locale дочернего PTY; Windows принудительно C.UTF-8, Linux наследует окружение; [consumer](../../packages/core/src/pty.ts#L177) | не задавать | Нет |
| `LC_CTYPE` | Нет | не задана | Locale дочернего PTY; Windows принудительно C.UTF-8, Linux наследует окружение; [consumer](../../packages/core/src/pty.ts#L178) | не задавать | Нет |
| `MENTIONS` | Нет | /opencode,/oc | GitHub mention triggers; [consumer](../../packages/opencode/src/cli/cmd/github.handler.ts#L747) | не задавать | Нет |
| `MODE` | Нет | не задана | Vite mode, не service env; [consumer](../../packages/app/src/entry.tsx#L130) | не задавать | Нет |
| `MODEL` | Нет | не задана | GitHub command model override; [consumer](../../packages/opencode/src/cli/cmd/github.handler.ts#L664) | не задавать | Нет |
| `OIDC_BASE_URL` | Нет | не задана | GitHub command OIDC endpoint; [consumer](../../packages/opencode/src/cli/cmd/github.handler.ts#L697) | не задавать | Нет |
| `OPENCODE` | Нет | не задана | CLI marker, выставляется автоматически в 1; [consumer](../../packages/opencode/src/index.ts#L76) | не задавать | Нет |
| `OPENCODE_ACP_PROFILE` | Нет | false | ACP profiling, enabled только 1; [consumer](../../packages/opencode/src/acp/profile.ts#L1) | не задавать | Нет |
| `OPENCODE_ALWAYS_NOTIFY_UPDATE` | Нет | false | Уведомлять об обновлениях; [consumer](../../packages/core/src/flag/flag.ts#L24) | 1 | Нет |
| `OPENCODE_AUTO_HEAP_SNAPSHOT` | Нет | false | Автоматический heap snapshot; может содержать private runtime data; [consumer](../../packages/core/src/flag/flag.ts#L19) | 1 | Нет |
| `OPENCODE_AUTO_SHARE` | Нет | false | Автоматическая публикация сессий; не включать в private installation; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L17) | 1 | Нет |
| `OPENCODE_CALLER` | Нет | не задана | IDE caller identification; [consumer](../../packages/opencode/src/ide/index.ts#L33) | не задавать | Нет |
| `OPENCODE_CHANNEL` | Да при standard frontend build | dev в app/vite.js; branch в release scripts | Build input dev/beta/prod; latest → prod в app; не меняет backend InstallationChannel source run | prod | Нет |
| `OPENCODE_CLIENT` | Нет | cli | Client identification, default cli; [consumer](../../packages/core/src/flag/flag.ts#L76) | не задавать | Нет |
| `OPENCODE_CONSOLE_TOKEN` | Нет | не задана | Внутренний organization token, выставляется loader; [consumer](../../packages/opencode/src/config/config.ts#L505) | не задавать | Да |
| `OPENCODE_DIRECT_TRACE` | Нет | не задана | CLI trace diagnostic control; [consumer](../../packages/opencode/src/cli/cmd/run/trace.ts#L58) | не задавать | Нет |
| `OPENCODE_DISABLE_AUTOCOMPACT` | Нет | false | Отключить autocompaction; [consumer](../../packages/core/src/flag/flag.ts#L28) | 1 | Нет |
| `OPENCODE_DISABLE_AUTOUPDATE` | Нет | false | Отключить updater (стандарт 1); [consumer](../../packages/core/src/flag/flag.ts#L23) | 1 | Нет |
| `OPENCODE_DISABLE_CLAUDE_CODE` | Нет | false | Отключить Claude prompt/skills compatibility; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L24) | 1 | Нет |
| `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` | Нет | false | Отключить Claude prompt compatibility; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L25) | 1 | Нет |
| `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` | Нет | false | Отключить Claude skill compatibility; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L29) | 1 | Нет |
| `OPENCODE_DISABLE_DEFAULT_PLUGINS` | Нет | false | Отключить default plugins; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L19) | 1 | Нет |
| `OPENCODE_DISABLE_EMBEDDED_WEB_UI` | Нет | false | Отключить встроенный OpenCode web UI, не Gamma gateway; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L20) | 1 | Нет |
| `OPENCODE_DISABLE_EXTERNAL_SKILLS` | Нет | false | Отключить внешнее skill discovery; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L21) | 1 | Нет |
| `OPENCODE_DISABLE_FFF` | Нет | false на Linux | Отключить fff search; Linux default false, Windows true; [consumer](../../packages/core/src/flag/flag.ts#L9) | 1 | Нет |
| `OPENCODE_DISABLE_LSP_DOWNLOAD` | Нет | false | Отключить автоматические LSP downloads; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L22) | 1 | Нет |
| `OPENCODE_DISABLE_MODELS_FETCH` | Нет | false | Не обновлять каталог моделей по сети; нужен snapshot/path/cache; [consumer](../../packages/core/src/flag/flag.ts#L29) | 1 | Нет |
| `OPENCODE_DISABLE_MOUSE` | Нет | false | Отключить TUI mouse; [consumer](../../packages/core/src/flag/flag.ts#L30) | 1 | Нет |
| `OPENCODE_DISABLE_PRUNE` | Нет | false | Не удалять старые tool outputs; [consumer](../../packages/core/src/flag/flag.ts#L25) | 1 | Нет |
| `OPENCODE_DISABLE_SHARE` | Нет | false | Отключить session sharing (стандарт 1); [consumer](../../packages/opencode/src/share/share-next.ts#L23) | не задавать | Нет |
| `OPENCODE_DISABLE_TERMINAL_TITLE` | Нет | false | Не менять terminal title; [consumer](../../packages/core/src/flag/flag.ts#L26) | 1 | Нет |
| `OPENCODE_ENABLE_EXA` | Нет | false | Включить Exa search; [consumer](../../packages/core/src/tool/websearch.ts#L79) | 1 | Нет |
| `OPENCODE_ENABLE_EXPERIMENTAL_MODELS` | Нет | false | Показать экспериментальные модели; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L40) | 1 | Нет |
| `OPENCODE_ENABLE_PARALLEL` | Нет | false | Включить Parallel search; [consumer](../../packages/core/src/tool/websearch.ts#L80) | 1 | Нет |
| `OPENCODE_ENABLE_QUESTION_TOOL` | Нет | false | Доступность question tool; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L41) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL` | Нет | false | Включает набор экспериментальных defaults; не включать массово; [consumer](../../packages/core/src/flag/flag.ts#L12) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` | Нет | OPENCODE_EXPERIMENTAL (false если unset) | Экспериментальный background subagents; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L43) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` | Нет | не задана | Положительный timeout shell в ms; fallback 120000 ms; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L53) | не задавать | Нет |
| `OPENCODE_EXPERIMENTAL_CODE_MODE` | Нет | OPENCODE_EXPERIMENTAL (false если unset) | Экспериментальный code mode; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L48) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT` | Нет | false на Linux | TUI copy-on-select, Linux false/Windows true; [consumer](../../packages/core/src/flag/flag.ts#L8) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER` | Нет | false | Отключить watcher; file panel freshness надо проверять; [consumer](../../packages/core/src/flag/flag.ts#L40) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM` | Нет | OPENCODE_EXPERIMENTAL (false если unset) | Экспериментальный event system; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L49) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_EXA` | Нет | false | Экспериментальный exa; [consumer](../../packages/core/src/tool/websearch.ts#L79) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_FILEWATCHER` | Нет | false | Экспериментальный file watcher; [consumer](../../packages/core/src/flag/flag.ts#L37) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_ICON_DISCOVERY` | Нет | OPENCODE_EXPERIMENTAL (false если unset) | Экспериментальный icon discovery; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L51) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_LSP_TOOL` | Нет | OPENCODE_EXPERIMENTAL (false если unset) | Экспериментальный lsp tool; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L45) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_LSP_TY` | Нет | false | Экспериментальный lsp ty; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L44) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_NATIVE_LLM` | Нет | false | Экспериментальная LLM реализация; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L54) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` | Нет | не задана | Положительный лимит output tokens; fallback model/provider; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L52) | не задавать | Нет |
| `OPENCODE_EXPERIMENTAL_OXFMT` | Нет | OPENCODE_EXPERIMENTAL (false если unset) | Экспериментальный oxfmt; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L46) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_PARALLEL` | Нет | false | Экспериментальный parallel; [consumer](../../packages/core/src/tool/websearch.ts#L80) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_PLAN_MODE` | Нет | OPENCODE_EXPERIMENTAL (false если unset) | Экспериментальный plan mode; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L47) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_REFERENCES` | Нет | OPENCODE_EXPERIMENTAL (false если unset) | Экспериментальный references; [consumer](../../packages/core/src/flag/flag.ts#L58) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_WEBSOCKETS` | Нет | false | Экспериментальный provider transport, не Nginx terminal WS; [consumer](../../packages/opencode/src/effect/runtime-flags.ts#L55) | 1 | Нет |
| `OPENCODE_EXPERIMENTAL_WORKSPACES` | Нет | OPENCODE_EXPERIMENTAL (false если unset) | Экспериментальный workspaces; [consumer](../../packages/core/src/flag/flag.ts#L50) | 1 | Нет |
| `OPENCODE_FAKE_VCS` | Нет | не задана | Тестовая VCS подмена; не production; [consumer](../../packages/core/src/flag/flag.ts#L31) | не задавать | Нет |
| `OPENCODE_GIT_BASH_PATH` | Нет | не задана | Windows-only Git Bash path; [consumer](../../packages/core/src/flag/flag.ts#L20) | не задавать | Нет |
| `OPENCODE_PID` | Нет | не задана | Устанавливается CLI автоматически; [consumer](../../packages/opencode/src/index.ts#L77) | не задавать | Нет |
| `OPENCODE_PLUGIN_META_FILE` | Нет | не задана | Plugin metadata override; [consumer](../../packages/core/src/flag/flag.ts#L73) | не задавать | Нет |
| `OPENCODE_PURE` | Нет | false | Pure CLI/runtime режим, не permission profile; [consumer](../../packages/core/src/flag/flag.ts#L67) | 1 | Нет |
| `OPENCODE_REPO_CLONE_GITHUB_BASE_URL` | Нет | не задана | Override base URL GitHub clone; [consumer](../../packages/core/src/repository.ts#L175) | не задавать | Нет |
| `OPENCODE_SHOW_TTFD` | Нет | false | Диагностика time-to-first-delta; [consumer](../../packages/core/src/flag/flag.ts#L27) | 1 | Нет |
| `OPENCODE_TEST_HOME` | Нет | не задана | Тестовый HOME override; не production; [consumer](../../packages/core/src/global.ts#L19) | не задавать | Нет |
| `OPENCODE_TEST_MANAGED_CONFIG_DIR` | Нет | не задана | Тестовый managed config override; не production; [consumer](../../packages/opencode/src/config/managed.ts#L32) | не задавать | Нет |
| `OPENCODE_TUI_CONFIG` | Нет | не задана | CLI TUI configuration path; [consumer](../../packages/core/src/flag/flag.ts#L61) | не задавать | Нет |
| `PATHEXT` | Нет | не задана | Windows executable suffixes; [consumer](../../packages/core/src/util/which.ts#L11) | не задавать | Нет |
| `PROMPT` | Нет | не задана | GitHub command prompt; [consumer](../../packages/opencode/src/cli/cmd/github.handler.ts#L732) | не задавать | Нет |
| `PWD` | Нет | не задана | CLI working directory; [consumer](../../packages/opencode/src/cli/cmd/run.ts#L333) | не задавать | Нет |
| `SHARE` | Нет | не задана | GitHub command sharing; [consumer](../../packages/opencode/src/cli/cmd/github.handler.ts#L681) | не задавать | Нет |
| `SHELL` | Нет | выбор shell implementation | Предпочитаемый пользовательский shell; [consumer](../../packages/core/src/shell.ts#L207) | не задавать | Нет |
| `TERM` | Нет | не задана | Terminal capabilities; [consumer](../../packages/opencode/src/cli/cmd/debug/index.ts#L59) | не задавать | Нет |
| `TERM_PROGRAM` | Нет | не задана | IDE/terminal detection; [consumer](../../packages/opencode/src/cli/cmd/debug/index.ts#L56) | не задавать | Нет |
| `TERM_PROGRAM_VERSION` | Нет | не задана | Terminal diagnostic version; [consumer](../../packages/opencode/src/cli/cmd/debug/index.ts#L57) | не задавать | Нет |
| `USE_GITHUB_TOKEN` | Нет | не задана | GitHub command auth choice; [consumer](../../packages/opencode/src/cli/cmd/github.handler.ts#L689) | не задавать | Нет |
| `VARIANT` | Нет | не задана | GitHub command model variant; [consumer](../../packages/opencode/src/cli/cmd/github.handler.ts#L408) | не задавать | Нет |
| `VIRTUAL_ENV` | Нет | не задана | LSP Python virtual environment discovery; [consumer](../../packages/opencode/src/lsp/server.ts#L445) | не задавать | Нет |
| `VSCODE_EXTENSIONS` | Нет | не задана | LSP extension discovery; [consumer](../../packages/opencode/src/lsp/server.ts#L789) | не задавать | Нет |

## Дополнительные scripts / производные значения

| Variable | Required | Default | Description | Example | Secret |
| --- | --- | --- | --- | --- | --- |
| `GAMMA_1C_PLATFORM` | Нет | PATH 1cv8 → 1cv8c | Python skill environment/check.py: путь к исполняемому 1C; не подтверждает лицензию/infobase | /opt/1cv8/1cv8 | Нет |
| `GAMMA_SKILL_MARKET_AUDIT_ROOT` | Нет | /tmp/gamma-skill-market-audit | script/skill-market/inventory.ts, только аудит каталога | /tmp/gamma-skill-market-audit | Нет |
| `OPENCODE_TERMINAL` | Выставляется PTY | 1 | Маркер дочернего терминала в core/src/pty.ts, не ручная service настройка | не задавать | Нет |
| `OPENCODE_VERSION` | Только binary release build | вычисляется script package | Override версии binary; source serve имеет InstallationVersion local | утверждённая release version | Нет |
| `OPENCODE_BUMP` | Только release tooling | patch при release вычислении | major/minor/patch для script package; может обращаться в npm | не задавать для VPS | Нет |
| `OPENCODE_RELEASE` | Только release tooling | не задана | Input script package, не config запущенной Gamma | не задавать для VPS | Нет |
| `GH_REPO` | Только binary publishing | нет | build script gh upload destination; не запускать publish на VPS | не задавать | Нет |
| `OPENTUI_LIBC` | Генерируется Linux binary build | glibc / build ABI | build define, не нужна при source serve Ubuntu | не задавать | Нет |

Источники: [BSL downloader](../../script/1c-agent/download-bsl.ts), [1C probe](../../gamma-agent-market/bundles/1c-development/skills/1c-environment/scripts/check.py), [Market inventory](../../script/skill-market/inventory.ts), [Vite channel](../../packages/app/vite.js), [release package](../../packages/script/src/index.ts), [binary build](../../packages/opencode/script/build.ts). Test-only `PREVIEW_*`, CI credentials, upstream skill test harness и workflows не входят в production env contract.

## Конфигурация вне env

| Источник | Содержание / приоритет |
| --- | --- |
| `/etc/gamma/auth.json` | Только username/passwordHash gateway. Один администратор; sessions in-memory 12 часов, max 32. После restart web нужен новый login |
| `/etc/gamma/backend.env` | Внутренний Basic secret; добавленные provider keys получают и backend, и web через существующие units |
| `/etc/gamma/opencode.json` | Legacy policy/default_agent/model/share; файл из OPENCODE_CONFIG не является последним override |
| `$XDG_CONFIG_HOME/opencode/opencode.json[c]` | Global OpenCode; в V2 canonical source, в Legacy один из ранних источников |
| Project `opencode.json[c]`, `.opencode/` | Agents, tools, providers, plugins, skills и permissions; в стандарте Legacy project loader отключён |
| `$HOME/.opencode` | Дополнительные agents/commands/plugins, проверять даже при disable project config |
| `/etc/opencode/opencode.json[c]` | Linux managed config Legacy, поздний override |
| `agent[s]/**/*.md`, `mode[s]/*.md` | Agent frontmatter/prompt, права могут отличаться от global |
| Provider auth | `/var/lib/gamma/data/opencode/auth.json` 0600; UI/API сохранение; OAuth refresh tokens тоже secrets |
| MCP auth | `/var/lib/gamma/data/opencode/mcp-auth.json` 0600; remote MCP credentials |
| Agent/Skill Market | Поставляемые catalogs, manifests/hashes; selections/pins в SQLite; обновление каталога не значит silent rebinding старых сессий |
| Browser storage | UI preferences, autoAccept, legacy Knowledge IndexedDB; не server permission enforcement и не полноценный backup |
| Nginx | Host/TLS/upstream/body size/streaming настроены вручную в INSTALL; не читает Gamma env |

### OpenCode JSON (Legacy)

Кроме `permission`, `default_agent`, `model` доступны реальные fields `provider`, `agent`, `mcp`, `skills`, `plugin`, `instructions`, `server`, `lsp`, `formatter`, `snapshot`, `share`, `autoupdate`, `experimental`. Полная schema: [ConfigV1](../../packages/core/src/v1/config/config.ts); V2 — [Config.Info](../../packages/core/src/config.ts). Не переносить singular/plural имена между схемами наугад. Precedence и исключения подробно в [PERMISSIONS.md](PERMISSIONS.md).

Для local MCP существующий формат (пример **структуры**, пакет здесь не поставляется):

```json
{
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["/usr/local/bin/node", "/opt/gamma-tools/my-mcp/server.js"],
      "enabled": true,
      "timeout": 10000,
      "environment": { "MY_SERVICE_TOKEN": "{env:MY_SERVICE_TOKEN}" }
    }
  }
}
```

До включения доставить выбранный MCP в указанный путь, pin версию/lock/hash, определить его env contract. `/opt/gamma-tools/my-mcp/server.js` не встроенный Gamma файл, `MY_SERVICE_TOKEN` не встроенная Gamma env: это показанный явно расширяемый contract. Local MCP наследует process.env и запускается от gamma; `environment` добавляет/переопределяет значения, не очищает остальные secrets.

Remote: `type: "remote"`, `url`, `headers`, `enabled`, `timeout`, `oauth` (false или clientId/clientSecret/scope/callbackPort/redirectUri). Default request timeout 5000 ms. OAuth default redirect `http://127.0.0.1:19876/mcp/oauth/callback` относится к VPS; браузер на ноутбуке не достигнет его без SSH tunnel/отдельно спроектированного redirect. Не открывать callback порт публично без проверки. Нет глобальных обязательных `MCP_PORT`/`MCP_API_KEY`.

Skills Legacy: `skills.paths` и `skills.urls`; native V2: `skills` array. Discovery также включает OpenCode/совместимые .claude/.agents skills и Market bundles; feature flags могут отключить внешние источники. Read-only каталоги не мешают читать skills, но scripts должны писать в workspace/temporary data, не в bundle.

### Динамические env providers

`packages/opencode/src/provider/provider.ts` получает `provider.env` из каталога и ищет первое заполненное значение; далее применяет auth/config/plugin настройки. Core integration аналогично поддерживает `method.type=env` с массивом `names`. Каталог может обновляться через `https://models.opencode.ai/api.json`; names не ограничены таблицей. Для каждого deployment фиксировать выбранный providerID/modelID, adapters и полученный каталог (при offline режиме `OPENCODE_MODELS_PATH` + `OPENCODE_DISABLE_MODELS_FETCH=1`). Эти флаги не делают npm/MCP/LLM offline.

`{env:NAME}`/`{file:path}` в Legacy config раскрывают произвольные переменные/файлы; пропущенная env может стать пустой строкой. Не выдавать raw effective config/debug output в публичный лог: он способен содержать раскрытые credentials. SDK env типа Google ADC, AWS credential chain, npm proxy/registry и Playwright также принадлежат зависимостям, требуют отдельного закрепления при включении.

### Не существующие универсальные настройки

Нет доказанного `GAMMA_PERMISSION_MODE`, `AUTO_APPROVE_ALL`, `GAMMA_MULTIUSER`, `DATABASE_URL` для основной SQLite БД, общего `MCP_SECRET`, env для публичного динамического Preview или env, изолирующей shell от secrets. `GAMMA_BACKEND_PORT` — contract unit, а не механизм конфигурации любой backend команды. Login/password browser пользователя не задаются через `OPENCODE_SERVER_USERNAME/PASSWORD`.

## Конфигурация, которой управляет install-gamma.sh

CLI и полный список параметров: [INSTALL](INSTALL.md#все-параметры). Эти параметры установщика не являются новыми runtime env. Единственный renderer — `deploy/installer/gamma_installer.py:rendered`; в отличие от ручных примеров выше пути assets/Market имеют вид `/opt/gamma/releases/<id>/...`. `<id>` — созданный установщиком UUID, фактическое значение хранит manifest.

* `/etc/gamma/install.json`: phase, options без admin credentials, release, commit, Bun/Node versions, lock SHA, hashes managed files и APT package versions. Root0600.
* `/etc/gamma/gamma.env`: все базовые runtime paths, loopback ports, origin, OPENCODE_CONFIG и disable project config/share/autoupdate. Root0600, читает systemd.
* `/etc/gamma/backend.env`: OPENCODE_SERVER_USERNAME/PASSWORD, root0600; случайный secret сохраняется при install/upgrade.
* `/etc/gamma/auth.json`: username и Argon2id passwordHash, gamma0600, исходный пароль не сохраняется.
* `/etc/gamma/opencode.json`: default_agent=gamma, share=disabled, autoupdate=false, permission profile. Root0644, каталог root:gamma0750.
* `gamma-backend.service`, `gamma-web.service`: gamma UID, fixed runtime PATH, абсолютный release, systemd EnvironmentFile, UMask0077, NoNewPrivileges, ProtectSystem=full, PrivateTmp.
* `/etc/nginx/conf.d/gamma.conf`: единственный управляемый app Nginx файл, содержит ownership marker. Остальные sites не удаляются.
* `/etc/gamma/transaction.json`: только на время переключения; next install/upgrade восстанавливает незавершённую транзакцию.

User/workspace directories 0700; release после build root-owned, group/other write снят. UID gamma всё равно имеет доступ к своим provider/admin credentials. Systemd hardening не изолирует tool-процессы от backend secrets.

Повторный запуск не переписывает credentials и не принимает скрытую смену профиля/domain/workspace. Изменение managed файлов блокирует upgrade/doctor (drift). Не редактировать install.json вручную для подавления диагностики: custom env/model config/Preview требуют явной проверяемой migration-функции будущего установщика. Provider connections через штатный UI и данные проектов не являются managed config и сохраняются. Глобальные agent/policy overrides также блокируют upgrade, чтобы не обещать autonomy при неизвестной effective policy.

Обычный `trusted-auto` применяется к Legacy Gamma. V2 не включается отдельным флагом установщика; native V2 loader не получает OPENCODE_CONFIG автоматически. Нельзя подменять backend unit на V2 без отдельного аудита policy.


Финальные defaults: `dev:gamma` использует `deploy/opencode.json`, `OPENCODE_DISABLE_PROJECT_CONFIG=1` и build `NODE_OPTIONS=--max-old-space-size=4096`, если оператор не указал overrides. Installer рендерит ту же permission policy (allow + external_directory deny), сохраняет выбранный профиль при upgrade и задаёт `PLAYWRIGHT_BROWSERS_PATH` внутри immutable release. Proxy variables installer не принимает: необходим прямой egress, диагностика происходит до provisioning.

В installer-режиме `cloudflare-tunnel` origin — `https://<ваш hostname>`, gateway — `127.0.0.1:4444`, trust proxy — 0. Локальный cloudflared направляется на gateway по HTTP; Secure cookie и exact-Origin проверки определяются публичным HTTPS origin, а не локальным транспортом. Настройка описана в [INSTALL.md](INSTALL.md).

## Production VPS и независимые HTTPS-режимы

Production: VPS с публичным IP → Nginx HTTPS → loopback gateway :4444 → backend :4096.
iMac остаётся тестовой установкой с Tailscale Funnel. Каждая установка хранит SQLite,
workspaces, Knowledge и LLM keys локально; центральные сервисы не требуются.

| Режим | Публичный вход | GAMMA_TRUST_PROXY |
| --- | --- | --- |
| `letsencrypt` | Nginx, сертификат и renewal через Certbot | 1, Nginx перезаписывает X-Real-IP |
| `existing` | Nginx, доверенный сертификат оператора | 1 |
| `ssh-tunnel` | localhost через SSH forwarding | 0 |
| `tailscale-funnel` | Отдельно настроенный Tailscale Funnel | 0 |
| `cloudflare-tunnel` | Опциональный отдельно настроенный cloudflared | 0 |

Ни один режим не требует другого. Cloudflare не нужен для Nginx, сертификатов или
Preview. Gateway проверяет configured Host, точный Origin и CSRF; непосредственные
loopback probes разрешены на его порту. Forwarded headers не определяют Origin.
HTTPS cookies остаются host-only `__Host-`, Secure/HttpOnly; backend Basic credentials
не передаются браузеру. SSE/WebSocket соединения закрываются при отзыве auth session.

### Legacy Preview на отдельном HTTPS-домене

Встроенный [Preview](../site-preview.md) включён без этих переменных и использует
существующий origin Gamma. Ниже описан только совместимый старый внешний режим.

`--preview-domain preview.example.net` задаёт `GAMMA_PREVIEW_DOMAIN` и loopback порт
4097. Адрес сайта — `https://<random-lease>.preview.example.net/`. Wildcard DNS
`*.preview.example.net` направляется непосредственно на IP VPS, а отдельный Nginx
virtual host использует сертификат для `*.preview.example.net`. См. INSTALL.md.
Никакой DNS allocator или запись на каждую ссылку не требуется.

Параметр поддерживается при install и сохраняется при upgrade. Для включения,
замены или отключения (`--preview-domain ''`) используйте `--reconfigure`.
В режимах `letsencrypt`/`existing` это Preview-only операция: основной Origin,
сертификаты и trust proxy сохраняются. Переходы между Nginx TLS и tunnel-режимами
по-прежнему требуют отдельного плана сертификатов/listeners и автоматически не делаются.

Legacy внешний Preview должен использовать отдельный регистрируемый домен. Проверка
консервативна: одинаковые последние две DNS-метки отклоняются, поэтому разные домены
под `co.uk` также не поддерживаются этой проверкой. Это не Public Suffix List.
Локальный `.localhost` Preview для dev/manual deployments сохранён.

Preview — static-only, без запуска dev servers или проксирования localhost-портов.
Существующий renderer поддерживает HTML/CSS/JS, assets и build directories, SPA
navigation fallback, refresh и revoke. CSP/iframe sandbox не даёт allow-same-origin,
запрещает внешние подключения, workers и вложенные frames. Внешние CDN/HMR/backend API
не поддерживаются: assets нужно включать в static build. Лимит файла — 8 MiB.

Lease живёт 120 секунд без heartbeat; закрытие Preview отзывает её, restart backend
отзывает все leases. Доступ к файлам использует workspace boundary, O_NOFOLLOW и
запрет hardlinks. Выбранный static root доступен обладателю ссылки: секреты туда не
помещать, в том числе JSON. Отключите access logs/cache для Preview; уже загруженный
HTML невозможно удалить из памяти браузера после revoke.
