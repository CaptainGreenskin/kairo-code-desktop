import { useCallback } from 'react'
import { useAppStore } from '../stores/app-store'
import { useEditorStore } from '../stores/editor-store'

interface ClickablePathProps {
  path: string
  line?: number
  className?: string
  children?: React.ReactNode
}

export function ClickablePath({ path, line, className, children }: ClickablePathProps): JSX.Element {
  const openFile = useEditorStore((s) => s.openFile)
  const setEditorVisible = useEditorStore((s) => s.setEditorVisible)

  const handleClick = useCallback(async () => {
    const wp = useAppStore.getState().workspacePath
    const absPath = path.startsWith('/') ? path : wp ? `${wp}/${path}` : path
    const name = absPath.split('/').pop() ?? absPath
    try {
      const result = await window.kairoAPI.readFile(absPath)
      if (result.ok && result.content !== undefined) {
        openFile({ path: absPath, name, content: result.content, line })
        setEditorVisible(true)
      }
    } catch {
      // best-effort
    }
  }, [path, line, openFile, setEditorVisible])

  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        'text-accent hover:underline cursor-pointer font-mono text-left ' +
        (className ?? '')
      }
    >
      {children ?? path}
    </button>
  )
}
