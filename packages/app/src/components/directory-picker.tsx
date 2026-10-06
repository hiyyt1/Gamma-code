import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { ServerConnection } from "@/context/server"
import { DialogProductProject } from "./dialog-product-project"

type DirectoryPickerInput = {
  server: ServerConnection.Any
  title?: string
  multiple?: boolean
  onSelect: (result: string | string[] | null) => void
}

// Product navigation never exposes the server's general filesystem picker.
export function useDirectoryPicker() {
  const dialog = useDialog()
  return (input: DirectoryPickerInput) => {
    const selection = { done: false }
    void dialog.show(
      () => (
        <DialogProductProject
          server={input.server.http}
          refresh={() => undefined}
          choose={async (project) => {
            selection.done = true
            input.onSelect(input.multiple ? [project.path] : project.path)
            dialog.close()
          }}
        />
      ),
      () => {
        if (!selection.done) input.onSelect(null)
      },
    )
  }
}
