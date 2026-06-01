import { describe, expect, it } from 'vitest'
import { flowSlug, parseFlowTrace, flowIsStale, type FlowTrace } from './flow-trace'

describe('flowSlug', () => {
  it('slugifies a scenario name', () => {
    expect(flowSlug('用户下单')).toBe('用户下单')
    expect(flowSlug('User Login Flow')).toBe('user-login-flow')
    expect(flowSlug('')).toBe('flow')
  })
})

describe('parseFlowTrace', () => {
  it('parses a valid trace', () => {
    const t = parseFlowTrace({
      scenario: 'login',
      entry: 'LoginController',
      steps: [
        { method: 'validate', file: 'auth.ts', line: 10, note: 'check creds' },
        { method: 'createSession', uncertain: true }
      ],
      confirmedAt: 1000
    })
    expect(t).not.toBeNull()
    expect(t!.steps).toHaveLength(2)
    expect(t!.steps[1]!.uncertain).toBe(true)
  })

  it('returns null for malformed input', () => {
    expect(parseFlowTrace(null)).toBeNull()
    expect(parseFlowTrace({})).toBeNull()
    expect(parseFlowTrace({ scenario: 'x' })).toBeNull() // no steps array
  })
})

describe('flowIsStale', () => {
  const trace: FlowTrace = {
    scenario: 'test',
    steps: [
      { method: 'a', file: 'src/a.ts' },
      { method: 'b', file: 'src/b.ts' }
    ],
    confirmedAt: 1000
  }

  it('detects staleness when a traced file was modified', () => {
    expect(flowIsStale(trace, new Set(['src/a.ts']))).toBe(true)
  })

  it('returns false when no traced files were modified', () => {
    expect(flowIsStale(trace, new Set(['src/c.ts']))).toBe(false)
  })
})
