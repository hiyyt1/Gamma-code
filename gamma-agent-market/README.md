# Gamma Agent Market

This directory ships immutable catalog metadata, native OpenCode agent configurations,
upstream Markdown and license notices. Deploy it alongside `gamma-skill-market`; compiled
backends use `GAMMA_AGENT_MARKET_ROOT` (see `deploy/gamma.env.example`). No installer or
third-party runtime executes during selection. `files.json` pins configuration hashes.

## Architecture

```text
Agent Market → existing DialogProductProject → authenticated product API
  → canonical directory authorization
  → shared V1 execution gate + SQLite transaction
      → expectedVersion + explicit replacement confirmation
      → verified Skill Market dependencies + policy validation
      → one project configuration row
      → existing Session.create + durable idempotency receipt
  → existing HomeController.openSession → Gamma chat

V1 prompt/loop + LLM stream → execution lease for canonical directory
  → Agent.resolve(current project binding, native child role)
  → native Agent.Info + existing system context / tool registry / LLM
  → permissions = intersection(default/project policy, profile, session restrictions)
  → Skill Market sources = manual selections ∪ active agent packages
  → native task tool, only explicitly allowed team members, shared directory
```

No new agent runner, project hierarchy, session store or skill loader is introduced.
Non-Git projects share OpenCode's `global` project ID, so the binding uses canonical
project directory identity, matching the existing Gamma product/Skill Market contract.
The revision and monotonic version persist in the existing database. Sessions/messages
are never rewritten when an agent is replaced. Historical user/assistant agent metadata
is diagnostic data, not the source of the next request's configuration.

`POST /product/projects/:project/active-agent` is deliberately consistent with the
existing `productRequest` and Skill Market APIs. Body: `agentId`, `expectedVersion`,
`confirmed`, `connectSkills`, `requestId`. It applies and creates the chat atomically.
A retry with the same project/request ID returns the original session. Reusing that
request for another agent fails. The same active agent retains its version and creates
one chat for each new explicit use operation. Selecting a stale version fails closed.
GET endpoints expose catalog, individual profile and project selection.

## Source audit

Exact upstream commits are in `sources.json`; per-profile URLs are in `catalog.json`.
The retained MIT license is `upstream/LICENSE-wshobson`.

| Source | Findings | Decision |
| --- | --- | --- |
| Wshobson Agents | MIT; Markdown agents; native OpenCode adapter in `tools/adapters/opencode.py`, translating tool names and permissions | Selected. Native agent JSON retains full prompt bodies with an explicit Gamma compatibility preamble. |
| VoltAgent Subagents | MIT; Claude tool names/model aliases; frontend profile mandates a `context-manager` protocol not supplied by Gamma | Considered, not imported. Would need additional protocol adaptation. |
| Agency Agents | MIT; official `scripts/install.sh --tool opencode` / converter; source colors/tools need conversion | Compatible alternative; not mixed into this release to keep one auditable source set. |
| Contains Studio | Markdown with Claude-only `MultiEdit`; no license file found at the pinned commit | Not imported; redistribution permission was not established. |

## Profile mapping and adaptation

All paths below are relative to Wshobson `plugins/`; exact unmodified source copies are
retained in `upstream/`. Every configuration is decoded with the active V1
`ConfigAgentV1.Info` schema, then loaded through the existing V1 Agent service.

| Gamma profile | Upstream agent | Adaptation / dependencies |
| --- | --- | --- |
| Website Builder | frontend-mobile-development/agents/frontend-developer.md | Responsive website specialization; use project's framework. |
| Web Application Developer | frontend-mobile-development/agents/frontend-developer.md | Application workflows; requires `superpowers:systematic-debugging`. |
| Telegram Developer | backend-development/agents/backend-architect.md | Explicit Gamma Telegram Bot API specialization; credentials/service not bundled. |
| UI/UX Designer | multi-platform-apps/agents/ui-ux-designer.md | Design methods only; Figma/browser integrations are not assumed. |
| Backend Developer | backend-development/agents/backend-architect.md | Existing API/data architecture; requires `superpowers:systematic-debugging`. |
| QA Engineer | unit-testing/agents/test-automator.md | Existing test tools; requires `superpowers:systematic-debugging`. |
| Security Auditor | security-scanning/agents/security-auditor.md | Edit denied; shell commands require approval; scanners not preinstalled. |
| DevOps Engineer | deployment-strategies/agents/deployment-engineer.md | Build/configuration work; deployments/credentials not provisioned. |
| SEO Specialist | seo-technical-optimization/agents/seo-structure-architect.md | Local structural/content audit; no ranking data or external SEO account. |
| AI Developer | llm-application-dev/agents/ai-engineer.md | Implementation expertise; provider credentials and frameworks are project dependencies. |
| Data Analyst | machine-learning-ops/agents/data-scientist.md | Existing project data; analytics libraries are not assumed installed. |
| Project Architect | comprehensive-review/agents/architect-review.md | Existing project architecture and implementation planning. |
| Web Team | architect + UI/UX + webapp + QA | Architect is primary; three native subagents; task approval required. |
| AI Team | AI + backend + architect + QA | AI engineer is primary; three native subagents; task approval required. |
| Review Team | comprehensive-review/agents/code-reviewer.md + security + QA | Code Reviewer is primary; two native subagents; task approval required. |

Source model aliases (`haiku`, `sonnet`, etc.) are not copied. Gamma retains the user's
provider/model selection. Source frontmatter tools do not grant permissions. Explicit
Gamma policy denies external directories and arbitrary delegation, asks for shell use,
and restricts the security auditor's edits. Subagents cannot spawn nested teams.
Platform/project restrictions and session denies remain effective even if a session
or remembered permission appends an allow rule. Ordinary projects keep legacy behavior.

Required skills are references to the existing verified Superpowers package. Agent-only
package references are stored separately from manual Skill Market selections and use the
same integrity/dependency validation and V1 loader. Replacing an agent drops its package
references; manually enabled packages survive. Missing packages require explicit consent.
No skill content is duplicated here. Superpowers permits broader workflows, but delegation
still obeys the active agent/team policy.

## Validation and operational limits

- `packages/core/test/agent-market.test.ts`: all native configs, fresh database layers,
  durable idempotency and simultaneous replacements.
- `packages/opencode/test/server/agent-market.test.ts`: authenticated real HTTP + SQLite,
  directory confinement, confirmation, version conflicts, run exclusion, rollback,
  preservation, skills and native team permission resolution.
- `packages/opencode/test/session/agent-market.test.ts`: full V1 prompt → HTTP provider
  transport → persisted messages, old/new sessions, all 15 profiles, held-stream replacement exclusion, real native task
  execution and an explicit permission reply. Only the remote model is a deterministic
  local test server; no paid/external model quality is claimed.
- `packages/app/e2e/regression/agent-market.spec.ts`: real backend browser flows and
  desktop/mobile screenshots. Set `GAMMA_AGENT_E2E=1` and isolated server/web ports.

Execution exclusion is process-local, matching V1's single-process ownership. Running
multiple independent Gamma backend processes against one SQLite database is not supported
for this guarantee. Authorization reuses Gamma's existing single-user server boundary and
confined workspace root; this change does not introduce multi-tenant identity/ACL storage.
Catalog content is Russian product copy; ordinary controls have English/Russian i18n.
External provider generation quality, cloud deployment, real Telegram credentials and
external design/security/SEO services are not validated by deterministic transport tests.
The existing performance benchmark's hidden titlebar-tab locator fails on the current
Gamma shell; do not infer a valid performance comparison from that benchmark.

## Implementation report (2026-10-08)

### Stage 1 — frontend

- `packages/app/src/pages/agent-market.{tsx,css}` and `src/app.tsx`: real catalog,
  search, category filters, specialist/team tabs, recommendations and details.
- `components/dialog-product-project.tsx`, `pages/home/home-controller.ts`: reuse
  existing project selection/creation and session navigation, with preferred project.
- `components/project-agent.tsx`, `components/workspace-files.tsx`: compact active
  agent in the workspace header, description and link to change it.
- `i18n/product.ts`, `i18n/ru.ts`: localized controls and replacement/skill consent.
- `e2e/regression/agent-market.spec.ts`: real API browser coverage.

### Stage 2 — profiles and V1

- `gamma-agent-market/{catalog.json,files.json,sources.json,profiles/,upstream/}`:
  12 specialists, 3 teams, pinned native configurations and licensed originals.
- `packages/core/src/agent-market/catalog.ts`: native schema/integrity validation.
- `packages/opencode/src/agent/agent.ts`: project-aware registry resolution;
  native primary and subagent roles, with the user's model choice preserved.
- `session/prompt.ts`, `session/llm.ts`: project binding at admission and provider
  execution, execution leases including auxiliary LLM streams.
- `permission/index.ts`, `tool/task.ts`: strict policy intersection, allowed native
  subagents and confinement when resuming a child task.

### Stage 3 — persistence and API

- `packages/schema/src/agent-market.ts`: browser-safe wire contracts.
- `packages/core/src/agent-market.ts`, `agent-market/sql.ts`: existing SQLite,
  per-directory binding, monotonic version, transactional session creation and
  durable idempotency receipts; shared process-local execution exclusion.
- Core migration `20261007225730_agent_market` and generated schema/registry.
- `packages/core/src/skill-market.ts`: agent package references merge with manual
  selections through the existing verified loader; no duplicated skill contents.
- `packages/opencode/src/server/routes/instance/httpapi/{agent-market,server,skill-market}.ts`:
  authenticated product routes and skill-change exclusion during execution.
- `deploy/gamma.env.example`: asset location for compiled deployments.
- Core/OpenCode tests listed above, plus `test/agent/market-permissions.test.ts`.

### Verification

| Check | Result |
| --- | --- |
| App, Core, V1 backend typecheck | Passed |
| E2E typecheck | Passed |
| Core catalog/persistence/Skill Market tests | Passed, including corrupted profile rejection |
| V1 backend/agent/Skill Market integration tests | 49 passed; additional final HTTP assertions passed |
| Full V1 profile transport coverage | All 15 profiles executed; old/new session resolution, held-stream exclusion and native QA task passed |
| Frontend component browser unit suite | 44 passed |
| Full frontend unit suite | 734 passed, 3 failed: existing `workspace.files.count` plural parity, outside Agent Market |
| Browser E2E against compiled backend | 4 passed: Agent Market and Skill Market regression suites |
| Frontend production build | Passed; existing large-chunk warnings remain |
| Backend Linux x64 production build | Passed; compiled version smoke test passed |
| Compiled backend catalog smoke test | 15 profiles, all available with explicit asset roots |
| Core migration consistency check | Passed |
| Client and legacy SDK regeneration | Completed using repository generators |
| Existing production performance benchmark, before/after workspace header change | Both failed on hidden titlebar navigation locator; no valid timing comparison |
| External commercial LLM | Not used; deterministic local HTTP model responses only |

The production backend build initially rejected inherited SOCKS proxy variables;
it passed with those variables removed for that build command. No existing app or
server process was restarted, and no commit was created.

Screenshots were inspected against the current Skill Market: [reference](validation/skills-desktop.png),
[desktop catalog](validation/agents-desktop.png), [mobile catalog](validation/agents-mobile.png),
[mobile cards](validation/agents-mobile-cards.png), [details](validation/details.png),
[replacement](validation/replacement.png), [mobile replacement](validation/replacement-mobile.png).
