import { describe, expect, it } from 'vitest'
import { shouldAlertDrift } from './useDriftWatch'

const GLOBS = ['**/auth/**', '**/payment*/**']

describe('shouldAlertDrift', () => {
  it('alerts on a first change inside an invariant region', () => {
    expect(shouldAlertDrift('src/auth/login.ts', GLOBS, undefined, 1000)).toBe(true)
  })

  it('does not alert for paths outside the protected globs', () => {
    expect(shouldAlertDrift('src/util/a.ts', GLOBS, undefined, 1000)).toBe(false)
  })

  it('throttles repeat alerts for the same path within the window', () => {
    expect(shouldAlertDrift('src/auth/login.ts', GLOBS, 1000, 1000 + 5_000)).toBe(false)
  })

  it('alerts again once the throttle window has passed', () => {
    expect(shouldAlertDrift('src/auth/login.ts', GLOBS, 1000, 1000 + 31_000)).toBe(true)
  })
})
