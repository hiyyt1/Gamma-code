// Test-only: seed durable tool evidence in the isolated smoke-test database.
import { Effect } from "effect"
import { AppRuntime } from "../src/effect/app-runtime"
import { Session } from "../src/session/session"
import { SessionID, MessageID, PartID } from "../src/session/schema"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"

const [id, directory, file = "index.html", mode = "write"] = process.argv.slice(2)
if (!process.env.OPENCODE_DB?.includes("gamma-preview-browser-") || !id || !directory)
  throw new Error("isolated_preview_fixture_required")
await AppRuntime.runPromise(
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const sessionID = SessionID.make(id)
    const history = yield* sessions.messages({ sessionID })
    const parent = history.findLast((message) => message.info.role === "user")
    if (!parent) throw new Error("user_required")
    const messageID = MessageID.ascending()
    yield* sessions.updateMessage({
      id: messageID,
      sessionID,
      role: "assistant",
      parentID: parent.info.id,
      time: { created: Date.now(), completed: Date.now() + 1 },
      modelID: Model.ID.make("test"),
      providerID: Provider.ID.make("test"),
      agent: "gamma",
      mode: "gamma",
      path: { cwd: directory, root: directory },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
      finish: "stop",
    })
    if (mode !== "text")
      yield* sessions.updatePart({
        id: PartID.ascending(),
        sessionID,
        messageID,
        type: "tool",
        tool: "write",
        callID: `fixture-${messageID}`,
        state: {
          status: "completed",
          input: { path: `${directory}/${file}` },
          output: "Created file successfully",
          metadata: {},
          title: file,
          time: { start: Date.now(), end: Date.now() },
        },
      })
    yield* sessions.updatePart({
      id: PartID.ascending(),
      sessionID,
      messageID,
      type: "text",
      text:
        (mode === "text"
          ? "Обычный ответ Gamma."
          : `Сайт готов: [${file}](${file}). [CSS](style.css). [Внешняя ссылка](https://example.com/index.html).`) +
        "\n\n" +
        Array.from(
          { length: 4 },
          (_, i) =>
            `Длинный абзац ${i + 1}. Текст ответа должен сохранять привычную ширину и удобно читаться рядом с файловой панелью. Здесь описаны структура сайта, стили, изображения и поведение на узком экране.`,
        ).join("\n\n") +
        '\n\n- Первый пункт списка\n- Второй пункт списка\n\n```js\nconst website = { title: "Coffee", responsive: true };\nconsole.log(website);\n```',
    })
  }),
)
await AppRuntime.dispose()
