/**
 * Change Lens builder — pure functions that turn a crew run's tool activity
 * into a comprehension-first view (blast radius + verification ledger).
 *
 * Design constraint: optimize for human UNDERSTANDING, not AI output volume.
 * No prose is generated here — only structured, glanceable facts.
 */

import type { ChangeLens, ChangeLensModule, VerificationRun } from '../shared/types'
import { analyzeBehaviorDelta } from '../shared/behavior-delta'
import { detectArchitectureDeviations } from '../shared/architecture-deviation'
import { transitiveImpact, type CodeMap } from '../shared/code-map'

// Presentation lives in shared/ so the renderer can import it too.
export { lensToMarkdown } from '../shared/change-lens-format'

/** A single tool invocation captured during a crew run. */
export interface CrewToolRecord {
  toolName: string
  args: Record<string, unknown>
  ok: boolean
}

const WRITE_TOOLS = new Set(['write_file', 'edit'])
const EXEC_TOOLS = new Set(['bash'])
const TEST_PATTERN = /\b(test|spec|vitest|jest|pytest|go\s+test|cargo\s+test|mocha|playwright)\b/i

function fileArg(args: Record<string, unknown>): string | undefined {
  const p = args.path ?? args.file ?? args.filePath
  return typeof p === 'string' && p.length > 0 ? p : undefined
}

function commandArg(args: Record<string, unknown>): string | undefined {
  const c = args.command ?? args.cmd ?? args.script
  return typeof c === 'string' && c.length > 0 ? c : undefined
}

/** Group a changed path into a module/region key (first 2 path segments). */
export function moduleOf(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/').replace(/^\.\//, '')
  const segs = norm.split('/').filter(Boolean)
  if (segs.length <= 1) return '(root)'
  return segs.slice(0, 2).join('/')
}

/**
 * Build a Change Lens from the tool records of a crew run. Pure and
 * deterministic — `uncertaintyFlags` are layered in separately (LLM).
 */
export function buildChangeLens(
  records: CrewToolRecord[],
  uncertaintyFlags: string[] = [],
  codeMap?: CodeMap | null
): ChangeLens {
  const filesChangedSet = new Set<string>()
  const ran: VerificationRun[] = []

  for (const rec of records) {
    if (WRITE_TOOLS.has(rec.toolName)) {
      const f = fileArg(rec.args)
      if (f) filesChangedSet.add(f.replace(/\\/g, '/').replace(/^\.\//, ''))
    } else if (EXEC_TOOLS.has(rec.toolName)) {
      const cmd = commandArg(rec.args)
      if (cmd) ran.push({ command: cmd, ok: rec.ok })
    }
  }

  const filesChanged = [...filesChangedSet].sort()

  // Blast radius: group changed files by module.
  const byModule = new Map<string, string[]>()
  for (const f of filesChanged) {
    const m = moduleOf(f)
    const list = byModule.get(m) ?? []
    list.push(f)
    byModule.set(m, list)
  }
  const blastRadius: ChangeLensModule[] = [...byModule.entries()]
    .map(([module, files]) => ({ module, files: files.sort() }))
    .sort((a, b) => a.module.localeCompare(b.module))

  const testsRun = ran.some((r) => TEST_PATTERN.test(r.command))
  let warning: string | undefined
  if (filesChanged.length > 0 && !testsRun) {
    warning =
      ran.length === 0
        ? `Nothing was executed to verify ${filesChanged.length} changed file(s).`
        : `No tests were run for ${filesChanged.length} changed file(s).`
  } else if (ran.some((r) => !r.ok)) {
    warning = 'Some executed commands failed — verification is not clean.'
  }

  const behaviorDelta = analyzeBehaviorDelta(records)
  const deviations = codeMap ? detectArchitectureDeviations(records, codeMap) : []

  // Transitive downstream: modules that depend (directly/indirectly) on the
  // changed ones — the impact the human is most likely to underestimate.
  let downstreamModules: string[] = []
  if (codeMap) {
    const seeds = blastRadius.map((b) => b.module)
    const impact = transitiveImpact(codeMap.edges, seeds)
    const seedSet = new Set(seeds)
    downstreamModules = [...impact.keys()].filter((m) => impact.get(m)! > 0 && !seedSet.has(m))
  }

  return {
    blastRadius,
    filesChanged,
    verification: {
      ran,
      filesWritten: filesChanged,
      testsRun,
      ...(warning ? { warning } : {})
    },
    uncertaintyFlags: uncertaintyFlags.slice(0, 3),
    ...(behaviorDelta.length > 0 ? { behaviorDelta } : {}),
    ...(deviations.length > 0 ? { deviations } : {}),
    ...(downstreamModules.length > 0 ? { downstreamModules } : {})
  }
}

/**
 * Parse a model's uncertainty-flag reply into ≤3 short strings. Defensive:
 * accepts a raw JSON array, a fenced block, or newline/bullet lists.
 */
export function parseUncertaintyFlags(text: string): string[] {
  if (!text) return []
  const trimmed = text.trim()

  // Try to extract the first JSON array.
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const arr = JSON.parse(trimmed.slice(start, end + 1)) as unknown
      if (Array.isArray(arr)) {
        return arr
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 3)
      }
    } catch {
      // fall through to line parsing
    }
  }

  // Fallback: bullet / numbered / plain lines.
  return trimmed
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 0 && !/^```/.test(l))
    .slice(0, 3)
}

