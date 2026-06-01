import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import {
  scanPlugins,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  readRegistry,
  fetchMarketplace,
  addMarketplace,
  readMarketplaces,
  removeMarketplace
} from './plugins'

let ws: string

beforeEach(() => {
  ws = mkdtempSync(path.join(tmpdir(), 'kairo-plugins-'))
})
afterEach(() => rmSync(ws, { recursive: true, force: true }))

async function writePlugin(name: string, pluginJson: object, commands: Record<string, string> = {}): Promise<void> {
  const dir = path.join(ws, '.kairo', 'plugins', name)
  await fs.mkdir(path.join(dir, '.claude-plugin'), { recursive: true })
  await fs.writeFile(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify(pluginJson), 'utf-8')
  if (Object.keys(commands).length > 0) {
    await fs.mkdir(path.join(dir, 'commands'), { recursive: true })
    for (const [file, body] of Object.entries(commands)) {
      await fs.writeFile(path.join(dir, 'commands', file), body, 'utf-8')
    }
  }
}

describe('scanPlugins (CC-compatible local loader)', () => {
  it('returns [] when there is no plugins dir', async () => {
    expect(await scanPlugins(ws)).toEqual([])
  })

  it('loads a plugin manifest with commands, gate rules and mcp servers', async () => {
    await writePlugin(
      'sec',
      {
        name: 'security-pack',
        version: '1.0.0',
        description: 'Security helpers',
        gateRules: [{ glob: '**/auth/**', message: 'auth is sensitive' }],
        mcpServers: { scanner: { command: 'sec-mcp', args: ['--stdio'] } }
      },
      { 'audit.md': '---\ndescription: Security audit\n---\nAudit the diff for vulns.' }
    )
    const plugins = await scanPlugins(ws)
    expect(plugins).toHaveLength(1)
    const p = plugins[0]!
    expect(p.metadata).toMatchObject({ name: 'security-pack', version: '1.0.0' })
    expect(p.commands).toEqual([{ name: 'audit', description: 'Security audit', prompt: 'Audit the diff for vulns.' }])
    expect(p.gateRules).toEqual([{ glob: '**/auth/**', severity: 'review', message: 'auth is sensitive' }])
    expect(p.mcpServers).toHaveProperty('scanner')
  })

  it('skips folders without a valid plugin.json', async () => {
    const dir = path.join(ws, '.kairo', 'plugins', 'broken')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'readme.txt'), 'not a plugin', 'utf-8')
    expect(await scanPlugins(ws)).toEqual([])
  })

  it('loads agents from agents/*.md', async () => {
    const dir = path.join(ws, '.kairo', 'plugins', 'ap')
    await fs.mkdir(path.join(dir, '.claude-plugin'), { recursive: true })
    await fs.writeFile(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'agent-pack' }), 'utf-8')
    await fs.mkdir(path.join(dir, 'agents'), { recursive: true })
    await fs.writeFile(path.join(dir, 'agents', 'fixer.md'), '---\nname: fixer\ntools: Bash, Edit\n---\nFix the bug.', 'utf-8')
    const p = (await scanPlugins(ws))[0]!
    expect(p.agents).toEqual([{ name: 'fixer', description: undefined, systemPrompt: 'Fix the bug.', tools: ['Bash', 'Edit'], canWrite: true }])
  })

  it('loads hooks from hooks/hooks.json', async () => {
    const dir = path.join(ws, '.kairo', 'plugins', 'hp')
    await fs.mkdir(path.join(dir, '.claude-plugin'), { recursive: true })
    await fs.writeFile(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'hook-pack' }), 'utf-8')
    await fs.mkdir(path.join(dir, 'hooks'), { recursive: true })
    await fs.writeFile(
      path.join(dir, 'hooks', 'hooks.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'write_file', hooks: [{ type: 'command', command: 'exit 1' }] }] } }),
      'utf-8'
    )
    const p = (await scanPlugins(ws))[0]!
    expect(p.hooks).toEqual([{ type: 'command', event: 'PreToolUse', matcher: 'write_file', command: 'exit 1' }])
  })

  it('parses richer metadata (author/homepage/keywords)', async () => {
    await writePlugin('m', {
      name: 'meta-pack',
      version: '2.1.0',
      author: { name: 'Ada', email: 'ada@x.io' },
      homepage: 'https://x.io',
      keywords: ['lint', 'fmt']
    })
    const p = (await scanPlugins(ws))[0]!
    expect(p.metadata).toMatchObject({ name: 'meta-pack', author: 'Ada', homepage: 'https://x.io', keywords: ['lint', 'fmt'] })
  })
})

describe('plugin lifecycle (install/uninstall/update from a local source)', () => {
  // Build a throwaway "source" plugin dir to install FROM.
  async function makeSource(root: string, name: string, version: string): Promise<string> {
    const dir = path.join(root, name)
    await fs.mkdir(path.join(dir, '.claude-plugin'), { recursive: true })
    await fs.writeFile(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version }), 'utf-8')
    return dir
  }

  it('install records the source in .kairo/plugins.json and scan attaches installedFrom', async () => {
    const src = mkdtempSync(path.join(tmpdir(), 'kairo-src-'))
    try {
      const srcDir = await makeSource(src, 'lc', '1.0.0')
      await installPlugin(ws, srcDir)

      const reg = await readRegistry(ws)
      expect(reg).toHaveLength(1)
      expect(reg[0]).toMatchObject({ name: 'lc', source: srcDir, version: '1.0.0' })
      expect(reg[0]!.installedAt).toBeGreaterThan(0)

      const p = (await scanPlugins(ws))[0]!
      expect(p.installedFrom?.source).toBe(srcDir)
    } finally {
      rmSync(src, { recursive: true, force: true })
    }
  })

  it('uninstall removes the folder and the registry record', async () => {
    const src = mkdtempSync(path.join(tmpdir(), 'kairo-src-'))
    try {
      const srcDir = await makeSource(src, 'lc', '1.0.0')
      await installPlugin(ws, srcDir)
      await uninstallPlugin(ws, 'lc')
      expect(await scanPlugins(ws)).toEqual([])
      expect(await readRegistry(ws)).toEqual([])
    } finally {
      rmSync(src, { recursive: true, force: true })
    }
  })

  it('update re-installs from the recorded source (picks up a new version)', async () => {
    const src = mkdtempSync(path.join(tmpdir(), 'kairo-src-'))
    try {
      const srcDir = await makeSource(src, 'lc', '1.0.0')
      await installPlugin(ws, srcDir)
      // Bump the source version, then update.
      await fs.writeFile(path.join(srcDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'lc', version: '2.0.0' }), 'utf-8')
      await updatePlugin(ws, 'lc')
      const p = (await scanPlugins(ws))[0]!
      expect(p.metadata.version).toBe('2.0.0')
    } finally {
      rmSync(src, { recursive: true, force: true })
    }
  })

  it('update throws when there is no recorded source', async () => {
    await expect(updatePlugin(ws, 'ghost')).rejects.toThrow(/安装来源/)
  })
})

describe('marketplace (discovery)', () => {
  // Build a local marketplace repo: <root>/.claude-plugin/marketplace.json with a
  // local-relative entry pointing at a sibling plugin folder.
  async function makeMarketplace(root: string): Promise<void> {
    await fs.mkdir(path.join(root, '.claude-plugin'), { recursive: true })
    await fs.mkdir(path.join(root, 'plugins', 'demo', '.claude-plugin'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'plugins', 'demo', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'demo', version: '1.0.0' }),
      'utf-8'
    )
    await fs.writeFile(
      path.join(root, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'demo-market',
        owner: { name: 'Acme' },
        plugins: [{ name: 'demo', source: './plugins/demo', description: 'a demo' }]
      }),
      'utf-8'
    )
  }

  it('fetchMarketplace resolves local-relative entry sources to absolute paths', async () => {
    const mkt = mkdtempSync(path.join(tmpdir(), 'kairo-mkt-'))
    try {
      await makeMarketplace(mkt)
      const mp = await fetchMarketplace(mkt)
      expect(mp.name).toBe('demo-market')
      expect(mp.plugins).toHaveLength(1)
      expect(mp.plugins[0]!.source).toBe(path.join(mkt, 'plugins', 'demo'))
      // The resolved source is installable end-to-end.
      await installPlugin(ws, mp.plugins[0]!.source)
      expect((await scanPlugins(ws))[0]!.metadata.name).toBe('demo')
    } finally {
      rmSync(mkt, { recursive: true, force: true })
    }
  })

  it('add/get/remove marketplace persists the source in .kairo/marketplaces.json', async () => {
    const mkt = mkdtempSync(path.join(tmpdir(), 'kairo-mkt-'))
    try {
      await makeMarketplace(mkt)
      const r = await addMarketplace(ws, mkt)
      expect(r.name).toBe('demo-market')
      expect(await readMarketplaces(ws)).toEqual([mkt])
      await removeMarketplace(ws, mkt)
      expect(await readMarketplaces(ws)).toEqual([])
    } finally {
      rmSync(mkt, { recursive: true, force: true })
    }
  })

  it('addMarketplace throws on an invalid source', async () => {
    await expect(addMarketplace(ws, '/no/such/marketplace')).rejects.toThrow()
  })
})
