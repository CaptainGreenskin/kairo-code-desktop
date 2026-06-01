import { describe, expect, it } from 'vitest'
import { appendChange, computeMapDelta, type ChangeRecord } from './map-delta'

const rec = (at: number, modules: string[], risk: 'auto' | 'review' = 'auto'): ChangeRecord => ({
  at,
  task: `t${at}`,
  modules,
  filesChanged: modules.map((m) => `${m}/x.ts`),
  risk
})

describe('computeMapDelta', () => {
  it('only counts changes strictly after the anchor', () => {
    const log = [rec(100, ['a']), rec(200, ['b']), rec(300, ['c'])]
    const d = computeMapDelta(log, 200)
    expect(d.sinceCount).toBe(1)
    expect(d.modules.map((m) => m.id)).toEqual(['c'])
  })

  it('aggregates per module with count + most-recent timestamp', () => {
    const log = [rec(110, ['a']), rec(120, ['a', 'b']), rec(130, ['b'])]
    const d = computeMapDelta(log, 0)
    const a = d.modules.find((m) => m.id === 'a')!
    const b = d.modules.find((m) => m.id === 'b')!
    expect(a.changes).toBe(2)
    expect(a.lastAt).toBe(120)
    expect(b.changes).toBe(2)
    expect(b.lastAt).toBe(130)
    // Most-recent module first.
    expect(d.modules[0]!.id).toBe('b')
  })

  it('surfaces the changes that need judgment (gate=review), newest first', () => {
    const log = [rec(100, ['a'], 'auto'), rec(200, ['b'], 'review'), rec(300, ['c'], 'review')]
    const d = computeMapDelta(log, 0)
    expect(d.needsJudgment.map((c) => c.at)).toEqual([300, 200])
    expect(d.modules.find((m) => m.id === 'b')!.needsJudgment).toBe(true)
    expect(d.modules.find((m) => m.id === 'a')!.needsJudgment).toBe(false)
  })

  it('a caught-up anchor yields an empty delta', () => {
    const log = [rec(100, ['a']), rec(200, ['b'])]
    const d = computeMapDelta(log, 200)
    expect(d.sinceCount).toBe(0)
    expect(d.modules).toHaveLength(0)
    expect(d.needsJudgment).toHaveLength(0)
  })
})

describe('appendChange', () => {
  it('appends and bounds the log to the newest cap entries', () => {
    let log: ChangeRecord[] = []
    for (let i = 0; i < 5; i++) log = appendChange(log, rec(i, ['m']), 3)
    expect(log.map((c) => c.at)).toEqual([2, 3, 4])
  })
})
