/**
 * Structural Drift Trend — turns the change log into a health time-series so you
 * can see the system drifting (more review-flagged, more unverified changes over
 * time) before it collapses. Pure + browser-safe.
 *
 * Source: `.kairo/changes.json` (ChangeRecord[]). We bucket changes in order
 * (equal-sized chunks) rather than by wall-clock, so a sparse log still yields a
 * readable trend.
 */

import type { ChangeRecord } from './map-delta'

export interface DriftPoint {
  total: number
  /** Fraction flagged for review (0..1). */
  reviewRate: number
  /** Fraction that ran no tests (0..1); undefined `verified` counts as unverified. */
  unverifiedRate: number
}

export interface DriftTrend {
  points: DriftPoint[]
  /** Health is degrading: unverified rate rose materially from first to last bucket. */
  worsening: boolean
}

const WORSENING_DELTA = 0.2

function bucketStats(slice: ChangeRecord[]): DriftPoint {
  const total = slice.length
  const review = slice.filter((c) => c.risk === 'review').length
  const unverified = slice.filter((c) => c.verified !== true).length
  return {
    total,
    reviewRate: total > 0 ? review / total : 0,
    unverifiedRate: total > 0 ? unverified / total : 0
  }
}

export function computeDriftTrend(changes: ChangeRecord[], buckets = 6): DriftTrend {
  const sorted = [...changes].sort((a, b) => a.at - b.at)
  const n = sorted.length
  if (n === 0) return { points: [], worsening: false }
  const k = Math.min(buckets, n)
  const points: DriftPoint[] = []
  for (let i = 0; i < k; i++) {
    const start = Math.floor((i * n) / k)
    const end = Math.floor(((i + 1) * n) / k)
    points.push(bucketStats(sorted.slice(start, end)))
  }
  const worsening =
    k >= 2 && points[k - 1]!.unverifiedRate - points[0]!.unverifiedRate > WORSENING_DELTA
  return { points, worsening }
}
