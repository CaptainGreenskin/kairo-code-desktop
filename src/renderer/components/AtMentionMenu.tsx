import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'

interface FileEntry {
  name: string
  relativePath: string
  absolutePath: string
}

interface AtMentionMenuProps {
  query: string
  selectedIndex: number
  onSelect: (file: FileEntry) => void
  onHover: (index: number) => void
}

export function AtMentionMenu({
  query,
  selectedIndex,
  onSelect,
  onHover
}: AtMentionMenuProps): JSX.Element {
  const [files, setFiles] = useState<FileEntry[]>([])
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadFiles()
  }, [])

  const loadFiles = async (): Promise<void> => {
    try {
      const { useAppStore } = await import('../stores/app-store')
      const wp = useAppStore.getState().workspacePath
      if (!wp) return
      const result = await window.kairoAPI.listAllFiles(wp)
      if (Array.isArray(result)) setFiles(result)
    } catch { /* ignore */ }
  }

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return files.slice(0, 20)
    return files
      .filter((f) =>
        f.name.toLowerCase().includes(q) ||
        f.relativePath.toLowerCase().includes(q)
      )
      .slice(0, 20)
  }, [files, query])

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (filtered.length === 0) return <></>

  return (
    <motion.div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 bg-surface-2 border border-border rounded-lg shadow-xl overflow-hidden max-h-52 overflow-y-auto z-20"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.1 }}
    >
      {filtered.map((file, i) => {
        const nameIdx = file.name.toLowerCase().indexOf(query.toLowerCase())
        return (
          <button
            key={file.absolutePath}
            type="button"
            onClick={() => onSelect(file)}
            onMouseEnter={() => onHover(i)}
            className={
              'w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors ' +
              (i === selectedIndex
                ? 'bg-accent/10 text-text-primary'
                : 'text-text-secondary hover:bg-surface-3')
            }
          >
            <FileIcon />
            <div className="flex-1 min-w-0">
              <span className="font-mono text-xs text-text-primary truncate block">
                {nameIdx >= 0 ? (
                  <>
                    {file.name.slice(0, nameIdx)}
                    <span className="text-accent font-semibold">
                      {file.name.slice(nameIdx, nameIdx + query.length)}
                    </span>
                    {file.name.slice(nameIdx + query.length)}
                  </>
                ) : (
                  file.name
                )}
              </span>
              <span className="text-[10px] text-text-muted truncate block">
                {file.relativePath}
              </span>
            </div>
          </button>
        )
      })}
    </motion.div>
  )
}

function FileIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5 text-accent shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  )
}

export type { FileEntry }
