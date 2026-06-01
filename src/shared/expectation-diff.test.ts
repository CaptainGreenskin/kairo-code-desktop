import { describe, expect, it } from 'vitest'
import { expectationDiff } from './expectation-diff'

describe('expectationDiff', () => {
  it('surfaces touched-but-not-expected as unexpected', () => {
    const d = expectationDiff(['src/main'], ['src/main', 'src/shared'])
    expect(d.unexpected).toEqual(['src/shared'])
    expect(d.asExpected).toEqual(['src/main'])
    expect(d.missed).toEqual([])
    expect(d.hasExpectation).toBe(true)
  })

  it('reports expected-but-not-touched as missed', () => {
    const d = expectationDiff(['src/main', 'src/db'], ['src/main'])
    expect(d.missed).toEqual(['src/db'])
    expect(d.unexpected).toEqual([])
  })

  it('matches by path prefix in both directions', () => {
    expect(expectationDiff(['src'], ['src/main']).unexpected).toEqual([])
    expect(expectationDiff(['src/main/sub'], ['src/main']).asExpected).toEqual(['src/main'])
  })

  it('with no expectation set, everything touched is unexpected and hasExpectation is false', () => {
    const d = expectationDiff([], ['src/main', 'src/shared'])
    expect(d.hasExpectation).toBe(false)
    expect(d.unexpected).toEqual(['src/main', 'src/shared'])
  })
})
