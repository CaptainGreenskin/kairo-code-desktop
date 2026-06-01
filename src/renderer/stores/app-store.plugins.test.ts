// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from './app-store'
import type { PluginManifest } from '@kairo/plugin'

const manifests: PluginManifest[] = [
  { metadata: { name: 'a' }, dir: '/a', commands: [{ name: 'ax', prompt: 'p' }], agents: [{ name: 'helper', systemPrompt: 'You help', tools: ['write_file'], canWrite: true }], hooks: [], mcpServers: { s: { command: 'c' } }, gateRules: [{ glob: 'ga', severity: 'review' }], mapAnnotations: [], drills: [], permissions: { network: false } },
  { metadata: { name: 'b' }, dir: '/b', commands: [{ name: 'bx', prompt: 'q' }], agents: [], hooks: [], mcpServers: {}, gateRules: [], mapAnnotations: [], drills: [], permissions: { network: false } }
]

beforeEach(() => {
  ;(window as unknown as { kairoAPI: unknown }).kairoAPI = {
    updateConfig: vi.fn().mockResolvedValue({ ok: true }),
    removeMcpServer: vi.fn().mockResolvedValue({ ok: true }),
    getPlugins: vi.fn().mockResolvedValue({ ok: true, plugins: manifests }),
    installPlugin: vi.fn().mockResolvedValue({ ok: true, name: 'a' }),
    uninstallPlugin: vi.fn().mockResolvedValue({ ok: true, name: 'a' }),
    updatePlugin: vi.fn().mockResolvedValue({ ok: true, name: 'a' }),
    setWorkspace: vi.fn().mockResolvedValue({ ok: true })
  }
  useAppStore.setState({ pluginManifests: manifests, disabledPlugins: [], trustedPlugins: [], pluginCommands: manifests.flatMap((m) => m.commands), pluginProtectedGlobs: ['ga'] })
})
afterEach(() => {
  useAppStore.setState({ pluginManifests: [], disabledPlugins: [], trustedPlugins: [], pluginCommands: [], pluginProtectedGlobs: [], pluginAgents: [] })
})

describe('setPluginEnabled', () => {
  it('disabling a plugin drops its commands + gate globs and removes its MCP', () => {
    useAppStore.getState().setPluginEnabled('a', false)
    const s = useAppStore.getState()
    expect(s.disabledPlugins).toContain('a')
    expect(s.pluginCommands.map((c) => c.name)).toEqual(['bx'])
    expect(s.pluginProtectedGlobs).toEqual([]) // a's review glob removed
    const api = (window as unknown as { kairoAPI: { removeMcpServer: ReturnType<typeof vi.fn> } }).kairoAPI
    expect(api.removeMcpServer).toHaveBeenCalledWith('a:s')
  })

  it('re-enabling restores contributions', () => {
    useAppStore.getState().setPluginEnabled('a', false)
    useAppStore.getState().setPluginEnabled('a', true)
    const s = useAppStore.getState()
    expect(s.disabledPlugins).not.toContain('a')
    expect(s.pluginCommands.map((c) => c.name).sort()).toEqual(['ax', 'bx'])
  })
})

describe('setPluginTrusted', () => {
  it('trusting a plugin records it and re-scans (so its MCP servers register)', () => {
    useAppStore.getState().setPluginTrusted('a', true)
    expect(useAppStore.getState().trustedPlugins).toContain('a')
    const api = (window as unknown as { kairoAPI: { getPlugins: ReturnType<typeof vi.fn> } }).kairoAPI
    // loadPlugins() re-scans, passing the now-trusted set to main.
    expect(api.getPlugins).toHaveBeenCalledWith(undefined, ['a'])
  })

  it('untrusting a plugin drops it and removes its MCP servers', () => {
    useAppStore.setState({ trustedPlugins: ['a'] })
    useAppStore.getState().setPluginTrusted('a', false)
    expect(useAppStore.getState().trustedPlugins).not.toContain('a')
    const api = (window as unknown as { kairoAPI: { removeMcpServer: ReturnType<typeof vi.fn> } }).kairoAPI
    expect(api.removeMcpServer).toHaveBeenCalledWith('a:s')
  })

  it("untrusting drops the plugin's agent roles from the crew library", () => {
    useAppStore.setState({ trustedPlugins: ['a'], pluginAgents: [{ id: 'a:helper', label: 'helper', systemPrompt: 'You help' }] })
    useAppStore.getState().setPluginTrusted('a', false)
    expect(useAppStore.getState().pluginAgents).toEqual([])
  })
})

describe('plugin agents in the crew library', () => {
  it('setPluginEnabled re-derives pluginAgents from enabled+trusted manifests', () => {
    useAppStore.setState({ trustedPlugins: ['a'], disabledPlugins: [], pluginAgents: [] })
    // Re-enable 'a' (no-op enable) to trigger a re-derive; 'a' has a write agent.
    useAppStore.getState().setPluginEnabled('a', true)
    expect(useAppStore.getState().pluginAgents.map((r) => r.id)).toEqual(['a:helper'])
    // Disabling drops it again.
    useAppStore.getState().setPluginEnabled('a', false)
    expect(useAppStore.getState().pluginAgents).toEqual([])
  })
})

describe('installPlugin', () => {
  it('forwards the source spec to main and re-scans on success', async () => {
    useAppStore.setState({ workspacePath: '/ws' })
    await useAppStore.getState().installPlugin('github:owner/repo')
    const api = (window as unknown as { kairoAPI: { installPlugin: ReturnType<typeof vi.fn>; getPlugins: ReturnType<typeof vi.fn> } }).kairoAPI
    expect(api.installPlugin).toHaveBeenCalledWith('github:owner/repo', '/ws')
    expect(api.getPlugins).toHaveBeenCalled() // loadPlugins() after install
    useAppStore.setState({ workspacePath: null })
  })

  it('throws when main reports failure', async () => {
    const api = (window as unknown as { kairoAPI: { installPlugin: ReturnType<typeof vi.fn> } }).kairoAPI
    api.installPlugin.mockResolvedValueOnce({ ok: false, error: 'boom' })
    await expect(useAppStore.getState().installPlugin('/bad/path')).rejects.toThrow('boom')
  })
})

describe('uninstallPlugin', () => {
  it('removes the plugin MCP servers, clears enabled/trusted state, and re-scans', async () => {
    useAppStore.setState({ disabledPlugins: ['a'], trustedPlugins: ['a'] })
    await useAppStore.getState().uninstallPlugin('a')
    const api = (window as unknown as { kairoAPI: { uninstallPlugin: ReturnType<typeof vi.fn>; removeMcpServer: ReturnType<typeof vi.fn>; getPlugins: ReturnType<typeof vi.fn> } }).kairoAPI
    expect(api.uninstallPlugin).toHaveBeenCalledWith('a', undefined)
    expect(api.removeMcpServer).toHaveBeenCalledWith('a:s') // a declares mcp server "s"
    const s = useAppStore.getState()
    expect(s.disabledPlugins).not.toContain('a')
    expect(s.trustedPlugins).not.toContain('a')
    expect(api.getPlugins).toHaveBeenCalled() // loadPlugins() after uninstall
  })

  it('throws when main reports failure', async () => {
    const api = (window as unknown as { kairoAPI: { uninstallPlugin: ReturnType<typeof vi.fn> } }).kairoAPI
    api.uninstallPlugin.mockResolvedValueOnce({ ok: false, error: 'nope' })
    await expect(useAppStore.getState().uninstallPlugin('a')).rejects.toThrow('nope')
  })
})

describe('updatePlugin', () => {
  it('forwards the name to main and re-scans', async () => {
    await useAppStore.getState().updatePlugin('a')
    const api = (window as unknown as { kairoAPI: { updatePlugin: ReturnType<typeof vi.fn>; getPlugins: ReturnType<typeof vi.fn> } }).kairoAPI
    expect(api.updatePlugin).toHaveBeenCalledWith('a', undefined)
    expect(api.getPlugins).toHaveBeenCalled()
  })
})
