/**
 * Settings panel.
 *
 * Renders as an overlay covering the chat area. Captures model, API key,
 * base URL, theme, and permission mode. Persistence is delegated to the
 * app store (which writes through to localStorage).
 */

import { useEffect, useState } from 'react'
import { Button } from './ui/Button'
import { motion } from 'framer-motion'
import { useAppStore } from '../stores/app-store'
import { useToastStore } from '../stores/toast-store'
import type {
  McpServerConfig,
  McpServerStatus,
  ModelProviderKind,
  PermissionMode,
  ThemeMode
} from '../../shared/types'
import type { Marketplace, MarketplaceEntry } from '@kairo/plugin'
import {
  ANTHROPIC_MODEL_PRESETS,
  OPENAI_MODEL_PRESETS,
  defaultModelFor,
  presetsFor
} from '../lib/model-presets'

export function SettingsPanel(): JSX.Element | null {
  const open = useAppStore((s) => s.settingsOpen)
  const setOpen = useAppStore((s) => s.setSettingsOpen)

  const model = useAppStore((s) => s.model)
  const apiKey = useAppStore((s) => s.apiKey)
  const baseUrl = useAppStore((s) => s.baseUrl)
  const provider = useAppStore((s) => s.provider)
  const anthropicApiKey = useAppStore((s) => s.anthropicApiKey)
  const anthropicBaseUrl = useAppStore((s) => s.anthropicBaseUrl)
  const theme = useAppStore((s) => s.theme)
  const permissionMode = useAppStore((s) => s.permissionMode)
  const protectedGlobs = useAppStore((s) => s.protectedGlobs)
  const setProtectedGlobs = useAppStore((s) => s.setProtectedGlobs)

  const setModel = useAppStore((s) => s.setModel)
  const setApiKey = useAppStore((s) => s.setApiKey)
  const setBaseUrl = useAppStore((s) => s.setBaseUrl)
  const setProvider = useAppStore((s) => s.setProvider)
  const setAnthropicApiKey = useAppStore((s) => s.setAnthropicApiKey)
  const setAnthropicBaseUrl = useAppStore((s) => s.setAnthropicBaseUrl)
  const setTheme = useAppStore((s) => s.setTheme)
  const setPermissionMode = useAppStore((s) => s.setPermissionMode)

  const autopilotEnabled = useAppStore((s) => s.autopilotEnabled)
  const autopilotMaxTurns = useAppStore((s) => s.autopilotMaxTurns)
  const setAutopilotEnabled = useAppStore((s) => s.setAutopilotEnabled)
  const setAutopilotMaxTurns = useAppStore((s) => s.setAutopilotMaxTurns)
  const workspacePath = useAppStore((s) => s.workspacePath)
  const mcpServers = useAppStore((s) => s.mcpServers)
  const refreshMcpServers = useAppStore((s) => s.refreshMcpServers)

  const [draft, setDraft] = useState({
    model,
    apiKey,
    baseUrl,
    provider,
    anthropicApiKey,
    anthropicBaseUrl,
    protectedGlobs: protectedGlobs.join('\n'),
    theme,
    permissionMode
  })
  const [showApiKey, setShowApiKey] = useState(false)
  const [mcpForm, setMcpForm] = useState<{ name: string; transport: 'stdio' | 'sse'; command: string; args: string; url: string }>({
    name: '', transport: 'stdio', command: '', args: '', url: ''
  })
  const [showMcpForm, setShowMcpForm] = useState(false)

  useEffect(() => {
    if (open) {
      setDraft({ model, apiKey, baseUrl, provider, anthropicApiKey, anthropicBaseUrl, protectedGlobs: protectedGlobs.join('\n'), theme, permissionMode })
      setShowApiKey(false)
      void refreshMcpServers()
    }
  }, [open, model, apiKey, baseUrl, provider, anthropicApiKey, anthropicBaseUrl, protectedGlobs, theme, permissionMode, refreshMcpServers])

  if (!open) return null

  const presets = presetsFor(draft.provider)
  const isCustomModel = !presets.includes(draft.model)

  const handleSave = (): void => {
    const fallbackModel = defaultModelFor(draft.provider)
    setProvider(draft.provider)
    setModel(draft.model.trim() || fallbackModel)
    setApiKey(draft.apiKey)
    setBaseUrl(draft.baseUrl)
    setAnthropicApiKey(draft.anthropicApiKey)
    setAnthropicBaseUrl(draft.anthropicBaseUrl)
    setProtectedGlobs(draft.protectedGlobs.split('\n').map((g) => g.trim()).filter(Boolean))
    setTheme(draft.theme)
    setPermissionMode(draft.permissionMode)
    useToastStore.getState().addToast({ type: 'success', message: 'Settings saved' })
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="absolute inset-0 z-30 flex items-stretch justify-center bg-black/60 backdrop-blur-sm"
    >
      <motion.div
        initial={{ x: -24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: -24, opacity: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="w-full max-w-2xl my-8 mx-4 flex flex-col rounded-2xl bg-surface-1 border border-border shadow-modal overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Settings</h2>
            <p className="text-[11.5px] text-text-muted">
              Stored locally on this device.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-2"
            title="Close"
            aria-label="Close settings"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Provider */}
          <Section title="Provider" subtitle="Choose the model backend. Switching resets the model presets.">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { value: 'openai' as ModelProviderKind, label: 'OpenAI-compatible', desc: 'GLM, OpenAI, DeepSeek, Qwen…' },
                  { value: 'anthropic' as ModelProviderKind, label: 'Anthropic', desc: 'Claude Opus / Sonnet / Haiku' }
                ]
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    setDraft((d) => {
                      if (d.provider === opt.value) return d
                      const nextPresets = opt.value === 'anthropic' ? ANTHROPIC_MODEL_PRESETS : OPENAI_MODEL_PRESETS
                      return { ...d, provider: opt.value, model: nextPresets[0] }
                    })
                  }
                  className={
                    'text-left px-3 py-2 rounded-md border transition-colors ' +
                    (draft.provider === opt.value
                      ? 'bg-accent/10 border-accent/50'
                      : 'bg-surface-2 border-border hover:border-text-muted')
                  }
                >
                  <div className="text-sm text-text-primary">{opt.label}</div>
                  <div className="text-[11.5px] text-text-muted">{opt.desc}</div>
                </button>
              ))}
            </div>
          </Section>

          {/* Model */}
          <Section title="Model" subtitle="Select a model preset or enter a custom identifier.">
            <div className="space-y-2">
              <select
                value={isCustomModel ? '__custom__' : draft.model}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '__custom__') {
                    setDraft((d) => ({ ...d, model: '' }))
                  } else {
                    setDraft((d) => ({ ...d, model: v }))
                  }
                }}
                className="w-full px-3 py-2 rounded-md bg-surface-2 border border-border text-sm text-text-primary outline-none focus:border-border-focus"
              >
                {presets.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value="__custom__">Custom…</option>
              </select>
              {isCustomModel && (
                <input
                  value={draft.model}
                  onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
                  placeholder="e.g. qwen2.5-coder-32b-instruct"
                  className="w-full px-3 py-2 rounded-md bg-surface-2 border border-border text-sm text-text-primary outline-none focus:border-border-focus font-mono"
                />
              )}
            </div>
          </Section>

          {/* API Configuration */}
          <Section
            title="API Configuration"
            subtitle={
              draft.provider === 'anthropic'
                ? 'Anthropic API key. Leave Base URL blank unless using a proxy/gateway.'
                : 'OpenAI-compatible endpoint. Leave Base URL blank for the default endpoint.'
            }
          >
            <label className="block">
              <span className="text-sm text-text-secondary">API Key</span>
              <div className="mt-1 flex items-stretch gap-1">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={draft.provider === 'anthropic' ? draft.anthropicApiKey : draft.apiKey}
                  onChange={(e) =>
                    setDraft((d) =>
                      d.provider === 'anthropic'
                        ? { ...d, anthropicApiKey: e.target.value }
                        : { ...d, apiKey: e.target.value }
                    )
                  }
                  placeholder={draft.provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
                  spellCheck={false}
                  autoComplete="off"
                  className="flex-1 px-3 py-2 rounded-md bg-surface-2 border border-border text-sm text-text-primary outline-none focus:border-border-focus font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  className="px-3 rounded-md bg-surface-3 hover:bg-surface-2 text-sm text-text-secondary"
                  title={showApiKey ? 'Hide' : 'Show'}
                >
                  {showApiKey ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>
            <label className="block mt-3">
              <span className="text-sm text-text-secondary">Base URL</span>
              <input
                value={draft.provider === 'anthropic' ? draft.anthropicBaseUrl : draft.baseUrl}
                onChange={(e) =>
                  setDraft((d) =>
                    d.provider === 'anthropic'
                      ? { ...d, anthropicBaseUrl: e.target.value }
                      : { ...d, baseUrl: e.target.value }
                  )
                }
                placeholder={
                  draft.provider === 'anthropic'
                    ? 'https://api.anthropic.com'
                    : 'https://api.openai.com/v1'
                }
                spellCheck={false}
                autoComplete="off"
                className="mt-1 w-full px-3 py-2 rounded-md bg-surface-2 border border-border text-sm text-text-primary outline-none focus:border-border-focus font-mono"
              />
            </label>
          </Section>

          {/* Theme */}
          <Section title="Theme" subtitle="System follows the OS preference.">
            <div className="grid grid-cols-3 gap-2">
              {(['dark', 'light', 'system'] as ThemeMode[]).map((t) => (
                <ChoiceTile
                  key={t}
                  active={draft.theme === t}
                  label={t === 'dark' ? 'Dark' : t === 'light' ? 'Light' : 'System'}
                  onClick={() => setDraft((d) => ({ ...d, theme: t }))}
                />
              ))}
            </div>
          </Section>

          {/* Permission mode */}
          <Section
            title="Permission Mode"
            subtitle="Control how the agent asks for tool approval."
          >
            <div className="grid grid-cols-1 gap-2">
              {(
                [
                  {
                    value: 'ask-every-time' as PermissionMode,
                    label: 'Ask every time',
                    desc: 'Prompt before every write or system tool.'
                  },
                  {
                    value: 'auto-approve-read' as PermissionMode,
                    label: 'Auto-approve read operations',
                    desc: 'Read tools run silently; writes still ask.'
                  }
                ]
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({ ...d, permissionMode: opt.value }))
                  }
                  className={
                    'text-left px-3 py-2 rounded-md border transition-colors ' +
                    (draft.permissionMode === opt.value
                      ? 'bg-accent/10 border-accent/50'
                      : 'bg-surface-2 border-border hover:border-text-muted')
                  }
                >
                  <div className="text-sm text-text-primary">{opt.label}</div>
                  <div className="text-[11.5px] text-text-muted">{opt.desc}</div>
                </button>
              ))}
            </div>
          </Section>

          {/* Crew protected regions (Comprehension Router) */}
          <Section
            title="Crew Protected Regions"
            subtitle="Invariant path globs. A crew auto-runs ordinary edits, but must ask before writing here. One glob per line."
          >
            <textarea
              value={draft.protectedGlobs}
              onChange={(e) => setDraft((d) => ({ ...d, protectedGlobs: e.target.value }))}
              rows={5}
              spellCheck={false}
              placeholder={'**/auth/**\n**/payment*/**\n**/.env*'}
              className="w-full px-3 py-2 rounded-md bg-surface-2 border border-border text-sm text-text-primary outline-none focus:border-border-focus font-mono resize-none"
            />
          </Section>

          {/* Plugins */}
          <Section title="Plugins" subtitle="CC-compatible plugins from .kairo/plugins. Contribute commands, agents, MCP servers, hooks and gate rules.">
            <PluginList />
          </Section>

          {/* Marketplaces */}
          <Section title="Marketplaces" subtitle="Register a plugin index (local path / github) to discover and one-click install plugins.">
            <MarketplaceManager />
          </Section>

          {/* Autopilot */}
          <Section title="Autopilot" subtitle="Let the agent execute multiple turns without pausing.">
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autopilotEnabled}
                  onChange={(e) => setAutopilotEnabled(e.target.checked)}
                  className="w-4 h-4 rounded accent-accent"
                />
                <span className="text-sm text-text-primary">Enable Autopilot</span>
              </label>
              <label className="block">
                <span className="text-sm text-text-secondary">Max turns per run</span>
                <div className="flex items-center gap-3 mt-1">
                  <input
                    type="range"
                    min={1}
                    max={20}
                    value={autopilotMaxTurns}
                    onChange={(e) => setAutopilotMaxTurns(Number(e.target.value))}
                    className="flex-1 accent-accent"
                  />
                  <span className="text-sm font-mono text-text-primary w-6 text-center">
                    {autopilotMaxTurns}
                  </span>
                </div>
              </label>
            </div>
          </Section>

          {/* MCP Servers */}
          <Section title="MCP Servers" subtitle="Connect external tool servers via the Model Context Protocol.">
            <div className="space-y-2">
              {mcpServers.length === 0 && !showMcpForm && (
                <p className="text-sm text-text-muted">No MCP servers configured.</p>
              )}
              {mcpServers.map((server) => (
                <McpServerRow
                  key={server.name}
                  server={server}
                  onToggle={async () => {
                    if (server.enabled) {
                      await window.kairoAPI.disableMcpServer(server.name)
                    } else {
                      await window.kairoAPI.enableMcpServer(server.name)
                    }
                    void refreshMcpServers()
                  }}
                  onRemove={async () => {
                    await window.kairoAPI.removeMcpServer(server.name)
                    void refreshMcpServers()
                    useToastStore.getState().addToast({ type: 'info', message: `Removed ${server.name}` })
                  }}
                />
              ))}
              {showMcpForm ? (
                <div className="rounded-md border border-border bg-surface-2 p-3 space-y-2">
                  <input
                    value={mcpForm.name}
                    onChange={(e) => setMcpForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Server name"
                    className="w-full px-2 py-1.5 rounded bg-surface-0 border border-border text-sm text-text-primary outline-none focus:border-border-focus font-mono"
                  />
                  <div className="flex gap-2">
                    <ChoiceTile active={mcpForm.transport === 'stdio'} label="stdio" onClick={() => setMcpForm((f) => ({ ...f, transport: 'stdio' }))} />
                    <ChoiceTile active={mcpForm.transport === 'sse'} label="SSE" onClick={() => setMcpForm((f) => ({ ...f, transport: 'sse' }))} />
                  </div>
                  {mcpForm.transport === 'stdio' ? (
                    <>
                      <input
                        value={mcpForm.command}
                        onChange={(e) => setMcpForm((f) => ({ ...f, command: e.target.value }))}
                        placeholder="Command (e.g. npx)"
                        className="w-full px-2 py-1.5 rounded bg-surface-0 border border-border text-sm text-text-primary outline-none focus:border-border-focus font-mono"
                      />
                      <input
                        value={mcpForm.args}
                        onChange={(e) => setMcpForm((f) => ({ ...f, args: e.target.value }))}
                        placeholder="Arguments (space-separated)"
                        className="w-full px-2 py-1.5 rounded bg-surface-0 border border-border text-sm text-text-primary outline-none focus:border-border-focus font-mono"
                      />
                    </>
                  ) : (
                    <input
                      value={mcpForm.url}
                      onChange={(e) => setMcpForm((f) => ({ ...f, url: e.target.value }))}
                      placeholder="Server URL (e.g. http://localhost:3100/sse)"
                      className="w-full px-2 py-1.5 rounded bg-surface-0 border border-border text-sm text-text-primary outline-none focus:border-border-focus font-mono"
                    />
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!mcpForm.name.trim()) return
                        const config: McpServerConfig = {
                          name: mcpForm.name.trim(),
                          transport: mcpForm.transport,
                          enabled: true,
                          ...(mcpForm.transport === 'stdio'
                            ? { command: mcpForm.command.trim(), args: mcpForm.args.trim().split(/\s+/).filter(Boolean) }
                            : { url: mcpForm.url.trim() })
                        }
                        const result = await window.kairoAPI.addMcpServer(config)
                        if (result.ok) {
                          useToastStore.getState().addToast({ type: 'success', message: `Added ${config.name}` })
                          setMcpForm({ name: '', transport: 'stdio', command: '', args: '', url: '' })
                          setShowMcpForm(false)
                          void refreshMcpServers()
                        } else {
                          useToastStore.getState().addToast({ type: 'error', message: result.error ?? 'Failed to add server' })
                        }
                      }}
                      className="px-3 py-1 text-xs rounded-md bg-accent hover:bg-accent-hover text-white"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowMcpForm(false)}
                      className="px-3 py-1 text-xs rounded-md bg-surface-3 hover:bg-surface-0 text-text-secondary border border-border"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowMcpForm(true)}
                  className="text-sm text-accent hover:text-accent-hover"
                >
                  + Add Server
                </button>
              )}
            </div>
          </Section>

          {/* Workspace */}
          <Section title="Workspace" subtitle="Root folder for file operations.">
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-text-primary truncate flex-1">
                {workspacePath || 'Not set'}
              </span>
              <button
                type="button"
                onClick={async () => {
                  const folder = await window.kairoAPI.openFolder()
                  if (folder) {
                    useAppStore.getState().setWorkspacePath(folder)
                    useToastStore.getState().addToast({ type: 'success', message: 'Workspace updated' })
                  }
                }}
                className="px-3 py-1 text-xs rounded-md bg-surface-3 hover:bg-surface-0 text-text-primary border border-border"
              >
                Change
              </button>
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-border bg-surface-0">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button variant="primary" onClick={handleSave}>
            Save
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

interface SectionProps {
  title: string
  subtitle?: string
  children: React.ReactNode
}

function Section({ title, subtitle, children }: SectionProps): JSX.Element {
  return (
    <section>
      <div className="mb-2">
        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
        {subtitle && (
          <p className="text-[11.5px] text-text-muted leading-relaxed">{subtitle}</p>
        )}
      </div>
      {children}
    </section>
  )
}

interface ChoiceTileProps {
  active: boolean
  label: string
  onClick: () => void
}

function ChoiceTile({ active, label, onClick }: ChoiceTileProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-3 py-2 rounded-md text-sm border transition-colors ' +
        (active
          ? 'bg-accent/10 border-accent/50 text-text-primary'
          : 'bg-surface-2 border-border text-text-secondary hover:border-text-muted')
      }
    >
      {label}
    </button>
  )
}

function McpServerRow({
  server,
  onToggle,
  onRemove
}: {
  server: McpServerStatus
  onToggle: () => void
  onRemove: () => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface-2 border border-border">
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${server.connected ? 'bg-success' : 'bg-danger'}`}
        title={server.connected ? 'Connected' : 'Disconnected'}
      />
      <span className="text-sm font-mono text-text-primary truncate flex-1">
        {server.name}
      </span>
      <span className="text-xs text-text-muted">
        {server.transport} · {server.toolCount} tools
      </span>
      {server.error && (
        <span className="text-xs text-danger truncate max-w-[120px]" title={server.error}>
          {server.error}
        </span>
      )}
      <button
        type="button"
        onClick={onToggle}
        className={`text-xs px-2 py-0.5 rounded border ${
          server.enabled
            ? 'text-success border-success/30 hover:bg-success/10'
            : 'text-text-muted border-border hover:bg-surface-3'
        }`}
      >
        {server.enabled ? 'On' : 'Off'}
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="text-xs text-danger hover:text-danger/80 px-1"
        title="Remove server"
      >
        ✕
      </button>
    </div>
  )
}

/** Install-from-source field: paste a local path or `github:owner/repo` spec. */
function PluginInstall(): JSX.Element {
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)

  const install = async (): Promise<void> => {
    const spec = source.trim()
    if (!spec || busy) return
    setBusy(true)
    try {
      await useAppStore.getState().installPlugin(spec)
      useToastStore.getState().addToast({ type: 'success', message: `已安装插件：${spec}` })
      setSource('')
    } catch (err) {
      useToastStore.getState().addToast({
        type: 'error',
        message: `安装失败：${err instanceof Error ? err.message : String(err)}`
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={source}
        onChange={(e) => setSource(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void install()
        }}
        placeholder="本地路径 或 github:owner/repo[#ref][/subdir]"
        disabled={busy}
        data-testid="plugin-install-source"
        className="flex-1 text-sm px-2 py-1 rounded border border-border bg-surface-1 text-text-primary placeholder:text-text-muted disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => void install()}
        disabled={busy || !source.trim()}
        data-testid="plugin-install-button"
        className="text-xs px-2.5 py-1 rounded border border-border text-text-secondary hover:text-text-primary disabled:opacity-40"
      >
        {busy ? '安装中…' : '安装'}
      </button>
    </div>
  )
}

/** Installed-plugin manager: list each plugin, what it contributes, enable/disable, trust. */
function PluginList(): JSX.Element {
  const manifests = useAppStore((s) => s.pluginManifests)
  const disabled = useAppStore((s) => s.disabledPlugins)
  const trusted = useAppStore((s) => s.trustedPlugins)

  const refresh = (
    <button
      type="button"
      onClick={() => useAppStore.getState().loadPlugins()}
      className="text-xs px-2 py-0.5 rounded border border-border text-text-secondary hover:text-text-primary"
    >
      刷新
    </button>
  )

  return (
    <div className="space-y-2" data-testid="plugin-list">
      <PluginInstall />
      {manifests.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <span>未发现插件。放到 工作区/.kairo/plugins/&lt;name&gt;/（含 .claude-plugin/plugin.json），或从上方安装。</span>
          {refresh}
        </div>
      ) : (
        <>
          <div className="flex justify-end">{refresh}</div>
          {manifests.map((p) => {
            const off = disabled.includes(p.metadata.name)
            const mcpCount = Object.keys(p.mcpServers).length
            const isTrusted = trusted.includes(p.metadata.name)
            // The code-running components a plugin contributes (gated by trust).
            const codeBits: string[] = [
              ...(mcpCount > 0 ? [`${mcpCount} 个 MCP 服务`] : []),
              ...(p.agents.length > 0 ? [`${p.agents.length} 个 agents`] : [])
            ]
            return (
              <div key={p.metadata.name} className="rounded-md border border-border bg-surface-2 px-3 py-2">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!off}
                      onChange={(e) => useAppStore.getState().setPluginEnabled(p.metadata.name, e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-accent"
                      data-testid={`plugin-toggle-${p.metadata.name}`}
                    />
                    <span className="text-sm font-medium text-text-primary">{p.metadata.name}</span>
                  </label>
                  {p.metadata.version && <span className="text-xs text-text-muted font-mono">v{p.metadata.version}</span>}
                  <span className="ml-auto text-xs text-text-muted">
                    {p.commands.length} 命令 · {p.agents.length} agents · {mcpCount} MCP · {p.gateRules.length} 规则
                  </span>
                  {p.installedFrom && (
                    <button
                      type="button"
                      onClick={() => {
                        void useAppStore
                          .getState()
                          .updatePlugin(p.metadata.name)
                          .then(() => useToastStore.getState().addToast({ type: 'success', message: `已更新 ${p.metadata.name}` }))
                          .catch((e: unknown) =>
                            useToastStore.getState().addToast({ type: 'error', message: `更新失败：${e instanceof Error ? e.message : String(e)}` })
                          )
                      }}
                      data-testid={`plugin-update-${p.metadata.name}`}
                      className="text-xs px-1.5 py-0.5 rounded border border-border text-text-secondary hover:text-text-primary"
                    >
                      更新
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      void useAppStore
                        .getState()
                        .uninstallPlugin(p.metadata.name)
                        .then(() => useToastStore.getState().addToast({ type: 'info', message: `已卸载 ${p.metadata.name}` }))
                        .catch((e: unknown) =>
                          useToastStore.getState().addToast({ type: 'error', message: `卸载失败：${e instanceof Error ? e.message : String(e)}` })
                        )
                    }}
                    data-testid={`plugin-uninstall-${p.metadata.name}`}
                    className="text-xs px-1.5 py-0.5 rounded border border-danger/40 text-danger/80 hover:text-danger hover:border-danger"
                  >
                    卸载
                  </button>
                </div>
                {p.metadata.description && <div className="text-xs text-text-secondary mt-0.5">{p.metadata.description}</div>}
                {(p.metadata.author || p.installedFrom) && (
                  <div className="text-xs text-text-muted mt-0.5 truncate">
                    {p.metadata.author && <span>by {p.metadata.author}</span>}
                    {p.metadata.author && p.installedFrom && <span> · </span>}
                    {p.installedFrom && <span className="font-mono">{p.installedFrom.source}</span>}
                  </div>
                )}
                {/* Trust gate: a plugin's code components (MCP / agents / hooks) only
                    activate once the user trusts it. */}
                {codeBits.length > 0 && (
                  <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isTrusted}
                      onChange={(e) => useAppStore.getState().setPluginTrusted(p.metadata.name, e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-warning"
                      data-testid={`plugin-trust-${p.metadata.name}`}
                    />
                    <span className={`text-xs ${isTrusted ? 'text-text-secondary' : 'text-warning'}`}>
                      {isTrusted
                        ? `已信任 — ${codeBits.join(' + ')} 会运行其代码`
                        : `信任以启用 ${codeBits.join(' + ')}（会执行插件代码）`}
                    </span>
                  </label>
                )}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

/** Register plugin marketplaces, browse their listings, and one-click install. */
function MarketplaceManager(): JSX.Element {
  const ws = useAppStore((s) => s.workspacePath)
  const [sources, setSources] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [browsed, setBrowsed] = useState<{ source: string; mp: Marketplace } | null>(null)

  const refresh = (): void => {
    void window.kairoAPI
      ?.getMarketplaces?.()
      .then((r) => {
        if (r?.ok && r.sources) setSources(r.sources)
      })
      .catch(() => {})
  }
  useEffect(() => refresh(), [ws])

  const add = async (): Promise<void> => {
    const s = input.trim()
    if (!s || busy) return
    setBusy(true)
    try {
      const r = await window.kairoAPI?.addMarketplace?.(s)
      if (!r?.ok) throw new Error(r?.error ?? 'failed')
      useToastStore.getState().addToast({ type: 'success', message: `已注册 marketplace：${r.name}` })
      setInput('')
      refresh()
    } catch (e) {
      useToastStore.getState().addToast({ type: 'error', message: `注册失败：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(false)
    }
  }

  const browse = async (source: string): Promise<void> => {
    try {
      const r = await window.kairoAPI?.browseMarketplace?.(source)
      if (!r?.ok || !r.marketplace) throw new Error(r?.error ?? 'failed')
      setBrowsed({ source, mp: r.marketplace })
    } catch (e) {
      useToastStore.getState().addToast({ type: 'error', message: `浏览失败：${e instanceof Error ? e.message : String(e)}` })
    }
  }

  const remove = async (source: string): Promise<void> => {
    await window.kairoAPI?.removeMarketplace?.(source).catch(() => {})
    if (browsed?.source === source) setBrowsed(null)
    refresh()
  }

  const install = async (entry: MarketplaceEntry): Promise<void> => {
    try {
      await useAppStore.getState().installPlugin(entry.source)
      useToastStore.getState().addToast({ type: 'success', message: `已安装 ${entry.name}` })
    } catch (e) {
      useToastStore.getState().addToast({ type: 'error', message: `安装失败：${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add()
          }}
          placeholder="marketplace 来源：本地路径 或 github:owner/repo"
          disabled={busy}
          data-testid="marketplace-source"
          className="flex-1 text-sm px-2 py-1 rounded border border-border bg-surface-1 text-text-primary placeholder:text-text-muted disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy || !input.trim()}
          data-testid="marketplace-add"
          className="text-xs px-2.5 py-1 rounded border border-border text-text-secondary hover:text-text-primary disabled:opacity-40"
        >
          {busy ? '注册中…' : '注册'}
        </button>
      </div>

      {sources.length === 0 ? (
        <div className="text-sm text-text-muted">未注册任何 marketplace。</div>
      ) : (
        <div className="space-y-1" data-testid="marketplace-list">
          {sources.map((src, i) => (
            <div key={src} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-text-secondary truncate flex-1" title={src}>
                {src}
              </span>
              <button
                type="button"
                onClick={() => void browse(src)}
                data-testid={`marketplace-browse-${i}`}
                className="text-xs px-1.5 py-0.5 rounded border border-border text-text-secondary hover:text-text-primary"
              >
                浏览
              </button>
              <button
                type="button"
                onClick={() => void remove(src)}
                data-testid={`marketplace-remove-${i}`}
                className="text-xs px-1.5 py-0.5 rounded border border-danger/40 text-danger/80 hover:text-danger"
              >
                移除
              </button>
            </div>
          ))}
        </div>
      )}

      {browsed && (
        <div data-testid="marketplace-entries" className="rounded-md border border-border bg-surface-2 p-2 space-y-1.5">
          <div className="text-xs font-semibold text-text-primary">{browsed.mp.name}</div>
          {browsed.mp.plugins.length === 0 && <div className="text-xs text-text-muted">该 marketplace 没有插件条目。</div>}
          {browsed.mp.plugins.map((entry) => (
            <div key={entry.name} data-testid={`marketplace-entry-${entry.name}`} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary">
                  {entry.name}
                  {entry.version && <span className="ml-1 text-xs text-text-muted font-mono">v{entry.version}</span>}
                </div>
                {entry.description && <div className="text-xs text-text-secondary truncate">{entry.description}</div>}
              </div>
              <button
                type="button"
                onClick={() => void install(entry)}
                data-testid={`marketplace-install-${entry.name}`}
                className="text-xs px-2 py-0.5 rounded border border-accent/40 text-accent hover:border-accent"
              >
                安装
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
