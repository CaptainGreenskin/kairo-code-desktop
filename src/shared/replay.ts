/**
 * Comprehension Replay — time-travel for the system, not the files. Instead of
 * reading 40 PRs to catch up, scrub a timeline and WATCH the structure evolve:
 * each step lights up the modules that changed at that moment (crew change or
 * git commit), rebuilding the mental model by replay. Pure + browser-safe.
 */

import { dirOf } from './code-map'
import type { ChangeRecord } from './map-delta'
import type { GitCommit } from './git-brain'

export interface ReplayStep {
  at: number
  /** Modules touched at this moment. */
  modules: string[]
  /** Short label (commit subject / crew task). */
  label: string
  source: 'crew' | 'git'
}

/**
 * Build a chronological replay timeline from the crew change log + git history.
 * Oldest first, so scrubbing left→right replays history forward. Each event is
 * one step; modules are de-duplicated within a step. Capped to the most recent
 * `limit` steps (the tail is what you need to catch up on).
 */
export function buildReplay(
  data: { changes: ChangeRecord[]; commits: GitCommit[] },
  limit = 80
): ReplayStep[] {
  const steps: ReplayStep[] = []
  for (const c of data.changes) {
    steps.push({ at: c.at, modules: [...new Set(c.modules)], label: c.task || '（变更）', source: 'crew' })
  }
  for (const c of data.commits) {
    const mods = [...new Set(c.files.map((f) => dirOf(f)))]
    steps.push({ at: c.at, modules: mods, label: c.subject || '（提交）', source: 'git' })
  }
  steps.sort((a, b) => a.at - b.at)
  return steps.length > limit ? steps.slice(steps.length - limit) : steps
}

/** Modules touched cumulatively from the start up to and including step `idx`. */
export function cumulativeModules(steps: ReplayStep[], idx: number): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i <= idx && i < steps.length; i++) {
    for (const m of steps[i]!.modules) out.add(m)
  }
  return out
}
