---
name: presentation-pptx-editing
description: Точечные изменения текста, изображений, геометрии и диаграмм PPTX через office-kit.
---

# Precise editing
Use gamma-presentation_inspect to obtain 1-based slide numbers and numeric shape IDs. Existing user PPTX must be ingested into originals before editing. Set path to the copied original for the first edit; use answer.pptx for subsequent edits.
Call gamma-presentation_edit with patch {slide,changes}. Supported operations: text {shape,find,replace}, image {shape,path}, bounds {shape,bounds:{x,y,w,h}}, chart {shape,dataset,kind}. Coordinates are inches. Text find must occur exactly once in the selected shape; range replacement preserves formatting where supported. Inspect before applying, never guess IDs.
The service loads/saves with office-kit but transplants only selected slide and exclusive media/chart dependencies into the original OOXML package. It preserves unrelated part bytes and emits qa/edit-N.json. Shared resources cause an explicit failure instead of silently changing other slides. Unsupported objects are not deleted.
To turn text into a diagram, move/edit existing supported shapes where feasible. A requested full-slide redesign may use an explicitly authored replacement only when preservation checks exist; do not silently reconstruct the entire deck. New output for full redesign must retain an inventory of facts/numbers/notes.
After every mutation render ALL slides. Compare untouched slides against the previous revision both structurally and visually. Read qa/edit-N.json, run visual review and finalize again. Never claim editing merely because a new file exists.

For text-to-diagram redesign of ONE supported slide: write a one-slide outline JSON in sources/, preserve its canvas dimensions, call gamma-presentation_redesign_slide with workspace, path, slide and source. This copies native objects with office-kit and keeps all other slide parts. Animated/unknown objects on the selected slide cause an explicit failure; use a separate redesign output in that case.
