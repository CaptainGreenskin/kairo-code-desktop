import { describe, expect, it } from 'vitest'
import { nextNightwatchAction, type NightwatchState, DEFAULT_MAX_WALLCLOCK_MS } from './nightwatch'

const base: NightwatchState = {
  enabled: true,
  turnsRemaining: 5,
  modelWantsMore: true,
  startedAt: 0,
  now: 1000,
  maxWallClockMs: DEFAULT_MAX_WALLCLOCK_MS
}

describe('nextNightwatchAction', () => {
  it('continues with a self-paced delay when work remains and budgets are fine', () => {
    const a = nextNightwatchAction(base, 800)
    expect(a).toEqual({ action: 'continue', delayMs: 800 })
  })

  it('stops when the model no longer wants to continue (task done)', () => {
    expect(nextNightwatchAction({ ...base, modelWantsMore: false }).action).toBe('stop')
    expect(nextNightwatchAction({ ...base, modelWantsMore: false }).action === 'stop').toBe(true)
  })

  it('stops at the turn budget', () => {
    const a = nextNightwatchAction({ ...base, turnsRemaining: 0 })
    expect(a).toMatchObject({ action: 'stop', reason: '达到最大轮数' })
  })

  it('stops at the wall-clock budget', () => {
    const a = nextNightwatchAction({ ...base, now: DEFAULT_MAX_WALLCLOCK_MS + 1 })
    expect(a).toMatchObject({ action: 'stop', reason: '达到时间预算' })
  })

  it('stops at the token (cost) budget', () => {
    const a = nextNightwatchAction({ ...base, tokensUsed: 600_000, maxTokens: 500_000 })
    expect(a).toMatchObject({ action: 'stop', reason: '达到成本(token)预算' })
    // No cap → keeps going.
    expect(nextNightwatchAction({ ...base, tokensUsed: 999_999, maxTokens: 0 }).action).toBe('continue')
  })

  it('stops on explicit request and when disabled, with priority', () => {
    expect(nextNightwatchAction({ ...base, stopRequested: true }).action).toBe('stop')
    expect(nextNightwatchAction({ ...base, enabled: false }).action).toBe('stop')
    // stopRequested wins even if other conditions also hold.
    expect(nextNightwatchAction({ ...base, stopRequested: true, turnsRemaining: 0 })).toMatchObject({
      reason: '已手动停止'
    })
  })
})
