/**
 * Left sidebar: app brand, new chat, search, grouped session list,
 * workspace folder, settings entry. Collapses to an icon rail.
 */

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  GROUP_LABELS,
  groupForTimestamp,
  useAppStore,
  type DateGroup
} from '../stores/app-store'
import { useChatStore } from '../stores/chat-store'
import { FileTree } from './FileTree'
import { GitPanel } from './GitPanel'
import type { SessionFile, SessionMeta } from '../../shared/types'

interface SidebarProps {
  onNewChat: () => void | Promise<void>
  onSelectSession: (id: string) => void | Promise<void>
}

export function Sidebar({ onNewChat, onSelectSession }: SidebarProps): JSX.Element {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const toggleSettings = useAppStore((s) => s.toggleSettings)
  const sessions = useAppStore((s) => s.sessions)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const workspacePath = useAppStore((s) => s.workspacePath)
  const setWorkspacePath = useAppStore((s) => s.setWorkspacePath)
  const removeSession = useAppStore((s) => s.removeSession)
  const updateSession = useAppStore((s) => s.updateSession)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)

  const [fileTreeOpen, setFileTreeOpen] = useState(false)
  const [gitPanelOpen, setGitPanelOpen] = useState(false)

  const [contextMenu, setContextMenu] = useState<{
    sessionId: string
    x: number
    y: number
  } | null>(null)

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [contextMenu])

  const filteredGrouped = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = q
      ? sessions.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.preview ?? '').toLowerCase().includes(q)
        )
      : sessions
    const groups: Record<DateGroup, SessionMeta[]> = {
      today: [],
      yesterday: [],
      last7: [],
      older: []
    }
    for (const s of filtered) {
      groups[groupForTimestamp(s.updatedAt)].push(s)
    }
    return groups
  }, [sessions, searchQuery])

  const handleOpenFolder = async (): Promise<void> => {
    const picked = await window.kairoAPI.openFolder(workspacePath ?? undefined)
    if (picked) setWorkspacePath(picked)
  }

  const handleDelete = async (id: string): Promise<void> => {
    setContextMenu(null)
    const ok = window.confirm('Delete this conversation? This cannot be undone.')
    if (!ok) return
    await window.kairoAPI.deleteSession(id)
    removeSession(id)
    if (activeSessionId === id) {
      // Clear chat panel; caller will create a fresh session.
      useChatStore.getState().clearMessages()
    }
  }

  const handleRename = async (id: string): Promise<void> => {
    setContextMenu(null)
    const current = sessions.find((s) => s.id === id)
    const next = window.prompt('Rename conversation', current?.name ?? '')
    if (!next || next.trim().length === 0) return
    const meta = await window.kairoAPI.renameSession(id, next.trim())
    if (meta) updateSession(meta)
  }

  if (sidebarCollapsed) {
    return (
      <motion.aside
        initial={false}
        animate={{ width: 56 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="shrink-0 bg-surface-0 border-r border-border flex flex-col items-center pt-3 pb-3 gap-2 select-none titlebar-no-drag overflow-hidden"
      >
        <button
          type="button"
          onClick={toggleSidebar}
          title="Expand sidebar"
          className="w-9 h-9 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
        >
          <HamburgerIcon />
        </button>
        <button
          type="button"
          onClick={onNewChat}
          title="New chat"
          className="w-9 h-9 flex items-center justify-center rounded-md text-text-primary bg-accent hover:bg-accent-hover transition-colors"
        >
          <PlusIcon />
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={toggleSettings}
          title="Settings"
          className="w-9 h-9 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
        >
          <GearIcon />
        </button>
      </motion.aside>
    )
  }

  return (
    <motion.aside
      initial={false}
      animate={{ width: 240 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      id="kairo-sidebar"
      className="shrink-0 bg-surface-0 border-r border-border flex flex-col select-none titlebar-no-drag overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-border">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
          <span className="text-accent">✦</span>
          <span>Kairo Code</span>
        </div>
        <button
          type="button"
          onClick={toggleSidebar}
          title="Collapse sidebar"
          className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
        >
          <HamburgerIcon />
        </button>
      </div>

      {/* New chat */}
      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition-colors shadow-sm"
        >
          <PlusIcon />
          <span>New Chat</span>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pt-2">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-2 border border-border focus-within:border-border-focus transition-colors">
          <SearchIcon />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions..."
            className="flex-1 bg-transparent outline-none text-[12.5px] text-text-primary placeholder:text-text-muted"
          />
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 min-h-0 overflow-y-auto mt-2 pb-2">
        {sessions.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-text-muted text-center">
            No sessions yet.
            <br />
            Start a new chat above.
          </div>
        ) : (
          (['today', 'yesterday', 'last7', 'older'] as DateGroup[]).map((g) => {
            const items = filteredGrouped[g]
            if (items.length === 0) return null
            return (
              <div key={g} className="mt-2">
                <div className="px-3 text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                  {GROUP_LABELS[g]}
                </div>
                <ul className="mt-1">
                  {items.map((s) => (
                    <SessionItem
                      key={s.id}
                      session={s}
                      isActive={s.id === activeSessionId}
                      onSelect={() => onSelectSession(s.id)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setContextMenu({ sessionId: s.id, x: e.clientX, y: e.clientY })
                      }}
                    />
                  ))}
                </ul>
              </div>
            )
          })
        )}
      </div>

      {/* File tree */}
      {workspacePath && (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setFileTreeOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wider text-text-muted font-semibold hover:bg-surface-2 transition-colors"
          >
            <span className="text-[9px]">{fileTreeOpen ? '▾' : '▸'}</span>
            Files
          </button>
          {fileTreeOpen && (
            <div className="max-h-[240px] overflow-y-auto pb-1">
              <FileTree />
            </div>
          )}
        </div>
      )}

      {/* Git panel */}
      {workspacePath && (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setGitPanelOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wider text-text-muted font-semibold hover:bg-surface-2 transition-colors"
          >
            <span className="text-[9px]">{gitPanelOpen ? '▾' : '▸'}</span>
            Source Control
          </button>
          {gitPanelOpen && <GitPanel />}
        </div>
      )}

      {/* Workspace folder */}
      <button
        type="button"
        onClick={handleOpenFolder}
        title={workspacePath ?? 'Choose workspace folder'}
        className="flex items-center gap-2 mx-3 mb-2 px-2 py-1.5 rounded-md text-left bg-surface-2 hover:bg-surface-3 border border-border text-[12px] text-text-secondary transition-colors min-w-0"
      >
        <FolderIcon />
        <span className="truncate flex-1 font-mono">
          {workspacePath ? shortenPath(workspacePath) : 'Open folder...'}
        </span>
      </button>

      {/* Settings */}
      <button
        type="button"
        onClick={toggleSettings}
        className="flex items-center gap-2 mx-3 mb-3 px-2 py-1.5 rounded-md text-left text-text-secondary hover:text-text-primary hover:bg-surface-2 text-[12.5px] transition-colors"
      >
        <GearIcon />
        <span>Settings</span>
      </button>

      {/* Context menu */}
      {contextMenu && (
        <div
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 50 }}
          className="min-w-[140px] rounded-md bg-surface-2 border border-border shadow-xl py-1 text-[12.5px]"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => handleRename(contextMenu.sessionId)}
            className="w-full text-left px-3 py-1.5 hover:bg-surface-3 text-text-primary"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => handleDelete(contextMenu.sessionId)}
            className="w-full text-left px-3 py-1.5 hover:bg-danger/20 text-danger"
          >
            Delete
          </button>
        </div>
      )}
    </motion.aside>
  )
}

interface SessionItemProps {
  session: SessionMeta
  isActive: boolean
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

function SessionItem({
  session,
  isActive,
  onSelect,
  onContextMenu
}: SessionItemProps): JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        onContextMenu={onContextMenu}
        className={
          'group w-full text-left px-3 py-1.5 flex items-start gap-2 border-l-2 transition-colors ' +
          (isActive
            ? 'border-accent bg-surface-2 text-text-primary'
            : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-3')
        }
        title={session.preview || session.name}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[13px] truncate">{session.name}</div>
          {session.preview && (
            <div className="text-[11px] text-text-muted truncate">
              {session.preview}
            </div>
          )}
        </div>
      </button>
    </li>
  )
}

// ── Helpers / icons ────────────────────────────────────────────────────────

function shortenPath(p: string): string {
  // Show only the trailing two segments to keep the row compact.
  const segs = p.split(/[\\/]+/).filter(Boolean)
  if (segs.length <= 2) return p
  return '…/' + segs.slice(-2).join('/')
}

export function HamburgerIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
    </svg>
  )
}

export function PlusIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  )
}

export function SearchIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}

export function FolderIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" strokeLinejoin="round" />
    </svg>
  )
}

export function GearIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}

// Re-exports kept for parent component to access without importing twice.
export type { SessionFile }
