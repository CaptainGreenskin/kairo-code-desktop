import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useChatStore } from '../stores/chat-store'
import { useEditorStore } from '../stores/editor-store'
import { useAppStore } from '../stores/app-store'
import { useToastStore } from '../stores/toast-store'
import { DiffPreview } from './DiffPreview'

export function ReviewPanel(): JSX.Element | null {
  const open = useAppStore((s) => s.reviewPanelOpen)
  const pendingDiffs = useChatStore((s) => s.pendingDiffs)
  const pending = useMemo(
    () => pendingDiffs.filter((d) => d.status === 'pending'),
    [pendingDiffs]
  )
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    if (open) setCurrentIndex(0)
  }, [open])

  useEffect(() => {
    if (currentIndex >= pending.length && pending.length > 0) {
      setCurrentIndex(pending.length - 1)
    }
  }, [pending.length, currentIndex])

  const current = pending[currentIndex]

  const close = useCallback(() => {
    useAppStore.getState().setReviewPanelOpen(false)
  }, [])

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, pending.length - 1))
  }, [pending.length])

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0))
  }, [])

  const acceptCurrent = useCallback(async () => {
    if (!current) return
    try {
      if (current.writePreviewId) {
        await window.kairoAPI.approveWrite(current.writePreviewId, true)
      } else {
        await window.kairoAPI.applyDiff(current.filePath, current.newContent)
      }
      useEditorStore.getState().refreshFileContent(current.filePath, current.newContent)
      useChatStore.getState().updatePendingDiffStatus(current.id, 'accepted')
      useToastStore.getState().addToast({ type: 'success', message: 'Change applied' })
    } catch {
      useToastStore.getState().addToast({ type: 'error', message: 'Failed to apply change' })
    }
  }, [current])

  const rejectCurrent = useCallback(async () => {
    if (!current) return
    if (current.writePreviewId) {
      try {
        await window.kairoAPI.approveWrite(current.writePreviewId, false)
      } catch { /* best-effort */ }
    }
    useChatStore.getState().updatePendingDiffStatus(current.id, 'rejected')
    useToastStore.getState().addToast({ type: 'info', message: 'Change rejected' })
  }, [current])

  const acceptAll = useCallback(async () => {
    for (const diff of pending) {
      try {
        if (diff.writePreviewId) {
          await window.kairoAPI.approveWrite(diff.writePreviewId, true)
        } else {
          await window.kairoAPI.applyDiff(diff.filePath, diff.newContent)
        }
        useEditorStore.getState().refreshFileContent(diff.filePath, diff.newContent)
        useChatStore.getState().updatePendingDiffStatus(diff.id, 'accepted')
      } catch { /* continue */ }
    }
    useToastStore.getState().addToast({ type: 'success', message: `Accepted ${pending.length} changes` })
    close()
  }, [pending, close])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      switch (e.key) {
        case 'j':
        case 'ArrowRight':
          e.preventDefault()
          goNext()
          break
        case 'k':
        case 'ArrowLeft':
          e.preventDefault()
          goPrev()
          break
        case 'a':
        case 'Enter':
          e.preventDefault()
          void acceptCurrent()
          break
        case 'A':
          e.preventDefault()
          void acceptAll()
          break
        case 'r':
        case 'Backspace':
          e.preventDefault()
          void rejectCurrent()
          break
        case 'Escape':
          e.preventDefault()
          close()
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, goNext, goPrev, acceptCurrent, rejectCurrent, acceptAll, close])

  if (!open) return null

  if (pending.length === 0) {
    return (
      <motion.div
        className="fixed inset-0 z-40 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
        <div className="relative bg-surface-2 border border-border rounded-xl shadow-2xl p-8 text-center">
          <p className="text-text-secondary mb-4">No pending changes to review.</p>
          <button
            type="button"
            onClick={close}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm hover:bg-accent-hover transition-colors"
          >
            Close
          </button>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      className="fixed inset-0 z-40 flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />

      <div className="relative flex flex-col mx-auto my-8 w-full max-w-4xl max-h-[calc(100vh-4rem)] bg-surface-1 border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-2">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-text-primary">Review Changes</h3>
            <span className="text-xs text-text-muted font-mono">
              {currentIndex + 1} / {pending.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted">
              j/k navigate &middot; a accept &middot; r reject &middot; A accept all &middot; Esc close
            </span>
            <button type="button" onClick={close} className="text-text-muted hover:text-text-primary text-sm px-1">
              &#10005;
            </button>
          </div>
        </div>

        {/* File path bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface-0">
          <span className="font-mono text-xs text-accent truncate">
            {current?.filePath}
          </span>
          <div className="flex-1" />
          <div className="flex gap-1">
            {pending.map((d, i) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setCurrentIndex(i)}
                className={
                  'w-2 h-2 rounded-full transition-colors ' +
                  (i === currentIndex ? 'bg-accent' : 'bg-surface-3 hover:bg-text-muted')
                }
                title={d.filePath.split('/').pop()}
              />
            ))}
          </div>
        </div>

        {/* Diff content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {current && (
            <DiffPreview
              key={current.id}
              filePath={current.filePath}
              originalContent={current.originalContent}
              newContent={current.newContent}
              language={current.language}
              writePreviewId={current.writePreviewId}
              status={current.status}
              onAccept={() => void acceptCurrent()}
              onReject={() => void rejectCurrent()}
            />
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-surface-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={goPrev}
              disabled={currentIndex === 0}
              className="px-3 py-1.5 text-xs rounded-md border border-border bg-surface-3 text-text-secondary hover:bg-surface-0 disabled:opacity-30 transition-colors"
            >
              &#8592; Prev
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={currentIndex >= pending.length - 1}
              className="px-3 py-1.5 text-xs rounded-md border border-border bg-surface-3 text-text-secondary hover:bg-surface-0 disabled:opacity-30 transition-colors"
            >
              Next &#8594;
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void rejectCurrent()}
              className="px-3 py-1.5 text-xs rounded-md bg-danger/20 hover:bg-danger/30 text-danger transition-colors"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => void acceptAll()}
              className="px-3 py-1.5 text-xs rounded-md border border-success/40 text-success hover:bg-success/10 transition-colors"
            >
              Accept All ({pending.length})
            </button>
            <button
              type="button"
              onClick={() => void acceptCurrent()}
              className="px-3 py-1.5 text-xs rounded-md bg-success/20 hover:bg-success/30 text-success font-medium transition-colors"
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
