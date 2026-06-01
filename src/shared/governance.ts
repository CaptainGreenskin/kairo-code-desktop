/**
 * From measuring to governing. The instrument already quantifies comprehension
 * debt and structural drift — but measurement alone is "测而不治". This turns
 * those signals into a standing verdict + recommended action, so a fleet
 * accumulating unconfirmed high-risk changes raises an alarm instead of quietly
 * rotting. Pure + browser-safe.
 */

import type { ComprehensionDebt } from './comprehension-debt'
import type { DriftTrend } from './drift-trend'

/** What the workspace should do right now, given its comprehension health. */
export type GovernanceAction = 'ok' | 'review-first' | 'freeze'

export interface GovernanceVerdict {
  action: GovernanceAction
  /** One-line reason; empty when action is 'ok'. */
  reason: string
  /** Modules implicated (for pointing the human at the work). */
  modules: string[]
}

/** Debt count at/above which we recommend freezing further dispatch. */
export const FREEZE_DEBT = 3

/**
 * Decide the governance action. Ordered by severity — debt is the loudest
 * signal (changes nobody understood that shipped anyway), then drift.
 */
export function governanceVerdict(p: {
  debt: ComprehensionDebt | null
  drift: DriftTrend | null
}): GovernanceVerdict {
  const debt = p.debt
  if (debt && debt.count >= FREEZE_DEBT) {
    return {
      action: 'freeze',
      reason: `${debt.count} 处高风险变更没人确认过 — 建议先理解，再对这些模块派单`,
      modules: debt.modules.slice(0, 6)
    }
  }
  if (debt && debt.count > 0) {
    return {
      action: 'review-first',
      reason: `${debt.count} 处变更待确认 — 派单前先在闸门理解`,
      modules: debt.modules.slice(0, 6)
    }
  }
  if (p.drift?.worsening) {
    return { action: 'review-first', reason: '未验证变更占比在上升 — 结构在漂移', modules: [] }
  }
  return { action: 'ok', reason: '', modules: [] }
}
