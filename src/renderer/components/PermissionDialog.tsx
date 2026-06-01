import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { usePermissionStore } from '../stores/permission-store'
import type { PermissionVerdict } from '../../shared/types'

/** Wall-clock approval window enforced by the main process (see permissions.ts). */
const APPROVAL_TIMEOUT_MS = 30_000

/**
 * Modal that surfaces tool-permission requests from the agent. Shows the
 * tool name, formatted arguments, and three actions: Allow (one-shot),
 * Deny, and Always Allow (session-scoped).
 *
 * Renders nothing when the queue is empty. A countdown indicator mirrors
 * the main-process auto-deny timeout.
 */
export function PermissionDialog(): JSX.Element | null {
  const head = usePermissionStore((s) => s.queue[0])
  const queueLength = usePermissionStore((s) => s.queue.length)
  const resolve = usePermissionStore((s) => s.resolve)

  const [submitting, setSubmitting] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(Math.floor(APPROVAL_TIMEOUT_MS / 1000))

  // Reset and tick the countdown whenever a fresh request takes the head.
  useEffect(() => {
    if (!head) return
    setSubmitting(false)
    setSecondsLeft(Math.floor(APPROVAL_TIMEOUT_MS / 1000))
    const start = Date.now()
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - start
      const remaining = Math.max(0, Math.ceil((APPROVAL_TIMEOUT_MS - elapsed) / 1000))
      setSecondsLeft(remaining)
    }, 250)
    return () => window.clearInterval(interval)
  }, [head?.toolCallId])

  const formattedArgs = useMemo(() => {
    if (!head) return ''
    try {
      return JSON.stringify(head.args, null, 2)
    } catch {
      return String(head.args)
    }
  }, [head])

  if (!head) return null

  const handle = async (verdict: PermissionVerdict): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    try {
      await resolve(verdict)
    } catch {
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-dialog-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="w-full max-w-lg mx-4 rounded-xl border border-border bg-surface-2 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-warning">
              Approval required
            </div>
            <h2
              id="permission-dialog-title"
              className="mt-1 text-lg font-semibold text-text-primary"
            >
              {head.toolName}
            </h2>
          </div>
          <div className="text-right">
            <div className="text-xs text-text-secondary">auto-deny in</div>
            <div className="font-mono text-base text-text-primary">{secondsLeft}s</div>
            {queueLength > 1 ? (
              <div className="mt-1 text-[11px] text-text-muted">
                +{queueLength - 1} queued
              </div>
            ) : null}
          </div>
        </header>

        <div className="px-6 py-4 space-y-4">
          {head.reason ? (
            <p className="text-sm text-text-secondary leading-relaxed">{head.reason}</p>
          ) : null}

          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              Arguments
            </div>
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-text-primary font-mono whitespace-pre-wrap break-words">
              {formattedArgs}
            </pre>
          </div>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => handle('deny')}
            disabled={submitting}
            className="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white transition hover:bg-danger/90 disabled:opacity-50"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => handle('allow-session')}
            disabled={submitting}
            className="rounded-md border border-border bg-surface-3 px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-2 disabled:opacity-50"
          >
            Always Allow
          </button>
          <button
            type="button"
            onClick={() => handle('allow')}
            disabled={submitting}
            autoFocus
            className="rounded-md bg-success px-4 py-2 text-sm font-semibold text-white transition hover:bg-success/90 disabled:opacity-50"
          >
            Allow
          </button>
        </footer>
      </motion.div>
    </motion.div>
  )
}
