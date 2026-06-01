/**
 * Team Brain. The Brain is per-workspace local files (`.kairo/*.json`). When a
 * team commits a shared copy (e.g. `.kairo/decisions.shared.json`, synced via
 * git), multiple people/agents append concurrently and the same decision can
 * appear twice. These pure merges fold local + shared into one deduped,
 * chronologically-ordered Brain. Pure + browser-safe.
 */

import type { ChangeRecord } from './map-delta'
import type { GateDecision } from './types'

/** Dedup gate decisions across sources (key: time + outcome + modules + why). */
export function mergeGateDecisions(...lists: GateDecision[][]): GateDecision[] {
  const seen = new Set<string>()
  const out: GateDecision[] = []
  for (const list of lists) {
    for (const d of list) {
      const key = `${d.at}|${d.outcome}|${[...d.modules].sort().join(',')}|${d.rationale ?? d.question ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(d)
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

/** Dedup change records across sources (key: time + task + modules). */
export function mergeChanges(...lists: ChangeRecord[][]): ChangeRecord[] {
  const seen = new Set<string>()
  const out: ChangeRecord[] = []
  for (const list of lists) {
    for (const c of list) {
      const key = `${c.at}|${c.task}|${[...c.modules].sort().join(',')}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(c)
    }
  }
  return out.sort((a, b) => a.at - b.at)
}
