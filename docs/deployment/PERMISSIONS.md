# OpenCode permissions в Gamma

[Установка](INSTALL.md) · [Конфигурация](CONFIGURATION.md) · [Ограничения и доработки](OPERATIONS.md)

## Что реально реализовано

Actions политики: `allow` (выполнить), `ask` (ожидать ответ на permission request), `deny` (отказ/скрытие tool). `TRUSTED_AUTO` и `RESTRICTED` ниже — имена профилей этой документации, **не значения env и не встроенный параметр `permissionMode`**. `primary`, `subagent`, `all` у агента — режим доступности агента, не разрешения. UI Full Permissions — клиентское автоодобрение, а не OS sandbox.

| Механизм | Legacy, активный Gamma | Core V2 |
| --- | --- | --- |
| JSON | `permission: "allow"` либо object | `permissions: [{action, resource, effect}]` |
| Agent override | `agent.<name>.permission` | `agents.<name>.permissions` |
| Обычный evaluator | Последнее совпавшее wildcard правило | Последнее совпавшее wildcard правило |
| Нет совпадения | ask | ask |
| Профиль Market | Пересечение групп, deny > ask > allow | То же, boundary markers |
| Сессия | durable `session.permission`, дописывается после agent rules | Политика берётся из resolved pinned agent, не Legacy `session.permission` |
| Ответ once | Текущий pending request | Текущий pending request |
| Ответ always | In-memory approvals по Session ID; теряются при restart | `permission` table, project-scoped saved rules; configured deny не отменяется |
| Pending requests | Память process/instance | Память Location; прерываются при закрытии |

Источники: [Legacy evaluator](../../packages/opencode/src/permission/index.ts), [V2 evaluator](../../packages/core/src/permission.ts), [V2 saved](../../packages/core/src/permission/saved.ts), [session state](../../packages/opencode/src/session/session.ts), [tool context](../../packages/opencode/src/session/tools.ts).

## Приоритет Legacy

`packages/opencode/src/config/config.ts` и `config/paths.ts` загружают и deep-merge:

1. Remote well-known config из authenticated organization.
2. Global `$XDG_CONFIG_HOME/opencode/config.json`, `opencode.json`, `opencode.jsonc`.
3. Файл `OPENCODE_CONFIG`.
4. Project `opencode.json[c]` вверх до worktree, если не `OPENCODE_DISABLE_PROJECT_CONFIG=1`.
5. Config и markdown agents/modes/plugins из найденных `.opencode`, HOME `.opencode`, `OPENCODE_CONFIG_DIR`.
6. `OPENCODE_CONFIG_CONTENT`.
7. Organization/enterprise config, managed `/etc/opencode/opencode.json[c]` (macOS preferences здесь неприменимы).
8. Legacy modes нормализуются в agents; `OPENCODE_PERMISSION` JSON deep-merge в `permission`; затем совместимость `tools` (write/edit/patch → edit, явный permission приоритетнее).

После этого агент добавляет собственные правила. У обычного агента `agent.<name>.permission` добавляется после global. Потом session rules, затем remembered approvals. Поэтому global allow не является неизменяемым административным потолком, а global deny у обычного агента не гарантирует запрет всех последующих источников.

`OPENCODE_PERMISSION='{"*":"allow"}'` не надёжен для очистки более конкретных ранее загруженных `bash`, `read` и других ключей: это merge, а не полная замена. Не использовать ошибочный JSON: parser логирует warning и продолжает с прежней политикой. `OPENCODE_DISABLE_PROJECT_CONFIG` отключает project config discovery, но HOME `.opencode`, глобальные файлы, skills/instructions и runtime API не превращаются в sandbox. Политика должна проверяться для конкретной новой сессии.

## TRUSTED_AUTO для основного Gamma

В чистом Legacy installation создать `/etc/gamma/opencode.json`:

```json
{
  "default_agent": "gamma",
  "permission": { "*": "allow", "external_directory": "deny" },
  "share": "disabled",
  "autoupdate": false
}
```

В `/etc/gamma/gamma.env`:

```dotenv
OPENCODE_CONFIG=/etc/gamma/opencode.json
OPENCODE_DISABLE_PROJECT_CONFIG=1
OPENCODE_DISABLE_AUTOUPDATE=1
OPENCODE_DISABLE_SHARE=1
```

Для воспроизводимости не задавать одновременно `OPENCODE_CONFIG_CONTENT`, `OPENCODE_PERMISSION`, `OPENCODE_CONFIG_DIR`; проверить отсутствие прежних global/HOME/managed overrides, agent overrides и session-specific restrictions. На чистой установке их нет. Файл политики root-owned; после изменения перезапустить backend и создать новую сессию основного `gamma`. Сохранённые старые сессии имеют свои ограничения и не обязаны стать автономными.

Это разрешает основной Gamma обычные shell/file/network/skill operations, в том числе установку project dependencies через npm/bun/pip venv. **Это не разрешение на sudo/apt, не ограничение исполнения рабочим каталогом и не гарантия отсутствия любых вопросов.** `question` — самостоятельный диалоговый инструмент; `plan_exit` и внешние business approvals живут отдельно. Для проекта с недоверенным кодом этот профиль непригоден без внешней изоляции.

### Какие ограничения специалистов сохраняются

В `packages/opencode/src/agent/agent.ts:marketAgent` итог — `Permission.intersect(base.permission, project.permission, profilePolicy)`. В `packages/core/src/agent.ts` V2 использует аналогичные `__gamma_boundary__`. Группа с ask продолжает давать ask даже после session allow/always. Группа deny остаётся deny. В `gamma-agent-market/profiles`:

* `website-builder`, `webapp-developer`, backend/devops/QA/AI/1C наследуют bash из global policy; `external_directory: deny` сохранён.
* Команды `web-team`, `ai-team`, `review-team`: task allow только к разрешённым members; остальные deny.
* Reviewer/explorer/auditor часто имеют edit deny.
* Presentation и Wildberries: bash deny, собственный ограниченный набор MCP tools.
* Gamma Guide жёстко ограничен question/gamma_help/встроенными help skills; конфигурацией доступ к shell не открыть.

Каталоги проверяются по SHA-256 manifest; правка profile JSON на сервере без согласованной поставки даёт `integrity_failed`. Переменной «снять все ограничения Market» нет. В финальном аудите shipped bash/task defaults исправлены вместе с SHA-256 manifest и проверены реальными tool/delegation tests; read-only/business boundaries сохранены. Прямое редактирование production profiles не является инструкцией установки.

UI `packages/app/src/context/permission.tsx` хранит `autoAccept` в browser persistence по server/directory/session и родительской линии. Реагирует на `permission.asked` ответом once. Это может скрыть ask, пока браузер подключён; headless runner и restart браузера нельзя считать настроенными таким образом. Условие автоматического включения сравнивает raw `config.permission === "allow"`, тогда как backend schema нормализует строку в object: полагаться на него для server-side режима нельзя.

Отдельный edge case: `packages/opencode/src/session/llm.ts` вызывает `workflow_tool_approval` с `ruleset: []`. Такой provider-specific workflow остаётся ask даже при global allow; нужна доработка этой ветки либо провайдер без этого workflow. Bitrix24/WB execute plans имеют собственную процедуру подтверждения; OpenCode allow её не отменяет.

## Где возникают запросы

| Tool/action | Что проверяется |
| --- | --- |
| bash | Разобранные команды; внешние directories дополнительно; shell executor не является контейнером |
| read | Путь файла; по умолчанию `.env`/`.env.*` ask, `.env.example` allow |
| edit | Объединяет edit/write/apply_patch; write — не самостоятельная политика записи в обычном flow |
| glob, grep, list | Поисковые ресурсы и границы каталогов; инструменты разных runners имеют различия |
| external_directory | Доступ за границы worktree; по умолчанию ask с исключениями tmp, skills/references |
| webfetch, websearch | Веб-доступ; websearch также зависит от provider/feature flags/key |
| task | Имя subagent; Market ограничивает список членов команды |
| skill | Имя skill; разрешение не гарантирует установленные зависимости |
| MCP | Имя exposed tool (например `gamma-bsl_*`), не абстрактный единый `mcp` permission; MCP resources дополнительно используют read |
| lsp, todowrite, doom_loop | Отдельные actions; repeated tool loop может запросить approval |
| question / plan | Вопрос пользователя может не быть Permission request вообще |

`session/tools.ts` вызывает `Permission.ask` перед native/MCP execution; `tool/shell.ts` проверяет shell и external paths; `session/processor.ts` проверяет doom loop. В обычном Legacy task дочерняя сессия наследует deny и external_directory из parent session; права parent agent не копируются полностью: действует профиль child. См. `agent/subagent-permissions.ts` и `tool/task.ts`.

## V2: не переносить env семантику Legacy

Core `config.ts` читает global directory (включая `OPENCODE_CONFIG_DIR` через Global), project files и `.opencode`, затем `config/plugin/agent.ts` дописывает global permissions и agent-specific permissions. Более поздние совпадения выигрывают. Поддерживается миграция V1 config, но это не Legacy loader: нет прямого чтения `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`, `OPENCODE_PERMISSION`, `OPENCODE_DISABLE_PROJECT_CONFIG` в этом loader. Нельзя обещать одинаковую централизацию этими env для V2.

Чистая V2 конфигурация в `/var/lib/gamma/config/opencode/opencode.json`:

```json
{
  "default_agent": "gamma",
  "permissions": [{ "action": "*", "resource": "*", "effect": "allow" }]
}
```

Это native V2 schema. Не смешивать `permission` и `permissions` в одном файле: compatibility layer проверяет конфликты. Project/agent rules и Market границы по-прежнему действуют. Изменения V2 config требуют закрытия/reopen Location, проще полного restart. Не переключать production Gamma на V2 только ради permissions: Knowledge/product completeness проверяется отдельно.

## RESTRICTED

Для отдельного доверенного администратора с подтверждениями, Legacy `/etc/gamma/opencode.json`:

```json
{
  "default_agent": "gamma",
  "share": "disabled",
  "autoupdate": false,
  "permission": {
    "*": "ask",
    "read": { "*": "allow", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow" },
    "glob": "allow",
    "grep": "allow",
    "edit": "ask",
    "bash": "ask",
    "external_directory": "deny",
    "task": "ask",
    "webfetch": "ask",
    "websearch": "ask",
    "skill": "ask"
  }
}
```

Это снижает автоматизацию, **не обеспечивает multi-user authorization**. Разрешённый shell может прочесть `.env` через cat/python, несмотря на read deny; patterns не заменяют системные права. В V2 тот же смысл передаётся ordered array, например `{"permissions":[{"action":"*","resource":"*","effect":"ask"},{"action":"external_directory","resource":"*","effect":"deny"}]}`, с необходимыми дополнительными rules и собственной проверкой inheritance.

Для нескольких независимых пользователей существующий поддерживаемый организационный вариант — отдельный VPS/VM и installation на каждого: отдельные Unix users, HOME, data/DB/config/workspaces, origin, credentials, процессы и firewall. Один gateway имеет один username/passwordHash, Knowledge не имеет owners/roles, backend общий. Настоящий shared multi-user deployment требует RBAC, tenant boundaries, quota, auditing и executor isolation в коде; одного RESTRICTED JSON недостаточно.

## Секреты и пределы защиты

Не запускать Gamma под root, не выдавать sudo, host Docker socket, SSH agent forwarding или ключ администратора. Root secrets и DNS API tokens держать root:root 0600 вне HOME Gamma. Root-owned checkout/конфигурация уменьшают риск случайного изменения, но пользователь с writable HOME может подменять своё окружение.

Legacy shell/PTY/local MCP наследуют backend environment (`tool/shell.ts`, `mcp/index.ts`, `core/src/pty.ts`). Значит agent code способен прочитать `OPENCODE_SERVER_PASSWORD`, provider keys и Gamma-readable auth files; 0600 защищает от других UID, а не от того же `gamma`. Оба текущих systemd services работают под одним UID, gateway auth hash тоже доступен этому UID. TRUSTED_AUTO безопасен только в смысле отсутствия host root-полномочий, а не защиты секретов Gamma от недоверенного кода.

Чтобы выполнить строгое требование «недоверенный код не получает системные/сервисные secrets», нужен отдельный executor UID/container/VM с allowlisted env, mount только workspace, без `/proc` соседних privileged процессов и без secret store; broker tools/LLM credentials остаются вне executor. Это **не реализовано текущими deploy units**. Не ставить галочку полной изоляции в checklist до такой доработки.

## Реализация в production-установщике

`sudo ./install-gamma.sh --install` создаёт `/etc/gamma/opencode.json` с `default_agent: "gamma"`, `permission: {"*":"allow","external_directory":"deny"}`, `share: "disabled"`, `autoupdate: false`. Сервис получает `OPENCODE_CONFIG=/etc/gamma/opencode.json`, `OPENCODE_DISABLE_PROJECT_CONFIG=1`, фиксированные HOME/XDG. После restart политика снова читается с диска. Credentials и provider state остаются в persistent storage.

`--permission-profile restricted` генерирует ordered JSON: сначала `"*":"ask"`, затем read allow с deny dotenv, glob/grep allow, edit/bash/task/webfetch/websearch/skill ask и external_directory deny. Порядок существенен для last-match. MCP, отсутствующие в списке, подпадают под wildcard ask. Это контролируемый single-admin deployment, **не tenant isolation**.

Preflight отвергает `/etc/opencode/opencode.json[c]`; doctor/upgrade дополнительно отвергают HOME `.opencode`, global config/agent/mode overrides и изменения managed files. Shipped Market profiles наследуют обычные разрешения: bash ask удалён, разрешённое командой task делегирование — allow. Все deny роли, Guide, границы делегирования и business approvals сохранены. Allow не включает отсутствующий или запрещённый роли инструмент. Существующие пользовательские политики установщик не удаляет: managed drift/global overrides останавливают upgrade для явного согласования.

Интеграционный тест `packages/opencode/test/tool/installer-permissions.test.ts` получает JSON непосредственно из Python renderer, валидирует реальной ConfigV1 schema с сохранением порядка, загружает native Gamma и выполняет реальные WriteTool/ShellTool через настоящий Permission.Service, без mock approval. Отдельно проверяет restricted. Это проверка Legacy в temporary instance, не LLM-driven browser acceptance и не доказательство одинакового поведения V2.

## Defaults, lifecycle и фактические проверки

Fresh install по умолчанию создаёт auto policy; `--permission-profile restricted` нужен только для намеренного restricted-профиля. Upgrade копирует прежний профиль из manifest, поэтому ранее выбранный restricted не переводится в auto молча. Restart перечитывает постоянную политику. Rollback неудачного обновления восстанавливает config, БД, проекты и Knowledge из offline snapshot. Явные agent/session overrides остаются частью effective policy; гарантия auto относится к defaults, а не к отмене пользовательских запретов.

`bun run dev:gamma` теперь по умолчанию использует `deploy/opencode.json` с теми же настройками, что installer, и `OPENCODE_DISABLE_PROJECT_CONFIG=1`. Явно заданный `OPENCODE_CONFIG`/другие локальные overrides сохраняются. Dev credentials нужно один раз создать через `deploy/setup-auth.ts`; production создаёт их интерактивно. Различие credentials не меняет default permissions.

`installer-permissions.test.ts` проверяет effective rules всех доступных Market profiles и нового custom agent; реально выполняет ReadTool/WriteTool/ShellTool через Permission.Service, включая website-builder, без handler автоматического ответа. `session/agent-market.test.ts` выполняет делегирование через fixture LLM без approval reply и без оплаты. Restrictions проверяются отдельно. Это не отключает Linux ownership, рабочие корни, service UID, NoNewPrivileges или защиту файлов от других UID.

Оставшиеся исключения: Guide и reviewer/аналитические роли намеренно read-only; presentation/WB работают через разрешённые специализированные tools, shell у них deny. GitLab workflow approval handler с пустым ruleset остаётся отдельным ask; он не был обойдён. Bitrix24/WB подтверждают внешние записи собственной процедурой. Auto permissions не отменяет этих бизнес-ограничений.
