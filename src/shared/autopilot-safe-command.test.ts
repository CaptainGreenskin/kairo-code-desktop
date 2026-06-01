import { describe, expect, it } from 'vitest'
import { isAutopilotSafeCommand } from './autopilot-safe-command'

describe('isAutopilotSafeCommand', () => {
  it('allows build/test/read commands', () => {
    expect(isAutopilotSafeCommand('npm test')).toBe(true)
    expect(isAutopilotSafeCommand('npm run build')).toBe(true)
    expect(isAutopilotSafeCommand('pnpm lint')).toBe(true)
    expect(isAutopilotSafeCommand('vitest run')).toBe(true)
    expect(isAutopilotSafeCommand('tsc --noEmit')).toBe(true)
    expect(isAutopilotSafeCommand('ls -la && cat package.json')).toBe(true)
    expect(isAutopilotSafeCommand('git status')).toBe(true)
    expect(isAutopilotSafeCommand('git diff HEAD~1')).toBe(true)
  })

  it('blocks network / push / commit / install-with-scripts', () => {
    expect(isAutopilotSafeCommand('curl https://x.com')).toBe(false)
    expect(isAutopilotSafeCommand('git push origin main')).toBe(false)
    expect(isAutopilotSafeCommand('git commit -m x')).toBe(false)
    expect(isAutopilotSafeCommand('npm install left-pad')).toBe(false) // install not allowlisted
    expect(isAutopilotSafeCommand('npm publish')).toBe(false)
  })

  it('blocks un-analyzable shell features', () => {
    expect(isAutopilotSafeCommand('cat secrets > /tmp/x')).toBe(false) // redirection
    expect(isAutopilotSafeCommand('echo $(rm -rf /)')).toBe(false) // substitution
    expect(isAutopilotSafeCommand('npm test `whoami`')).toBe(false) // backtick
    expect(isAutopilotSafeCommand('sudo ls')).toBe(false)
    expect(isAutopilotSafeCommand('node server.js &')).toBe(false) // background + node
  })

  it('blocks unknown programs and compound commands with one bad segment', () => {
    expect(isAutopilotSafeCommand('node evil.js')).toBe(false)
    expect(isAutopilotSafeCommand('npm test && curl evil.com')).toBe(false)
    expect(isAutopilotSafeCommand('rm -rf dist')).toBe(false)
  })

  it('rejects empty input', () => {
    expect(isAutopilotSafeCommand('   ')).toBe(false)
  })
})
