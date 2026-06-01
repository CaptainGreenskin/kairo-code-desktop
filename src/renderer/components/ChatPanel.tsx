/**
 * Scrollable chat transcript.
 *
 * Auto-scrolls to the bottom when new content lands, but only if the user
 * is already near the bottom (so reading older context doesn't yank them
 * back down on every new token).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useChatStore } from '../stores/chat-store'
import { useAppStore } from '../stores/app-store'
import { useEditorStore } from '../stores/editor-store'
import { MessageBubble } from './MessageBubble'
import { WelcomeScreen } from './WelcomeScreen'

const NEAR_BOTTOM_THRESHOLD_PX = 120

export function ChatPanel(): JSX.Element {
  const messages = useChatStore((s) => s.messages)
  const isGenerating = useChatStore((s) => s.isGenerating)
  const error = useChatStore((s) => s.error)
  const pendingDiffs = useChatStore((s) => s.pendingDiffs).filter((d) => d.status === 'pending')

  const containerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  // Track whether the user is at/near the bottom; if they scroll up we
  // stop forcing autoscroll until they return to the bottom themselves.
  const onScroll = (): void => {
    const el = containerRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distance < NEAR_BOTTOM_THRESHOLD_PX
  }

  useEffect(() => {
    if (!stickToBottomRef.current) return
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  // Show the welcome state only when we have no messages at all.
  const isEmpty = messages.length === 0

  // The pulsing thinking dot belongs in the trailing assistant bubble,
  // but if the agent says "isGenerating" before any assistant message
  // has been seeded (edge case), we surface it here so the UI is
  // never silently waiting.
  const showFallbackPending =
    isGenerating &&
    (messages.length === 0 ||
      messages[messages.length - 1].role !== 'assistant')

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto"
      >
        {isEmpty ? (
          <WelcomeScreen />
        ) : (
          <div className="py-4 flex flex-col gap-3">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {showFallbackPending && (
              <div className="flex items-center gap-1.5 px-6 py-3 text-text-secondary text-xs">
                <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <span>Thinking…</span>
              </div>
            )}
            <div className="h-4" />
          </div>
        )}
      </div>

      {pendingDiffs.length > 1 && <BatchDiffBar count={pendingDiffs.length} />}
      {error && <ErrorBanner error={error} />}
    </div>
  )
}

function BatchDiffBar({ count }: { count: number }): JSX.Element {
  const handleAcceptAll = async (): Promise<void> => {
    const diffs = useChatStore.getState().pendingDiffs.filter((d) => d.status === 'pending')
    for (const diff of diffs) {
      try {
        if (diff.writePreviewId) {
          await window.kairoAPI.approveWrite(diff.writePreviewId, true)
        } else {
          await window.kairoAPI.applyDiff(diff.filePath, diff.newContent)
        }
        useEditorStore.getState().refreshFileContent(diff.filePath, diff.newContent)
        useChatStore.getState().updatePendingDiffStatus(diff.id, 'accepted')
      } catch {
        // continue with remaining
      }
    }
  }

  const handleRejectAll = async (): Promise<void> => {
    const diffs = useChatStore.getState().pendingDiffs.filter((d) => d.status === 'pending')
    for (const diff of diffs) {
      if (diff.writePreviewId) {
        try {
          await window.kairoAPI.approveWrite(diff.writePreviewId, false)
        } catch { /* best-effort */ }
      }
      useChatStore.getState().updatePendingDiffStatus(diff.id, 'rejected')
    }
  }

  return (
    <div className="absolute top-2 right-4 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-2 border border-border shadow-lg z-10">
      <span className="text-xs text-text-secondary">
        {count} pending changes
      </span>
      <button
        type="button"
        onClick={() => void handleRejectAll()}
        className="px-2 py-0.5 text-xs rounded bg-danger/20 hover:bg-danger/30 text-danger transition-colors"
      >
        Reject All
      </button>
      <button
        type="button"
        onClick={() => void handleAcceptAll()}
        className="px-2 py-0.5 text-xs rounded bg-success/20 hover:bg-success/30 text-success transition-colors"
      >
        Accept All
      </button>
      <button
        type="button"
        onClick={() => useAppStore.getState().setReviewPanelOpen(true)}
        className="px-2 py-0.5 text-xs rounded bg-accent/20 hover:bg-accent/30 text-accent transition-colors"
      >
        Review
      </button>
    </div>
  )
}

function ErrorBanner({ error }: { error: string }): JSX.Element {
  const sessionId = useChatStore((s) => s.sessionId)
  const messages = useChatStore((s) => s.messages)
  const addUserMessage = useChatStore((s) => s.addUserMessage)
  const setError = useChatStore((s) => s.setError)
  const isGenerating = useChatStore((s) => s.isGenerating)
  const [countdown, setCountdown] = useState<number | null>(null)

  const isRateLimit = /rate.?limit|429|too many requests/i.test(error)
  const isNetwork = /network|ECONN|ETIMEDOUT|fetch failed|connection/i.test(error)
  const isDenied = /denied|reject|permission/i.test(error)

  useEffect(() => {
    if (!isRateLimit) return
    const match = error.match(/(\d+)\s*s/)
    let secs = match ? parseInt(match[1]!, 10) : 30
    setCountdown(secs)
    const interval = setInterval(() => {
      secs--
      if (secs <= 0) {
        clearInterval(interval)
        setCountdown(null)
      } else {
        setCountdown(secs)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [error, isRateLimit])

  const handleRetry = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUser || isGenerating) return
    setError(null)
    addUserMessage(lastUser.content)
    void window.kairoAPI
      .sendPrompt(sessionId, lastUser.content)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [messages, sessionId, addUserMessage, setError, isGenerating])

  return (
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 max-w-[80%] px-4 py-2 text-xs rounded-lg bg-danger/20 border border-danger/40 text-danger shadow-lg flex items-center gap-3">
      <div className="flex-1">
        {isRateLimit && countdown !== null && (
          <span className="font-mono mr-2">{countdown}s</span>
        )}
        {isDenied ? 'User rejected the tool call.' : error}
      </div>
      {(isNetwork || isRateLimit) && (
        <button
          type="button"
          onClick={handleRetry}
          disabled={isGenerating || (isRateLimit && countdown !== null && countdown > 0)}
          className="shrink-0 px-2.5 py-1 rounded bg-danger/30 hover:bg-danger/50 text-danger border border-danger/40 disabled:opacity-40 transition-colors"
        >
          Retry
        </button>
      )}
      <button
        type="button"
        onClick={() => setError(null)}
        className="shrink-0 text-danger/60 hover:text-danger"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}

