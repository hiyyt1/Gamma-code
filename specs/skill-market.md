# Gamma Skill Market: per-skill compatibility

Status: proposed architecture; only publication retirement is implemented in stage 1.
No importer, converter, new database tables or new HTTP contracts are implemented here.

## Stage 1: publication and legacy runtime

`gamma-skill-market/catalog.json` is the empty public catalog. The list endpoint
returns `[]`; package detail endpoints no longer expose retired packages.
`SkillMarketService.set(..., true, ...)` rejects every new connection with
`package_not_published`. An existing durable manual selection can be retried
without rewriting its pinned revision. Disable still removes only that manual
selection. Re-enabling after disable is unavailable until a replacement is published.
The existing API signature is retained for old clients; its name-conflict argument
is unused while publication is paused. Public Protocol/HttpApi schemas are unchanged.

`legacy-catalog.json` preserves all 20 old manifests without changing their IDs,
revisions, hashes or resources. It is used exclusively by runtime `sources()` and
agent dependency `resolve()`. The latter remains available for newly applied ready
agents as well as existing projects; this is not public Skill Market publication.
An agent-owned dependency remains effective after disabling a manual selection.
Existing manual and agent selections, project files and local skills are untouched.
There is no fallback from a missing public catalog to the legacy registry.
A deployment must include both registry files and the retained package resources;
a missing or corrupted legacy asset remains a validation error, not silent removal.

The old `verified`, `needs-adaptation`, `needs-configuration`, `unsupported` schema
and checks remain solely for legacy payloads and runtime validation. Their use was
checked in Schema, Core, HTTP handlers, App, native loaders and agent dependency
resolution. `script/skill-market/decisions.json` is build-time historical policy,
not a live compatibility analyzer. Its consumer `package.py` now writes only the
legacy registry, never the public catalog. The Superpowers-only V1 distribution
and Git check remain legacy restrictions: removing them would claim unsupported
runtime capabilities or invalidate existing agent behavior. New preparation and
admission must not reuse these package-level flags or add new IDs to that allowlist.

Known local databases checked read-only before changes:
`/tmp/gamma-dev/opencode.db` and
`/home/nikita/.local/share/gamma-dev/opencode.db`; both selection tables were empty.
This is not an audit of remote deployments or other data roots. Existing deployments
need an explicit migration inventory before legacy resources can be removed.

## Pipeline and trust boundaries

GitHub → Import → Parse → Analyze → Adapt → Validate → Publish → Connect

1. **Import**: resolve a repository/ref to an immutable commit; retain source URL,
   repository-relative skill path, source commit, license and provenance. Download
   to quarantined storage outside native skill discovery. Do not execute code,
   install dependencies, follow symlinks or accept traversal/oversized archives.
   A repository is a transport container and can contain independently assessed skills.
2. **Parse**: discover each SKILL.md and parse YAML frontmatter plus Markdown body.
   Normalize name/description; preserve unknown frontmatter as source metadata,
   never as granted permissions or executable configuration. Report invalid fields
   with file and line. Inventory scripts, templates, references and linked resources;
   reject escaping paths and record unresolved references. Keep original bytes.
3. **Analyze**: build per-skill requirements from frontmatter, instructions and
   resource inspection: tool calls, shell commands, binaries, package managers,
   environment variables (names only), network endpoints, filesystem scope, MCP,
   hooks, slash commands, delegation and dependencies on other skills. Distinguish
   declared requirements, inferred requirements and unknowns. Static analysis does
   not prove arbitrary natural-language instructions or scripts safe/functional.
   Compare with a versioned Gamma capability profile: runtime V1/V2, tool versions,
   permission policy and optional integrations. No repository-wide verdict.
4. **Adapt**: produce a separate immutable artifact and reviewable patch. Translate
   tool names/arguments, namespace references, resolve resource links and adjust
   instructions only when semantics are supported. Do not invent unavailable tools
   or strip permission requirements to get a passing result. Record adapter version,
   changes and unresolved diagnostics. No silent modification of the source artifact.
5. **Validate**: reparse; validate paths, all resource hashes, unique names, referenced
   skills and permission/tool contracts. Validate environment requirements in an
   isolated fixture. Optional script execution requires an explicit sandbox policy,
   bounded filesystem/network/time and no production secrets. Save observed results,
   tests, coverage and untested limitations. Permissions still apply on every use.
6. **Publish**: publish a specific validated per-skill revision transactionally.
   Require compatible verdict for its declared capability profile, no blocking
   diagnostics, license/provenance and a recorded validation report. An individual
   skill may publish even when siblings in its source repository cannot. Published
   does not imply connected, globally safe, or usable under every project policy.
7. **Connect**: check the chosen project's actual dependency availability, policy,
   runtime and name conflicts; request consent for necessary setup/permissions.
   Pin exact artifact revision and checksums atomically. Never auto-install or grant
   permissions from SKILL.md. Existing loaders receive a validated source adapter;
   native `skill`, local discovery and agent permission enforcement remain in place.

## Separate state axes

| Axis               | Values                                                        | Meaning                                                                                                                   |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Preparation        | Imported, Analyzing, Failed                                   | Acquisition succeeded; parsing/analysis/adaptation/validation in progress; infrastructure/parser/conversion job failed    |
| Compatibility      | Compatible, Needs adaptation, Needs dependencies, Unsupported | Verdict for one skill revision and a specific capability profile                                                          |
| Publication        | Unpublished, Published, Withdrawn                             | Catalog visibility of a validated revision, independent of connections                                                    |
| Project connection | Disconnected, Connected, Disabled                             | User intent plus exact installed revision; a separate readiness report records missing dependencies or denied permissions |

`phase` distinguishes Parse/Analyze/Adapt/Validate while preparation is Analyzing;
`completedAt` marks completion rather than introducing a misleading connection state.
After analysis, the UI presents the compatibility verdict. Published is an additional
publication badge, not a replacement for compatibility. Failed records the failing
phase and retryability; Unsupported means a known capability mismatch, not a job error.

Transitions: Imported → Analyzing → completed verdict or Failed. Adapt/resolve
requirements → Analyzing with a new artifact or analysis run. Retry Failed only with
an explicit job attempt, retaining history. Compatible + successful validation →
Published. Withdrawn prevents new connects, preserving existing pins pending explicit
migration/revocation policy. A dependency-sensitive published skill may be Compatible
in its validation environment and Needs dependencies in a particular project.
Multiple blockers are retained; the displayed primary verdict must not hide them.

## Proposed entities (not executable schemas in stage 1)

- **ImportSource**: source ID, GitHub repository, requested ref, resolved commit,
  importedAt, license/provenance and source archive SHA-256.
- **SkillRevision**: stable skill ID, source ID, relative SKILL.md path, original name,
  namespaced runtime name, user-facing version, immutable revision, source digest,
  artifact digest, parser/adapter versions and frontmatter. Version labels never
  substitute for a checksum or commit pin.
- **ResourceManifest**: relative path, media type, size, SHA-256 for every file,
  role (instruction/script/reference/template), linked-resource diagnostics.
- **AnalysisRun**: skill revision, capability profile version/digest, phase, state,
  timestamps, requirements, compatibility verdict, diagnostics and validation report.
  Reanalyze after engine/profile/adapter changes; do not label stale results verified.
- **Diagnostic**: stable code, severity, blocking flag, file/line, evidence,
  expected/actual capability, remediation, responsible actor (publisher/admin/user),
  confidence and whether runtime verification is required. Redact secrets.
- **Publication**: skill revision, validation run, channel, published/withdrawn time.
- **ProjectSkillConnection**: project, skill ID, artifact revision/digest, enabled,
  permission consent/policy reference, dependency snapshot, owner (manual/agent),
  previous pin and migration provenance. Effective readiness is computed separately.

Examples: `tool.task.missing`, `dependency.binary.missing`,
`permission.external_directory.denied`, `resource.path_escape`,
`frontmatter.invalid`, `skill.name_conflict`, `artifact.checksum_mismatch`.
Names should be stable publisher/skill namespaces; duplicate names fail connect
before any project state is changed. Retrying an identical connect is idempotent;
upgrading requires an explicit target revision, conflict check and rollback path.

## Formats and dependency semantics

SKILL.md is the common instruction container, not proof of cross-engine compatibility.
Claude hooks/plugins, Codex/OpenCode tools and permissions are separate contracts.
The current native loaders consume name/description/body (and V2-specific metadata);
they do not install arbitrary package manifests or execute supporting scripts merely
because those files exist. Preserve extra metadata for analysis and normalize only
supported fields. Supporting files remain addressable relative to the artifact.
External resources must be pinned/copied or explicitly diagnosed, never silently
fetched with project credentials. Binary/MCP/network requirements must distinguish
optional recommendations from instructions required for the advertised workflow.
No adaptation is required solely because the source repository targets another agent.

## Migration and next stages

1. Implement parse/import in quarantine with per-skill schemas, diagnostics and
   fixtures for native, Claude, Codex, malformed frontmatter and unsafe resources.
   Keep imports unpublished. Respect Schema → Core/Protocol → Server dependencies.
2. Add versioned capability analysis and adapter patches; test missing tools,
   dependencies, permissions, duplicates and differing V1/V2 behavior. Review the
   patch and evidence before publishing; no broad repository approval switch.
3. Add immutable validation artifacts, publication API and a read-only catalog UI.
   Regenerate Client with `bun run generate` after public Protocol/HttpApi changes.
4. Add project connect/disable/upgrade with atomic pins, permissions, readiness and
   rollback; test manual vs agent-owned dependencies and restart persistence.
5. Inventory each deployment's legacy selections read-only. Map package revision
   plus namespaced skill names to validated per-skill revisions; migrate only with
   explicit user/admin consent. Preserve old pins if validation or mapping fails.
   Update agent manifests to the same new skill IDs before retiring their resolver.
   Only after zero remaining references may old schemas, decisions and resources
   be removed. Do not rewrite or delete local user SKILL.md files.

## Stage 1 acceptance

Public API empty; all 20 IDs reject new manual connects; details unavailable; retries
preserve old pins; disable works; fresh service layers still load old connections;
checksums/symlink protection unchanged; V1 skill tool loads local and legacy skills;
V2 runtime boundaries remain; all ready agents apply and execute through the existing
session path. Browser checks cover /skills empty/error/retry, search/categories,
hero dialogs, /agents application, desktop/mobile overflow. Tests use temporary
SQLite/projects and an isolated backend, not production data or paid model calls.
