/**
 * Prompt input.
 *
 * - Auto-grows up to a max height (then scrolls)
 * - Enter to send, Shift+Enter for newline
 * - Becomes a Stop button while a turn is in flight
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useChatStore } from '../stores/chat-store'
import { useAppStore } from '../stores/app-store'
import { useToastStore } from '../stores/toast-store'
import { useCrewRun } from '../hooks/useCrewRun'
import {
  SlashCommandMenu,
  filterCommands,
  type SlashCommand
} from './SlashCommandMenu'
import { AtMentionMenu, type FileEntry } from './AtMentionMenu'

const MAX_HEIGHT_PX = 200

interface CommandResult {
  ok: boolean
  result?: string
  error?: string
}

export function InputBar(): JSX.Element {
  const [content, setContent] = useState('')
  const [showSlash, setShowSlash] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [showAtMention, setShowAtMention] = useState(false)
  const [atQuery, setAtQuery] = useState('')
  const [atIndex, setAtIndex] = useState(0)
  const sessionId = useChatStore((s) => s.sessionId)
  const isGenerating = useChatStore((s) => s.isGenerating)
  const addUserMessage = useChatStore((s) => s.addUserMessage)
  const setError = useChatStore((s) => s.setError)
  const droppedFiles = useChatStore((s) => s.droppedFiles)
  const removeDroppedFile = useChatStore((s) => s.removeDroppedFile)
  const clearDroppedFiles = useChatStore((s) => s.clearDroppedFiles)
  const codeContext = useChatStore((s) => s.codeContext)
  const clearCodeContext = useChatStore((s) => s.clearCodeContext)
  const pastedImages = useChatStore((s) => s.pastedImages)
  const removePastedImage = useChatStore((s) => s.removePastedImage)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize the textarea to fit its content, capped at MAX_HEIGHT_PX.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT_PX) + 'px'
  }, [content])

  // Slash command detection: show menu when content starts with /
  useEffect(() => {
    if (content.startsWith('/') && !content.includes(' ') && !content.includes('\n')) {
      const matches = filterCommands(content)
      setShowSlash(matches.length > 0)
      setSlashIndex(0)
    } else {
      setShowSlash(false)
    }
  }, [content])

  // @-mention detection: look for @query at the cursor position
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const pos = el.selectionStart
    const before = content.slice(0, pos)
    const match = before.match(/@([\w.\-/]*)$/)
    if (match) {
      setShowAtMention(true)
      setAtQuery(match[1])
      setAtIndex(0)
    } else {
      setShowAtMention(false)
    }
  }, [content])

  const executeSlashCommand = useCallback(
    (cmd: SlashCommand): void => {
      setContent('')
      setShowSlash(false)
      switch (cmd.name) {
        case 'new':
          // Trigger new chat via the Cmd+N path — dispatch a synthetic keyboard event
          // or directly call the API. We use the simpler approach of dispatching through
          // the command palette's action binding.
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'n', metaKey: true, bubbles: true })
          )
          break
        case 'clear':
          useChatStore.getState().resetForSession(sessionId)
          break
        case 'model':
        case 'settings':
          useAppStore.getState().setSettingsOpen(true)
          break
        case 'crew':
          // Crew runs inline in the chat thread — switch the composer to Crew
          // mode (not the legacy modal).
          useAppStore.getState().setComposerMode('crew')
          break
        case 'workspace':
          void window.kairoAPI.openFolder().then((folder) => {
            if (folder) useAppStore.getState().setWorkspacePath(folder)
          })
          break
        case 'compact':
          void window.kairoAPI.executeCommand(sessionId, 'compact').then((raw) => {
            const res = raw as CommandResult
            if (res.ok) {
              useToastStore.getState().addToast({ type: 'success', message: 'Context compacted' })
            } else {
              useToastStore.getState().addToast({ type: 'error', message: res.error ?? 'Compaction failed' })
            }
          })
          break
        case 'export':
          void window.kairoAPI.executeCommand(sessionId, 'export').then((raw) => {
            const res = raw as CommandResult
            if (res.ok) {
              useToastStore.getState().addToast({ type: 'success', message: `Exported to ${res.result}` })
            } else if (res.error !== 'Cancelled') {
              useToastStore.getState().addToast({ type: 'error', message: res.error ?? 'Export failed' })
            }
          })
          break
        case 'help': {
          const helpText = [
            '**Available commands:**',
            '- `/new` — Start a new conversation',
            '- `/clear` — Clear current chat',
            '- `/compact` — Compress older context',
            '- `/export` — Export chat as Markdown',
            '- `/crew` — Run a multi-agent crew on a task',
            '- `/model` — Change AI model',
            '- `/settings` — Open settings',
            '- `/workspace` — Change workspace folder',
            '- `/help` — Show this help',
            '',
            '**Keyboard shortcuts:**',
            '- `⌘K` — Command palette',
            '- `⌘N` — New chat',
            '- `⌘⇧C` — Run crew',
            '- `⌘B` — Toggle sidebar',
            '- `⌘,` — Settings',
            '- `⌘O` — Open workspace'
          ].join('\n')
          addUserMessage('/help')
          useChatStore.getState().appendToken({ sessionId, turnId: 'help', delta: helpText, index: 0 })
          useChatStore.getState().finalizeTurn({ sessionId, turnId: 'help', reason: 'completed' })
          break
        }
      }
    },
    [sessionId, addUserMessage]
  )

  const handleAtSelect = useCallback(
    async (file: FileEntry): Promise<void> => {
      setShowAtMention(false)
      // Replace @query text in content
      const el = textareaRef.current
      if (el) {
        const pos = el.selectionStart
        const before = content.slice(0, pos)
        const after = content.slice(pos)
        const replaced = before.replace(/@[\w.\-/]*$/, '')
        setContent(replaced + after)
      } else {
        setContent(content.replace(/@[\w.\-/]*/, ''))
      }
      // Read file and add as dropped file chip
      try {
        const result = await window.kairoAPI.readFile(file.absolutePath)
        if (result.ok && result.content !== undefined) {
          useChatStore.getState().addDroppedFile({
            id: `at-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: file.name,
            path: file.absolutePath,
            content: result.content,
            size: result.content.length
          })
        }
      } catch { /* ignore */ }
    },
    [content]
  )

  const autopilotEnabled = useAppStore((s) => s.autopilotEnabled)
  const autopilotMaxTurns = useAppStore((s) => s.autopilotMaxTurns)
  const composerMode = useAppStore((s) => s.composerMode)
  const crewRun = useCrewRun()

  const handleSend = (): void => {
    const trimmed = content.trim()
    // Crew mode: kick off an inline crew turn instead of a single-agent prompt.
    if (composerMode === 'crew') {
      if (!trimmed) return
      crewRun.start(trimmed)
      setContent('')
      useAppStore.getState().setComposerMode('agent')
      return
    }
    if ((!trimmed && droppedFiles.length === 0 && !codeContext) || isGenerating) return
    const codePart = codeContext ? '\n\n' + codeContext : ''
    const attachments = droppedFiles
      .map(
        (f) =>
          `\n\n[Attached file: ${f.path}]\n\`\`\`\n${f.content}\n\`\`\``
      )
      .join('')
    const imageParts = pastedImages
      .map((img) => `\n\n[Pasted image: ${img.name}]\n![${img.name}](${img.dataUrl})`)
      .join('')
    let fullPrompt = trimmed + codePart + attachments + imageParts

    const chat = useChatStore.getState()
    if (chat.sessionLoaded) {
      const contextLines = chat.messages
        .slice(-10)
        .map((m) => `[${m.role}]: ${m.content.slice(0, 400)}`)
        .join('\n')
      if (contextLines) {
        fullPrompt = `[Previous conversation context]\n${contextLines}\n[End context]\n\n${fullPrompt}`
      }
      useChatStore.setState({ sessionLoaded: false })
    }

    addUserMessage(trimmed + codePart + attachments + imageParts)
    setError(null)
    setContent('')
    clearCodeContext()
    clearDroppedFiles()
    useChatStore.getState().clearPastedImages()
    if (autopilotEnabled) {
      useChatStore.getState().startAutopilot(autopilotMaxTurns)
      const ws = useAppStore.getState().workspacePath ?? undefined
      // Fresh checkpoint baseline so an unattended run can be rolled back whole.
      void window.kairoAPI.resetCheckpoint?.(ws).catch(() => {})
      // Persist the run so a crash/close can be detected & resumed on next launch.
      const now = Date.now()
      void window.kairoAPI.saveNightwatch?.(
        { active: true, sessionId, turnsRemaining: autopilotMaxTurns, startedAt: now, updatedAt: now, workspacePath: ws },
        ws
      ).catch(() => {})
    }
    void window.kairoAPI.sendPrompt(sessionId, fullPrompt).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    })
  }

  const handleStop = (): void => {
    void window.kairoAPI.abort(sessionId).catch(() => {
      // best-effort; the main process emits its own state on abort.
    })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (showAtMention) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAtIndex((i) => i + 1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAtIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        // Selection is handled by the menu's onSelect callback
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowAtMention(false)
        return
      }
    }
    if (showSlash) {
      const filtered = filterCommands(content)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex((i) => Math.min(i + 1, filtered.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        const cmd = filtered[slashIndex]
        if (cmd) executeSlashCommand(cmd)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSlash(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  const handlePaste = useCallback((e: React.ClipboardEvent): void => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          useChatStore.getState().addPastedImage({
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            dataUrl,
            name: file.name || `image.${item.type.split('/')[1] ?? 'png'}`
          })
        }
        reader.readAsDataURL(file)
      }
    }
  }, [])

  const canSend = (content.trim().length > 0 || droppedFiles.length > 0 || pastedImages.length > 0 || !!codeContext) && !isGenerating

  return (
    <div className="border-t border-border bg-surface-2 px-4 py-3">
      <div className="mx-auto max-w-4xl">
        {codeContext && (
          <div className="mb-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={clearCodeContext}
              title="Code selection from editor — click to remove"
              className="group flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/30 hover:border-danger/50 hover:bg-danger/10 transition-colors"
            >
              <CodeIcon />
              <span className="text-xs font-mono text-text-primary max-w-[300px] truncate">
                {codeContext.split('\n')[0]}
              </span>
              <span className="text-xs text-text-muted group-hover:text-danger">✕</span>
            </button>
          </div>
        )}
        {droppedFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {droppedFiles.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => removeDroppedFile(file.id)}
                title={`${file.path} (${formatSize(file.size)}) — click to remove`}
                className="group flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-3 border border-border hover:border-danger/50 hover:bg-danger/10 transition-colors"
              >
                <ChipIcon />
                <span className="text-xs font-mono text-text-primary max-w-[220px] truncate">
                  {file.name}
                </span>
                <span className="text-xs text-text-muted group-hover:text-danger">✕</span>
              </button>
            ))}
          </div>
        )}
        {pastedImages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pastedImages.map((img) => (
              <button
                key={img.id}
                type="button"
                onClick={() => removePastedImage(img.id)}
                title={`${img.name} — click to remove`}
                className="group relative w-10 h-10 rounded-md overflow-hidden border border-border hover:border-danger/50 transition-colors"
              >
                <img src={img.dataUrl} alt={img.name} className="w-full h-full object-cover" />
                <span className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                  <span className="text-white text-xs opacity-0 group-hover:opacity-100">✕</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {/* Crew mode indicator (only visible when /crew activated) */}
        {composerMode === 'crew' && (
          <div className="mb-2 flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs rounded bg-accent/20 text-accent font-medium">Crew 模式</span>
            <span className="text-xs text-text-muted">多角色协作 · 发送即启动</span>
            <button
              type="button"
              onClick={() => useAppStore.getState().setComposerMode('agent')}
              className="text-xs text-text-muted hover:text-text-primary"
            >
              取消
            </button>
          </div>
        )}

        <div className="relative flex items-end gap-2 rounded-xl bg-surface-2 border border-border input-glow transition-all duration-200 px-4 py-3">
          <AnimatePresence>
            {showSlash && (
              <SlashCommandMenu
                filter={content}
                selectedIndex={slashIndex}
                onSelect={executeSlashCommand}
                onHover={setSlashIndex}
              />
            )}
            {showAtMention && (
              <AtMentionMenu
                query={atQuery}
                selectedIndex={atIndex}
                onSelect={(f) => void handleAtSelect(f)}
                onHover={setAtIndex}
              />
            )}
          </AnimatePresence>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={handlePaste}
            placeholder="Ask anything, or type / for commands..."
            rows={1}
            className="flex-1 bg-transparent resize-none outline-none text-sm text-text-primary placeholder:text-text-muted leading-relaxed py-1 max-h-[200px]"
          />
          <button
            type="button"
            onClick={() => useAppStore.getState().toggleAutopilot()}
            title={autopilotEnabled ? `Autopilot ON (${autopilotMaxTurns} turns)` : 'Autopilot OFF'}
            className={
              'shrink-0 w-8 h-8 flex items-center justify-center rounded-md transition-colors ' +
              (autopilotEnabled
                ? 'bg-warning/20 text-warning hover:bg-warning/30'
                : 'bg-transparent text-text-muted hover:text-text-secondary hover:bg-surface-3')
            }
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </button>
          {isGenerating ? (
            <button
              type="button"
              onClick={() => {
                useChatStore.getState().stopAutopilot()
                handleStop()
              }}
              title="Stop generation"
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md bg-danger hover:bg-danger/90 text-white transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              title="Send message"
              className={
                'shrink-0 w-8 h-8 flex items-center justify-center rounded-md transition-colors ' +
                (canSend
                  ? 'bg-accent hover:bg-accent-hover text-white'
                  : 'bg-surface-3 text-text-muted cursor-not-allowed')
              }
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
        <div className="mt-1.5 px-1 text-xs text-text-muted flex justify-between">
          <span>Enter send · Shift+Enter newline · / commands · @file · ⌘K palette</span>
          {isGenerating && <span className="text-accent">Generating…</span>}
        </div>
      </div>
    </div>
  )
}

function CodeIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3 text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

function ChipIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3 text-accent"
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
