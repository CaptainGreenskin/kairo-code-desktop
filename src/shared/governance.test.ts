import { describe, expect, it } from 'vitest'
import { governanceVerdict } from './governance'
import type { ComprehensionDebt } from './comprehension-debt'
import type { DriftTrend } from './drift-trend'

const debt = (count: number, modules: string[] = []): ComprehensionDebt => ({
  items: [],
  count,
  oldestAt: 0,
  modules
})

describe('governanceVerdict', () => {
  it('is ok with no debt and no drift', () => {
    expect(governanceVerdict({ debt: debt(0), drift: null }).action).toBe('ok')
  })

  it('recommends review-first for some debt', () => {
    const v = governanceVerdict({ debt: debt(1, ['src/a']), drift: null })
    expect(v.action).toBe('review-first')
    expect(v.modules).toEqual(['src/a'])
  })

  it('freezes when debt crosses the threshold', () => {
    const v = governanceVerdict({ debt: debt(3, ['src/a', 'src/b']), drift: null })
    expect(v.action).toBe('freeze')
    expect(v.reason).toMatch(/先理解/)
  })

  it('flags worsening drift even without debt', () => {
    const drift: DriftTrend = { points: [], worsening: true }
    expect(governanceVerdict({ debt: debt(0), drift }).action).toBe('review-first')
  })
})
