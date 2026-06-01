import { describe, expect, it } from 'vitest'
import { computeTrackRecord, pct } from './track-record'
import type { ChangeRecord } from './map-delta'
import type { GateDecision } from './types'

const ch = (risk: 'auto' | 'review', verified?: boolean): ChangeRecord => ({
  at: 1,
  task: 't',
  modules: ['m'],
  filesChanged: ['m/x.ts'],
  risk,
  ...(verified !== undefined ? { verified } : {})
})

const dec = (outcome: 'passed' | 'changes'): GateDecision => ({
  at: 1,
  outcome,
  files: ['m/x.ts'],
  modules: ['m']
})

describe('computeTrackRecord', () => {
  it('aggregates auto/review and verification rates over the change log', () => {
    const tr = computeTrackRecord([ch('auto', true), ch('auto', false), ch('review', true), ch('review')], [])
    expect(tr.total).toBe(4)
    expect(tr.autoCount).toBe(2)
    expect(tr.reviewCount).toBe(2)
    expect(tr.autoRate).toBe(0.5)
    expect(tr.verifiedCount).toBe(2)
    expect(tr.verifyRate).toBe(0.5)
  })

  it('computes accept rate only over reviewed decisions', () => {
    const tr = computeTrackRecord([], [dec('passed'), dec('passed'), dec('changes')])
    expect(tr.passedCount).toBe(2)
    expect(tr.changesCount).toBe(1)
    expect(tr.acceptRate).toBeCloseTo(2 / 3)
  })

  it('leaves accept rate undefined when nothing was reviewed', () => {
    const tr = computeTrackRecord([ch('auto', true)], [])
    expect(tr.acceptRate).toBeUndefined()
  })

  it('is all-zero for an empty workspace', () => {
    const tr = computeTrackRecord([], [])
    expect(tr).toMatchObject({ total: 0, autoRate: 0, verifyRate: 0, passedCount: 0, changesCount: 0 })
    expect(tr.acceptRate).toBeUndefined()
  })

  it('pct rounds to a whole percentage', () => {
    expect(pct(0.666)).toBe('67%')
    expect(pct(0)).toBe('0%')
    expect(pct(1)).toBe('100%')
  })
})
