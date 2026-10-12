---
name: presentation-visual-qa
description: Визуальная проверка реального PPTX, исправления и проверяемая финализация.
---

# Visual QA
Use gamma-presentation_health before review. Vision must report image=true for a configured provider; otherwise visual quality is unverified. Never replace a missing image review with a text-only assertion. Models/endpoints use the existing Gamma provider configuration, including compatible local providers.
Run gamma-presentation_render for current PPTX. Then gamma-presentation_review_slides checks every image and stores provider identity, verdicts, findings and image/deck hashes. Check clipping, off-canvas objects, unintended overlap, readability, contrast, hierarchy, data and consistency. Read each reported problem and fix its source. Review title logic and compare all numeric claims with source data independently.
Run gamma-presentation_review_deck for overall consistency. At most three repair cycles; unresolved issues yield an explicit draft with status, not a successful completion. Rerender after every change; stale results cannot pass finalize.
Rendering alone is not review. Unit tests are not design approval. An image-capable provider's pass is recorded evidence, not a guarantee against all visual defects. Inspect dense full-size slides when uncertain. Missing LibreOffice/Poppler, damaged output, unsupported objects or unavailable fonts must remain explicit failures.
Finalization requires structure parsing, successful opening/render of all slides and fresh successful slide/deck vision results. Link the preview manifest, editable PPTX, PDF and editable sources. State material raster elements and remaining limitations.
