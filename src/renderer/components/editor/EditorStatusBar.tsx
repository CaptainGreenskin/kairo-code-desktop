import { useEditorStore } from '../../stores/editor-store'

interface Props {
  cursorLine: number
  cursorColumn: number
}

export function EditorStatusBar({ cursorLine, cursorColumn }: Props): JSX.Element {
  const openFiles = useEditorStore((s) => s.openFiles)
  const activeFileId = useEditorStore((s) => s.activeFileId)

  const active = openFiles.find((f) => f.id === activeFileId)

  return (
    <div className="flex items-center gap-4 border-t border-border bg-surface-0 px-3 py-1 text-[11px] text-text-muted select-none">
      {active ? (
        <>
          <span className="font-mono">
            Ln {cursorLine}, Col {cursorColumn}
          </span>
          <span className="text-text-muted/50">·</span>
          <span>{active.language}</span>
          <span className="text-text-muted/50">·</span>
          <span className="truncate max-w-[300px] text-text-secondary">
            {active.path}
          </span>
        </>
      ) : (
        <span>No file open</span>
      )}
    </div>
  )
}
