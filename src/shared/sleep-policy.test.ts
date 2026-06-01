import { describe, expect, it } from 'vitest'
import { clampSleepSeconds, paceFromToolCalls, DEFAULT_SLEEP_MS, MAX_SLEEP_MS } from './sleep-policy'

describe('clampSleepSeconds', () => {
  it('converts seconds to ms', () => {
    expect(clampSleepSeconds(30)).toBe(30_000)
  })
  it('caps at MAX_SLEEP_MS and floors at 0', () => {
    expect(clampSleepSeconds(99_999)).toBe(MAX_SLEEP_MS)
    expect(clampSleepSeconds(-5)).toBe(DEFAULT_SLEEP_MS)
  })
  it('falls back to default for non-numbers', () => {
    expect(clampSleepSeconds('abc')).toBe(DEFAULT_SLEEP_MS)
    expect(clampSleepSeconds(undefined)).toBe(DEFAULT_SLEEP_MS)
  })
  it('honors custom bounds', () => {
    expect(clampSleepSeconds(1, { minMs: 2000 })).toBe(2000)
  })
})

describe('paceFromToolCalls', () => {
  it('returns default when no sleep call present', () => {
    expect(paceFromToolCalls([{ toolName: 'bash', args: {} }])).toBe(DEFAULT_SLEEP_MS)
    expect(paceFromToolCalls(undefined)).toBe(DEFAULT_SLEEP_MS)
  })
  it('uses the latest sleep call requested seconds', () => {
    const calls = [
      { toolName: 'sleep', args: { seconds: 5 } },
      { toolName: 'bash', args: {} },
      { toolName: 'sleep', args: { seconds: 45 } }
    ]
    expect(paceFromToolCalls(calls)).toBe(45_000)
  })
  it('clamps the requested sleep', () => {
    expect(paceFromToolCalls([{ toolName: 'sleep', args: { seconds: 100_000 } }])).toBe(MAX_SLEEP_MS)
  })
})
