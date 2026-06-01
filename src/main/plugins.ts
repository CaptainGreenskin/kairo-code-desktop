/**
 * Local plugin loader (Claude-Code-compatible). Scans `<workspace>/.kairo/plugins/*`
 * for plugin folders containing `.claude-plugin/plugin.json`, and assembles each
 * into a {@link PluginManifest} (commands + mcpServers + gate rules). Pure
 * normalization lives in shared/plugin-manifest; this is just the filesystem
 * scan. v0 loads only the declarative, no-code-execution components.
 */

import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { spawn } from 'node:child_process'
import {
  parsePluginMetadata,
  parseCommandFile,
  parseAgentFile,
  parseHooks,
  parseGateRules,
  parseMcpServers,
  parseMapAnnotations,
  parseDrills,
  type PluginCommand,
  type PluginAgent,
  type PluginManifest,
  parsePluginSource,
  githubTarballUrl,
  parsePermissions,
  parseInstalledRegistry,
  upsertRecord,
  removeRecord,
  findRecord,
  type InstalledRecord,
  parseMarketplace,
  parseMarketplaceRegistry,
  type Marketplace
} from '@kairo/plugin'

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as unknown
  } catch {
    return null
  }
}

/** Path of the central install registry for a workspace. */
function registryPath(workspaceRoot: string): string {
  return nodePath.join(workspaceRoot, '.kairo', 'plugins.json')
}

/** Read the install registry (empty if absent/corrupt). */
export async function readRegistry(workspaceRoot: string): Promise<InstalledRecord[]> {
  return parseInstalledRegistry(await readJson(registryPath(workspaceRoot)))
}

async function writeRegistry(workspaceRoot: string, records: InstalledRecord[]): Promise<void> {
  const file = registryPath(workspaceRoot)
  await fs.mkdir(nodePath.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(records, null, 2))
}

async function loadOne(dir: string): Promise<PluginManifest | null> {
  const pluginJson = await readJson(nodePath.join(dir, '.claude-plugin', 'plugin.json'))
  const metadata = parsePluginMetadata(pluginJson)
  if (!metadata) return null

  const commands: PluginCommand[] = []
  const cmdDir = nodePath.join(dir, 'commands')
  try {
    for (const entry of await fs.readdir(cmdDir)) {
      if (!entry.toLowerCase().endsWith('.md')) continue
      try {
        commands.push(parseCommandFile(entry, await fs.readFile(nodePath.join(cmdDir, entry), 'utf-8')))
      } catch {
        /* skip unreadable command */
      }
    }
  } catch {
    /* no commands dir */
  }

  const agents: PluginAgent[] = []
  const agentDir = nodePath.join(dir, 'agents')
  try {
    for (const entry of await fs.readdir(agentDir)) {
      if (!entry.toLowerCase().endsWith('.md')) continue
      try {
        agents.push(parseAgentFile(entry, await fs.readFile(nodePath.join(agentDir, entry), 'utf-8')))
      } catch {
        /* skip unreadable agent */
      }
    }
  } catch {
    /* no agents dir */
  }

  const dotMcp = await readJson(nodePath.join(dir, '.mcp.json'))
  const hooksJson = await readJson(nodePath.join(dir, 'hooks', 'hooks.json'))
  return {
    metadata,
    dir,
    commands: commands.sort((a, b) => a.name.localeCompare(b.name)),
    agents: agents.sort((a, b) => a.name.localeCompare(b.name)),
    hooks: parseHooks(pluginJson, hooksJson),
    mcpServers: parseMcpServers(pluginJson, dotMcp),
    gateRules: parseGateRules(pluginJson),
    mapAnnotations: parseMapAnnotations(pluginJson),
    drills: parseDrills(pluginJson),
    permissions: parsePermissions(pluginJson)
  }
}

/** Scan the workspace's `.kairo/plugins` for installed plugins. */
export async function scanPlugins(workspaceRoot: string): Promise<PluginManifest[]> {
  const root = nodePath.join(workspaceRoot, '.kairo', 'plugins')
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const registry = await readRegistry(workspaceRoot)
  const manifests: PluginManifest[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const m = await loadOne(nodePath.join(root, e.name))
    if (!m) continue
    const rec = findRecord(registry, m.metadata.name)
    if (rec) m.installedFrom = { source: rec.source, installedAt: rec.installedAt }
    manifests.push(m)
  }
  return manifests.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
}

/** Extract a .tar.gz into a directory using the system tar. */
function extractTarGz(file: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', file, '-C', dest])
    let err = ''
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString()
    })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `tar exited ${code}`))))
    child.on('error', reject)
  })
}

/**
 * Install a plugin from a source spec into `<workspace>/.kairo/plugins/<name>`.
 * v0: local path (copy) and GitHub (download codeload tarball + extract). The
 * installed plugin is UNTRUSTED by default — its declarative parts load, but its
 * MCP/code components only activate once the user trusts it.
 */
/** Run a command and resolve when done. Rejects on non-zero or spawn error. */
function runCommand(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd })
    let err = ''
    child.stderr.on('data', (d: Buffer) => (err += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `${cmd} exited ${code}`))))
  })
}

/** Find the first directory (recursively) that contains `.claude-plugin/plugin.json`. */
async function findPluginRoot(base: string): Promise<string | null> {
  if (await fs.stat(nodePath.join(base, '.claude-plugin', 'plugin.json')).catch(() => null)) return base
  try {
    for (const e of await fs.readdir(base, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const child = nodePath.join(base, e.name)
      if (await fs.stat(nodePath.join(child, '.claude-plugin', 'plugin.json')).catch(() => null)) return child
    }
  } catch {
    /* unreadable */
  }
  return null
}

export async function installPlugin(workspaceRoot: string, spec: string): Promise<{ name: string }> {
  const src = parsePluginSource(spec)
  if (!src) throw new Error('无法识别的插件来源（支持本地路径 / github:owner/repo / npm:pkg / pip:pkg）')
  const pluginsRoot = nodePath.join(workspaceRoot, '.kairo', 'plugins')
  await fs.mkdir(pluginsRoot, { recursive: true })

  let tmp: string | null = null
  try {
    let sourceDir: string
    switch (src.kind) {
      case 'local':
        sourceDir = src.path.replace(/^~(?=\/)/, os.homedir())
        break
      case 'github': {
        tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'kairo-plugin-'))
        const tgz = nodePath.join(tmp, 'plugin.tar.gz')
        const res = await fetch(githubTarballUrl(src))
        if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
        await fs.writeFile(tgz, Buffer.from(await res.arrayBuffer()))
        await extractTarGz(tgz, tmp)
        const dirs = (await fs.readdir(tmp, { withFileTypes: true })).filter((e) => e.isDirectory())
        if (dirs.length === 0) throw new Error('压缩包为空')
        const root = nodePath.join(tmp, dirs[0]!.name)
        sourceDir = src.subdir ? nodePath.join(root, src.subdir) : root
        break
      }
      case 'npm': {
        tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'kairo-npm-'))
        const pkgSpec = src.version ? `${src.package}@${src.version}` : src.package
        await runCommand('npm', ['install', pkgSpec, '--prefix', tmp])
        const pkgDir = nodePath.join(tmp, 'node_modules', src.package)
        const npmRoot = await findPluginRoot(pkgDir)
        if (!npmRoot) throw new Error(`npm 包 ${src.package} 不含 .claude-plugin/plugin.json`)
        sourceDir = npmRoot
        break
      }
      case 'pip': {
        tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'kairo-pip-'))
        const pipSpec = src.version ? `${src.package}==${src.version}` : src.package
        await runCommand('pip', ['download', pipSpec, '--no-deps', '--no-binary', ':all:', '-d', tmp])
        const sdists = (await fs.readdir(tmp)).filter((f) => f.endsWith('.tar.gz'))
        if (sdists.length === 0) throw new Error(`pip download 未产出 sdist（仅 sdist 支持）`)
        await extractTarGz(nodePath.join(tmp, sdists[0]!), tmp)
        const pipRoot = await findPluginRoot(tmp)
        if (!pipRoot) throw new Error(`pip 包 ${src.package} 不含 .claude-plugin/plugin.json`)
        sourceDir = pipRoot
        break
      }
    }

    const meta = parsePluginMetadata(await readJson(nodePath.join(sourceDir, '.claude-plugin', 'plugin.json')))
    if (!meta) throw new Error('来源缺少有效的 .claude-plugin/plugin.json')
    const dest = nodePath.join(pluginsRoot, meta.name.replace(/[^\w.-]/g, '_'))
    await fs.rm(dest, { recursive: true, force: true })
    await fs.cp(sourceDir, dest, { recursive: true })
    const registry = await readRegistry(workspaceRoot)
    await writeRegistry(
      workspaceRoot,
      upsertRecord(registry, { name: meta.name, source: spec, version: meta.version, installedAt: Date.now() })
    )
    return { name: meta.name }
  } finally {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

/** Remove an installed plugin's folder and its registry record. */
export async function uninstallPlugin(workspaceRoot: string, name: string): Promise<{ name: string }> {
  const pluginsRoot = nodePath.join(workspaceRoot, '.kairo', 'plugins')
  // The on-disk folder is the sanitized plugin name (see installPlugin).
  await fs.rm(nodePath.join(pluginsRoot, name.replace(/[^\w.-]/g, '_')), { recursive: true, force: true })
  await writeRegistry(workspaceRoot, removeRecord(await readRegistry(workspaceRoot), name))
  return { name }
}

/** Re-install a plugin from the source recorded at install time. */
export async function updatePlugin(workspaceRoot: string, name: string): Promise<{ name: string }> {
  const rec = findRecord(await readRegistry(workspaceRoot), name)
  if (!rec) throw new Error(`没有 ${name} 的安装来源记录，无法更新（请重新安装）`)
  return installPlugin(workspaceRoot, rec.source)
}

// ── Marketplace (discovery) ────────────────────────────────────────────────

/** Resolve a (possibly relative) entry source against the marketplace base dir. */
function resolveEntrySource(source: string, baseDir: string): string {
  if (/^(github:|https?:\/\/)/.test(source)) return source
  const p = source.replace(/^~(?=\/)/, os.homedir())
  return nodePath.isAbsolute(p) ? p : nodePath.resolve(baseDir, p)
}

/**
 * Fetch + parse a marketplace from a source spec (local dir / local
 * marketplace.json / github). Local-relative plugin entries are resolved to
 * absolute paths against the marketplace's base dir so they can be installed.
 */
export async function fetchMarketplace(spec: string): Promise<Marketplace> {
  const src = parsePluginSource(spec)
  if (!src || (src.kind !== 'local' && src.kind !== 'github')) {
    throw new Error('无法识别的 marketplace 来源（支持本地路径 / github:owner/repo）')
  }
  let tmp: string | null = null
  try {
    let baseDir: string
    if (src.kind === 'local') {
      const p = src.path.replace(/^~(?=\/)/, os.homedir())
      const stat = await fs.stat(p).catch(() => null)
      baseDir = stat?.isFile() ? nodePath.dirname(nodePath.dirname(p)) : p
    } else {
      tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'kairo-mp-'))
      const tgz = nodePath.join(tmp, 'mp.tar.gz')
      const res = await fetch(githubTarballUrl(src))
      if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
      await fs.writeFile(tgz, Buffer.from(await res.arrayBuffer()))
      await extractTarGz(tgz, tmp)
      const dirs = (await fs.readdir(tmp, { withFileTypes: true })).filter((e) => e.isDirectory())
      if (dirs.length === 0) throw new Error('压缩包为空')
      baseDir = src.subdir ? nodePath.join(tmp, dirs[0]!.name, src.subdir) : nodePath.join(tmp, dirs[0]!.name)
    }
    const parsed = parseMarketplace(await readJson(nodePath.join(baseDir, '.claude-plugin', 'marketplace.json')))
    if (!parsed) throw new Error('来源缺少有效的 .claude-plugin/marketplace.json')
    return { ...parsed, plugins: parsed.plugins.map((e) => ({ ...e, source: resolveEntrySource(e.source, baseDir) })) }
  } finally {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

function marketplaceRegistryPath(workspaceRoot: string): string {
  return nodePath.join(workspaceRoot, '.kairo', 'marketplaces.json')
}

/** Read the registered marketplace source specs. */
export async function readMarketplaces(workspaceRoot: string): Promise<string[]> {
  return parseMarketplaceRegistry(await readJson(marketplaceRegistryPath(workspaceRoot)))
}

async function writeMarketplaces(workspaceRoot: string, list: string[]): Promise<void> {
  const file = marketplaceRegistryPath(workspaceRoot)
  await fs.mkdir(nodePath.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(list, null, 2))
}

/** Register a marketplace (validated by a fetch) and persist its source spec. */
export async function addMarketplace(workspaceRoot: string, source: string): Promise<{ name: string }> {
  const mp = await fetchMarketplace(source) // throws if invalid/unreachable
  const list = await readMarketplaces(workspaceRoot)
  if (!list.includes(source)) await writeMarketplaces(workspaceRoot, [...list, source])
  return { name: mp.name }
}

/** Drop a registered marketplace. */
export async function removeMarketplace(workspaceRoot: string, source: string): Promise<void> {
  await writeMarketplaces(workspaceRoot, (await readMarketplaces(workspaceRoot)).filter((s) => s !== source))
}
