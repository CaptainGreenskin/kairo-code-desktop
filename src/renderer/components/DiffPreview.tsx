/**
 * Inline diff-preview card.
 *
 * Renders a unified diff produced by the `diff` package alongside an
 * Accept / Reject pair. Accepting writes the new content to disk via
 * `window.kairoAPI.applyDiff` and notifies the parent; rejecting just
 * notifies. Lines are syntax-highlighted with shiki using the shared
 * highlighter singleton.
 *
 * The component renders inline and does not modify global state on its
 * own — the caller (typically `ToolCallBlock`) is responsible for
 * removing the pending diff from the chat store.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { diffLines, diffWords, type Change } from 'diff'
import { highlight } from '../lib/highlighter'
import { useEditorStore } from '../stores/editor-store'
import { useToastStore } from '../stores/toast-store'

export interface DiffPreviewProps {
  filePath: string
  originalContent: string
  newContent: string
  language: string
  /** WritePreview approval ID (from main process). When set, Accept/Reject go through the WritePreview IPC. */
  writePreviewId?: string
  /** Current status of the diff (pending/accepted/rejected). */
  status?: 'pending' | 'accepted' | 'rejected'
  onAccept: () => void
  onReject: () => void
}

type ViewMode = 'unified' | 'split'

interface UnifiedRow {
  type: 'add' | 'remove' | 'context'
  oldNumber: number | null
  newNumber: number | null
  text: string
  pairedWith?: number
}

const MAX_HEIGHT_PX = 480

export function DiffPreview({
  filePath,
  originalContent,
  newContent,
  language,
  writePreviewId,
  status = 'pending',
  onAccept,
  onReject
}: DiffPreviewProps): JSX.Element {
  const [view, setView] = useState<ViewMode>('unified')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const decided = status !== 'pending'

  const handleAcceptRef = useCallback(() => { void handleAccept() }, [busy, decided, writePreviewId, filePath, newContent, onAccept])
  const handleRejectRef = useCallback(() => { void handleReject() }, [busy, decided, writePreviewId, onReject])

  useEffect(() => {
    if (decided) return
    const handler = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 'Enter') {
        e.preventDefault()
        handleAcceptRef()
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        handleRejectRef()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [decided, handleAcceptRef, handleRejectRef])

  const changes = useMemo<Change[]>(
    () => diffLines(originalContent, newContent),
    [originalContent, newContent]
  )

  const rows = useMemo(() => buildUnifiedRows(changes), [changes])
  const stats = useMemo(() => countStats(rows), [rows])

  const handleAccept = async (): Promise<void> => {
    if (busy || decided) return
    setBusy(true)
    setError(null)
    try {
      if (writePreviewId) {
        await window.kairoAPI.approveWrite(writePreviewId, true)
      } else {
        const result = await window.kairoAPI.applyDiff(filePath, newContent)
        if (!result.ok) {
          setError(result.error ?? 'Failed to write file')
          setBusy(false)
          return
        }
      }
      useEditorStore.getState().refreshFileContent(filePath, newContent)
      useToastStore.getState().addToast({ type: 'success', message: 'Change applied' })
      onAccept()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const handleReject = async (): Promise<void> => {
    if (busy || decided) return
    if (writePreviewId) {
      setBusy(true)
      try {
        await window.kairoAPI.approveWrite(writePreviewId, false)
      } catch { /* best-effort */ }
    }
    useToastStore.getState().addToast({ type: 'info', message: 'Change rejected' })
    onReject()
  }

  return (
    <div className="my-2 rounded-md border border-warning/40 bg-surface-0/80 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-2 border-b border-border">
        <FileIcon />
        <span className="text-xs font-mono text-text-primary truncate" title={filePath}>
          {filePath}
        </span>
        <div className="ml-auto flex items-center gap-2 text-xs font-mono">
          <span className="text-success">+{stats.added}</span>
          <span className="text-danger">-{stats.removed}</span>
          <div className="ml-2 flex rounded border border-border overflow-hidden">
            <ViewToggle current={view} value="unified" onClick={() => setView('unified')}>
              Unified
            </ViewToggle>
            <ViewToggle current={view} value="split" onClick={() => setView('split')}>
              Split
            </ViewToggle>
          </div>
        </div>
      </div>

      <div className="overflow-auto" style={{ maxHeight: MAX_HEIGHT_PX }}>
        {view === 'unified' ? (
          <UnifiedView rows={rows} language={language} />
        ) : (
          <SplitView changes={changes} language={language} />
        )}
      </div>

      {error && (
        <div className="px-3 py-1.5 text-xs bg-danger/20 border-t border-danger/40 text-danger">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2 bg-surface-2 border-t border-border">
        {decided ? (
          <span
            className={
              'text-xs font-medium ' +
              (status === 'accepted' ? 'text-success' : 'text-danger')
            }
          >
            {status === 'accepted' ? 'Applied' : 'Rejected'}
          </span>
        ) : (
          <>
            <span className="text-xs text-text-muted">
              Review the proposed change before it's written to disk.
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={handleReject}
                disabled={busy}
                className="px-3 py-1 text-xs rounded-md bg-danger hover:bg-danger/90 text-white disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                Reject
                <kbd className="text-xs opacity-70 bg-white/20 px-1 rounded">⌘⌫</kbd>
              </button>
              <button
                type="button"
                onClick={handleAccept}
                disabled={busy}
                className="px-3 py-1 text-xs rounded-md bg-success hover:bg-success/90 text-white disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {busy ? 'Applying…' : 'Accept'}
                <kbd className="text-xs opacity-70 bg-white/20 px-1 rounded">⌘↵</kbd>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Unified view ──────────────────────────────────────────────────────────

function UnifiedView({
  rows,
  language
}: {
  rows: UnifiedRow[]
  language: string
}): JSX.Element {
  return (
    <table className="w-full text-[12.5px] font-mono leading-5 border-collapse">
      <tbody>
        {rows.map((row, i) => (
          <UnifiedRowView key={i} row={row} rows={rows} index={i} language={language} />
        ))}
      </tbody>
    </table>
  )
}

function UnifiedRowView({
  row,
  rows,
  index,
  language
}: {
  row: UnifiedRow
  rows: UnifiedRow[]
  index: number
  language: string
}): JSX.Element {
  const bg =
    row.type === 'add'
      ? 'bg-success/10 border-l-2 border-success'
      : row.type === 'remove'
        ? 'bg-danger/10 border-l-2 border-danger'
        : 'border-l-2 border-transparent'
  const sigil = row.type === 'add' ? '+' : row.type === 'remove' ? '-' : ' '
  const sigilColor =
    row.type === 'add'
      ? 'text-success'
      : row.type === 'remove'
        ? 'text-danger'
        : 'text-text-muted'

  const pairedRow = row.pairedWith !== undefined ? rows[row.pairedWith] : undefined
  const showWordDiff = pairedRow !== undefined

  return (
    <tr className={bg}>
      <td className="select-none text-right pr-2 pl-3 w-10 text-text-muted align-top">
        {row.oldNumber ?? ''}
      </td>
      <td className="select-none text-right pr-2 w-10 text-text-muted align-top">
        {row.newNumber ?? ''}
      </td>
      <td className={`select-none text-center w-5 ${sigilColor} align-top`}>
        {sigil}
      </td>
      <td className="pr-3 align-top whitespace-pre-wrap break-words text-text-primary">
        {showWordDiff ? (
          <IntraLineDiff
            oldText={row.type === 'remove' ? row.text : pairedRow!.text}
            newText={row.type === 'add' ? row.text : pairedRow!.text}
            side={row.type as 'add' | 'remove'}
          />
        ) : (
          <HighlightedLine code={row.text} language={language} />
        )}
      </td>
    </tr>
  )
}

function IntraLineDiff({
  oldText,
  newText,
  side
}: {
  oldText: string
  newText: string
  side: 'add' | 'remove'
}): JSX.Element {
  const wordChanges = useMemo(() => diffWords(oldText, newText), [oldText, newText])
  return (
    <span>
      {wordChanges.map((change, i) => {
        if (!change.added && !change.removed) {
          return <span key={i}>{change.value}</span>
        }
        if (side === 'remove' && change.removed) {
          return (
            <span key={i} className="bg-danger/30 rounded-sm px-0.5">
              {change.value}
            </span>
          )
        }
        if (side === 'add' && change.added) {
          return (
            <span key={i} className="bg-success/30 rounded-sm px-0.5">
              {change.value}
            </span>
          )
        }
        return null
      })}
    </span>
  )
}

// ── Split view ────────────────────────────────────────────────────────────

interface SplitRow {
  left: { number: number | null; text: string; type: 'remove' | 'context' | 'empty' }
  right: { number: number | null; text: string; type: 'add' | 'context' | 'empty' }
}

function SplitView({
  changes,
  language
}: {
  changes: Change[]
  language: string
}): JSX.Element {
  const rows = useMemo(() => buildSplitRows(changes), [changes])
  return (
    <table className="w-full text-[12.5px] font-mono leading-5 border-collapse">
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td className="select-none text-right pr-2 pl-3 w-10 text-text-muted align-top">
              {row.left.number ?? ''}
            </td>
            <td
              className={
                'pr-3 align-top whitespace-pre-wrap break-words ' +
                (row.left.type === 'remove'
                  ? 'bg-danger/10 border-l-2 border-danger text-text-primary'
                  : row.left.type === 'context'
                    ? 'text-text-primary'
                    : 'bg-surface-2/40')
              }
            >
              {row.left.type !== 'empty' && (
                <HighlightedLine code={row.left.text} language={language} />
              )}
            </td>
            <td className="select-none text-right pr-2 pl-2 w-10 text-text-muted align-top border-l border-border">
              {row.right.number ?? ''}
            </td>
            <td
              className={
                'pr-3 align-top whitespace-pre-wrap break-words ' +
                (row.right.type === 'add'
                  ? 'bg-success/10 border-l-2 border-success text-text-primary'
                  : row.right.type === 'context'
                    ? 'text-text-primary'
                    : 'bg-surface-2/40')
              }
            >
              {row.right.type !== 'empty' && (
                <HighlightedLine code={row.right.text} language={language} />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Highlighted line cell ─────────────────────────────────────────────────

/**
 * Per-line shiki highlighting. We strip shiki's `<pre>/<code>` wrapper so
 * the result inlines cleanly inside a table cell, preserving the dark
 * theme tokens. Falls back to escaped text while the highlighter loads.
 */
function HighlightedLine({
  code,
  language
}: {
  code: string
  language: string
}): JSX.Element {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!code) {
      setHtml('')
      return () => {
        cancelled = true
      }
    }
    highlight(code, language)
      .then((rendered) => {
        if (cancelled) return
        setHtml(stripShikiWrapper(rendered))
      })
      .catch(() => {
        if (!cancelled) setHtml(null)
      })
    return () => {
      cancelled = true
    }
  }, [code, language])

  if (html === null) {
    return <span>{code}</span>
  }
  return <span className="shiki-line" dangerouslySetInnerHTML={{ __html: html }} />
}

function stripShikiWrapper(html: string): string {
  // shiki wraps output in `<pre class="shiki" ...><code>...</code></pre>`.
  // For inline rendering we want only the inner highlighted span markup.
  const inner = html.replace(/^<pre[^>]*>/, '').replace(/<\/pre>$/, '')
  return inner.replace(/^<code[^>]*>/, '').replace(/<\/code>$/, '')
}

// ── Utilities ─────────────────────────────────────────────────────────────

function ViewToggle({
  current,
  value,
  onClick,
  children
}: {
  current: ViewMode
  value: ViewMode
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  const active = current === value
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-2 py-0.5 text-xs uppercase tracking-wide ' +
        (active
          ? 'bg-surface-3 text-text-primary'
          : 'bg-surface-2 text-text-secondary hover:text-text-primary')
      }
    >
      {children}
    </button>
  )
}

function FileIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5 text-warning shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" strokeLinejoin="round" />
      <path d="M14 3v6h6" strokeLinejoin="round" />
    </svg>
  )
}

function buildUnifiedRows(changes: Change[]): UnifiedRow[] {
  const rows: UnifiedRow[] = []
  let oldNumber = 1
  let newNumber = 1
  for (let ci = 0; ci < changes.length; ci++) {
    const change = changes[ci]!
    const lines = splitLines(change.value)
    if (change.added) {
      for (const line of lines) {
        rows.push({ type: 'add', oldNumber: null, newNumber: newNumber++, text: line })
      }
    } else if (change.removed) {
      const removeStart = rows.length
      for (const line of lines) {
        rows.push({ type: 'remove', oldNumber: oldNumber++, newNumber: null, text: line })
      }
      // Pair with the next added block for word-level diff
      const next = changes[ci + 1]
      if (next?.added) {
        const addedLines = splitLines(next.value)
        const addStart = rows.length
        for (const line of addedLines) {
          rows.push({ type: 'add', oldNumber: null, newNumber: newNumber++, text: line })
        }
        const pairCount = Math.min(lines.length, addedLines.length)
        for (let j = 0; j < pairCount; j++) {
          rows[removeStart + j]!.pairedWith = addStart + j
          rows[addStart + j]!.pairedWith = removeStart + j
        }
        ci++ // consumed next
      }
    } else {
      for (const line of lines) {
        rows.push({
          type: 'context',
          oldNumber: oldNumber++,
          newNumber: newNumber++,
          text: line
        })
      }
    }
  }
  return rows
}

function buildSplitRows(changes: Change[]): SplitRow[] {
  const rows: SplitRow[] = []
  let oldNumber = 1
  let newNumber = 1
  // Pair removed+added blocks side-by-side, padding the shorter side with
  // empty cells so context lines stay aligned across both columns.
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    if (!change.added && !change.removed) {
      for (const line of splitLines(change.value)) {
        rows.push({
          left: { number: oldNumber, text: line, type: 'context' },
          right: { number: newNumber, text: line, type: 'context' }
        })
        oldNumber++
        newNumber++
      }
      continue
    }
    if (change.removed) {
      const removedLines = splitLines(change.value)
      const next = changes[i + 1]
      const addedLines = next?.added ? splitLines(next.value) : []
      const max = Math.max(removedLines.length, addedLines.length)
      for (let j = 0; j < max; j++) {
        const removedLine = removedLines[j]
        const addedLine = addedLines[j]
        rows.push({
          left:
            removedLine !== undefined
              ? { number: oldNumber++, text: removedLine, type: 'remove' }
              : { number: null, text: '', type: 'empty' },
          right:
            addedLine !== undefined
              ? { number: newNumber++, text: addedLine, type: 'add' }
              : { number: null, text: '', type: 'empty' }
        })
      }
      if (next?.added) i++ // consumed
      continue
    }
    if (change.added) {
      // Pure addition (no preceding removal).
      for (const line of splitLines(change.value)) {
        rows.push({
          left: { number: null, text: '', type: 'empty' },
          right: { number: newNumber++, text: line, type: 'add' }
        })
      }
    }
  }
  return rows
}

function splitLines(text: string): string[] {
  if (text === '') return []
  // Drop the trailing newline produced by diffLines so we don't render
  // an empty row at the end of every block.
  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text
  return trimmed.split('\n')
}

function countStats(rows: UnifiedRow[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const r of rows) {
    if (r.type === 'add') added++
    else if (r.type === 'remove') removed++
  }
  return { added, removed }
}
