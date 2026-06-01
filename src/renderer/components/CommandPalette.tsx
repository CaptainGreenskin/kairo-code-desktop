import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from '../stores/app-store'
import { useChatStore } from '../stores/chat-store'
import { useEditorStore } from '../stores/editor-store'
import { useTerminalStore } from '../stores/terminal-store'
import { useActivityStore } from '../stores/activity-store'
import { useToastStore } from '../stores/toast-store'

interface PaletteCommand {
  id: string
  label: string
  description: string
  shortcut?: string
  category: string
  action: () => void
}

interface CommandPaletteProps {
  onNewChat: () => void
  onOpenFolder: () => void
}

export function CommandPalette({ onNewChat, onOpenFolder }: CommandPaletteProps): JSX.Element {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const pluginCommands = useAppStore((s) => s.pluginCommands)
  const close = useCallback(() => useAppStore.getState().setCommandPaletteOpen(false), [])

  const commands = useMemo<PaletteCommand[]>(
    () => [
      // Plugin-contributed commands: invoking sends the command's prompt template.
      ...pluginCommands.map((c) => ({
        id: `plugin:${c.name}`,
        label: c.name,
        description: c.description ?? 'Plugin command',
        category: 'Plugin',
        action: () => {
          close()
          const sid = useChatStore.getState().sessionId
          useChatStore.getState().addUserMessage(c.prompt)
          void window.kairoAPI.sendPrompt(sid, c.prompt).catch(() => {})
        }
      })),
      {
        id: 'new-chat',
        label: 'New Chat',
        description: 'Start a fresh conversation',
        shortcut: '⌘N',
        category: 'Session',
        action: () => { close(); onNewChat() }
      },
      {
        id: 'clear-chat',
        label: 'Clear Chat',
        description: 'Clear current conversation messages',
        category: 'Session',
        action: () => {
          close()
          const { sessionId } = useChatStore.getState()
          if (sessionId) useChatStore.getState().resetForSession(sessionId)
        }
      },
      {
        id: 'rollback-changes',
        label: '回滚最近的文件改动',
        description: 'Undo file writes/edits since the last autonomous run started',
        category: 'Safety',
        action: () => {
          close()
          const ws = useAppStore.getState().workspacePath ?? undefined
          if (!window.confirm('回滚自上次自治运行以来的所有文件改动？此操作会覆盖当前文件内容。')) return
          void window.kairoAPI
            .rollbackChanges?.(ws)
            .then((r) => {
              const { addToast } = useToastStore.getState()
              if (r?.ok && r.result) {
                addToast({ type: 'success', message: `已回滚：还原 ${r.result.restored} 个文件，删除 ${r.result.deleted} 个新建` })
              } else {
                addToast({ type: 'error', message: r?.error ?? '回滚失败' })
              }
            })
            .catch(() => useToastStore.getState().addToast({ type: 'error', message: '回滚失败' }))
        }
      },
      {
        id: 'open-workspace',
        label: 'Open Workspace',
        description: 'Choose a project folder',
        shortcut: '⌘O',
        category: 'Navigation',
        action: () => { close(); onOpenFolder() }
      },
      {
        id: 'quick-open',
        label: 'Quick Open File',
        description: 'Fuzzy-search and open a file',
        shortcut: '⌘P',
        category: 'Navigation',
        action: () => { close(); useAppStore.getState().setQuickFileOpenVisible(true) }
      },
      {
        id: 'find-in-files',
        label: 'Find in Files',
        description: 'Search text across workspace',
        shortcut: '⌘⇧F',
        category: 'Navigation',
        action: () => { close(); useAppStore.getState().setFindVisible(true) }
      },
      {
        id: 'toggle-sidebar',
        label: 'Toggle Sidebar',
        description: 'Show or hide the sidebar',
        shortcut: '⌘B',
        category: 'Panels',
        action: () => { close(); useAppStore.getState().toggleSidebar() }
      },
      {
        id: 'toggle-editor',
        label: 'Toggle Editor',
        description: 'Show or hide the code editor',
        shortcut: '⌘E',
        category: 'Panels',
        action: () => { close(); useEditorStore.getState().toggleEditor() }
      },
      {
        id: 'toggle-terminal',
        label: 'Toggle Terminal',
        description: 'Show or hide the terminal',
        shortcut: '⌘`',
        category: 'Panels',
        action: () => { close(); useTerminalStore.getState().toggleVisible() }
      },
      {
        id: 'toggle-activity',
        label: 'Toggle Activity Panel',
        description: 'Show or hide the activity log',
        shortcut: '⌘⇧A',
        category: 'Panels',
        action: () => { close(); useActivityStore.getState().togglePanel() }
      },
      {
        id: 'review-changes',
        label: 'Review Changes',
        description: 'Navigate and accept/reject pending diffs',
        shortcut: '⌘R',
        category: 'Session',
        action: () => { close(); useAppStore.getState().setReviewPanelOpen(true) }
      },
      {
        id: 'run-crew',
        label: 'Run Crew',
        description: 'Plan → implement → review with a team of agents',
        shortcut: '⌘⇧C',
        category: 'Session',
        // Crew is an inline chat turn now — switch the composer to Crew mode
        // rather than opening the legacy modal.
        action: () => { close(); useAppStore.getState().setComposerMode('crew') }
      },
      {
        id: 'code-map',
        label: 'Code Map',
        description: 'See your system as a module dependency map',
        shortcut: '⌘⇧M',
        category: 'Navigation',
        action: () => { close(); useAppStore.getState().setCodeMapOpen(true) }
      },
      {
        id: 'toggle-autopilot',
        label: 'Toggle Autopilot',
        description: 'Enable/disable multi-turn autonomous mode',
        category: 'Settings',
        action: () => { close(); useAppStore.getState().toggleAutopilot() }
      },
      {
        id: 'settings',
        label: 'Settings',
        description: 'Open settings panel',
        shortcut: '⌘,',
        category: 'Settings',
        action: () => { close(); useAppStore.getState().setSettingsOpen(true) }
      },
      {
        id: 'change-model',
        label: 'Change Model',
        description: 'Switch the AI model',
        category: 'Settings',
        action: () => { close(); useAppStore.getState().setSettingsOpen(true) }
      }
    ],
    [close, onNewChat, onOpenFolder, pluginCommands]
  )

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    const q = query.toLowerCase()
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
    )
  }, [commands, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [filtered.length])

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
        filtered[selectedIndex]?.action()
      }
    },
    [close, filtered, selectedIndex]
  )

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
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
              <SearchIcon />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a command..."
                className="flex-1 py-3 px-2 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
              />
              <kbd className="text-[10px] text-text-muted bg-surface-3 px-1.5 py-0.5 rounded border border-border font-mono">
                ESC
              </kbd>
            </div>

            <div className="max-h-80 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-text-muted">
                  No commands found
                </div>
              ) : (
                filtered.map((cmd, i) => {
                  const prevCategory = i > 0 ? filtered[i - 1]?.category : undefined
                  const showHeader = cmd.category !== prevCategory
                  return (
                    <div key={cmd.id}>
                      {showHeader && (
                        <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                          {cmd.category}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={cmd.action}
                        onMouseEnter={() => setSelectedIndex(i)}
                        className={
                          'w-full flex items-center justify-between px-4 py-2 text-left transition-colors ' +
                          (i === selectedIndex
                            ? 'bg-accent/10 text-text-primary'
                            : 'text-text-secondary hover:bg-surface-3')
                        }
                      >
                        <div>
                          <div className="text-sm font-medium">{cmd.label}</div>
                          <div className="text-xs text-text-muted mt-0.5">{cmd.description}</div>
                        </div>
                        {cmd.shortcut && (
                          <kbd className="text-[10px] text-text-muted bg-surface-3 px-1.5 py-0.5 rounded border border-border font-mono shrink-0 ml-4">
                            {cmd.shortcut}
                          </kbd>
                        )}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function SearchIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4 text-text-muted shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 4 4" strokeLinecap="round" />
    </svg>
  )
}
