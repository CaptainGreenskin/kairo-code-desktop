/**
 * Application shell. Wires the IPC event bridge into the chat store on
 * mount, composes the sidebar / chat / status panels, and orchestrates
 * session lifecycle (create / load / save / switch).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { ActivityPanel } from './components/ActivityPanel'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastContainer } from './components/Toast'
import { ChatPanel } from './components/ChatPanel'
import { NightwatchResumeBanner } from './components/NightwatchResumeBanner'
import { FindInFiles } from './components/FindInFiles'
import { QuickFileOpen } from './components/QuickFileOpen'
import { TerminalPanel } from './components/terminal/TerminalPanel'
import { CommandPalette } from './components/CommandPalette'
import { ReviewPanel } from './components/ReviewPanel'
import { CrewPanel } from './components/CrewPanel'
import { CodeMap } from './components/CodeMap'
import { FeedbackDialog } from './components/FeedbackDialog'
import { EditorPanel } from './components/editor/EditorPanel'
import { FileDropZone } from './components/FileDropZone'
import { InputBar } from './components/InputBar'
import { PermissionDialog } from './components/PermissionDialog'
import { SettingsPanel } from './components/SettingsPanel'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { setHighlighterTheme } from './lib/highlighter'
import { useAgentEvents } from './hooks/useAgentEvents'
import { useDriftWatch } from './hooks/useDriftWatch'
import { useActivityStore } from './stores/activity-store'
import { useAppStore } from './stores/app-store'
import { useTerminalStore } from './stores/terminal-store'
import { useChatStore } from './stores/chat-store'
import { useEditorStore } from './stores/editor-store'
import { usePermissionStore } from './stores/permission-store'
import type { ChatMessage } from './stores/chat-store'
import { fromSessionMessage, toSessionMessage } from './lib/session-message'
import type { SessionFile, SessionMessage } from '../shared/types'

const AUTO_NAME_LIMIT = 40

export default function App(): JSX.Element {
  useAgentEvents()
  useDriftWatch()

  const enqueuePermission = usePermissionStore((s) => s.enqueue)
  const addDroppedFile = useChatStore((s) => s.addDroppedFile)

  const sessions = useAppStore((s) => s.sessions)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const setSessions = useAppStore((s) => s.setSessions)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const addAppSession = useAppStore((s) => s.addSession)
  const updateAppSession = useAppStore((s) => s.updateSession)
  const model = useAppStore((s) => s.model)
  const workspacePath = useAppStore((s) => s.workspacePath)
  const theme = useAppStore((s) => s.theme)

  // Wire the user's theme preference to the document root so the CSS
  // variables in `index.css` swap palettes accordingly.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    setHighlighterTheme(theme)
  }, [theme])

  // Load installed plugins (commands + gate rules + MCP) on launch / workspace change.
  useEffect(() => {
    useAppStore.getState().loadPlugins()
  }, [workspacePath])

  // Hold the last-known session id we saved, so we don't write empties.
  const lastSavedRef = useRef<string | null>(null)

  // ── Session helpers ────────────────────────────────────────────────────
  const buildSessionFile = useCallback((id: string): SessionFile => {
    const chat = useChatStore.getState()
    const app = useAppStore.getState()
    const meta = app.sessions.find((s) => s.id === id)
    const now = Date.now()
    const messages: SessionMessage[] = chat.messages.map(toSessionMessage)
    return {
      id,
      name: meta?.name ?? deriveName(messages),
      createdAt: meta?.createdAt ?? now,
      updatedAt: now,
      ...(app.workspacePath ? { workspaceRoot: app.workspacePath } : {}),
      ...(meta?.model ?? app.model ? { model: meta?.model ?? app.model } : {}),
      messages
    }
  }, [])

  const persistCurrent = useCallback(async (): Promise<void> => {
    const id = useAppStore.getState().activeSessionId
    if (!id) return
    const chat = useChatStore.getState()
    if (chat.messages.length === 0) return
    const file = buildSessionFile(id)
    // If the meta name is still the default and we have a user message,
    // upgrade it.
    const existing = useAppStore.getState().sessions.find((s) => s.id === id)
    if (!existing || existing.name === 'New chat') {
      file.name = deriveName(file.messages)
    }
    await window.kairoAPI.saveSession(file)
    updateAppSession({
      id: file.id,
      name: file.name,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      messageCount: file.messages.length,
      preview: file.messages.find((m) => m.role === 'user')?.content.slice(0, 80) ?? '',
      ...(file.workspaceRoot ? { workspaceRoot: file.workspaceRoot } : {}),
      ...(file.model ? { model: file.model } : {})
    })
    lastSavedRef.current = id
  }, [buildSessionFile, updateAppSession])

  const handleNewChat = useCallback(async (): Promise<void> => {
    // Save current first (best effort).
    try {
      await persistCurrent()
    } catch {
      // ignore — saving shouldn't block creating a new chat.
    }
    const created = await window.kairoAPI.createSession({
      ...(workspacePath ? { workspaceRoot: workspacePath } : {}),
      ...(model ? { model } : {})
    })
    addAppSession({
      id: created.id,
      name: created.name,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      messageCount: 0,
      preview: '',
      ...(created.workspaceRoot ? { workspaceRoot: created.workspaceRoot } : {}),
      ...(created.model ? { model: created.model } : {})
    })
    setActiveSession(created.id)
    useChatStore.getState().resetForSession(created.id)
  }, [persistCurrent, workspacePath, model, addAppSession, setActiveSession])

  const handleSelectSession = useCallback(
    async (id: string): Promise<void> => {
      if (id === useAppStore.getState().activeSessionId) return
      try {
        await persistCurrent()
      } catch {
        // ignore
      }
      const file = await window.kairoAPI.loadSession(id)
      if (!file) {
        useChatStore.getState().setError('Could not load that session.')
        return
      }
      const chatMessages: ChatMessage[] = file.messages.map(fromSessionMessage)
      useChatStore.getState().setSessionId(file.id)
      useChatStore.getState().setMessages(chatMessages)
      setActiveSession(file.id)
    },
    [persistCurrent, setActiveSession]
  )

  // ── Mount: load sessions, ensure an active one, subscribe to permissions
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await window.kairoAPI.getSessions()
        if (cancelled) return
        setSessions(list)
        if (list.length > 0) {
          const head = list[0]
          const file = await window.kairoAPI.loadSession(head.id)
          if (cancelled) return
          if (file) {
            useChatStore.getState().setSessionId(file.id)
            useChatStore
              .getState()
              .setMessages(file.messages.map(fromSessionMessage))
            setActiveSession(file.id)
          }
        }
        // If no sessions exist yet, leave the chat in its newly-minted
        // sessionId state; we'll persist it lazily on first user turn.
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        useChatStore.getState().setError(msg)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setSessions, setActiveSession])

  // Push persisted model/provider settings to the main process on startup,
  // so the agent uses the user's chosen provider/key rather than only env vars.
  useEffect(() => {
    useAppStore.getState().syncConfigToMain()
    // Re-bind the remembered workspace so a Finder-launched app doesn't default
    // its tool working directory to "/". Also starts the file watcher.
    const ws = useAppStore.getState().workspacePath
    if (ws) void window.kairoAPI?.setWorkspace?.(ws)
  }, [])

  // Subscribe to permission requests pushed from the main process and feed
  // them into the dialog queue.
  useEffect(() => {
    if (typeof window.kairoAPI?.onPermissionRequest !== 'function') return
    const unsubscribe = window.kairoAPI.onPermissionRequest((request) => {
      enqueuePermission(request)
    })
    return unsubscribe
  }, [enqueuePermission])

  // Auto-save on every turn end. We rely on the IPC bridge directly so we
  // run after the chat store has finalized the turn.
  useEffect(() => {
    if (typeof window.kairoAPI?.onTurnEnd !== 'function') return
    const unsubscribe = window.kairoAPI.onTurnEnd(() => {
      // If we have no active session yet, materialize one using the chat's
      // local sessionId so the user's first turn is durable.
      const state = useAppStore.getState()
      const chat = useChatStore.getState()
      if (!state.activeSessionId) {
        // Adopt chat sessionId as the new active id, register, then save.
        void (async () => {
          const created = await window.kairoAPI.createSession({
            ...(state.workspacePath ? { workspaceRoot: state.workspacePath } : {}),
            ...(state.model ? { model: state.model } : {})
          })
          // Reuse the just-finished messages in the new session.
          const file: SessionFile = {
            id: created.id,
            name: deriveName(chat.messages.map(toSessionMessage)),
            createdAt: created.createdAt,
            updatedAt: Date.now(),
            ...(state.workspacePath ? { workspaceRoot: state.workspacePath } : {}),
            ...(state.model ? { model: state.model } : {}),
            messages: chat.messages.map(toSessionMessage)
          }
          await window.kairoAPI.saveSession(file)
          addAppSession({
            id: file.id,
            name: file.name,
            createdAt: file.createdAt,
            updatedAt: file.updatedAt,
            messageCount: file.messages.length,
            preview:
              file.messages.find((m) => m.role === 'user')?.content.slice(0, 80) ??
              '',
            ...(file.workspaceRoot ? { workspaceRoot: file.workspaceRoot } : {}),
            ...(file.model ? { model: file.model } : {})
          })
          setActiveSession(file.id)
          useChatStore.getState().setSessionId(file.id)
        })()
      } else {
        void persistCurrent()
      }
    })
    return unsubscribe
  }, [persistCurrent, addAppSession, setActiveSession])

  // Save on quit (best-effort) when the window is hidden / unloaded.
  useEffect(() => {
    const onBeforeUnload = (): void => {
      // Fire-and-forget; the main process keeps the IPC channel alive
      // for the duration of the unload handler.
      void persistCurrent()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [persistCurrent])

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

  const handleOpenFolder = useCallback(async () => {
    const folder = await window.kairoAPI.openFolder()
    if (folder) {
      useAppStore.getState().setWorkspacePath(folder)
    }
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (!mod) return

      // With Shift held, e.key for a letter is uppercase (e.g. 'C'), so the
      // shifted shortcuts (⌘⇧C/⌘⇧A/⌘⇧F) must be matched case-insensitively.
      switch (e.key.toLowerCase()) {
        case 'k':
          e.preventDefault()
          useAppStore.getState().toggleCommandPalette()
          break
        case 'n':
          e.preventDefault()
          void handleNewChat()
          break
        case 'b':
          e.preventDefault()
          useAppStore.getState().toggleSidebar()
          break
        case ',':
          e.preventDefault()
          useAppStore.getState().toggleSettings()
          break
        case 'o':
          e.preventDefault()
          void handleOpenFolder()
          break
        case 'a':
          if (e.shiftKey) {
            e.preventDefault()
            useActivityStore.getState().togglePanel()
          }
          break
        case 'f':
          if (e.shiftKey) {
            e.preventDefault()
            useAppStore.getState().toggleFind()
          }
          break
        case 'p':
          e.preventDefault()
          useAppStore.getState().toggleQuickFileOpen()
          break
        case 'r':
          e.preventDefault()
          useAppStore.getState().toggleReviewPanel()
          break
        case 'c':
          if (e.shiftKey) {
            e.preventDefault()
            // Crew is now an inline chat turn — switch the composer to Crew mode.
            useAppStore.getState().toggleComposerMode()
          }
          break
        case 'm':
          if (e.shiftKey) {
            e.preventDefault()
            useAppStore.getState().toggleCodeMap()
          }
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isMac, handleNewChat, handleOpenFolder])

  const editorVisible = useEditorStore((s) => s.editorVisible)
  const toggleEditor = useEditorStore((s) => s.toggleEditor)
  const activityVisible = useActivityStore((s) => s.panelVisible)
  const terminalVisible = useTerminalStore((s) => s.visible)
  const findVisible = useAppStore((s) => s.findVisible)
  const codeMapOpen = useAppStore((s) => s.codeMapOpen)

  const [editorWidth, setEditorWidth] = useState(500)
  const isDraggingRef = useRef(false)
  // Code Map dock resize removed — Map now lives in the sidebar.

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!isDraggingRef.current) return
      const sidebar = document.getElementById('kairo-sidebar')
      const sidebarW = sidebar ? sidebar.getBoundingClientRect().width : 0
      const newW = e.clientX - sidebarW
      setEditorWidth(Math.max(200, Math.min(newW, window.innerWidth - sidebarW - 360)))
    }
    const onUp = (): void => {
      isDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // Cmd+E toggles editor, Cmd+` toggles terminal, Ctrl+Tab/Cmd+W for tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (mod && e.key === 'e') {
        e.preventDefault()
        toggleEditor()
      }
      if (mod && e.key === '`') {
        e.preventDefault()
        useTerminalStore.getState().toggleVisible()
      }
      if (mod && e.key === 'w') {
        e.preventDefault()
        useEditorStore.getState().closeActiveTab()
      }
      if (e.key === 'Tab' && e.ctrlKey) {
        e.preventDefault()
        const es = useEditorStore.getState()
        if (es.openFiles.length > 1) {
          e.shiftKey ? es.prevTab() : es.nextTab()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isMac, toggleEditor])

  return (
    <div className="flex flex-col h-screen w-screen bg-surface-1 text-text-primary overflow-hidden">
      {isMac && <div className="titlebar-drag h-7 shrink-0 bg-surface-0" />}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar onNewChat={handleNewChat} onSelectSession={handleSelectSession} />

        {findVisible && (
          <div className="w-80 shrink-0">
            <FindInFiles visible={findVisible} onClose={() => useAppStore.getState().setFindVisible(false)} />
          </div>
        )}

        {editorVisible && (
          <>
            <div className="flex flex-col min-h-0" style={{ width: editorWidth }}>
              <div className="flex-1 min-h-0">
                <EditorPanel />
              </div>
              {terminalVisible && (
                <div className="h-56 shrink-0">
                  <TerminalPanel />
                </div>
              )}
            </div>
            <div
              className="w-1 cursor-col-resize bg-border hover:bg-accent transition-colors shrink-0"
              onMouseDown={() => {
                isDraggingRef.current = true
                document.body.style.cursor = 'col-resize'
                document.body.style.userSelect = 'none'
              }}
            />
          </>
        )}

        {!editorVisible && terminalVisible && (
          <div className="w-96 shrink-0 flex flex-col">
            <TerminalPanel />
          </div>
        )}

        <main className="relative flex-1 min-w-0 flex flex-col bg-surface-1">
          <ErrorBoundary title="Chat Error">
            <FileDropZone
              className="flex-1 min-h-0 flex flex-col"
              onFilesDropped={(files) => {
                for (const file of files) {
                  addDroppedFile({
                    id: `drop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    name: file.name,
                    path: file.path,
                    content: file.content,
                    size: file.size
                  })
                }
              }}
            >
              <ChatPanel />
            </FileDropZone>
            <NightwatchResumeBanner />
            <InputBar />
            <StatusBar />
            <AnimatePresence>
              <SettingsPanel />
            </AnimatePresence>
          </ErrorBoundary>
        </main>

        {activityVisible && (
          <div className="w-72 shrink-0">
            <ActivityPanel />
          </div>
        )}

        {codeMapOpen && (
          <div className="shrink-0 border-l border-border" style={{ width: 520 }}>
            <CodeMap mode="display" />
          </div>
        )}
      </div>

      <AnimatePresence>
        <PermissionDialog />
      </AnimatePresence>
      <CommandPalette onNewChat={handleNewChat} onOpenFolder={handleOpenFolder} />
      <QuickFileOpen />
      <ReviewPanel />
      {/* CrewPanel removed in V3 — crew plan/run/gate are fully inline in the chat via CrewRunBlock */}
      <FeedbackDialog />
      <ToastContainer />
    </div>
  )
}

// ── helpers ────────────────────────────────────────────────────────────────

function deriveName(messages: SessionMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')
  if (!firstUser) return 'New chat'
  const trimmed = firstUser.content.trim().replace(/\s+/g, ' ')
  if (!trimmed) return 'New chat'
  return trimmed.length > AUTO_NAME_LIMIT
    ? trimmed.slice(0, AUTO_NAME_LIMIT - 1) + '…'
    : trimmed
}
