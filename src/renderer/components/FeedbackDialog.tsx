/**
 * Lightweight dogfood feedback capture. Writes to the app's userData dir
 * (`kairo-feedback.md`) via IPC so validation produces a structured artifact we
 * can collect from each tester — no server, no account.
 */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../stores/app-store'
import { useToastStore } from '../stores/toast-store'

export function FeedbackDialog(): JSX.Element | null {
  const open = useAppStore((s) => s.feedbackOpen)
  const [text, setText] = useState('')
  const [rating, setRating] = useState<number>(0)
  const [submitting, setSubmitting] = useState(false)

  const close = (): void => {
    useAppStore.getState().setFeedbackOpen(false)
    setText('')
    setRating(0)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const submit = (): void => {
    const body = text.trim()
    if (!body || submitting) return
    setSubmitting(true)
    void window.kairoAPI
      .recordFeedback?.(body, rating || undefined)
      .then((res) => {
        if (res?.ok) {
          useToastStore.getState().addToast({ type: 'success', message: '已记录反馈，谢谢！' })
          close()
        } else {
          useToastStore.getState().addToast({ type: 'error', message: res?.error ?? '保存失败' })
        }
      })
      .catch(() => useToastStore.getState().addToast({ type: 'error', message: '保存失败' }))
      .finally(() => setSubmitting(false))
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-md bg-surface-1 border border-border rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-2">
          <span className="text-sm font-semibold text-text-primary">发送反馈</span>
          <button type="button" onClick={close} className="text-text-muted hover:text-text-primary text-sm px-1">&#10005;</button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">体验评分</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                className={'text-lg leading-none ' + (n <= rating ? 'text-warning' : 'text-text-muted/40 hover:text-text-muted')}
                aria-label={`${n} 星`}
              >
                ★
              </button>
            ))}
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            rows={5}
            placeholder="哪里有用？哪里别扭？Comprehension Gate 的那个问题问到点子上了吗？"
            className="w-full px-3 py-2 rounded-md bg-surface-2 border border-border text-sm text-text-primary outline-none focus:border-border-focus resize-none"
          />

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="px-3 py-1.5 text-sm rounded-md bg-surface-3 hover:bg-surface-2 text-text-secondary border border-border"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim() || submitting}
              className="px-3 py-1.5 text-sm rounded-md bg-accent hover:bg-accent-hover text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? '保存中…' : '提交'}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
