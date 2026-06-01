/**
 * Personal drift — modules YOU specifically engaged with (confirmed at a gate)
 * that have since changed under you. This is sharper than workspace staleness:
 * it targets the exact parts of your mental model that have gone out of date, so
 * the instrument can push "you understood X last week — it just changed, re-check"
 * instead of a generic banner. Constitution: invert the signal, route attention
 * to where the human's understanding is now wrong. Pure + browser-safe.
 */

import { dirOf } from './code-map'
import type { ChangeRecord } from './map-delta'
import type { GitCommit } from './git-brain'
import type { GateDecision } from './types'

function matchesModule(id: string, c: string): boolean {
  return id === c || id.startsWith(`${c}/`) || c.startsWith(`${id}/`)
}

export interface DriftedModule {
  id: string
  understoodAt: number
  changedAt: number
}

/**
 * Modules that have a gate decision (you engaged) and a later change/commit
 * (it drifted). Ranked most-recently-changed first. Each module's anchor is its
 * latest decision time; a change after that = drift.
 */
export function personalDrift(input: {
  changes: ChangeRecord[]
  commits: GitCommit[]
  decisions: GateDecision[]
}): DriftedModule[] {
  const { changes, commits, decisions } = input
  // Latest decision time per engaged module.
  const understood = new Map<string, number>()
  for (const d of decisions) {
    for (const m of d.modules) {
      understood.set(m, Math.max(understood.get(m) ?? 0, d.at))
    }
  }
  if (understood.size === 0) return []

  const out: DriftedModule[] = []
  for (const [moduleId, understoodAt] of understood) {
    let changedAt = 0
    for (const c of changes) {
      if (c.at > understoodAt && c.modules.some((m) => matchesModule(moduleId, m))) {
        changedAt = Math.max(changedAt, c.at)
      }
    }
    for (const c of commits) {
      if (c.at > understoodAt && c.files.some((f) => matchesModule(moduleId, dirOf(f)))) {
        changedAt = Math.max(changedAt, c.at)
      }
    }
    if (changedAt > 0) out.push({ id: moduleId, understoodAt, changedAt })
  }
  return out.sort((a, b) => b.changedAt - a.changedAt)
}
