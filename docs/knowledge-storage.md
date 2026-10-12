# Gamma Knowledge Base: single-user server storage

Knowledge is stored independently of projects. Project connections advertise physical space paths to the existing OpenCode runtime without modifying Full Permissions.

## Location and files

Set `GAMMA_KNOWLEDGE_ROOT` to an absolute, independent directory. The default is `$HOME/.local/share/gamma/knowledge`. The development launcher uses its isolated data directory. The root must not contain, or be contained by, `GAMMA_WORKSPACES_ROOT`. Symlink ancestors are rejected. This implementation targets a Linux VPS with `/proc`, libc, and a filesystem supporting atomic directory exchange.

```text
GAMMA_KNOWLEDGE_ROOT/
  .lock
  _blobs/<sha256>                  # verified, immutable upload content
  spaces/
    _registry.json                # internal metadata, versions, project connections
    <stable-storage-uuid>/
      index.json                  # source ID -> [relative path, description]
      links.json                  # source ID -> unique bidirectional neighbor IDs
      materials/<sha256-id>.md
      originals/<sha256-id>.<extension>
```

Legacy space/source IDs are preserved in metadata and dictionaries. A stable storage UUID and hashed source filenames keep arbitrary legacy IDs out of filesystem paths. Text, notes and URLs have material files; documents without extracted text point to originals. No synthetic parsing or retrieval engine is introduced.

The internal registry stores `publication: { version, requestID, digest, data, originals, spaces }` and `projects: [{ id, name, path, inode, spaces }]`. There are no users, owners or roles. Project UUIDs refer to Gamma's server `ProductProjects`, not OpenCode's global project ID. Device/inode/birthtime identity preserves a project's connection during an in-filesystem directory rename. Copying/recreating a directory is a new project. Missing projects are pruned when project connections are read; spaces remain.

## Import and conflicts

The browser offers **Import to server** when existing IndexedDB data has no acknowledged server binding. It merges IDs conservatively, verifies original hashes and publishes against the server version. A differing record with the same ID, missing original or stale version aborts publication. Resolve conflicting copies deliberately; the UI does not offer a destructive overwrite shortcut.

An acknowledged publication switches the UI to server data. Existing IndexedDB `current` and original files are retained unchanged; server snapshots and downloaded originals use separate cache keys. Offline server caches are readable, but server-bound edits cannot silently become local edits. Refresh after a conflict explicitly loads the current server state; editor drafts are not automatically rebased.

Publication stages a complete snapshot and exchanges it atomically under a filesystem lock. The registry, originals, materials and both dictionaries become visible together. Exact retries are idempotent. Concurrent requests can return `busy` and be retried; there is no background queue. Connecting/disconnecting changes only registry metadata and retains the material files. Removing a space is an explicit versioned publication and prunes its project connections.

Back up the entire root consistently, including `_registry.json` and `_blobs`. Content blobs are intentionally retained after cancelled/failed uploads and removals; automatic garbage collection is not implemented. Crash-left `.publish-*` directories are not authoritative; the `spaces` tree is the committed state. Do not edit published files directly while Gamma is running.

## Agent context with Full Permissions

Connections are relevance settings, not filesystem access controls. No permissions, shell tools, filesystem tools, or process isolation are changed. Disconnecting removes a space from subsequent system instructions; an agent can still use a previously known path, and previous conversation/tool results remain in history.

`KnowledgeStore.context(directory)` resolves Gamma's registered project UUID through the existing directory identity (device/inode/birthtime), including sessions in project subdirectories. It reads current connections and published space metadata under the existing storage lock and emits names, descriptions and absolute `spaces/<storageID>` paths. It never reads document bodies or indexes for the prompt. Non-Gamma directories receive no block. Recreating a project directory does not inherit the deleted project's connections.

The active Gamma `/session` route uses `SessionPrompt` and `SystemPrompt.environment` in `packages/opencode/src/session/system.ts`. Environment instructions are rebuilt on every model turn, including continuations in an existing session. This is where the current knowledge block is added. The separate Core V2 runner is not the active Gamma route and is unchanged. A storage failure is logged and does not terminate unrelated agent work. Changes during an in-flight model call apply to the following call.

Project creation offers an optional multiple-space selector (empty by default). A failed connection can be retried using the already-created project. Existing sessions show **База знаний · N** in the upper-right toolbar, with checkboxes and a link to `/knowledge`. The existing project-settings section uses the same controls. Both use the existing `knowledge/projects` endpoints and stable Gamma IDs. No copies, symlinks, special reading routes, or retrieval tools are added.

Agents use ordinary `bash`/`ls`, `read`, `grep` and `glob`. Direct filesystem edits remain technically possible under Full Permissions. The existing publication system still owns synchronization of the UI metadata and files; direct agent edits are not automatically imported into that model.

## Implementation files

- `packages/schema/src/knowledge.ts`: wire schemas for snapshots, originals and project connections.
- `packages/opencode/src/server/knowledge-store.ts`: registry, independent paths, integrity checks, atomic publication and project identity.
- `packages/opencode/src/server/routes/instance/httpapi/knowledge.ts`: authenticated product endpoints.
- `packages/opencode/src/server/routes/instance/httpapi/server.ts`: route registration.
- `packages/app/src/utils/knowledge-sync.ts`: explicit import, deep record comparison, hashing, server publication and cache.
- `packages/app/src/utils/knowledge.ts`: original-file reader routing; existing IndexedDB layout retained.
- `packages/app/src/pages/knowledge.tsx` and `knowledge.css`: synchronization status and server persistence integration.
- `packages/app/src/components/project-knowledge.tsx`: project connection controls.
- `packages/app/src/components/workspace-files.tsx`: current Gamma project settings integration.
- `packages/app/src/components/dialog-edit-project.tsx` and `dialog-edit-project-v2.tsx`: existing project dialog integrations.
- `packages/app/src/i18n/product.ts` and `ru.ts`: synchronization and connection messages.
- `script/dev-gamma.ts`: isolated development storage root.
- `packages/opencode/test/server/knowledge-store.test.ts` and `knowledge-http.test.ts`: store, integrity, concurrency, persistence and authentication regression tests.
- `packages/app/e2e/regression/knowledge-server.spec.ts`: browser import, editor, conflicts, originals, duplicate recovery and project settings regressions.
- `docs/knowledge-storage.md`: operational notes and stage boundary.

Client generation is run after the public API/schema additions; it currently produces no generated-file differences. No OpenCode permission, shell/process or agent model changes are part of this implementation.

## Migrating the ordinary browser profile

Open the same origin and browser profile that holds the data (currently `http://127.0.0.1:4456/knowledge`). A separate automated browser has separate IndexedDB and cannot inventory or migrate that profile.

1. Select **Резервная копия** below the hero. Inventory loads in a separate dialog; detailed technical records stay under **Подробный отчёт** and do not replace the map.
2. Select **Проверить локальные данные**. Review counts, names, descriptions, appearance, original byte sizes and SHA-256. Missing/mismatched originals are identified by material name and ID.
3. Select **Подготовить резервную копию с оригиналами**, then **Скачать резервную копию с оригиналами**. The downloaded `gamma-knowledge-backup.json` includes all IndexedDB data-store records and every file-store Blob, including orphaned originals and cached files. File bytes are base64-encoded with size, MIME and SHA-256; it is not a metadata-only export. The metadata/files snapshot comes from one read transaction. A backup with a missing original lists that omission explicitly and is not a complete recovery of that missing file.
4. Close the backup dialog, then select **Перенести локальные данные на сервер** on the page. This is disabled while the storage API is unavailable. An old backend returning an HTML fallback must be updated before import. The frontend does not silently fall back to another backend or test directory.
5. Only after snapshot equality and physical server verification succeed is the server binding cached. Refresh `/knowledge`, open originals and select **Проверить файлы на сервере** to inspect the actual root and verification results.

The import checks that the current local snapshot still matches the displayed data before uploading. If another tab changed it, refresh first. Existing server entries are merged without replacement; conflicting IDs block the import. Empty PDF/DOCX extracted text does not create an empty Markdown substitute: the index points at the binary original. URL Markdown includes the saved title, description and original URL.

The backup format has `format`, `version`, `records`, `files`, `missing` and `mismatched` fields. Each file contains `key`, `mime`, `size`, `sha256` and `base64`. Records retain the complete existing UI model, including typed relations and visual settings. Treat the backup as private material; it contains complete source content. No automatic IndexedDB deletion or backup restoration is performed.

### Inspect the physical files in a terminal

Run on the Gamma server, using the exact root displayed by the verification action:

```sh
KB_ROOT="${GAMMA_KNOWLEDGE_ROOT:-$HOME/.local/share/gamma/knowledge}"
find "$KB_ROOT/spaces" -type f
find "$KB_ROOT/spaces" -name index.json -exec cat {} \;
find "$KB_ROOT/spaces" -name links.json -exec cat {} \;
find "$KB_ROOT/spaces" -path '*/originals/*' -type f -exec sha256sum {} \;
```

The authenticated `GET /product/knowledge/verify` endpoint reads physical files under the publication lock. It reports the root, publication version, counts, original byte sizes/hashes, and errors by ID. It checks index targets/descriptions, material text, originals, and exact deduplicated bidirectional adjacency. A successful catalog response alone is no longer treated as a successful import.

Additional implementation files: `packages/app/src/utils/knowledge-backup.ts`, `packages/app/src/components/knowledge-migration.tsx`, and `packages/app/e2e/regression/knowledge-migration.spec.ts`.
