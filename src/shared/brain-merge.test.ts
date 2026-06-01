import { describe, expect, it } from 'vitest'
import { mergeChanges, mergeGateDecisions } from './brain-merge'
import type { ChangeRecord } from './map-delta'
import type { GateDecision } from './types'

describe('mergeGateDecisions', () => {
  it('dedups identical decisions across sources and sorts by time', () => {
    const local: GateDecision[] = [
      { at: 200, outcome: 'passed', question: 'q2', files: [], modules: ['b'] },
      { at: 100, outcome: 'passed', question: 'q1', files: [], modules: ['a'] }
    ]
    const shared: GateDecision[] = [
      { at: 100, outcome: 'passed', question: 'q1', files: [], modules: ['a'] }, // dup
      { at: 300, outcome: 'changes', question: 'q3', files: [], modules: ['c'] }
    ]
    const merged = mergeGateDecisions(local, shared)
    expect(merged.map((d) => d.at)).toEqual([100, 200, 300])
  })

  it('keeps decisions that differ only by rationale', () => {
    const a: GateDecision[] = [{ at: 1, outcome: 'passed', files: [], modules: ['x'], rationale: 'why-a' }]
    const b: GateDecision[] = [{ at: 1, outcome: 'passed', files: [], modules: ['x'], rationale: 'why-b' }]
    expect(mergeGateDecisions(a, b)).toHaveLength(2)
  })
})

describe('mergeChanges', () => {
  it('dedups identical changes across sources', () => {
    const c: ChangeRecord = { at: 1, task: 't', modules: ['a'], filesChanged: [], risk: 'auto' }
    expect(mergeChanges([c], [c, { ...c, at: 2 }]).map((x) => x.at)).toEqual([1, 2])
  })
})
