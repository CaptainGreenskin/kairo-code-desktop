import { describe, expect, it } from 'vitest'
import { computeDriftTrend } from './drift-trend'
import type { ChangeRecord } from './map-delta'

const ch = (at: number, risk: 'auto' | 'review', verified: boolean): ChangeRecord => ({
  at,
  task: 't',
  modules: ['m'],
  filesChanged: [],
  risk,
  verified
})

describe('computeDriftTrend', () => {
  it('is empty for no changes', () => {
    expect(computeDriftTrend([])).toEqual({ points: [], worsening: false })
  })

  it('buckets changes in order and computes per-bucket rates', () => {
    // 4 changes, 2 buckets: first all verified, second all unverified.
    const changes = [ch(1, 'auto', true), ch(2, 'auto', true), ch(3, 'review', false), ch(4, 'review', false)]
    const t = computeDriftTrend(changes, 2)
    expect(t.points).toHaveLength(2)
    expect(t.points[0]!.unverifiedRate).toBe(0)
    expect(t.points[1]!.unverifiedRate).toBe(1)
    expect(t.points[1]!.reviewRate).toBe(1)
  })

  it('flags worsening when unverified rate climbs across the series', () => {
    const changes = [ch(1, 'auto', true), ch(2, 'auto', true), ch(3, 'review', false), ch(4, 'review', false)]
    expect(computeDriftTrend(changes, 2).worsening).toBe(true)
  })

  it('does not flag worsening for a steadily healthy log', () => {
    const changes = [ch(1, 'auto', true), ch(2, 'auto', true), ch(3, 'auto', true), ch(4, 'auto', true)]
    expect(computeDriftTrend(changes, 2).worsening).toBe(false)
  })

  it('caps buckets at the number of changes', () => {
    expect(computeDriftTrend([ch(1, 'auto', true)], 6).points).toHaveLength(1)
  })
})
