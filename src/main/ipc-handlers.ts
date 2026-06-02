/**
 * IPC handler registration for the main process.
 *
 * Channel names mirror the contract exposed by `src/preload/index.ts`
 * (`kairo:*`). Handlers that depend on subsystems landing in later tasks
 * (sessions, file diffs, slash commands, permission flow) are stubbed
 * with ok-shaped placeholders so the renderer can wire its UI today.
 */

import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as nodePath from 'node:path'
import type { ApprovalDecision } from '@kairo/api'
import type { AgentManager } from './agent'
import type { FileWatcher } from './file-watcher'
import type { McpManager } from './mcp-manager'
import type { GateDecision, McpServerConfig, McpServerStatus, McpToolInfo } from '../shared/types'
import { appendChange, type ChangeRecord } from '../shared/map-delta'
import type { Evidence } from '../shared/brain-qa'
import { grepFiles } from './grep-utils'
import type {
  AgentConfig,
  CrewPlan,
  CrewRoleConfig,
  CrewStrategy,
  PermissionDecision,
  PermissionVerdict,
  SessionFile,
  SessionMeta
} from '../shared/types'
import {
  createSession,
  deleteSession,
  listSessions,
  loadSession,
  renameSession,
  saveSession,
  type CreateSessionInput
} from './sessions'

interface SendPromptArgs {
  sessionId: string
  prompt: string
  config?: AgentConfig
}

interface SessionRefArgs {
  sessionId: string
}

interface UpdateConfigArgs {
  model?: string
  apiKey?: string
  baseUrl?: string
  provider?: 'openai' | 'anthropic'
  anthropicApiKey?: string
  anthropicBaseUrl?: string
  protectedGlobs?: string[]
  trustedPlugins?: string[]
  disabledPlugins?: string[]
}

interface RunCrewArgs {
  crewId: string
  sessionId: string
  task: string
  roles?: CrewRoleConfig[]
  strategy?: CrewStrategy
  plan?: CrewPlan
}

interface PlanCrewArgs {
  task: string
  roles?: CrewRoleConfig[]
}

interface AbortCrewArgs {
  crewId: string
}

interface ExecuteCommandArgs {
  sessionId: string
  command: string
  args?: string[]
}

interface OpenFolderArgs {
  path?: string
}

interface ApplyDiffArgs {
  filePath: string
  content: string
}

interface ReadFileArgs {
  filePath: string
}

interface WatchFolderArgs {
  folder: string
}

interface ListDirArgs {
  dirPath: string
}

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: TreeNode[]
}

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  agentManager: AgentManager,
  fileWatcher: FileWatcher,
  mcpManager?: McpManager
): void {
  // ── Agent lifecycle ────────────────────────────────────────────────────
  ipcMain.handle('kairo:sendPrompt', async (_event, args: SendPromptArgs) => {
    return agentManager.runQuery(args.sessionId, args.prompt, undefined, args.config)
  })

  ipcMain.handle('kairo:abort', async (_event, args: SessionRefArgs) => {
    agentManager.abort(args.sessionId)
  })

  // ── Agent configuration (settings → main) ──────────────────────────────
  ipcMain.handle('kairo:updateConfig', async (_event, cfg: UpdateConfigArgs) => {
    if (!cfg || typeof cfg !== 'object') {
      return { ok: false, error: 'invalid config payload' }
    }
    agentManager.updateConfig({
      ...(cfg.model !== undefined ? { model: cfg.model } : {}),
      ...(cfg.apiKey !== undefined ? { apiKey: cfg.apiKey } : {}),
      ...(cfg.baseUrl !== undefined ? { baseUrl: cfg.baseUrl } : {}),
      ...(cfg.provider !== undefined ? { provider: cfg.provider } : {}),
      ...(cfg.anthropicApiKey !== undefined ? { anthropicApiKey: cfg.anthropicApiKey } : {}),
      ...(cfg.anthropicBaseUrl !== undefined ? { anthropicBaseUrl: cfg.anthropicBaseUrl } : {}),
      ...(cfg.protectedGlobs !== undefined ? { protectedGlobs: cfg.protectedGlobs } : {}),
      ...(cfg.trustedPlugins !== undefined ? { trustedPlugins: cfg.trustedPlugins } : {}),
      ...(cfg.disabledPlugins !== undefined ? { disabledPlugins: cfg.disabledPlugins } : {})
    })
    return { ok: true }
  })

  ipcMain.handle('kairo:getConfigStatus', async () => agentManager.getConfigStatus())

  // ── Workspace binding ──────────────────────────────────────────────────
  // The renderer owns "which folder is open"; mirror it into the agent (so
  // tools run in the project, not "/") and start watching it for the live map.
  ipcMain.handle('kairo:setAutopilotMode', async (_event, args: { enabled?: boolean }) => {
    agentManager.setAutopilotMode(args?.enabled === true)
    return { ok: true }
  })

  ipcMain.handle('kairo:setWorkspace', async (_event, args: { workspacePath?: string | null }) => {
    const root = args?.workspacePath?.trim() || null
    agentManager.setWorkspace(root)
    if (root) {
      try {
        fileWatcher.watch(root)
      } catch {
        // best-effort; watching is non-critical
      }
    }
    return { ok: true }
  })

  // ── Comprehension Gate decision → workspace memory (Brain) ──────────────
  ipcMain.handle(
    'kairo:recordDecision',
    async (_event, args: { workspacePath?: string; entry: string }) => {
      const dir = args?.workspacePath || process.cwd()
      if (!args?.entry?.trim()) return { ok: false, error: 'entry is required' }
      try {
        const { WorkspaceMemory } = await import('./memory')
        await new WorkspaceMemory().append(dir, args.entry.trim())
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ── Code System Map ────────────────────────────────────────────────────
  ipcMain.handle('kairo:getCodeMap', async (_event, args: { workspacePath?: string }) => {
    const root = args?.workspacePath || process.cwd()
    try {
      const { scanCodeMapWithStats } = await import('./code-map-scan')
      // Race against a 10s timeout so the UI never freezes waiting for a scan
      const result = await Promise.race([
        scanCodeMapWithStats(root),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000))
      ])
      if (!result) return { ok: true, map: { modules: [], edges: [] }, stats: { total: 0, reused: 0, read: 0, removed: 0, durationMs: 10000, cached: false, timedOut: true } }
      return { ok: true, map: result.map, stats: result.stats }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Plugins (CC-compatible local loader). Returns installed plugins and, as a
  // side effect, registers their declared MCP servers with the manager so plugin
  // tools become available. Commands + gate rules are consumed by the renderer.
  ipcMain.handle('kairo:getPlugins', async (_event, args: { workspacePath?: string; trustedNames?: string[] }) => {
    const root = args?.workspacePath || process.cwd()
    const trusted = new Set(args?.trustedNames ?? [])
    try {
      const { scanPlugins } = await import('./plugins')
      const { toMcpServerConfig } = await import('@kairo/plugin')
      const plugins = await scanPlugins(root)
      if (mcpManager) {
        for (const p of plugins) {
          // MCP servers run code (their `command`), so only register for TRUSTED plugins.
          if (!trusted.has(p.metadata.name)) continue
          for (const [name, raw] of Object.entries(p.mcpServers)) {
            const cfg = toMcpServerConfig(`${p.metadata.name}:${name}`, raw)
            if (cfg) await mcpManager.addServer(cfg).catch(() => {})
          }
        }
      }
      return { ok: true, plugins }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Install a plugin from a source spec (local path / github:owner/repo).
  ipcMain.handle('kairo:installPlugin', async (_event, args: { workspacePath?: string; source?: string }) => {
    const root = args?.workspacePath || process.cwd()
    if (!args?.source) return { ok: false, error: 'source required' }
    try {
      const { installPlugin } = await import('./plugins')
      return { ok: true, ...(await installPlugin(root, args.source)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Uninstall a plugin (remove its folder + registry record).
  ipcMain.handle('kairo:uninstallPlugin', async (_event, args: { workspacePath?: string; name?: string }) => {
    const root = args?.workspacePath || process.cwd()
    if (!args?.name) return { ok: false, error: 'name required' }
    try {
      const { uninstallPlugin } = await import('./plugins')
      return { ok: true, ...(await uninstallPlugin(root, args.name)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Update a plugin by re-installing from its recorded source.
  ipcMain.handle('kairo:updatePlugin', async (_event, args: { workspacePath?: string; name?: string }) => {
    const root = args?.workspacePath || process.cwd()
    if (!args?.name) return { ok: false, error: 'name required' }
    try {
      const { updatePlugin } = await import('./plugins')
      return { ok: true, ...(await updatePlugin(root, args.name)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Marketplaces (plugin discovery) ────────────────────────────────────
  ipcMain.handle('kairo:getMarketplaces', async (_event, args: { workspacePath?: string }) => {
    const root = args?.workspacePath || process.cwd()
    try {
      const { readMarketplaces } = await import('./plugins')
      return { ok: true, sources: await readMarketplaces(root) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('kairo:addMarketplace', async (_event, args: { workspacePath?: string; source?: string }) => {
    const root = args?.workspacePath || process.cwd()
    if (!args?.source) return { ok: false, error: 'source required' }
    try {
      const { addMarketplace } = await import('./plugins')
      return { ok: true, ...(await addMarketplace(root, args.source)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('kairo:removeMarketplace', async (_event, args: { workspacePath?: string; source?: string }) => {
    const root = args?.workspacePath || process.cwd()
    if (!args?.source) return { ok: false, error: 'source required' }
    try {
      const { removeMarketplace } = await import('./plugins')
      await removeMarketplace(root, args.source)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Browse a marketplace's plugin list without registering it.
  ipcMain.handle('kairo:browseMarketplace', async (_event, args: { source?: string }) => {
    if (!args?.source) return { ok: false, error: 'source required' }
    try {
      const { fetchMarketplace } = await import('./plugins')
      return { ok: true, marketplace: await fetchMarketplace(args.source) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Flow traces (comprehension engine v2) ───────────────────────────────
  ipcMain.handle('kairo:saveFlow', async (_event, args: { workspacePath?: string; flow?: unknown }) => {
    const root = args?.workspacePath || process.cwd()
    try {
      const { parseFlowTrace, flowSlug } = await import('../shared/flow-trace')
      const trace = parseFlowTrace(args?.flow)
      if (!trace) return { ok: false, error: 'invalid flow trace' }
      const { promises: fs } = await import('node:fs')
      const { join } = await import('node:path')
      const dir = join(root, '.kairo', 'flows')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(join(dir, `${flowSlug(trace.scenario)}.json`), JSON.stringify(trace, null, 2))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('kairo:getFlow', async (_event, args: { workspacePath?: string; scenario?: string }) => {
    const root = args?.workspacePath || process.cwd()
    if (!args?.scenario) return { ok: false, error: 'scenario required' }
    try {
      const { parseFlowTrace, flowSlug } = await import('../shared/flow-trace')
      const { promises: fs } = await import('node:fs')
      const { join } = await import('node:path')
      const file = join(root, '.kairo', 'flows', `${flowSlug(args.scenario)}.json`)
      const raw = JSON.parse(await fs.readFile(file, 'utf-8'))
      const trace = parseFlowTrace(raw)
      return trace ? { ok: true, flow: trace } : { ok: false, error: 'malformed flow file' }
    } catch {
      return { ok: true, flow: null }
    }
  })

  // ── Why records (comprehension engine v2) ────────────────────────────────
  ipcMain.handle('kairo:getWhyRecords', async (_event, args: { workspacePath?: string }) => {
    const root = args?.workspacePath || process.cwd()
    try {
      const { promises: fs } = await import('node:fs')
      const { join } = await import('node:path')
      const { parseWhyRecords } = await import('../shared/why-record')
      const file = join(root, '.kairo', 'why-records.json')
      const raw = JSON.parse(await fs.readFile(file, 'utf-8').catch(() => '[]'))
      return { ok: true, records: parseWhyRecords(raw) }
    } catch {
      return { ok: true, records: [] }
    }
  })

  ipcMain.handle('kairo:recordWhy', async (_event, args: { workspacePath?: string; records?: unknown[] }) => {
    const root = args?.workspacePath || process.cwd()
    if (!Array.isArray(args?.records) || args.records.length === 0) return { ok: true }
    try {
      const { promises: fs } = await import('node:fs')
      const { join } = await import('node:path')
      const { parseWhyRecords, appendWhyRecord } = await import('../shared/why-record')
      const file = join(root, '.kairo', 'why-records.json')
      await fs.mkdir(join(root, '.kairo'), { recursive: true })
      let existing = parseWhyRecords(JSON.parse(await fs.readFile(file, 'utf-8').catch(() => '[]')))
      for (const r of args.records) {
        if (r && typeof r === 'object' && typeof (r as Record<string, unknown>).file === 'string' && typeof (r as Record<string, unknown>).why === 'string') {
          existing = appendWhyRecord(existing, r as { file: string; why: string; task?: string; at: number })
        }
      }
      await fs.writeFile(file, JSON.stringify(existing, null, 2))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Comprehension-ranked diff — order the working-tree (or a commit's) hunks by
  // how much they matter to understanding; the UI reads the top ones, hides churn.
  ipcMain.handle('kairo:getRankedDiff', async (_event, args: { workspacePath?: string; sha?: string }) => {
    const dir = args?.workspacePath || process.cwd()
    try {
      const raw = args?.sha
        ? await runGit(['show', '--format=', '--no-color', args.sha], dir)
        : await runGit(['diff', '--no-color', 'HEAD'], dir)
      const { rankDiff } = await import('../shared/diff-rank')
      return { ok: true, hunks: rankDiff(raw).slice(0, 50) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Change Lens for ANY git commit — the instrument works on human/external
  // changes, not just crew runs. Reconstructs per-file before/after into edit
  // records and runs the same lens builder (blast radius + behavior delta).
  ipcMain.handle('kairo:lensForCommit', async (_event, args: { workspacePath?: string; sha?: string }) => {
    const dir = args?.workspacePath || process.cwd()
    if (!args?.sha) return { ok: false, error: 'sha required' }
    const sha = args.sha
    try {
      const nameStatus = await runGit(['show', '--name-status', '--format=', '--no-color', sha], dir)
      const files: string[] = []
      for (const line of nameStatus.split('\n')) {
        const m = /^[ACMRTD]\d*\t(.+)$/.exec(line.trim())
        if (m) files.push((m[1]!.includes('\t') ? m[1]!.split('\t').pop()! : m[1]!).trim())
      }
      const records: Array<{ toolName: string; args: Record<string, unknown>; ok: boolean }> = []
      for (const file of files.slice(0, 40)) {
        const before = await runGit(['show', `${sha}^:${file}`], dir).catch(() => '')
        const after = await runGit(['show', `${sha}:${file}`], dir).catch(() => '')
        records.push({ toolName: 'edit', args: { path: file, oldText: before, newText: after }, ok: true })
      }
      const { buildChangeLens } = await import('./change-lens')
      const { getCachedCodeMap } = await import('./code-map-scan')
      const lens = buildChangeLens(records, [], getCachedCodeMap(dir))
      return { ok: true, lens }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Git as a Brain source: backfill the Living Map's history with non-crew
  // commits (manual edits, external pushes, Agent-mode work the gate never saw).
  ipcMain.handle('kairo:getGitHistory', async (_event, args: { workspacePath?: string; limit?: number }) => {
    const dir = args?.workspacePath || process.cwd()
    try {
      const { parseGitLog } = await import('../shared/git-brain')
      const limit = Math.min(Math.max(args?.limit ?? 400, 1), 2000)
      const raw = await runGit(
        ['log', '--no-merges', `-n${limit}`, '--date=unix', '--name-only', '--pretty=format:%x01%H%x1f%at%x1f%an%x1f%s'],
        dir
      )
      return { ok: true, commits: parseGitLog(raw) }
    } catch {
      // Not a git repo / git unavailable → no history (the Brain just has crew data).
      return { ok: true, commits: [] }
    }
  })

  // Durable overnight run — persist/load/clear so a crashed/closed app can
  // resume an in-flight autonomous run on next launch.
  ipcMain.handle('kairo:saveNightwatch', async (_event, args: { workspacePath?: string; record?: unknown }) => {
    const dir = args?.workspacePath || process.cwd()
    if (!args?.record) return { ok: false, error: 'record required' }
    try {
      const file = nodePath.join(dir, '.kairo', 'nightwatch.json')
      await fs.mkdir(nodePath.dirname(file), { recursive: true })
      await fs.writeFile(file, JSON.stringify(args.record, null, 2), 'utf-8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('kairo:loadNightwatch', async (_event, args: { workspacePath?: string }) => {
    const dir = args?.workspacePath || process.cwd()
    try {
      const parsed = JSON.parse(await fs.readFile(nodePath.join(dir, '.kairo', 'nightwatch.json'), 'utf-8'))
      return { ok: true, record: parsed }
    } catch {
      return { ok: true, record: null }
    }
  })
  ipcMain.handle('kairo:clearNightwatch', async (_event, args: { workspacePath?: string }) => {
    const dir = args?.workspacePath || process.cwd()
    try {
      await fs.rm(nodePath.join(dir, '.kairo', 'nightwatch.json'), { force: true })
    } catch {
      /* best-effort */
    }
    return { ok: true }
  })

  // Comprehension drills — persist self-test results so the measured accuracy
  // (the real comprehension metric) accrues across sessions, not just in-memory.
  ipcMain.handle('kairo:recordDrill', async (_event, args: { workspacePath?: string; correct?: boolean }) => {
    const dir = args?.workspacePath || process.cwd()
    try {
      const file = nodePath.join(dir, '.kairo', 'drills.json')
      await fs.mkdir(nodePath.dirname(file), { recursive: true })
      let arr: boolean[] = []
      try {
        const parsed = JSON.parse(await fs.readFile(file, 'utf-8')) as unknown
        if (Array.isArray(parsed)) arr = parsed as boolean[]
      } catch {
        /* fresh */
      }
      arr.push(args?.correct === true)
      if (arr.length > 200) arr = arr.slice(arr.length - 200)
      await fs.writeFile(file, JSON.stringify(arr), 'utf-8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('kairo:getDrills', async (_event, args: { workspacePath?: string }) => {
    const dir = args?.workspacePath || process.cwd()
    try {
      const parsed = JSON.parse(await fs.readFile(nodePath.join(dir, '.kairo', 'drills.json'), 'utf-8')) as unknown
      return { ok: true, results: Array.isArray(parsed) ? (parsed as boolean[]) : [] }
    } catch {
      return { ok: true, results: [] as boolean[] }
    }
  })

  // Checkpoint / rollback — undo a (possibly unattended) run's file changes.
  ipcMain.handle('kairo:rollbackChanges', async (_event, args: { workspacePath?: string }) => {
    const root = args?.workspacePath || process.cwd()
    try {
      const { rollbackChanges } = await import('./checkpoint')
      return { ok: true, result: await rollbackChanges(root) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('kairo:resetCheckpoint', async (_event, args: { workspacePath?: string }) => {
    const root = args?.workspacePath || process.cwd()
    try {
      const { resetCheckpoint } = await import('./checkpoint')
      await resetCheckpoint(root)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('kairo:checkpointCount', async (_event, args: { workspacePath?: string }) => {
    const root = args?.workspacePath || process.cwd()
    try {
      const { checkpointCount } = await import('./checkpoint')
      return { ok: true, count: await checkpointCount(root) }
    } catch {
      return { ok: true, count: 0 }
    }
  })

  // Context window usage (token budget) for a session — drives the UI gauge +
  // auto-compaction suggestion.
  ipcMain.handle('kairo:contextUsage', async (_event, args: { sessionId?: string; maxTokens?: number }) => {
    if (!args?.sessionId) return { ok: false, error: 'sessionId is required' }
    try {
      const { getContextUsage } = await import('./compaction')
      const usage = await getContextUsage(args.sessionId, args.maxTokens)
      return { ok: true, usage }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Talk to the system (grounded): answer a question using ONLY Brain evidence.
  ipcMain.handle('kairo:askBrain', async (_event, args: { question?: string; evidence?: Evidence }) => {
    if (!args?.question || !args?.evidence) return { ok: false, error: 'question and evidence are required' }
    try {
      const answer = await agentManager.askBrain(args.question, args.evidence)
      return { ok: true, answer }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Auto-discover sibling services: directories next to the workspace that look
  // like their own project (have a package.json / go.mod / pom.xml / src dir).
  ipcMain.handle('kairo:discoverServices', async (_event, args: { workspacePath?: string }) => {
    const ws = args?.workspacePath
    if (!ws) return { ok: false, error: 'no workspace' }
    try {
      const parent = nodePath.dirname(ws)
      const entries = await fs.readdir(parent, { withFileTypes: true })
      const markers = ['package.json', 'go.mod', 'pom.xml', 'build.gradle', 'Cargo.toml', 'pyproject.toml']
      const found: string[] = []
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue
        const dir = nodePath.join(parent, e.name)
        if (dir === ws) continue
        const has = await Promise.all(
          markers.map((m) =>
            fs
              .access(nodePath.join(dir, m))
              .then(() => true)
              .catch(() => false)
          )
        )
        if (has.some(Boolean)) found.push(dir)
      }
      return { ok: true, roots: found }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Cross-repo service map: scan each registered root's coupling signals and
  // link services that share an event topic / HTTP route.
  ipcMain.handle('kairo:getServiceGraph', async (_event, args: { roots?: string[] }) => {
    const roots = (args?.roots ?? []).filter((r) => typeof r === 'string' && r.length > 0)
    if (roots.length === 0) return { ok: false, error: 'no service roots' }
    try {
      const { scanServiceSignals } = await import('./code-map-scan')
      const { buildServiceGraph } = await import('../shared/service-graph')
      const services = await Promise.all(
        roots.map(async (root) => ({
          name: nodePath.basename(root) || root,
          signals: await scanServiceSignals(root)
        }))
      )
      return { ok: true, graph: buildServiceGraph(services) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Hidden coupling: non-import edges (shared tables/events/routes/flags).
  ipcMain.handle('kairo:getCoupling', async (_event, args: { workspacePath?: string }) => {
    const root = args?.workspacePath || process.cwd()
    try {
      const { scanCoupling } = await import('./code-map-scan')
      return { ok: true, edges: await scanCoupling(root) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // File-level granularity: "who imports this file" (finer than the module map).
  ipcMain.handle('kairo:getFileDeps', async (_event, args: { workspacePath?: string; file?: string }) => {
    const root = args?.workspacePath || process.cwd()
    if (!args?.file) return { ok: false, error: 'file is required' }
    try {
      const { scanFileGraph } = await import('./code-map-scan')
      const { fileImporters, fileImports } = await import('../shared/code-map')
      const edges = await scanFileGraph(root)
      return { ok: true, importers: fileImporters(edges, args.file), imports: fileImports(edges, args.file) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Dogfood feedback → userData/kairo-feedback.md ──────────────────────
  ipcMain.handle(
    'kairo:recordFeedback',
    async (_event, args: { rating?: number; text: string }) => {
      const text = args?.text?.trim()
      if (!text) return { ok: false, error: 'text is required' }
      try {
        const file = nodePath.join(app.getPath('userData'), 'kairo-feedback.md')
        const ts = new Date().toISOString()
        const rating = typeof args.rating === 'number' ? ` · ${args.rating}/5` : ''
        const entry = `\n\n## ${ts} · v${app.getVersion()}${rating}\n\n${text}\n`
        try {
          await fs.appendFile(file, entry, 'utf-8')
        } catch {
          await fs.writeFile(file, `# Kairo Feedback${entry}`, 'utf-8')
        }
        return { ok: true, path: file }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ── Comprehension Gate decisions → .kairo/decisions.json (Living Map) ───
  ipcMain.handle(
    'kairo:recordGateDecision',
    async (_event, args: { workspacePath?: string; decision?: GateDecision }) => {
      const dir = args?.workspacePath || process.cwd()
      if (!args?.decision) return { ok: false, error: 'decision is required' }
      try {
        const file = nodePath.join(dir, '.kairo', 'decisions.json')
        await fs.mkdir(nodePath.dirname(file), { recursive: true })
        let arr: GateDecision[] = []
        try {
          const parsed = JSON.parse(await fs.readFile(file, 'utf-8')) as unknown
          if (Array.isArray(parsed)) arr = parsed as GateDecision[]
        } catch {
          /* fresh file */
        }
        arr.push(args.decision)
        await fs.writeFile(file, JSON.stringify(arr, null, 2), 'utf-8')
        // Reviewing a gate IS understanding — advance the Map Delta anchor so
        // the change you just judged no longer shows as "since you last looked".
        try {
          const seenFile = nodePath.join(dir, '.kairo', 'last-seen.json')
          await fs.writeFile(seenFile, JSON.stringify({ at: args.decision.at || Date.now() }), 'utf-8')
        } catch {
          /* best-effort */
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('kairo:getGateDecisions', async (_event, args: { workspacePath?: string }) => {
    const dir = args?.workspacePath || process.cwd()
    const readArr = async (name: string): Promise<GateDecision[]> => {
      try {
        const parsed = JSON.parse(await fs.readFile(nodePath.join(dir, '.kairo', name), 'utf-8')) as unknown
        return Array.isArray(parsed) ? (parsed as GateDecision[]) : []
      } catch {
        return []
      }
    }
    try {
      // Team Brain: merge the local log with an optional team-synced copy
      // (`.kairo/decisions.shared.json`, committed to git), deduped.
      const { mergeGateDecisions } = await import('../shared/brain-merge')
      const [local, shared] = await Promise.all([readArr('decisions.json'), readArr('decisions.shared.json')])
      return { ok: true, decisions: mergeGateDecisions(local, shared) }
    } catch {
      return { ok: true, decisions: [] as GateDecision[] }
    }
  })

  // ── Map Delta: change log + "last seen" anchor (.kairo) ────────────────
  const kairoFile = (dir: string, name: string): string => nodePath.join(dir, '.kairo', name)
  const writeLastSeen = async (dir: string, at: number): Promise<void> => {
    const file = kairoFile(dir, 'last-seen.json')
    await fs.mkdir(nodePath.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ at }), 'utf-8')
  }

  ipcMain.handle(
    'kairo:recordChange',
    async (_event, args: { workspacePath?: string; change?: ChangeRecord }) => {
      const dir = args?.workspacePath || process.cwd()
      if (!args?.change) return { ok: false, error: 'change is required' }
      try {
        const file = kairoFile(dir, 'changes.json')
        await fs.mkdir(nodePath.dirname(file), { recursive: true })
        let log: ChangeRecord[] = []
        try {
          const parsed = JSON.parse(await fs.readFile(file, 'utf-8')) as unknown
          if (Array.isArray(parsed)) log = parsed as ChangeRecord[]
        } catch {
          /* fresh file */
        }
        await fs.writeFile(file, JSON.stringify(appendChange(log, args.change), null, 2), 'utf-8')
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('kairo:getChanges', async (_event, args: { workspacePath?: string }) => {
    const dir = args?.workspacePath || process.cwd()
    const readArr = async (name: string): Promise<ChangeRecord[]> => {
      try {
        const parsed = JSON.parse(await fs.readFile(kairoFile(dir, name), 'utf-8')) as unknown
        return Array.isArray(parsed) ? (parsed as ChangeRecord[]) : []
      } catch {
        return []
      }
    }
    try {
      // Team Brain: merge local + team-synced change log (`changes.shared.json`).
      const { mergeChanges } = await import('../shared/brain-merge')
      const [local, shared] = await Promise.all([readArr('changes.json'), readArr('changes.shared.json')])
      return { ok: true, changes: mergeChanges(local, shared) }
    } catch {
      return { ok: true, changes: [] as ChangeRecord[] }
    }
  })

  ipcMain.handle('kairo:getLastSeen', async (_event, args: { workspacePath?: string }) => {
    const dir = args?.workspacePath || process.cwd()
    try {
      const parsed = JSON.parse(await fs.readFile(kairoFile(dir, 'last-seen.json'), 'utf-8')) as { at?: number }
      return { ok: true, at: typeof parsed?.at === 'number' ? parsed.at : 0 }
    } catch {
      return { ok: true, at: 0 }
    }
  })

  ipcMain.handle('kairo:markSeen', async (_event, args: { workspacePath?: string; at?: number }) => {
    const dir = args?.workspacePath || process.cwd()
    try {
      await writeLastSeen(dir, typeof args?.at === 'number' ? args.at : Date.now())
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Crew (multi-agent pipeline) ────────────────────────────────────────
  ipcMain.handle('kairo:planCrew', async (_event, args: PlanCrewArgs) => {
    if (!args?.task) return { ok: false, error: 'task is required' }
    try {
      const plan = await agentManager.planCrew(args.task, args.roles)
      return { ok: true, plan }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('kairo:runCrew', async (_event, args: RunCrewArgs) => {
    if (!args?.crewId || !args.sessionId || !args.task) {
      return { ok: false, error: 'crewId, sessionId and task are required' }
    }
    try {
      const result = await agentManager.runCrew(args.crewId, args.sessionId, args.task, args.roles, args.strategy, args.plan)
      return { ok: result.reason !== 'error', ...result }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('kairo:abortCrew', async (_event, args: AbortCrewArgs) => {
    if (!args?.crewId) return { ok: false }
    return { ok: agentManager.abortCrew(args.crewId) }
  })

  // ── Sessions ───────────────────────────────────────────────────────────
  ipcMain.handle('kairo:getSessions', async (): Promise<SessionMeta[]> => {
    return listSessions()
  })

  ipcMain.handle(
    'kairo:loadSession',
    async (_event, args: SessionRefArgs): Promise<SessionFile | null> => {
      if (!args?.sessionId) return null
      return loadSession(args.sessionId)
    }
  )

  ipcMain.handle(
    'kairo:createSession',
    async (_event, args: CreateSessionInput | undefined): Promise<SessionFile> => {
      return createSession(args ?? {})
    }
  )

  ipcMain.handle(
    'kairo:saveSession',
    async (_event, session: SessionFile): Promise<{ ok: boolean; error?: string }> => {
      if (!session?.id || !Array.isArray(session.messages)) {
        return { ok: false, error: 'invalid session payload' }
      }
      try {
        await saveSession(session)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(
    'kairo:deleteSession',
    async (_event, args: SessionRefArgs): Promise<{ ok: boolean }> => {
      if (!args?.sessionId) return { ok: false }
      const ok = await deleteSession(args.sessionId)
      return { ok }
    }
  )

  ipcMain.handle(
    'kairo:renameSession',
    async (
      _event,
      args: { sessionId: string; name: string }
    ): Promise<SessionMeta | null> => {
      if (!args?.sessionId || typeof args.name !== 'string') return null
      return renameSession(args.sessionId, args.name)
    }
  )

  // ── Slash commands ─────────────────────────────────────────────────────
  ipcMain.handle(
    'kairo:executeCommand',
    async (_event, args: ExecuteCommandArgs) => {
      if (!args?.command) return { ok: false, error: 'No command specified' }
      switch (args.command) {
        case 'model': {
          const modelName = args.args?.[0]
          if (!modelName) return { ok: false, error: 'Usage: /model <name>' }
          return { ok: true, result: modelName }
        }
        case 'clear':
          return { ok: true }
        case 'compact': {
          try {
            const { compactSession } = await import('./compaction')
            const result = await compactSession(args.sessionId, agentManager)
            return { ok: true, result: JSON.stringify(result) }
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) }
          }
        }
        case 'export': {
          try {
            const { exportSessionToMarkdown } = await import('./session-export')
            const markdown = await exportSessionToMarkdown(args.sessionId)
            const saveResult = await dialog.showSaveDialog(mainWindow, {
              defaultPath: `session-${args.sessionId.slice(0, 8)}.md`,
              filters: [{ name: 'Markdown', extensions: ['md'] }]
            })
            if (saveResult.canceled || !saveResult.filePath) {
              return { ok: false, error: 'Cancelled' }
            }
            await fs.writeFile(saveResult.filePath, markdown, 'utf-8')
            return { ok: true, result: saveResult.filePath }
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) }
          }
        }
        default:
          return { ok: false, error: `Unknown command: /${args.command}` }
      }
    }
  )

  // ── Permission decisions ───────────────────────────────────────────────
  ipcMain.handle(
    'kairo:approveToolCall',
    async (_event, decision: PermissionDecision) => {
      if (!decision || typeof decision.toolCallId !== 'string') {
        return { ok: false, error: 'invalid permission decision payload' }
      }
      const mapped = mapVerdict(decision.verdict)
      const resolved = agentManager.approvalHandler.resolveApproval(
        decision.toolCallId,
        mapped
      )
      return { ok: resolved }
    }
  )

  // ── File system dialogs ────────────────────────────────────────────────
  ipcMain.handle('kairo:openFolder', async (_event, args: OpenFolderArgs) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      ...(args?.path ? { defaultPath: args.path } : {})
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const folder = result.filePaths[0]
    try {
      fileWatcher.watch(folder)
    } catch {
      // best-effort; file watching is non-essential to the dialog result.
    }
    return folder
  })

  // ── Write preview approval ─────────────────────────────────────────────
  ipcMain.handle(
    'kairo:approveWrite',
    async (_event, args: { toolCallId: string; accepted: boolean }) => {
      if (!args || typeof args.toolCallId !== 'string') {
        return { ok: false, error: 'invalid approveWrite payload' }
      }
      const resolved = agentManager.resolveWrite(args.toolCallId, args.accepted)
      return { ok: resolved }
    }
  )

  // ── File save (from editor) ─────────────────────────────────────────────
  ipcMain.handle('kairo:saveFile', async (_event, args: ApplyDiffArgs) => {
    if (!args || typeof args.filePath !== 'string' || typeof args.content !== 'string') {
      return { ok: false, error: 'invalid saveFile payload' }
    }
    try {
      await fs.writeFile(args.filePath, args.content, 'utf-8')
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message }
    }
  })

  // ── File apply ─────────────────────────────────────────────────────────
  ipcMain.handle('kairo:applyDiff', async (_event, args: ApplyDiffArgs) => {
    if (!args || typeof args.filePath !== 'string' || typeof args.content !== 'string') {
      return { ok: false, error: 'invalid applyDiff payload' }
    }
    try {
      await fs.writeFile(args.filePath, args.content, 'utf-8')
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message }
    }
  })

  // ── File read (used by drop-zone for full-path access) ────────────────
  ipcMain.handle('kairo:readFile', async (_event, args: ReadFileArgs) => {
    if (!args || typeof args.filePath !== 'string') {
      return { ok: false, error: 'invalid readFile payload' }
    }
    try {
      const content = await fs.readFile(args.filePath, 'utf-8')
      return { ok: true, content }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message }
    }
  })

  // ── Git operations (sidebar panel) ──────────────────────────────────────
  ipcMain.handle('kairo:gitStatus', async (_event, args: { workspacePath: string }) => {
    const cwd = args?.workspacePath
    if (!cwd) return { ok: false, error: 'No workspace folder set' }
    try {
      const branchOut = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
      const statusOut = await runGit(['status', '--porcelain=v1'], cwd)
      const staged: Array<{ path: string; status: string }> = []
      const modified: Array<{ path: string; status: string }> = []
      const untracked: Array<{ path: string; status: string }> = []
      for (const line of statusOut.split('\n')) {
        if (!line) continue
        const x = line[0]!
        const y = line[1]!
        const filePath = line.slice(3)
        if (x === '?' && y === '?') {
          untracked.push({ path: filePath, status: '?' })
        } else {
          if (x !== ' ' && x !== '?') {
            staged.push({ path: filePath, status: x })
          }
          if (y !== ' ' && y !== '?') {
            modified.push({ path: filePath, status: y })
          }
        }
      }
      return { ok: true, branch: branchOut.trim(), staged, modified, untracked }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    'kairo:gitQuickCommit',
    async (_event, args: { workspacePath: string; files: string[]; message: string }) => {
      const cwd = args?.workspacePath
      if (!cwd) return { ok: false, error: 'No workspace folder set' }
      if (!args?.files?.length || !args.message) {
        return { ok: false, error: 'files and message required' }
      }
      try {
        await runGit(['add', ...args.files], cwd)
        const out = await runGit(['commit', '-m', args.message], cwd)
        const match = out.match(/\[[\w/-]+ ([a-f0-9]+)\]/)
        return { ok: true, hash: match?.[1] ?? '' }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ── List directory (shallow — children loaded on demand) ────────────────
  ipcMain.handle('kairo:listDir', async (_event, args: ListDirArgs): Promise<TreeNode[]> => {
    if (!args?.dirPath) return []
    try {
      const entries = await fs.readdir(args.dirPath, { withFileTypes: true })
      const HIDDEN = new Set([
        'node_modules', '.git', '.next', '.nuxt', 'dist', 'out', '.cache',
        '.turbo', '.vscode', '.idea', '__pycache__', '.DS_Store', 'coverage',
        '.env', '.env.local', '.env.production'
      ])
      const nodes: TreeNode[] = []
      for (const e of entries) {
        if (e.name.startsWith('.') && HIDDEN.has(e.name)) continue
        if (HIDDEN.has(e.name)) continue
        const full = require('node:path').join(args.dirPath, e.name)
        nodes.push({
          name: e.name,
          path: full,
          type: e.isDirectory() ? 'directory' : 'file'
        })
      }
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      return nodes
    } catch {
      return []
    }
  })

  // ── List all files (Quick File Open) ────────────────────────────────
  ipcMain.handle(
    'kairo:listAllFiles',
    async (_event, args: { workspacePath: string }) => {
      if (!args?.workspacePath) return []
      const MAX_FILES = 10_000
      const results: Array<{ name: string; relativePath: string; absolutePath: string }> = []
      const HIDDEN = new Set([
        'node_modules', '.git', '.next', '.nuxt', 'dist', 'out', '.cache',
        '.turbo', '.vscode', '.idea', '__pycache__', '.DS_Store', 'coverage',
        '.env', '.env.local', '.env.production', '.kairo'
      ])

      const walk = async (dir: string): Promise<void> => {
        if (results.length >= MAX_FILES) return
        let entries
        try {
          entries = await fs.readdir(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of entries) {
          if (results.length >= MAX_FILES) return
          if (HIDDEN.has(entry.name)) continue
          const full = require('node:path').join(dir, entry.name)
          if (entry.isDirectory()) {
            await walk(full)
          } else if (entry.isFile()) {
            const rel = require('node:path').relative(args.workspacePath, full)
            results.push({ name: entry.name, relativePath: rel, absolutePath: full })
          }
        }
      }

      await walk(args.workspacePath)
      return results
    }
  )

  // ── Grep files (Find in Files panel) ─────────────────────────────────
  ipcMain.handle(
    'kairo:grepFiles',
    async (
      _event,
      args: { searchPath: string; pattern: string; include?: string; maxResults?: number }
    ) => {
      if (!args?.searchPath || !args.pattern) return []
      return grepFiles(args.searchPath, args.pattern, args.include, args.maxResults)
    }
  )

  // ── Terminal command execution ──────────────────────────────────────────
  ipcMain.handle(
    'kairo:terminalExec',
    async (_event, args: { command: string; cwd: string }) => {
      if (!args?.command || !args.cwd) {
        return { ok: false, error: 'command and cwd required' }
      }
      return new Promise<{ ok: boolean; stdout?: string; stderr?: string; exitCode?: number | null; error?: string }>((resolve) => {
        const child = spawn('/bin/sh', ['-c', args.command], {
          cwd: args.cwd,
          env: process.env
        })
        let stdout = ''
        let stderr = ''
        const timer = setTimeout(() => {
          child.kill('SIGTERM')
        }, 60_000)

        child.stdout?.on('data', (d: Buffer) => {
          stdout += d.toString('utf-8')
          mainWindow.webContents.send('kairo:terminalData', {
            type: 'stdout',
            text: d.toString('utf-8')
          })
        })
        child.stderr?.on('data', (d: Buffer) => {
          stderr += d.toString('utf-8')
          mainWindow.webContents.send('kairo:terminalData', {
            type: 'stderr',
            text: d.toString('utf-8')
          })
        })
        child.on('error', (err) => {
          clearTimeout(timer)
          resolve({ ok: false, error: err.message })
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          mainWindow.webContents.send('kairo:terminalExit', { exitCode: code })
          resolve({ ok: true, stdout, stderr, exitCode: code })
        })
      })
    }
  )

  // ── MCP management ─────────────────────────────────────────────────────
  ipcMain.handle('kairo:getMcpServers', async (): Promise<McpServerStatus[]> => {
    return mcpManager?.getServers() ?? []
  })

  ipcMain.handle('kairo:addMcpServer', async (_event, config: McpServerConfig) => {
    if (!mcpManager || !config?.name) return { ok: false, error: 'invalid config' }
    try {
      await mcpManager.addServer(config)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('kairo:removeMcpServer', async (_event, args: { name: string }) => {
    if (!mcpManager || !args?.name) return { ok: false }
    await mcpManager.removeServer(args.name)
    return { ok: true }
  })

  ipcMain.handle('kairo:enableMcpServer', async (_event, args: { name: string }) => {
    if (!mcpManager || !args?.name) return { ok: false }
    await mcpManager.enableServer(args.name)
    return { ok: true }
  })

  ipcMain.handle('kairo:disableMcpServer', async (_event, args: { name: string }) => {
    if (!mcpManager || !args?.name) return { ok: false }
    mcpManager.disableServer(args.name)
    return { ok: true }
  })

  ipcMain.handle('kairo:getMcpTools', async (): Promise<McpToolInfo[]> => {
    return mcpManager?.getTools() ?? []
  })

  // ── Watch folder ──────────────────────────────────────────────────────
  ipcMain.handle('kairo:watchFolder', async (_event, args: WatchFolderArgs) => {
    if (!args || typeof args.folder !== 'string') {
      return { ok: false, error: 'invalid watchFolder payload' }
    }
    try {
      fileWatcher.watch(args.folder)
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message }
    }
  })
}

export function unregisterIpcHandlers(): void {
  for (const channel of [
    'kairo:sendPrompt',
    'kairo:abort',
    'kairo:updateConfig',
    'kairo:getConfigStatus',
    'kairo:setWorkspace',
    'kairo:setAutopilotMode',
    'kairo:getCodeMap',
    'kairo:getPlugins',
    'kairo:installPlugin',
    'kairo:uninstallPlugin',
    'kairo:updatePlugin',
    'kairo:getMarketplaces',
    'kairo:addMarketplace',
    'kairo:removeMarketplace',
    'kairo:browseMarketplace',
    'kairo:saveFlow',
    'kairo:getFlow',
    'kairo:getWhyRecords',
    'kairo:recordWhy',
    'kairo:getGitHistory',
    'kairo:lensForCommit',
    'kairo:getRankedDiff',
    'kairo:getFileDeps',
    'kairo:getCoupling',
    'kairo:getServiceGraph',
    'kairo:discoverServices',
    'kairo:contextUsage',
    'kairo:rollbackChanges',
    'kairo:resetCheckpoint',
    'kairo:checkpointCount',
    'kairo:recordDrill',
    'kairo:getDrills',
    'kairo:saveNightwatch',
    'kairo:loadNightwatch',
    'kairo:clearNightwatch',
    'kairo:askBrain',
    'kairo:recordDecision',
    'kairo:recordGateDecision',
    'kairo:getGateDecisions',
    'kairo:recordChange',
    'kairo:getChanges',
    'kairo:getLastSeen',
    'kairo:markSeen',
    'kairo:recordFeedback',
    'kairo:planCrew',
    'kairo:runCrew',
    'kairo:abortCrew',
    'kairo:getSessions',
    'kairo:loadSession',
    'kairo:createSession',
    'kairo:saveSession',
    'kairo:deleteSession',
    'kairo:renameSession',
    'kairo:executeCommand',
    'kairo:approveToolCall',
    'kairo:approveWrite',
    'kairo:openFolder',
    'kairo:saveFile',
    'kairo:applyDiff',
    'kairo:readFile',
    'kairo:gitStatus',
    'kairo:gitQuickCommit',
    'kairo:listDir',
    'kairo:grepFiles',
    'kairo:listAllFiles',
    'kairo:terminalExec',
    'kairo:watchFolder',
    'kairo:getMcpServers',
    'kairo:addMcpServer',
    'kairo:removeMcpServer',
    'kairo:enableMcpServer',
    'kairo:disableMcpServer',
    'kairo:getMcpTools'
  ]) {
    ipcMain.removeHandler(channel)
  }
}

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `git exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

function mapVerdict(verdict: PermissionVerdict): ApprovalDecision {
  switch (verdict) {
    case 'allow':
      return 'allow'
    case 'deny':
      return 'deny'
    case 'allow-session':
      return 'always'
  }
}
