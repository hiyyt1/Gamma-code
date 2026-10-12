# Upstream attribution

Source: https://github.com/kostikpenzin/mcp_b24
Commit: `74e9062ef04c53b6be336b778a73c5236996e015` (package 0.4.0).
License: MIT, copyright 2026 Penzin Konstantin. See LICENSE-mcp-b24.

- `token-bucket.ts`: upstream token-bucket implementation, reformatted only.
- `methods.json`: adapted static `restMethod` mappings from upstream `src/tools`.
  Each entry preserves the original source filename. The subset includes CRM,
  tasks, users, business processes and events; read versus write is explicitly
  classified. It is not the upstream generic `bx24_call` or `batch` surface.
- The Gamma vault, approval plans, request transport, audit and four MCP tools
  are new integration code. The upstream CLI/auth storage/installer is not run
  or redistributed here. In particular, upstream `confirm: true` is replaced by
  a human approval capability confined to the Gamma connection form.

The allowlist is deliberately static and must be reviewed when expanding it.
Runtime access additionally requires a selected scope and a method reported by
that particular portal. Presence here does not guarantee webhook support or
availability in a specific cloud plan/on-premise release.
