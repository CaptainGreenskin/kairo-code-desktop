/**
 * Application-level Zustand store: sessions, settings, workspace, UI flags.
 *
 * Settings are persisted to localStorage (renderer-only). Session metadata
 * is sourced from the main process via `window.kairoAPI.getSessions()` and
 * mirrored here for fast filtering / grouping.
 */

import { create } from 'zustand'
import type {
  AppSettings,
  CrewRoleConfig,
  McpServerStatus,
  ModelProviderKind,
  PermissionMode,
  SessionMeta,
  ThemeMode
} from '../../shared/types'
import { DEFAULT_PROTECTED_GLOBS } from '../../shared/comprehension-router'
import { derivePluginContributions, derivePluginAgents, type PluginCommand, type PluginManifest, type PluginMapAnnotation, type PluginDrill } from '@kairo/plugin'
import { WRITER_TOOLS } from '../../shared/crew-roles'

const SETTINGS_STORAGE_KEY = 'kairo:settings'

const DEFAULT_SETTINGS: AppSettings = {
  model: 'glm-5.1',
  apiKey: '',
  baseUrl: '',
  provider: 'openai',
  anthropicApiKey: '',
  anthropicBaseUrl: '',
  protectedGlobs: DEFAULT_PROTECTED_GLOBS,
  theme: 'dark',
  permissionMode: 'ask-every-time',
  workspacePath: undefined
}

function loadSettings(): AppSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS }
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function persistSettings(settings: AppSettings): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // ignore quota / serialization errors
  }
}

export interface AppState {
  // Sessions
  sessions: SessionMeta[]
  activeSessionId: string | null

  // Settings (mirrored from localStorage on init)
  model: string
  apiKey: string
  baseUrl: string
  provider: ModelProviderKind
  anthropicApiKey: string
  anthropicBaseUrl: string
  protectedGlobs: string[]
  theme: ThemeMode
  permissionMode: PermissionMode
  workspacePath: string | null
  /** Registered sibling service folders for the cross-repo service map. */
  serviceRoots: string[]
  /** All installed plugin manifests (for the management UI). */
  pluginManifests: PluginManifest[]
  /** Plugin names the user has disabled (persisted). */
  disabledPlugins: string[]
  /** Plugin names the user has TRUSTED to run code (MCP / hooks). Default: none. */
  trustedPlugins: string[]
  /** Slash commands contributed by ENABLED plugins. */
  pluginCommands: PluginCommand[]
  /** Crew roles contributed by ENABLED + TRUSTED plugins (agents run code). */
  pluginAgents: CrewRoleConfig[]
  /** Gate-rule globs contributed by ENABLED plugins (merged into protected set). */
  pluginProtectedGlobs: string[]
  /** Living-Map annotations contributed by ENABLED plugins. */
  pluginAnnotations: PluginMapAnnotation[]
  /** Comprehension drills contributed by ENABLED plugins. */
  pluginDrills: PluginDrill[]

  // UI
  sidebarCollapsed: boolean
  settingsOpen: boolean
  commandPaletteOpen: boolean
  searchQuery: string

  // Actions ───────────────────────────────────────────────────────────────
  setSessions: (sessions: SessionMeta[]) => void
  setActiveSession: (id: string | null) => void
  addSession: (session: SessionMeta) => void
  updateSession: (session: SessionMeta) => void
  removeSession: (id: string) => void

  setModel: (model: string) => void
  setApiKey: (apiKey: string) => void
  setBaseUrl: (baseUrl: string) => void
  setProvider: (provider: ModelProviderKind) => void
  setAnthropicApiKey: (key: string) => void
  setAnthropicBaseUrl: (url: string) => void
  setProtectedGlobs: (globs: string[]) => void
  setTheme: (theme: ThemeMode) => void
  setPermissionMode: (mode: PermissionMode) => void
  setWorkspacePath: (path: string | null) => void
  /** Registered sibling service folders (cross-repo service map). */
  addServiceRoot: (path: string) => void
  removeServiceRoot: (path: string) => void
  /** Load installed plugins (commands + gate rules) and sync their globs to main. */
  loadPlugins: () => void
  /** Enable/disable a plugin by name (affects commands + gate rules + its MCP). */
  setPluginEnabled: (name: string, enabled: boolean) => void
  /** Trust/untrust a plugin to run code (registers/removes its MCP servers). */
  setPluginTrusted: (name: string, trusted: boolean) => void
  /** Install a plugin from a source spec (local path / github:owner/repo). */
  installPlugin: (source: string) => Promise<void>
  /** Uninstall a plugin by name (removes its folder + clears enabled/trusted state). */
  uninstallPlugin: (name: string) => Promise<void>
  /** Update a plugin by re-installing from its recorded source. */
  updatePlugin: (name: string) => Promise<void>
  /** Push the current model/provider config to the main process agent. */
  syncConfigToMain: () => void

  toggleSidebar: () => void
  toggleSettings: () => void
  setSettingsOpen: (open: boolean) => void
  toggleCommandPalette: () => void
  setCommandPaletteOpen: (open: boolean) => void
  setSearchQuery: (q: string) => void
  quickFileOpenVisible: boolean
  toggleQuickFileOpen: () => void
  setQuickFileOpenVisible: (v: boolean) => void
  findVisible: boolean
  toggleFind: () => void
  setFindVisible: (v: boolean) => void
  autopilotEnabled: boolean
  autopilotMaxTurns: number
  setAutopilotEnabled: (v: boolean) => void
  toggleAutopilot: () => void
  setAutopilotMaxTurns: (n: number) => void

  mcpServers: McpServerStatus[]
  setMcpServers: (servers: McpServerStatus[]) => void
  refreshMcpServers: () => Promise<void>

  reviewPanelOpen: boolean
  setReviewPanelOpen: (open: boolean) => void
  toggleReviewPanel: () => void

  crewPanelOpen: boolean
  setCrewPanelOpen: (open: boolean) => void
  toggleCrewPanel: () => void

  codeMapOpen: boolean
  setCodeMapOpen: (open: boolean) => void
  toggleCodeMap: () => void
  /** Whether the first-run setup wizard has been completed. */
  setupDone: boolean
  setSetupDone: (done: boolean) => void
  /** Module the user asked to focus on the map (from a crew blast-radius chip). */
  focusedModule: string | null
  /** Context-aware module filter for the map (driven by chat/tool context). */
  contextModuleIds: Set<string> | null
  /** Focus a module on the docked map (opens the map if closed). */
  focusModuleOnMap: (module: string) => void
  /** Set the context modules shown on the map (null = show full graph). */
  setContextModules: (ids: string[] | null) => void
  /** Bumped whenever a gate decision is recorded, so the map re-reads the Brain. */
  decisionsRev: number
  bumpDecisions: () => void

  feedbackOpen: boolean
  setFeedbackOpen: (open: boolean) => void
  toggleFeedback: () => void

  /** Composer mode: a normal single-agent turn, or an inline crew turn. */
  composerMode: 'agent' | 'crew'
  setComposerMode: (mode: 'agent' | 'crew') => void
  toggleComposerMode: () => void
}

const initial = loadSettings()

export const useAppStore = create<AppState>((set, get) => {
  // Persist whenever a settings field mutates.
  const persist = (): void => {
    const s = get()
    persistSettings({
      model: s.model,
      apiKey: s.apiKey,
      baseUrl: s.baseUrl,
      provider: s.provider,
      anthropicApiKey: s.anthropicApiKey,
      anthropicBaseUrl: s.anthropicBaseUrl,
      protectedGlobs: s.protectedGlobs,
      theme: s.theme,
      permissionMode: s.permissionMode,
      ...(s.workspacePath ? { workspacePath: s.workspacePath } : {}),
      ...(s.serviceRoots.length > 0 ? { serviceRoots: s.serviceRoots } : {}),
      ...(s.disabledPlugins.length > 0 ? { disabledPlugins: s.disabledPlugins } : {}),
      ...(s.trustedPlugins.length > 0 ? { trustedPlugins: s.trustedPlugins } : {})
    })
  }

  const syncConfigToMain = (): void => {
    const s = get()
    // Only send fields the user actually set. Empty strings would otherwise
    // overwrite credentials supplied via the environment (.env).
    void window.kairoAPI
      ?.updateConfig({
        model: s.model,
        provider: s.provider,
        ...(s.apiKey ? { apiKey: s.apiKey } : {}),
        ...(s.baseUrl ? { baseUrl: s.baseUrl } : {}),
        ...(s.anthropicApiKey ? { anthropicApiKey: s.anthropicApiKey } : {}),
        ...(s.anthropicBaseUrl ? { anthropicBaseUrl: s.anthropicBaseUrl } : {}),
        ...((s.protectedGlobs.length > 0 || s.pluginProtectedGlobs.length > 0)
          ? { protectedGlobs: [...new Set([...s.protectedGlobs, ...s.pluginProtectedGlobs])] }
          : {}),
        // Trusted/disabled sets gate which plugins' lifecycle hooks run in main.
        trustedPlugins: s.trustedPlugins,
        disabledPlugins: s.disabledPlugins
      })
      .catch(() => {
        /* best-effort; main falls back to env vars */
      })
  }

  return {
    sessions: [],
    activeSessionId: null,

    model: initial.model,
    apiKey: initial.apiKey ?? '',
    baseUrl: initial.baseUrl ?? '',
    provider: initial.provider ?? 'openai',
    anthropicApiKey: initial.anthropicApiKey ?? '',
    anthropicBaseUrl: initial.anthropicBaseUrl ?? '',
    protectedGlobs: initial.protectedGlobs ?? DEFAULT_PROTECTED_GLOBS,
    theme: initial.theme,
    permissionMode: initial.permissionMode,
    workspacePath: initial.workspacePath ?? null,
    setupDone: !!(initial.apiKey || initial.anthropicApiKey || (typeof process !== 'undefined' && (process.env?.OPENAI_API_KEY || process.env?.ANTHROPIC_API_KEY))),
    setSetupDone: (done: boolean) => set({ setupDone: done }),
    serviceRoots: initial.serviceRoots ?? [],
    pluginManifests: [],
    disabledPlugins: initial.disabledPlugins ?? [],
    trustedPlugins: initial.trustedPlugins ?? [],
    pluginCommands: [],
    pluginAgents: [],
    pluginProtectedGlobs: [],
    pluginAnnotations: [],
    pluginDrills: [],

    sidebarCollapsed: false,
    settingsOpen: false,
    commandPaletteOpen: false,
    searchQuery: '',

    setSessions: (sessions) => {
      // Newest first, defensive sort.
      const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
      set({ sessions: sorted })
    },
    setActiveSession: (id) => set({ activeSessionId: id }),
    addSession: (session) =>
      set((s) => ({
        sessions: [session, ...s.sessions.filter((x) => x.id !== session.id)]
      })),
    updateSession: (session) =>
      set((s) => {
        const next = s.sessions.some((x) => x.id === session.id)
          ? s.sessions.map((x) => (x.id === session.id ? session : x))
          : [session, ...s.sessions]
        next.sort((a, b) => b.updatedAt - a.updatedAt)
        return { sessions: next }
      }),
    removeSession: (id) =>
      set((s) => ({
        sessions: s.sessions.filter((x) => x.id !== id),
        activeSessionId: s.activeSessionId === id ? null : s.activeSessionId
      })),

    setModel: (model) => {
      set({ model })
      persist()
      syncConfigToMain()
    },
    setApiKey: (apiKey) => {
      set({ apiKey })
      persist()
      syncConfigToMain()
    },
    setBaseUrl: (baseUrl) => {
      set({ baseUrl })
      persist()
      syncConfigToMain()
    },
    setProvider: (provider) => {
      set({ provider })
      persist()
      syncConfigToMain()
    },
    setAnthropicApiKey: (anthropicApiKey) => {
      set({ anthropicApiKey })
      persist()
      syncConfigToMain()
    },
    setAnthropicBaseUrl: (anthropicBaseUrl) => {
      set({ anthropicBaseUrl })
      persist()
      syncConfigToMain()
    },
    setProtectedGlobs: (protectedGlobs) => {
      set({ protectedGlobs })
      persist()
      syncConfigToMain()
    },
    syncConfigToMain,
    setTheme: (theme) => {
      set({ theme })
      persist()
    },
    setPermissionMode: (permissionMode) => {
      set({ permissionMode })
      persist()
    },
    setWorkspacePath: (workspacePath) => {
      set({ workspacePath })
      persist()
      // Mirror to the main process so the agent/crew run tools in this folder
      // (not the Electron CWD, which is "/" for a packaged app).
      void window.kairoAPI?.setWorkspace?.(workspacePath)
    },
    addServiceRoot: (path) => {
      set((s) => (s.serviceRoots.includes(path) ? s : { serviceRoots: [...s.serviceRoots, path] }))
      persist()
    },
    removeServiceRoot: (path) => {
      set((s) => ({ serviceRoots: s.serviceRoots.filter((r) => r !== path) }))
      persist()
    },
    loadPlugins: () => {
      const ws = get().workspacePath ?? undefined
      // Only TRUSTED plugins' MCP servers get registered (MCP commands run code).
      void window.kairoAPI?.getPlugins?.(ws, get().trustedPlugins)
        .then((r) => {
          if (!r?.ok || !r.plugins) return
          set({ pluginManifests: r.plugins })
          const { commands, protectedGlobs, annotations, drills } = derivePluginContributions(r.plugins, get().disabledPlugins)
          set({
            pluginCommands: commands,
            pluginProtectedGlobs: protectedGlobs,
            pluginAnnotations: annotations,
            pluginDrills: drills,
            pluginAgents: derivePluginAgents(r.plugins, get().disabledPlugins, get().trustedPlugins, WRITER_TOOLS)
          })
          get().syncConfigToMain() // push merged protected globs to the agent
        })
        .catch(() => {})
    },
    setPluginEnabled: (name, enabled) => {
      set((s) => ({
        disabledPlugins: enabled
          ? s.disabledPlugins.filter((n) => n !== name)
          : [...new Set([...s.disabledPlugins, name])]
      }))
      persist()
      const s = get()
      const { commands, protectedGlobs, annotations, drills } = derivePluginContributions(s.pluginManifests, s.disabledPlugins)
      set({
        pluginCommands: commands,
        pluginProtectedGlobs: protectedGlobs,
        pluginAnnotations: annotations,
        pluginDrills: drills,
        pluginAgents: derivePluginAgents(s.pluginManifests, s.disabledPlugins, s.trustedPlugins, WRITER_TOOLS)
      })
      s.syncConfigToMain()
      // MCP: disable removes that plugin's servers; enable re-registers via reload.
      const m = s.pluginManifests.find((p) => p.metadata.name === name)
      if (m) {
        if (!enabled) {
          for (const key of Object.keys(m.mcpServers)) {
            void window.kairoAPI?.removeMcpServer?.(`${name}:${key}`).catch(() => {})
          }
        } else {
          s.loadPlugins() // re-scan re-registers the plugin's MCP servers
        }
      }
    },
    setPluginTrusted: (name, trusted) => {
      set((st) => ({
        trustedPlugins: trusted
          ? [...new Set([...st.trustedPlugins, name])]
          : st.trustedPlugins.filter((n) => n !== name)
      }))
      persist()
      const s = get()
      const m = s.pluginManifests.find((p) => p.metadata.name === name)
      if (trusted) {
        s.loadPlugins() // now allowed to register this plugin's MCP servers
      } else if (m) {
        for (const key of Object.keys(m.mcpServers)) {
          void window.kairoAPI?.removeMcpServer?.(`${name}:${key}`).catch(() => {})
        }
      }
      // Untrusting also drops the plugin's agent roles from the crew library,
      // and must push the new trusted set to main (so its hooks stop running).
      if (!trusted) {
        set((st) => ({ pluginAgents: derivePluginAgents(st.pluginManifests, st.disabledPlugins, st.trustedPlugins, WRITER_TOOLS) }))
        get().syncConfigToMain()
      }
    },
    installPlugin: async (source) => {
      const ws = get().workspacePath ?? undefined
      const r = await window.kairoAPI?.installPlugin?.(source, ws)
      if (!r?.ok) throw new Error(r?.error ?? 'install failed')
      get().loadPlugins()
    },
    uninstallPlugin: async (name) => {
      const ws = get().workspacePath ?? undefined
      // Remove the plugin's MCP servers first (trusted plugins may have registered some).
      const m = get().pluginManifests.find((p) => p.metadata.name === name)
      if (m) {
        for (const key of Object.keys(m.mcpServers)) {
          void window.kairoAPI?.removeMcpServer?.(`${name}:${key}`).catch(() => {})
        }
      }
      const r = await window.kairoAPI?.uninstallPlugin?.(name, ws)
      if (!r?.ok) throw new Error(r?.error ?? 'uninstall failed')
      // Drop any lingering enabled/trusted state for the removed plugin.
      set((s) => ({
        disabledPlugins: s.disabledPlugins.filter((n) => n !== name),
        trustedPlugins: s.trustedPlugins.filter((n) => n !== name)
      }))
      persist()
      get().loadPlugins()
    },
    updatePlugin: async (name) => {
      const ws = get().workspacePath ?? undefined
      const r = await window.kairoAPI?.updatePlugin?.(name, ws)
      if (!r?.ok) throw new Error(r?.error ?? 'update failed')
      get().loadPlugins()
    },

    toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
    setSettingsOpen: (open) => set({ settingsOpen: open }),
    toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
    setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    setSearchQuery: (q) => set({ searchQuery: q }),

    quickFileOpenVisible: false,
    toggleQuickFileOpen: () => set((s) => ({ quickFileOpenVisible: !s.quickFileOpenVisible })),
    setQuickFileOpenVisible: (v) => set({ quickFileOpenVisible: v }),

    findVisible: false,
    toggleFind: () => set((s) => ({ findVisible: !s.findVisible })),
    setFindVisible: (v) => set({ findVisible: v }),

    autopilotEnabled: false,
    autopilotMaxTurns: 5,
    setAutopilotEnabled: (v) => {
      set({ autopilotEnabled: v })
      // Tell main so it can auto-approve allowlisted safe bash while unattended.
      void window.kairoAPI?.setAutopilotMode?.(v).catch(() => {})
    },
    toggleAutopilot: () => set((s) => ({ autopilotEnabled: !s.autopilotEnabled })),
    setAutopilotMaxTurns: (n) => {
      set({ autopilotMaxTurns: Math.max(1, Math.min(n, 20)) })
      persist()
    },

    mcpServers: [],
    setMcpServers: (servers) => set({ mcpServers: servers }),
    refreshMcpServers: async () => {
      try {
        const servers = await window.kairoAPI.getMcpServers()
        set({ mcpServers: servers })
      } catch { /* ignore */ }
    },

    reviewPanelOpen: false,
    setReviewPanelOpen: (open) => set({ reviewPanelOpen: open }),
    toggleReviewPanel: () => set((s) => ({ reviewPanelOpen: !s.reviewPanelOpen })),

    crewPanelOpen: false,
    setCrewPanelOpen: (open) => set({ crewPanelOpen: open }),
    toggleCrewPanel: () => set((s) => ({ crewPanelOpen: !s.crewPanelOpen })),

    codeMapOpen: false,
    setCodeMapOpen: (open) => set({ codeMapOpen: open }),
    toggleCodeMap: () => set((s) => {
      const next = !s.codeMapOpen
      return { codeMapOpen: next, ...(next && s.sidebarCollapsed ? { sidebarCollapsed: false } : {}) }
    }),
    focusedModule: null,
    contextModuleIds: null as Set<string> | null,
    focusModuleOnMap: (module) => set({ focusedModule: module, codeMapOpen: true }),
    setContextModules: (ids: string[] | null) => set({ contextModuleIds: ids ? new Set(ids) : null }),
    decisionsRev: 0,
    bumpDecisions: () => set((s) => ({ decisionsRev: s.decisionsRev + 1 })),

    feedbackOpen: false,
    setFeedbackOpen: (open) => set({ feedbackOpen: open }),
    toggleFeedback: () => set((s) => ({ feedbackOpen: !s.feedbackOpen })),

    composerMode: 'agent',
    setComposerMode: (composerMode) => set({ composerMode }),
    toggleComposerMode: () => set((s) => ({ composerMode: s.composerMode === 'agent' ? 'crew' : 'agent' }))
  }
})

export const getAppStore = (): AppState => useAppStore.getState()

// ── Date grouping helpers used by the sidebar ──────────────────────────────

export type DateGroup = 'today' | 'yesterday' | 'last7' | 'older'

export function groupForTimestamp(ts: number, now: number = Date.now()): DateGroup {
  const startOf = (d: Date): Date => {
    const c = new Date(d)
    c.setHours(0, 0, 0, 0)
    return c
  }
  const today = startOf(new Date(now))
  const targetDay = startOf(new Date(ts))
  const dayMs = 24 * 60 * 60 * 1000
  const diffDays = Math.round((today.getTime() - targetDay.getTime()) / dayMs)
  if (diffDays <= 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays <= 7) return 'last7'
  return 'older'
}

export const GROUP_LABELS: Record<DateGroup, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 days',
  older: 'Older'
}
