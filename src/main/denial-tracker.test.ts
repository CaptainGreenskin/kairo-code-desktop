import { describe, expect, it } from 'vitest'
import { DenialTracker, denialKey } from './denial-tracker'

describe('DenialTracker', () => {
  it('nudges after N consecutive failures of the same op, then resets the streak', () => {
    const t = new DenialTracker({ maxConsecutive: 3 })
    expect(t.record('bash:rm', true)).toBeNull()
    expect(t.record('bash:rm', true)).toBeNull()
    const nudge = t.record('bash:rm', true)
    expect(nudge).toMatch(/连续失败 3 次/)
    // Streak reset → counts up again before the next nudge.
    expect(t.record('bash:rm', true)).toBeNull()
  })

  it('a success resets the streak', () => {
    const t = new DenialTracker({ maxConsecutive: 3 })
    t.record('bash:x', true)
    t.record('bash:x', true)
    expect(t.record('bash:x', false)).toBeNull()
    expect(t.record('bash:x', true)).toBeNull() // streak restarted at 1
  })

  it('tracks streaks per-operation independently', () => {
    const t = new DenialTracker({ maxConsecutive: 2 })
    expect(t.record('a', true)).toBeNull()
    expect(t.record('b', true)).toBeNull()
    expect(t.record('a', true)).toMatch(/连续失败 2 次/)
  })

  it('emits a hard stop nudge once total failures cross maxTotal', () => {
    const t = new DenialTracker({ maxConsecutive: 999, maxTotal: 5 })
    let hard: string | null = null
    for (let i = 0; i < 5; i++) hard = t.record(`op${i}`, true)
    expect(hard).toMatch(/重新评估整体方案/)
  })
})

describe('denialKey', () => {
  it('combines tool name + serialized args, capped', () => {
    expect(denialKey('bash', { cmd: 'ls' })).toBe('bash:{"cmd":"ls"}')
    expect(denialKey('read', 'a/b.ts')).toBe('read:a/b.ts')
    expect(denialKey('x', { big: 'y'.repeat(500) }).length).toBeLessThan(230)
  })
})
