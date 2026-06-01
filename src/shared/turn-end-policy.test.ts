import { describe, expect, it } from 'vitest'
import { planTurnEnd } from './turn-end-policy'

const base = {
  autopilotEnabled: true,
  contextRatio: 0.3,
  turnsRemaining: 5,
  modelWantsMore: true,
  startedAt: 0,
  now: 1000,
  tokensUsed: 0,
  lastToolCalls: [] as Array<{ toolName: string; args?: Record<string, unknown> }>
}

describe('planTurnEnd (composed autonomy loop)', () => {
  it('continues with default pace when budgets are fine and context is low', () => {
    const p = planTurnEnd(base)
    expect(p.compact).toBe('none')
    expect(p.autonomy).toEqual({ action: 'continue', delayMs: 800 })
  })

  it('auto-compacts AND continues when context is full mid-run (unattended)', () => {
    const p = planTurnEnd({ ...base, contextRatio: 0.85 })
    expect(p.compact).toBe('auto') // autopilot compacts at 0.8
    expect(p.autonomy?.action).toBe('continue')
  })

  it('honours the model SleepTool pace for the next iteration', () => {
    const p = planTurnEnd({ ...base, lastToolCalls: [{ toolName: 'sleep', args: { seconds: 30 } }] })
    expect(p.autonomy).toEqual({ action: 'continue', delayMs: 30_000 })
  })

  it('stops on the token (cost) budget even if turns remain', () => {
    const p = planTurnEnd({ ...base, tokensUsed: 600_000, maxTokens: 500_000 })
    expect(p.autonomy).toMatchObject({ action: 'stop', reason: '达到成本(token)预算' })
  })

  it('stops when the model is done (task complete)', () => {
    expect(planTurnEnd({ ...base, modelWantsMore: false }).autonomy?.action).toBe('stop')
  })

  it('no autonomy decision when autopilot is off, but compaction still suggested', () => {
    const p = planTurnEnd({ ...base, autopilotEnabled: false, contextRatio: 0.82 })
    expect(p.autonomy).toBeNull()
    expect(p.compact).toBe('suggest') // attended → suggest, not auto
  })
})
