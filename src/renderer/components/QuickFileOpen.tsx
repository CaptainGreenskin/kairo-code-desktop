import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from '../stores/app-store'
import { useEditorStore } from '../stores/editor-store'

interface FileEntry {
  name: string
  relativePath: string
  absolutePath: string
}

function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (q.length === 0) return 1

  let qi = 0
  let score = 0
  let consecutive = 0
  let lastMatch = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++
      consecutive = ti === lastMatch + 1 ? consecutive + 1 : 1
      score += consecutive + (ti === 0 ? 5 : 0)
      lastMatch = ti
    }
  }

  if (qi < q.length) return -1
  return score - target.length * 0.1
}

export function QuickFileOpen(): JSX.Element {
  const open = useAppStore((s) => s.quickFileOpenVisible)
  const close = useCallback(() => useAppStore.getState().setQuickFileOpenVisible(false), [])
  const workspacePath = useAppStore((s) => s.workspacePath)

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || !workspacePath) return
    setQuery('')
    setSelectedIndex(0)
    setLoading(true)
    void window.kairoAPI.listAllFiles(workspacePath).then((result) => {
      setFiles(result)
      setLoading(false)
    }).catch(() => setLoading(false))
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [open, workspacePath])

  const filtered = useMemo(() => {
    if (!query.trim()) return files.slice(0, 50)
    const scored = files
      .map((f) => ({ file: f, score: Math.max(fuzzyScore(query, f.name), fuzzyScore(query, f.relativePath)) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
    return scored.slice(0, 50).map((s) => s.file)
  }, [files, query])

  useEffect(() => {
    setSelectedIndex(0)
  }, [filtered.length])

  const handleOpen = useCallback(async (file: FileEntry) => {
    close()
    try {
      const result = await window.kairoAPI.readFile(file.absolutePath)
      if (result.ok && result.content !== undefined) {
        useEditorStore.getState().openFile({
          path: file.absolutePath,
          name: file.name,
          content: result.content
        })
        useEditorStore.getState().setEditorVisible(true)
      }
    } catch {
      // best-effort
    }
  }, [close])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const f = filtered[selectedIndex]
        if (f) void handleOpen(f)
      }
    },
    [close, filtered, selectedIndex, handleOpen]
  )

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} />

          <motion.div
            className="relative w-full max-w-lg bg-surface-2 border border-border rounded-xl shadow-2xl overflow-hidden"
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15 }}
            onKeyDown={handleKeyDown}
          >
            <div className="flex items-center px-4 border-b border-border">
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m16 16 4 4" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search files by name..."
                className="flex-1 py-3 px-2 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
              />
              {loading && (
                <span className="text-xs text-text-muted">Loading...</span>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-text-muted">
                  {loading ? 'Scanning workspace...' : 'No files found'}
                </div>
              ) : (
                filtered.map((file, i) => (
                  <button
                    key={file.absolutePath}
                    type="button"
                    onClick={() => void handleOpen(file)}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={
                      'w-full flex flex-col px-4 py-2 text-left transition-colors ' +
                      (i === selectedIndex
                        ? 'bg-accent/10 text-text-primary'
                        : 'text-text-secondary hover:bg-surface-3')
                    }
                  >
                    <span className="text-sm font-medium truncate">{file.name}</span>
                    <span className="text-xs text-text-muted font-mono truncate">{file.relativePath}</span>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
