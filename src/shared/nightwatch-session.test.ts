import { describe, expect, it } from 'vitest'
import { shouldResume, DEFAULT_MAX_STALE_MS, type NightwatchSession } from './nightwatch-session'

const rec = (over: Partial<NightwatchSession> = {}): NightwatchSession => ({
  active: true,
  sessionId: 's1',
  turnsRemaining: 5,
  startedAt: 0,
  updatedAt: 1000,
  workspacePath: '/ws',
  ...over
})

describe('shouldResume', () => {
  it('resumes a fresh active run in the same workspace', () => {
    expect(shouldResume(rec(), 2000, '/ws').resume).toBe(true)
  })
  it('does not resume when inactive / no record', () => {
    expect(shouldResume(null, 2000, '/ws').resume).toBe(false)
    expect(shouldResume(rec({ active: false }), 2000, '/ws').resume).toBe(false)
  })
  it('does not resume when turns are exhausted', () => {
    expect(shouldResume(rec({ turnsRemaining: 0 }), 2000, '/ws').resume).toBe(false)
  })
  it('does not resume a stale record', () => {
    expect(shouldResume(rec({ updatedAt: 1000 }), 1000 + DEFAULT_MAX_STALE_MS + 1, '/ws').resume).toBe(false)
  })
  it('does not resume in a different workspace', () => {
    expect(shouldResume(rec({ workspacePath: '/other' }), 2000, '/ws').resume).toBe(false)
  })
})
