/**
 * Map Delta — the Living Map's time dimension. Answers "what changed since I
 * last understood the system?" so an overnight crew run becomes "look at the
 * delta + the N things that need your judgment", not "re-read 40 PRs".
 *
 * Pure + browser-safe. The source of truth is a persisted change log
 * (`.kairo/changes.json`) plus a single "last seen" anchor that advances when
 * the human reviews a gate or explicitly marks the map as caught up.
 */

/** One crew change, appended to the log whenever a Change Lens is produced. */
export interface ChangeRecord {
  at: number
  task: string
  /** Modules in the change's blast radius. */
  modules: string[]
  filesChanged: string[]
  /** Comprehension Gate verdict for this change. */
  risk: 'auto' | 'review'
  /** Whether the crew actually ran tests for this change (Track Record). */
  verified?: boolean
}

/** A module that changed since the anchor, with how often and how recently. */
export interface DeltaModule {
  id: string
  changes: number
  lastAt: number
  /** Any of its changes still need review (gate said 'review'). */
  needsJudgment: boolean
}

export interface MapDelta {
  lastSeen: number
  /** Number of changes after the anchor. */
  sinceCount: number
  /** Modules touched since the anchor, most-recent first. */
  modules: DeltaModule[]
  /** The changes that asked for review — "the N things that need your judgment". */
  needsJudgment: ChangeRecord[]
}

/**
 * Aggregate the change log into a delta relative to `lastSeen`. Only changes
 * strictly after the anchor count, so a freshly-caught-up map is empty.
 */
export function computeMapDelta(changes: ChangeRecord[], lastSeen: number): MapDelta {
  const since = changes.filter((c) => c.at > lastSeen)
  const byModule = new Map<string, DeltaModule>()
  for (const c of since) {
    const review = c.risk === 'review'
    for (const m of c.modules) {
      const cur = byModule.get(m)
      if (cur) {
        cur.changes += 1
        cur.lastAt = Math.max(cur.lastAt, c.at)
        cur.needsJudgment = cur.needsJudgment || review
      } else {
        byModule.set(m, { id: m, changes: 1, lastAt: c.at, needsJudgment: review })
      }
    }
  }
  const modules = [...byModule.values()].sort((a, b) => b.lastAt - a.lastAt)
  const needsJudgment = since
    .filter((c) => c.risk === 'review')
    .sort((a, b) => b.at - a.at)
  return { lastSeen, sinceCount: since.length, modules, needsJudgment }
}

/** Append a change, keeping the log bounded (newest `cap` kept). */
export function appendChange(log: ChangeRecord[], rec: ChangeRecord, cap = 500): ChangeRecord[] {
  const next = [...log, rec]
  return next.length > cap ? next.slice(next.length - cap) : next
}
