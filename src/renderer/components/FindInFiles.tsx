import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../stores/app-store'
import { ClickablePath } from './ClickablePath'

interface GrepResult {
  file: string
  line: number
  text: string
}

interface GroupedResult {
  file: string
  matches: Array<{ line: number; text: string }>
}

interface FindInFilesProps {
  visible: boolean
  onClose: () => void
}

export function FindInFiles({ visible, onClose }: FindInFilesProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [include, setInclude] = useState('')
  const [results, setResults] = useState<GroupedResult[]>([])
  const [searching, setSearching] = useState(false)
  const [totalMatches, setTotalMatches] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const workspacePath = useAppStore((s) => s.workspacePath)

  useEffect(() => {
    if (visible) inputRef.current?.focus()
  }, [visible])

  const doSearch = useCallback(async () => {
    const pattern = query.trim()
    if (!pattern || !workspacePath) return
    setSearching(true)
    try {
      const raw: GrepResult[] = await window.kairoAPI.grepFiles(
        workspacePath,
        pattern,
        include || undefined,
        100
      )
      const grouped = groupByFile(raw)
      setResults(grouped)
      setTotalMatches(raw.length)
    } catch {
      setResults([])
      setTotalMatches(0)
    } finally {
      setSearching(false)
    }
  }, [query, include, workspacePath])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void doSearch()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  if (!visible) return null

  return (
    <div className="flex flex-col h-full bg-surface-0 border-r border-border">
      <div className="flex items-center justify-between px-3 py-2 bg-surface-2 border-b border-border">
        <span className="text-xs font-medium text-text-primary">Find in Files</span>
        <button
          type="button"
          onClick={onClose}
          className="text-text-muted hover:text-text-primary transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="px-3 py-2 space-y-1.5 border-b border-border">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search pattern (regex)…"
          className="w-full px-2 py-1 text-xs bg-surface-2 border border-border rounded outline-none focus:border-accent text-text-primary placeholder:text-text-muted"
        />
        <input
          type="text"
          value={include}
          onChange={(e) => setInclude(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Files to include (e.g. *.ts)"
          className="w-full px-2 py-1 text-xs bg-surface-2 border border-border rounded outline-none focus:border-accent text-text-primary placeholder:text-text-muted"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1.5 text-xs">
        {searching && (
          <div className="text-text-muted text-center py-3">Searching…</div>
        )}
        {!searching && results.length === 0 && query && (
          <div className="text-text-muted text-center py-3 italic">No results</div>
        )}
        {!searching && results.length > 0 && (
          <>
            <div className="text-text-muted mb-1.5 px-1">
              {totalMatches} result{totalMatches === 1 ? '' : 's'} in {results.length} file{results.length === 1 ? '' : 's'}
            </div>
            {results.map((group) => (
              <FileGroup key={group.file} group={group} workspacePath={workspacePath ?? ''} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function FileGroup({
  group,
  workspacePath
}: {
  group: GroupedResult
  workspacePath: string
}): JSX.Element {
  const [open, setOpen] = useState(true)
  const relPath = group.file.startsWith(workspacePath)
    ? group.file.slice(workspacePath.length + 1)
    : group.file

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 w-full px-1 py-0.5 hover:bg-surface-2 rounded text-left"
      >
        <span className="text-text-muted shrink-0">{open ? '▾' : '▸'}</span>
        <span className="font-mono text-text-primary truncate">{relPath}</span>
        <span className="text-text-muted ml-auto shrink-0">({group.matches.length})</span>
      </button>
      {open && (
        <div className="ml-4 space-y-0">
          {group.matches.map((m, i) => (
            <ClickablePath
              key={i}
              path={group.file}
              line={m.line}
              className="block px-1 py-0.5 hover:bg-surface-2 rounded cursor-pointer no-underline"
            >
              <span className="text-text-muted mr-1.5">{m.line}:</span>
              <span className="text-text-secondary font-mono">{m.text.trim()}</span>
            </ClickablePath>
          ))}
        </div>
      )}
    </div>
  )
}

function groupByFile(results: GrepResult[]): GroupedResult[] {
  const map = new Map<string, GroupedResult>()
  for (const r of results) {
    let group = map.get(r.file)
    if (!group) {
      group = { file: r.file, matches: [] }
      map.set(r.file, group)
    }
    group.matches.push({ line: r.line, text: r.text })
  }
  return [...map.values()]
}
