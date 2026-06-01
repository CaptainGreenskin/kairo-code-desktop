import { useCallback, useEffect, useState } from 'react'
import { useEditorStore } from '../stores/editor-store'
import { useAppStore } from '../stores/app-store'

interface TreeEntry {
  name: string
  path: string
  type: 'file' | 'directory'
}

export function FileTree(): JSX.Element {
  const workspacePath = useAppStore((s) => s.workspacePath)
  const [rootEntries, setRootEntries] = useState<TreeEntry[]>([])

  useEffect(() => {
    if (!workspacePath) {
      setRootEntries([])
      return
    }
    void window.kairoAPI.listDir(workspacePath).then(setRootEntries)
  }, [workspacePath])

  if (!workspacePath) {
    return (
      <div className="px-3 py-2 text-[11px] text-text-muted">
        Open a folder to browse files
      </div>
    )
  }

  return (
    <div className="overflow-y-auto text-[12px]">
      {rootEntries.map((e) => (
        <TreeNode key={e.path} entry={e} depth={0} />
      ))}
    </div>
  )
}

interface TreeNodeProps {
  entry: TreeEntry
  depth: number
}

function TreeNode({ entry, depth }: TreeNodeProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<TreeEntry[]>([])
  const [loaded, setLoaded] = useState(false)

  const openFile = useEditorStore((s) => s.openFile)
  const setEditorVisible = useEditorStore((s) => s.setEditorVisible)

  const toggle = useCallback(async () => {
    if (entry.type === 'file') {
      const result = await window.kairoAPI.readFile(entry.path)
      if (result.ok && result.content !== undefined) {
        openFile({ path: entry.path, name: entry.name, content: result.content })
        setEditorVisible(true)
      }
      return
    }
    if (!loaded) {
      const entries = await window.kairoAPI.listDir(entry.path)
      setChildren(entries)
      setLoaded(true)
    }
    setExpanded((v) => !v)
  }, [entry, loaded, openFile, setEditorVisible])

  const isDir = entry.type === 'directory'
  const indent = depth * 16 + 8

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-1 py-0.5 hover:bg-surface-2 transition-colors text-left"
        style={{ paddingLeft: indent }}
      >
        {isDir ? (
          <span className="w-3.5 text-center text-text-muted text-[10px]">
            {expanded ? '▾' : '▸'}
          </span>
        ) : (
          <span className="w-3.5" />
        )}
        <span className="text-[10px] mr-0.5">{isDir ? '📁' : fileIcon(entry.name)}</span>
        <span className="truncate text-text-secondary">{entry.name}</span>
      </button>
      {expanded &&
        children.map((c) => (
          <TreeNode key={c.path} entry={c} depth={depth + 1} />
        ))}
    </>
  )
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'ts':
    case 'tsx':
      return '🔷'
    case 'js':
    case 'jsx':
      return '🟡'
    case 'json':
      return '📋'
    case 'md':
      return '📝'
    case 'css':
    case 'scss':
    case 'less':
      return '🎨'
    case 'html':
      return '🌐'
    case 'py':
      return '🐍'
    case 'go':
      return '🔵'
    case 'rs':
      return '🦀'
    case 'java':
      return '☕'
    case 'sh':
    case 'bash':
      return '⚙️'
    default:
      return '📄'
  }
}
