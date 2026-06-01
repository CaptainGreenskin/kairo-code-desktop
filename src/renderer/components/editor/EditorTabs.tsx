import { useEditorStore } from '../../stores/editor-store'

export function EditorTabs(): JSX.Element {
  const openFiles = useEditorStore((s) => s.openFiles)
  const activeFileId = useEditorStore((s) => s.activeFileId)
  const setActiveFile = useEditorStore((s) => s.setActiveFile)
  const closeFile = useEditorStore((s) => s.closeFile)

  if (openFiles.length === 0) return <></>

  return (
    <div className="flex items-center bg-surface-0 border-b border-border overflow-x-auto">
      {openFiles.map((f) => {
        const active = f.id === activeFileId
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => setActiveFile(f.id)}
            className={
              'group flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-border shrink-0 transition-colors ' +
              (active
                ? 'bg-surface-1 text-text-primary border-b-2 border-b-accent'
                : 'bg-surface-0 text-text-secondary hover:bg-surface-2')
            }
          >
            <span className="truncate max-w-[140px]">{f.name}</span>
            {f.dirty && (
              <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
            )}
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation()
                closeFile(f.id)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation()
                  closeFile(f.id)
                }
              }}
              className="ml-1 w-4 h-4 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-3 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              ×
            </span>
          </button>
        )
      })}
    </div>
  )
}
