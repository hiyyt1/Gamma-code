# Gamma website Preview

Preview is an independent product feature; it does not change agents, sessions,
skills, MCP, the database schema, or the OpenCode PTY lifecycle.

## Supported sites

After a successful assistant turn, supported websites appear as compact result
cards beneath its final answer. **Open website / Открыть сайт** opens the existing
Preview panel beside the chat. Refresh rereads assets; the external link opens
the website in a new tab. Closing Preview restores the Workspace panel. The file
panel no longer has a permanent Preview button.

Cards combine existing Preview discovery with completed write/edit/apply_patch
tool results, patch parts, or durable per-turn file diffs. Model prose alone never
creates a card. Each site belongs to its latest modifying turn in the current
session, with the deepest matching application directory selected. Multiple
results get separate cards. History reconstructs the cards after reload without
new model requests or new database records. A scan after completion, on focus,
and every ten visible-page seconds revalidates availability. Removed sites become
disabled; after reload, absent sites are omitted. Starting a preview always
rechecks the files on the backend.

Result cards are siblings below the original assistant text container, never
children of its horizontal flex row. They are capped at 560 px and the available
message width; the text retains its original flex sizing and code-block layout.
Availability distinguishes successful discovery, a missing entry file, missing
Preview configuration, denied access, a network failure and a backend error.
Failed requests preserve the last discovered sites and disable opening with the
specific reason. Only a successful scan can mark an entry file as missing.

Local `index.html` links in assistant answers open the corresponding discovered
site. Other local file links open the file viewer; external URLs remain ordinary
links. The chat menu **Project websites / Сайты проекта** opens the existing site
selector, including for older sessions without structured mutation evidence.
Shell-only work without per-turn file diffs cannot be attributed to an answer
reliably; use this menu in that case. Preview discovery never executes a model.

Supported: root or nested `index.html`, CSS, browser JavaScript and ES modules,
images, fonts, media, WASM and existing static builds (including React/Vite
`dist/index.html`). Root-relative asset URLs work because each preview has its
own hostname. Discovery searches six directory levels, at most 2,000 entries and
50 applications; hidden directories, node_modules, vendor and coverage are skipped.

Projects with package.json scripts `dev`, `start` or `build` are identified as
requiring a build/dev server. **No project scripts, installers, dev servers or
build commands are executed by Preview.** Existing PTY processes inherit Gamma's
environment and are not a safe sandbox. VPS execution isolation has not been
audited, so dynamic execution, HMR/WebSockets and automatic React/Vite compilation
are intentionally unavailable. A ready static build can be selected separately.

## Backend and isolation

Authenticated product endpoints under `/product/session/:sessionID/preview`
list sites and start, renew or stop a preview. The session selects the existing
ProductProjects workspace; the client cannot pass an arbitrary filesystem root.
The existing shared Gamma authorization model is preserved (this does not add
tenant-level ownership to a server using one shared login).

A process-scoped listener binds only to `127.0.0.1:4097` when configured. It serves
only files, never proxies localhost targets, and never executes user code.
Each start creates a random 192-bit capability hostname mapped to one site.
There are at most 32 leases. The UI renews its lease every 30 seconds; abandoned
leases expire after 120 seconds and are swept every 30 seconds. Closing the panel
revokes its lease immediately, including its new-tab URL. Server restart revokes
all leases. No per-site processes or persistent preview records exist.

Files are read through ProductProjects' pinned directory descriptors, with
O_NOFOLLOW on every path component. Only a web-asset extension allowlist is
served; dotfiles, known Gamma/package configs, symlinks, hardlinks, traversal and
files over 8 MiB are refused. There is no directory listing or SPA fallback;
client-side routers should use hash routing. Files deliberately placed in the
selected site's public asset tree are accessible to holders of its preview URL.

Use an **independent registrable domain** for Preview, with no Gamma cookies or
authentication. Nginx strips Authorization/Cookie headers. Preview does not receive
Gamma tokens. The HTTP CSP applies sandboxing even in a new tab, with scripts and
forms enabled but no same-origin, popup or top-navigation privileges. Cookies,
localStorage, workers, embedded frames and external network resources/API calls
are unavailable. Assets must be local; third-party CDN libraries/fonts must be
vendored. This is more restrictive than ordinary hosting.

The production web proxy rejects opaque-origin and cross-origin browser API
requests before credentials reach Gamma. All public Gamma API traffic must pass
through this proxy; do not expose backend port 4096 or add Nginx routes bypassing
it. CORS on the preview asset listener allows credentialless module and asset
loads from opaque sandbox origins; it does not enable credentials.

Security references: [CSP sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox)
and [Fetch Metadata](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Fetch_metadata).

## Deployment by the administrator

No VPS changes were made as part of this implementation. Keep the existing
database, workspaces, environment, authorization and service account.

1. Provision wildcard DNS and TLS for an independent domain, e.g.
   `*.preview.example.net`. Do not use Gamma's cookie domain. No additional public
   ports are needed: both sites use HTTPS port 443.
2. Add to the existing Gamma backend environment:
   ```ini
   GAMMA_PUBLIC_ORIGIN=https://gamma.example.com
   GAMMA_PREVIEW_DOMAIN=preview.example.net
   GAMMA_PREVIEW_PORT=4097
   ```
   `GAMMA_PUBLIC_ORIGIN` must be the exact HTTPS origin, without a trailing slash.
   Leave these unset to keep Preview disabled with an explanatory UI message.
3. Adapt `deploy/gamma-preview.nginx.conf.example` to the actual domain and
   certificate. Include it in Nginx's http context. The main Gamma host must proxy
   to `deploy/web.ts` as before. Do not configure Gamma Basic auth on the preview
   virtual host. Avoid logging capability hostnames in upstream/error logs.
4. Build with `bun run --cwd packages/app build`. Deploy the changed backend,
   frontend build and `deploy/web.ts`. Keep Gamma running as its existing non-root
   service account (the provided templates use `gamma`). Do not replace an
   existing installation's paths/data with the sample paths.
5. Validate with `nginx -t`, then reload Nginx and restart only Gamma backend/web
   services during the planned update. The preview listener follows backend
   startup/shutdown; it does not need another systemd service.
6. Verify a temporary static project through the real production hostname,
   including a new tab, refresh and API-denial checks. Remove only that fixture.

## Local validation

From `packages/opencode`: `bun test test/server/site-preview.test.ts` and
`bun typecheck`. From `packages/app`: `bun typecheck`, `bun run build`, then
`bun run e2e/preview-smoke.ts` (requires installed Playwright Chromium and openssl).

The browser smoke runner launches isolated backend/web instances with temporary
data, workspace and TLS certificate, and cleans those instances/data in finally.
It uses the production build and real preview responses; Playwright routes the
test-only wildcard domain to the loopback listener. It generates a site fixture
directly, without calling a paid model. Therefore agent generation and real
production DNS/Nginx/TLS must still be checked after deployment.

Validated locally: backend/frontend/e2e typechecks, production frontend build,
22 backend filesystem/preview tests (67 assertions), 11 card-attribution/status tests
(50 assertions), and the browser smoke flow:
embedded HTML, CSS, ES modules, images, animation, normal-click new tab, refresh,
opaque-origin storage/parent/API denial, close/revocation, result cards, reload
without duplicates, HTML/file/external links, deletion, multiple-site selection,
Vite static builds, unsupported dev projects, neighboring-session isolation and
legacy project-menu access. Durable assistant/tool history is seeded through the
real Session service in the isolated test database, without a paid LLM call.
Temporary test databases, projects,
certificates and server processes are removed by the runner.

The smoke now also checks long paragraphs, lists and code blocks with and without
a result card, open/closed file panels, a 390 px viewport, and recovery after
403, 500 and network failures. `PREVIEW_REAL_SITE=/absolute/path/to/coffee-site`
optionally copies that existing site into the disposable fixture to verify the
real coffee website with configured isolated Preview; the source is read-only.
`bun run e2e/preview-layout-audit.ts <sessionID> <directory>` audits an existing
session on the local dev pair, blocks mutating requests, compares text geometry
with the cards hidden, captures desktop/mobile screenshots in `/tmp`, and verifies
that the history response remains unchanged. This audit expects the unconfigured
Preview state found in the reported local installation.

The reported project `123` was checked directly: `coffee-site/index.html` exists
(44,073 bytes), the file API and Preview discovery resolve the same workspace,
and discovery returns `{ "enabled": false, "apps": [{ "path": "coffee-site",
"kind": "static" }] }`. The running backend lacks `GAMMA_PUBLIC_ORIGIN` and
`GAMMA_PREVIEW_DOMAIN`; this is a configuration issue, not deletion or a session
binding issue. Enabling the existing feature still requires the isolated origin
configuration described above. No same-origin fallback is introduced.

For the layout fix, production readiness measured 3143 ms before and 3110 ms
after (single runs); logs are `/tmp/preview-fix-baseline.log` and
`/tmp/preview-fix-smoke.log`. In the unchanged real coffee session, text widths
were 713 px with the file panel, 808 px without it, and 323 px at a 390 px viewport.
Showing the card does not change those widths. The original regression was the
card competing with the text as a second child of `.gamma-assistant-response`
(`display: flex`, row direction, default cross-axis stretching).

Production-build readiness smoke baseline: 3123 ms, 667 DOM nodes, 47 resources;
after the chat integration: 3104 ms, 666 nodes, 48 resources (single runs, not a
statistical performance claim). The existing session-tab-switch benchmark failed
before the change because it targets the older tab/review layout. Raw logs are
kept in `/tmp/gamma-preview-ux-baseline.log`,
`/tmp/gamma-preview-ux-smoke-baseline.log` and `/tmp/gamma-preview-ux-smoke.log`.

Returning focus from the iframe exposed an existing suspense issue in the
project knowledge/agent UI widgets: focus-triggered refetch briefly unmounted the
page and swallowed toolbar clicks. Those two refresh handlers now use a Solid
transition to retain the visible UI while their data refreshes.
