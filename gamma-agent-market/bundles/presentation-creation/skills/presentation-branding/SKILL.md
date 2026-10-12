---
name: presentation-branding
description: Извлечение фирменного стиля из PPTX и сохранение шаблонов, шрифтов и мастер-слайдов.
---

# Branding
Ingest the corporate PPTX and inspect it. Record actual canvas size, theme colors, fonts, title/body geometry, logo placement and representative slide IDs in sources/brand.json. Render and view the original when possible; metadata alone does not establish its visible style.
For filling an existing template, use office-kit targeted edits. Reuse master/layout/notes instead of generating a replacement deck. Do not erase animations or unknown objects.
For a new deck inspired by a template, set the exact dimensions and available fonts in outline.json, reuse approved colors and supplied logos; explicitly distinguish style reuse from full master inheritance. The structured generation route does not clone arbitrary masters.
If a font is absent, tell the lead and choose an installed metrically appropriate alternative only with a disclosed substitution. Never download proprietary fonts. Preserve logo aspect ratio and do not recolor brand assets without authorization.
