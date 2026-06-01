import { describe, expect, it } from 'vitest'
import { autoCompactDecision } from './context-policy'

describe('autoCompactDecision', () => {
  it('does nothing when the window is comfortably under budget', () => {
    expect(autoCompactDecision(0.5)).toBe('none')
    expect(autoCompactDecision(0.79)).toBe('none')
  })

  it('suggests compaction at the suggest threshold when attended', () => {
    expect(autoCompactDecision(0.8)).toBe('suggest')
    expect(autoCompactDecision(0.85)).toBe('suggest')
  })

  it('auto-compacts when nearly full even when attended', () => {
    expect(autoCompactDecision(0.9)).toBe('auto')
    expect(autoCompactDecision(0.97)).toBe('auto')
  })

  it('auto-compacts earlier when unattended (autopilot/overnight)', () => {
    expect(autoCompactDecision(0.82, { autopilot: true })).toBe('auto')
    expect(autoCompactDecision(0.5, { autopilot: true })).toBe('none')
  })

  it('honors custom thresholds', () => {
    expect(autoCompactDecision(0.6, { suggestThreshold: 0.5, autoThreshold: 0.7 })).toBe('suggest')
    expect(autoCompactDecision(0.7, { suggestThreshold: 0.5, autoThreshold: 0.7 })).toBe('auto')
  })
})
