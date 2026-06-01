import { describe, expect, it } from 'vitest'
import { isSecretPath, redactSecrets, guardFileContent } from './secret-guard'

describe('isSecretPath', () => {
  it('flags env / key / credential files', () => {
    expect(isSecretPath('.env')).toBe(true)
    expect(isSecretPath('config/.env.production')).toBe(true)
    expect(isSecretPath('certs/server.pem')).toBe(true)
    expect(isSecretPath('id_rsa')).toBe(true)
    expect(isSecretPath('home/.ssh/config')).toBe(true)
    expect(isSecretPath('aws/credentials')).toBe(true)
  })
  it('does not flag ordinary source files', () => {
    expect(isSecretPath('src/main/agent.ts')).toBe(false)
    expect(isSecretPath('README.md')).toBe(false)
  })
})

describe('redactSecrets', () => {
  it('redacts private key blocks', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----'
    expect(redactSecrets(pem)).toBe('[REDACTED PRIVATE KEY]')
  })
  it('redacts sensitive KEY=VALUE assignments but keeps the key name', () => {
    const out = redactSecrets('API_KEY=sk-abcdef0123456789abcdef\nPORT=3000')
    expect(out).toMatch(/API_KEY=\[REDACTED\]/)
    expect(out).toMatch(/PORT=3000/) // non-sensitive untouched
  })
  it('redacts known token shapes anywhere', () => {
    expect(redactSecrets('id AKIAIOSFODNN7EXAMPLE here')).toMatch(/\[REDACTED\]/)
    expect(redactSecrets('token ghp_0123456789abcdefghijABCD')).toMatch(/\[REDACTED\]/)
  })
})

describe('guardFileContent', () => {
  it('adds a banner + redacts for secret files', () => {
    const out = guardFileContent('.env', 'DB_PASSWORD=hunter2supersecret')
    expect(out).toMatch(/已脱敏/)
    expect(out).toMatch(/DB_PASSWORD=\[REDACTED\]/)
  })
  it('passes ordinary files through (still stripping obvious tokens)', () => {
    const out = guardFileContent('src/x.ts', 'const port = 3000')
    expect(out).toBe('const port = 3000')
  })
})
