import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROTECTED_GLOBS,
  isProtectedPath,
  routeToolCall,
  type RoutingConfig
} from './comprehension-router'

const cfg: RoutingConfig = { protectedGlobs: DEFAULT_PROTECTED_GLOBS }

describe('isProtectedPath', () => {
  it('matches protected regions', () => {
    expect(isProtectedPath('src/auth/login.ts', cfg.protectedGlobs)).toBe(true)
    expect(isProtectedPath('server/payments/charge.ts', cfg.protectedGlobs)).toBe(true)
    expect(isProtectedPath('db/migrations/001.sql', cfg.protectedGlobs)).toBe(true)
    expect(isProtectedPath('.env.production', cfg.protectedGlobs)).toBe(true)
    expect(isProtectedPath('src/lib/secretStore.ts', cfg.protectedGlobs)).toBe(true)
  })

  it('does not match ordinary paths', () => {
    expect(isProtectedPath('src/components/Button.tsx', cfg.protectedGlobs)).toBe(false)
    expect(isProtectedPath('hello.txt', cfg.protectedGlobs)).toBe(false)
    expect(isProtectedPath('src/utils/format.ts', cfg.protectedGlobs)).toBe(false)
  })

  it('normalizes ./ and backslashes', () => {
    expect(isProtectedPath('./src/auth/x.ts', cfg.protectedGlobs)).toBe(true)
    expect(isProtectedPath('src\\auth\\x.ts', cfg.protectedGlobs)).toBe(true)
  })
})

describe('routeToolCall', () => {
  it('auto-runs read-only tools', () => {
    expect(routeToolCall('read_file', { path: 'src/auth/x.ts' }, cfg).decision).toBe('auto')
    expect(routeToolCall('grep', {}, cfg).decision).toBe('auto')
    expect(routeToolCall('git_diff', {}, cfg).decision).toBe('auto')
  })

  it('auto-runs ordinary writes (reversible, surfaced in the lens)', () => {
    expect(routeToolCall('write_file', { path: 'hello.txt' }, cfg).decision).toBe('auto')
    expect(routeToolCall('edit', { path: 'src/components/Button.tsx' }, cfg).decision).toBe('auto')
  })

  it('escalates writes to protected regions', () => {
    const r = routeToolCall('edit', { path: 'src/auth/login.ts' }, cfg)
    expect(r.decision).toBe('ask')
    expect(r.reason).toMatch(/protected/i)
  })

  it('escalates shell/commit/irreversible tools', () => {
    expect(routeToolCall('bash', { command: 'rm -rf x' }, cfg).decision).toBe('ask')
    expect(routeToolCall('git_commit', {}, cfg).decision).toBe('ask')
  })
})
