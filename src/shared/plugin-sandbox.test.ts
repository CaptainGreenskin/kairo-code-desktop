import { describe, expect, it } from 'vitest'
import { sanitizeEnv, parsePermissions, buildSandboxWrapper } from '@kairo/plugin'

describe('sanitizeEnv', () => {
  it('strips env vars whose names match secret patterns', () => {
    const env = {
      PATH: '/usr/bin',
      HOME: '/home/x',
      MY_API_KEY: 'secret1',
      DATABASE_PASSWORD: 'secret2',
      AUTH_TOKEN: 'secret3',
      NORMAL_VAR: 'visible',
      CLAUDE_PLUGIN_ROOT: '/p'
    }
    const clean = sanitizeEnv(env)
    expect(clean.PATH).toBe('/usr/bin')
    expect(clean.HOME).toBe('/home/x')
    expect(clean.NORMAL_VAR).toBe('visible')
    expect(clean.CLAUDE_PLUGIN_ROOT).toBe('/p')
    expect(clean.MY_API_KEY).toBeUndefined()
    expect(clean.DATABASE_PASSWORD).toBeUndefined()
    expect(clean.AUTH_TOKEN).toBeUndefined()
  })

  it('respects an explicit allowlist', () => {
    const env = { SECRET_TOKEN: 'ok', OTHER_SECRET: 'nope' }
    const clean = sanitizeEnv(env, ['SECRET_TOKEN'])
    expect(clean.SECRET_TOKEN).toBe('ok')
    expect(clean.OTHER_SECRET).toBeUndefined()
  })
})

describe('parsePermissions', () => {
  it('defaults network to false when absent', () => {
    expect(parsePermissions(undefined)).toEqual({ network: false })
    expect(parsePermissions({})).toEqual({ network: false })
    expect(parsePermissions({ permissions: {} })).toEqual({ network: false })
  })

  it('reads an explicit network:true', () => {
    expect(parsePermissions({ permissions: { network: true } })).toEqual({ network: true })
  })
})

describe('buildSandboxWrapper', () => {
  it('wraps with sandbox-exec on darwin when network is false and sandbox-exec is available', () => {
    const cmd = buildSandboxWrapper('./run.sh', { network: false }, 'darwin', true)
    expect(cmd).toContain('sandbox-exec')
    expect(cmd).toContain('deny network')
    expect(cmd).toContain('./run.sh')
  })

  it('returns the command unchanged when network is declared', () => {
    expect(buildSandboxWrapper('./run.sh', { network: true }, 'darwin', true)).toBe('./run.sh')
  })

  it('returns the command unchanged on non-darwin', () => {
    expect(buildSandboxWrapper('./run.sh', { network: false }, 'linux', false)).toBe('./run.sh')
  })

  it('returns the command unchanged when sandbox-exec is absent', () => {
    expect(buildSandboxWrapper('./run.sh', { network: false }, 'darwin', false)).toBe('./run.sh')
  })
})
