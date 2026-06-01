/**
 * Comprehension Debt — a direct measure of "comprehension collapse": the
 * high-risk crew changes (the gate flagged for review) that a human NEVER
 * actually confirmed at a gate. They shipped without anyone understanding them.
 * The longer this list, the less of the system anyone truly understands.
 *
 * Pure + browser-safe. Sources: `.kairo/changes.json` (ChangeRecord[]) +
 * `.kairo/decisions.json` (GateDecision[]).
 */

import type { ChangeRecord } from './map-delta'
import type { GateDecision } from './types'

export interface DebtItem {
  change: ChangeRecord
  /** Why it's still owed understanding. */
  reasons: Array<'unconfirmed' | 'unverified'>
}

export interface ComprehensionDebt {
  items: DebtItem[]
  count: number
  /** Timestamp of the oldest unpaid debt (0 when none). */
  oldestAt: number
  /** Distinct modules carrying debt. */
  modules: string[]
}

function overlaps(a: string[], b: string[]): boolean {
  const set = new Set(a)
  return b.some((x) => set.has(x))
}

/**
 * A review-flagged change is "confirmed" when some gate decision recorded at or
 * after it touches an overlapping module — i.e. a human engaged with that area.
 * Everything else is debt. Unverified review changes are flagged too.
 */
export function computeComprehensionDebt(
  changes: ChangeRecord[],
  decisions: GateDecision[]
): ComprehensionDebt {
  const items: DebtItem[] = []
  const moduleSet = new Set<string>()
  let oldestAt = 0

  for (const c of changes) {
    if (c.risk !== 'review') continue
    const confirmed = decisions.some((d) => d.at >= c.at && overlaps(d.modules, c.modules))
    const reasons: Array<'unconfirmed' | 'unverified'> = []
    if (!confirmed) reasons.push('unconfirmed')
    if (c.verified === false) reasons.push('unverified')
    // Debt requires the change to be unconfirmed (the core signal). An
    // unverified-but-confirmed change is acceptable — a human looked at it.
    if (!confirmed) {
      items.push({ change: c, reasons })
      for (const m of c.modules) moduleSet.add(m)
      if (oldestAt === 0 || c.at < oldestAt) oldestAt = c.at
    }
  }

  // Newest debt first — most actionable.
  items.sort((a, b) => b.change.at - a.change.at)
  return { items, count: items.length, oldestAt, modules: [...moduleSet] }
}
