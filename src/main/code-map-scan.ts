/**
 * Scans a workspace for source files and builds the Code System Map. Lives in
 * main (needs fs); the pure model is in shared/code-map.ts.
 *
 * Large repos make a full re-read on every open expensive, so the scanner keeps
 * a per-workspace cache of extracted {@link FileFacts} keyed by mtime + size.
 * A rescan still walks the tree (cheap `readdir`/`stat`), but only re-reads and
 * re-parses files whose mtime or size changed, then re-assembles the (cheap)
 * graph. Deleted files are pruned. This turns repeat scans from O(read every
 * file) into O(stat every file) + O(read changed files).
 */

import { promises as fs } from 'node:fs'
import * as nodePath from 'node:path'
import {
  buildCodeMapFromFacts,
  buildCouplingGraph,
  buildFileGraph,
  toFileFacts,
  type CodeMap,
  type CouplingEdge,
  type CouplingSignal,
  type FileEdge,
  type FileFacts
} from '../shared/code-map'
import type { CodeMapScanStats } from '../shared/types'

const SOURCE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.java', '.kt', '.py', '.go', '.rs', '.rb', '.php', '.cs', '.scala', '.swift'
])
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'out', 'dist', '.next', '.nuxt', 'coverage',
  '.cache', '.turbo', '.idea', '.vscode', '__pycache__', 'test-results',
  'playwright-report',
  // JVM / other build + dependency dirs
  'target', 'build', '.gradle', 'bin', 'vendor', 'venv', '.venv', '.mvn'
])
const MAX_FILES = 4000
const MAX_BYTES = 400_000
const SCAN_TIMEOUT_MS = 15_000

/** Detect monorepo and return the relevant sub-package root if applicable. */
async function detectMonorepoRoot(workspaceRoot: string): Promise<string> {
  try {
    const pkgPath = nodePath.join(workspaceRoot, 'package.json')
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8')) as Record<string, unknown>
    // If this is a monorepo root (has workspaces), check if cwd is inside a sub-package
    if (Array.isArray(pkg.workspaces)) {
      // Already at the monorepo root — don't scan all packages, just common dirs
      return workspaceRoot
    }
  } catch {
    // no package.json — not a JS/TS project, scan as-is
  }
  return workspaceRoot
}

interface CachedFile {
  mtimeMs: number
  size: number
  facts: FileFacts
}

interface CacheEntry {
  /** Relative path → cached extraction. */
  files: Map<string, CachedFile>
}

const cache = new Map<string, CacheEntry>()

export type ScanStats = CodeMapScanStats

/** Build the Code System Map for a workspace, reusing the incremental cache. */
export async function scanCodeMap(workspaceRoot: string): Promise<CodeMap> {
  const { map } = await scanCodeMapWithStats(workspaceRoot)
  return map
}

/** Like {@link scanCodeMap} but also reports cache-hit / timing stats. */
export async function scanCodeMapWithStats(
  workspaceRoot: string
): Promise<{ map: CodeMap; stats: ScanStats }> {
  const started = Date.now()
  const entry = cache.get(workspaceRoot) ?? { files: new Map<string, CachedFile>() }
  const seen = new Set<string>()
  let total = 0
  let reused = 0
  let read = 0

  const deadline = Date.now() + SCAN_TIMEOUT_MS
  let batchCount = 0

  const walk = async (dir: string): Promise<void> => {
    if (total >= MAX_FILES || Date.now() > deadline) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (total >= MAX_FILES || Date.now() > deadline) return
      if (SKIP_DIRS.has(e.name)) continue
      // Skip hidden dirs (dotfiles like .docker, .terraform, etc.)
      if (e.name.startsWith('.') && e.isDirectory()) continue
      const full = nodePath.join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full)
      } else if (e.isFile() && SOURCE_EXT.has(nodePath.extname(e.name))) {
        let stat
        try {
          stat = await fs.stat(full)
        } catch {
          continue
        }
        if (stat.size > MAX_BYTES) continue
        const rel = nodePath.relative(workspaceRoot, full).replace(/\\/g, '/')
        seen.add(rel)
        total += 1

        const cached = entry.files.get(rel)
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
          reused += 1
          continue
        }
        try {
          const content = await fs.readFile(full, 'utf-8')
          entry.files.set(rel, {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            facts: toFileFacts({ path: rel, content })
          })
          read += 1
        } catch {
          // skip unreadable file
        }

        // Yield to event loop every 50 files so the main process stays responsive.
        batchCount++
        if (batchCount % 50 === 0) {
          await new Promise((r) => setTimeout(r, 0))
        }
      }
    }
  }

  await walk(workspaceRoot)

  // Prune cache entries for files that no longer exist (deleted / moved).
  let removed = 0
  for (const key of [...entry.files.keys()]) {
    if (!seen.has(key)) {
      entry.files.delete(key)
      removed += 1
    }
  }

  cache.set(workspaceRoot, entry)

  const facts = [...entry.files.values()].map((c) => c.facts)
  const map = buildCodeMapFromFacts(facts)
  return {
    map,
    stats: {
      total, reused, read, removed,
      durationMs: Date.now() - started,
      cached: reused > 0,
      truncated: total >= MAX_FILES,
      timedOut: Date.now() > deadline
    }
  }
}

/** Drop the cache for one workspace (or all). Use when a workspace is closed. */
export function invalidateCodeMapCache(workspaceRoot?: string): void {
  if (workspaceRoot) cache.delete(workspaceRoot)
  else cache.clear()
}

/** Assemble the map from the current cache without walking the tree. */
export function getCachedCodeMap(workspaceRoot: string): CodeMap | null {
  const entry = cache.get(workspaceRoot)
  if (!entry) return null
  return buildCodeMapFromFacts([...entry.files.values()].map((c) => c.facts))
}

/** Cached per-file facts for a workspace (empty if not scanned yet). */
export function getCachedFacts(workspaceRoot: string): FileFacts[] {
  const entry = cache.get(workspaceRoot)
  return entry ? [...entry.files.values()].map((c) => c.facts) : []
}

/** File-level dependency graph for the workspace (scans first if needed). */
export async function scanFileGraph(workspaceRoot: string): Promise<FileEdge[]> {
  if (!cache.get(workspaceRoot)) await scanCodeMapWithStats(workspaceRoot)
  return buildFileGraph(getCachedFacts(workspaceRoot))
}

/** Hidden-coupling graph (shared tables/events/routes/flags) for the workspace. */
export async function scanCoupling(workspaceRoot: string): Promise<CouplingEdge[]> {
  if (!cache.get(workspaceRoot)) await scanCodeMapWithStats(workspaceRoot)
  return buildCouplingGraph(getCachedFacts(workspaceRoot))
}

/** All coupling signals found in a workspace (for the cross-service graph). */
export async function scanServiceSignals(workspaceRoot: string): Promise<CouplingSignal[]> {
  if (!cache.get(workspaceRoot)) await scanCodeMapWithStats(workspaceRoot)
  return getCachedFacts(workspaceRoot).flatMap((f) => f.signals ?? [])
}

/**
 * Apply a single file-watcher event to the cache for precise invalidation —
 * re-reading just the touched file instead of re-walking the whole tree. Returns
 * true when the cache changed (so the caller can re-emit the map). No-ops (false)
 * when the workspace hasn't been scanned yet (the next full scan will pick it up)
 * or the path isn't a tracked source file.
 */
export async function applyFileChange(
  workspaceRoot: string,
  absPath: string,
  changeType: 'created' | 'modified' | 'deleted'
): Promise<boolean> {
  const entry = cache.get(workspaceRoot)
  if (!entry) return false

  const rel = nodePath.relative(workspaceRoot, absPath).replace(/\\/g, '/')
  if (!rel || rel.startsWith('..') || nodePath.isAbsolute(rel)) return false
  if (rel.split('/').some((seg) => SKIP_DIRS.has(seg))) return false
  if (!SOURCE_EXT.has(nodePath.extname(absPath))) return false

  if (changeType === 'deleted') {
    return entry.files.delete(rel)
  }

  // created / modified → re-read + re-extract this one file.
  try {
    const stat = await fs.stat(absPath)
    if (stat.size > MAX_BYTES) return entry.files.delete(rel)
    // Respect the soft cap, but always allow updating a file we already track.
    if (!entry.files.has(rel) && entry.files.size >= MAX_FILES) return false
    const content = await fs.readFile(absPath, 'utf-8')
    entry.files.set(rel, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      facts: toFileFacts({ path: rel, content })
    })
    return true
  } catch {
    return entry.files.delete(rel)
  }
}
