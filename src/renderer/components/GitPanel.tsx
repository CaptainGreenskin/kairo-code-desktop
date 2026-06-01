import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../stores/app-store'
import { useGitStore } from '../stores/git-store'

export function GitPanel(): JSX.Element {
  const branch = useGitStore((s) => s.branch)
  const staged = useGitStore((s) => s.staged)
  const modified = useGitStore((s) => s.modified)
  const untracked = useGitStore((s) => s.untracked)
  const loading = useGitStore((s) => s.loading)
  const error = useGitStore((s) => s.error)
  const refresh = useGitStore((s) => s.refresh)

  const [commitMsg, setCommitMsg] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [committing, setCommitting] = useState(false)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggleFile = useCallback((path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const workspacePath = useAppStore((s) => s.workspacePath)

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim() || selectedFiles.size === 0 || !workspacePath) return
    setCommitting(true)
    try {
      const result = await window.kairoAPI.gitQuickCommit(
        workspacePath,
        Array.from(selectedFiles),
        commitMsg.trim()
      )
      if (result.ok) {
        setCommitMsg('')
        setSelectedFiles(new Set())
        await refresh()
      }
    } finally {
      setCommitting(false)
    }
  }, [commitMsg, selectedFiles, workspacePath, refresh])

  const allFiles = [
    ...staged.map((f) => ({ ...f, group: 'staged' as const })),
    ...modified.map((f) => ({ ...f, group: 'modified' as const })),
    ...untracked.map((f) => ({ ...f, group: 'untracked' as const }))
  ]

  return (
    <div className="text-sm">
      {/* Branch */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-text-secondary">
        <BranchIcon />
        <span className="font-mono truncate">{branch || '—'}</span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="ml-auto text-text-muted hover:text-text-primary transition-colors"
          title="Refresh"
        >
          ↻
        </button>
      </div>

      {error && (
        <div className="px-3 py-1 text-danger text-xs">{error}</div>
      )}

      {loading ? (
        <div className="px-3 py-2 text-text-muted">Loading...</div>
      ) : allFiles.length === 0 ? (
        <div className="px-3 py-2 text-text-muted">Working tree clean</div>
      ) : (
        <>
          {/* File list */}
          <div className="max-h-[160px] overflow-y-auto">
            {allFiles.map((f) => {
              const checked = selectedFiles.has(f.path)
              return (
                <label
                  key={f.path}
                  className="flex items-center gap-1.5 px-3 py-0.5 hover:bg-surface-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleFile(f.path)}
                    className="accent-accent"
                  />
                  <span
                    className={
                      'w-1.5 h-1.5 rounded-full shrink-0 ' +
                      (f.group === 'staged'
                        ? 'bg-success'
                        : f.group === 'modified'
                          ? 'bg-warning'
                          : 'bg-text-muted')
                    }
                  />
                  <span className="truncate text-text-secondary">{f.path}</span>
                </label>
              )
            })}
          </div>

          {/* Quick commit */}
          <div className="px-3 pt-2 pb-1 flex flex-col gap-1.5">
            <input
              type="text"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              placeholder="Commit message..."
              className="w-full px-2 py-1 rounded bg-surface-2 border border-border text-text-primary text-sm outline-none focus:border-border-focus"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCommit()
              }}
            />
            <button
              type="button"
              onClick={() => void handleCommit()}
              disabled={committing || !commitMsg.trim() || selectedFiles.size === 0}
              className="w-full py-1 rounded bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-40 transition-colors"
            >
              {committing ? 'Committing...' : `Commit (${selectedFiles.size})`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function BranchIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M18 9c0 3.314-2.686 6-6 6h-6" />
    </svg>
  )
}
