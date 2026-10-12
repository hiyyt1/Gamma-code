Gamma Knowledge Base: manually authored test fixture

36 materials: 12 Markdown, 6 TXT, 10 notes, 8 official documentation links.
8 thematic entities, 64 explicit manual test relations, 18 original file blobs.
No automatic extraction, embeddings or link downloading is claimed.

On /knowledge, click “Загрузить тестовое пространство” in the empty state.
The button saves in the current browser and selects the populated space.
Repeated clicks select the existing seed space without modifying it.

Alternatively, run in the developer console of YOUR open Gamma /knowledge page, served by the
local Vite development server for this checkout:

await import('/@fs/home/nikita/menti/mvp_platform/script/knowledge-base/seed.mjs').then(m => m.seedKnowledge())

Then select “Gamma — Разработка AI-платформы” in the space selector.
Reload if another tab has not received the update yet.

Storage belongs to the exact browser profile AND origin (scheme, hostname, port).
127.0.0.1 and localhost are different origins. Seeding an automation browser does
not seed your normal Chrome profile. Execute the command in the profile where
you intend to use the space. This script deliberately does not inspect or modify
another browser's files.

Uses existing readKnowledge/saveKnowledge/validateMaterial/validateURL.
Original files and metadata commit atomically with the existing revision check.
Stable IDs prevent duplicates: if the seed space exists, nothing is written.
Existing user edits to that space are retained. This is not an update/migration
script. A conflicting space name or orphan seed IDs abort without writing.
No deletion, overwrite, schema change, backend change, or application dependency.

Sources, descriptions, tags, relation types and metadata explicitly identify the
fictional scenario. Links wait for processing; text files and notes are stored.
Entity nodes are manually authored topics, not machine-extracted facts.

Source ordering groups nearby slots in the existing deterministic graph layout.
The renderer has no community-detection layout; node positions moved by hand are
not persisted by this seed. Its data order remains stable across reloads.

PDF/DOCX are not included; no extra generator dependency was installed.
The temporary application button bundles this helper lazily and works in builds.
The developer-console /@fs command above targets the local Vite server only.
