/**
 * Agent Track Record — aggregates the workspace's change log + gate decisions
 * into a trust signal: how much of the AI's work the human accepted as-is, how
 * much was verified, and how much demanded review. Governing a fleet needs data,
 * not vibes — this turns the persisted history into a few glanceable rates.
 *
 * Pure + browser-safe. Sources: `.kairo/changes.json` (ChangeRecord[]) and
 * `.kairo/decisions.json` (GateDecision[]).
 */

import type { ChangeRecord } from './map-delta'
import type { GateDecision } from './types'

export interface TrackRecord {
  /** Total recorded changes. */
  total: number
  /** Changes the gate auto-passed (low-risk) vs flagged for review. */
  autoCount: number
  reviewCount: number
  /** Fraction auto-passed (0..1); 0 when no changes. */
  autoRate: number
  /** Changes that actually ran tests, and the fraction (0..1). */
  verifiedCount: number
  verifyRate: number
  /** Gate decisions split by outcome. */
  passedCount: number
  changesCount: number
  /**
   * Accept rate: of the changes a human reviewed, the fraction they passed
   * as-is (vs sent back for changes). Undefined when nothing was reviewed —
   * an accept rate over zero reviews would be misleading.
   */
  acceptRate?: number
}

function rate(n: number, d: number): number {
  return d > 0 ? n / d : 0
}

export function computeTrackRecord(changes: ChangeRecord[], decisions: GateDecision[]): TrackRecord {
  const total = changes.length
  const autoCount = changes.filter((c) => c.risk === 'auto').length
  const reviewCount = total - autoCount
  const verifiedCount = changes.filter((c) => c.verified === true).length

  const passedCount = decisions.filter((d) => d.outcome === 'passed').length
  const changesCount = decisions.filter((d) => d.outcome === 'changes').length
  const reviewed = passedCount + changesCount

  return {
    total,
    autoCount,
    reviewCount,
    autoRate: rate(autoCount, total),
    verifiedCount,
    verifyRate: rate(verifiedCount, total),
    passedCount,
    changesCount,
    ...(reviewed > 0 ? { acceptRate: rate(passedCount, reviewed) } : {})
  }
}

/** Format a 0..1 rate as a whole-number percentage string. */
export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`
}
