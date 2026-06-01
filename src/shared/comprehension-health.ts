/**
 * Comprehension Health — the north-star metric. Every other tool measures the
 * SYSTEM (what changed, what's risky) or the AI (track record). This measures
 * the HUMAN: how much of the system that changed has the human actually engaged
 * with since it changed. As AI writes and you don't look, the score decays —
 * "your model of the system is N% fresh, drifting here". A proxy, not
 * mind-reading: a module is "understood" when a human reviewed it (a gate
 * decision, or a Map-Delta catch-up) at or after its last change. Weighted by
 * importance (hubs matter more than leaves). Pure + browser-safe.
 */

import { dirOf, type CodeMap } from './code-map'
import type { ChangeRecord } from './map-delta'
import type { GitCommit } from './git-brain'
import type { GateDecision } from './types'

export interface StaleModule {
  id: string
  lastChangeAt: number
  /** Latest moment a human engaged with this module (decision or catch-up). */
  lastUnderstoodAt: number
  /** Importance weight (1 + fan-in): a stale hub hurts more than a stale leaf. */
  weight: number
}

export interface ComprehensionHealth {
  /** Weighted fraction of the changed system the human still understands (0..1). */
  score: number
  /** Modules that have changed at all (the live surface). */
  liveModules: number
  freshModules: number
  /** Modules whose understanding is stale (changed since you last engaged). */
  staleModules: StaleModule[]
}

function matchesModule(id: string, c: string): boolean {
  return id === c || id.startsWith(`${c}/`) || c.startsWith(`${id}/`)
}

/**
 * Compute the workspace's comprehension health. A module is "live" if anything
 * (crew change or git commit) touched it; "fresh" if the human engaged at/after
 * its last change. Score = weighted fresh / weighted live (1.0 when nothing is
 * live — an untouched system is, trivially, fully understood).
 */
export function comprehensionHealth(input: {
  map: CodeMap
  changes: ChangeRecord[]
  commits: GitCommit[]
  decisions: GateDecision[]
  lastSeen: number
}): ComprehensionHealth {
  const { map, changes, commits, decisions, lastSeen } = input

  // Fan-in (importance) per module.
  const fanIn = new Map<string, number>()
  for (const e of map.edges) fanIn.set(e.to, (fanIn.get(e.to) ?? 0) + 1)

  let weightedLive = 0
  let weightedFresh = 0
  let liveModules = 0
  let freshModules = 0
  const stale: StaleModule[] = []

  for (const m of map.modules) {
    let lastChangeAt = 0
    for (const c of changes) {
      if (c.at > lastChangeAt && c.modules.some((mm) => matchesModule(m.id, mm))) lastChangeAt = c.at
    }
    for (const c of commits) {
      if (c.at > lastChangeAt && c.files.some((f) => matchesModule(m.id, dirOf(f)))) lastChangeAt = c.at
    }
    if (lastChangeAt === 0) continue // not live — nothing changed here

    let lastUnderstoodAt = lastSeen
    for (const d of decisions) {
      if (d.at > lastUnderstoodAt && d.modules.some((mm) => matchesModule(m.id, mm))) lastUnderstoodAt = d.at
    }

    const weight = 1 + (fanIn.get(m.id) ?? 0)
    liveModules += 1
    weightedLive += weight
    if (lastUnderstoodAt >= lastChangeAt) {
      freshModules += 1
      weightedFresh += weight
    } else {
      stale.push({ id: m.id, lastChangeAt, lastUnderstoodAt, weight })
    }
  }

  // Worst first: heaviest, then most-recently-changed.
  stale.sort((a, b) => b.weight - a.weight || b.lastChangeAt - a.lastChangeAt)

  return {
    score: weightedLive === 0 ? 1 : weightedFresh / weightedLive,
    liveModules,
    freshModules,
    staleModules: stale.slice(0, 8)
  }
}
