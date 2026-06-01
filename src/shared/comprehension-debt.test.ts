import { describe, expect, it } from 'vitest'
import { computeComprehensionDebt } from './comprehension-debt'
import type { ChangeRecord } from './map-delta'
import type { GateDecision } from './types'

const ch = (at: number, modules: string[], risk: 'auto' | 'review', verified?: boolean): ChangeRecord => ({
  at,
  task: `t${at}`,
  modules,
  filesChanged: modules.map((m) => `${m}/x.ts`),
  risk,
  ...(verified !== undefined ? { verified } : {})
})

const dec = (at: number, modules: string[]): GateDecision => ({ at, outcome: 'passed', files: [], modules })

describe('computeComprehensionDebt', () => {
  it('counts review changes never confirmed at a gate', () => {
    const d = computeComprehensionDebt([ch(100, ['a'], 'review'), ch(200, ['b'], 'review')], [])
    expect(d.count).toBe(2)
    expect(d.modules.sort()).toEqual(['a', 'b'])
    expect(d.oldestAt).toBe(100)
  })

  it('clears debt when a later decision touches an overlapping module', () => {
    const d = computeComprehensionDebt([ch(100, ['a'], 'review')], [dec(150, ['a'])])
    expect(d.count).toBe(0)
  })

  it('a decision BEFORE the change does not clear it', () => {
    const d = computeComprehensionDebt([ch(200, ['a'], 'review')], [dec(100, ['a'])])
    expect(d.count).toBe(1)
  })

  it('auto-passed (low-risk) changes are not debt', () => {
    const d = computeComprehensionDebt([ch(100, ['a'], 'auto', false)], [])
    expect(d.count).toBe(0)
  })

  it('flags unverified as an extra reason on unconfirmed review changes', () => {
    const d = computeComprehensionDebt([ch(100, ['a'], 'review', false)], [])
    expect(d.items[0]?.reasons).toContain('unconfirmed')
    expect(d.items[0]?.reasons).toContain('unverified')
  })

  it('orders newest debt first', () => {
    const d = computeComprehensionDebt([ch(100, ['a'], 'review'), ch(300, ['b'], 'review')], [])
    expect(d.items.map((i) => i.change.at)).toEqual([300, 100])
  })
})
