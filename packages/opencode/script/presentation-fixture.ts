// Deterministic real-file fixture for browser tests; deliberately not LLM QA.
import { create, load, build, render, editDeck } from "../src/presentation/service"
import { read, write } from "../src/presentation/files"
import { inspect } from "../src/presentation/pptx"

const [operation, directory, workspace] = process.argv.slice(2)
if (!directory) throw new Error("directory_required")
if (operation === "create") {
  const created = await create(directory, "Gamma presentation preview", "data")
  const { root, state } = await load(directory, created.workspace)
  await write(
    root,
    "sources/outline.json",
    JSON.stringify({
      title: "Gamma presentation preview",
      audience: "Leadership",
      objective: "Test real preview",
      direction: "Editorial Minimal",
      font: "Liberation Sans",
      slides: ["First slide", "Second slide", "Third slide"].map((title) => ({
        title,
        takeaway: title,
        elements: [{ type: "text", x: 1, y: 1, w: 10, h: 2, text: title, size: 36 }],
      })),
    }),
  )
  await render(root, await build(root, state))
  console.log(JSON.stringify(created))
}
if (operation === "edit") {
  const { root, state } = await load(directory, workspace)
  const info = await inspect(await read(root, "answer.pptx"))
  await render(
    root,
    await editDeck(root, state, "answer.pptx", {
      slide: 2,
      changes: [
        { type: "text", shape: info.slides[1].shapes[0].id, find: "Second slide", replace: "Updated second slide" },
      ],
    }),
  )
  console.log(JSON.stringify({ workspace, revision: state.revision + 1 }))
}
