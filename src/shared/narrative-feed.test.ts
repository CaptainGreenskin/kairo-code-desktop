import { describe, expect, it } from 'vitest'
import { buildNarrativeFeed } from './narrative-feed'

const BASE = {
  changes: [] as Parameters<typeof buildNarrativeFeed>[0]['changes'],
  commits: [] as Parameters<typeof buildNarrativeFeed>[0]['commits'],
  decisions: [] as Parameters<typeof buildNarrativeFeed>[0]['decisions'],
  lastSeen: 0,
  protectedGlobs: [] as string[]
}

describe('buildNarrativeFeed', () => {
  it('returns empty when nothing happened since lastSeen', () => {
    expect(buildNarrativeFeed({ ...BASE, lastSeen: Date.now() })).toEqual([])
  })

  it('surfaces unverified changes as critical', () => {
    const events = buildNarrativeFeed({
      ...BASE,
      changes: [{ at: 100, task: 't', modules: ['auth'], filesChanged: ['auth/x.ts'], risk: 'review', verified: false }]
    })
    expect(events[0]?.severity).toBe('critical')
    expect(events[0]?.source).toBe('unverified')
  })

  it('surfaces invariant-region touches as warning', () => {
    const events = buildNarrativeFeed({
      ...BASE,
      changes: [{ at: 100, task: 't', modules: ['src/auth/login'], filesChanged: ['src/auth/login/x.ts'], risk: 'auto', verified: true }],
      protectedGlobs: ['src/auth/**']
    })
    expect(events.some((e) => e.source === 'invariant')).toBe(true)
  })

  it('surfaces manual git commits as info', () => {
    const events = buildNarrativeFeed({
      ...BASE,
      commits: [{ hash: 'a', subject: 'fix login', at: 100, files: ['auth/x.ts'], author: 'Ada' }]
    })
    expect(events.some((e) => e.source === 'change' && e.severity === 'info')).toBe(true)
  })

  it('sorts critical before warning before info and caps at 5', () => {
    const events = buildNarrativeFeed({
      ...BASE,
      changes: [
        { at: 100, task: 't', modules: ['a'], filesChanged: ['a/x.ts'], risk: 'review', verified: false },
        { at: 101, task: 't', modules: ['b'], filesChanged: ['b/x.ts'], risk: 'auto', verified: true }
      ],
      commits: [
        { hash: 'x', subject: 'manual', at: 102, files: ['c/x.ts'], author: 'X' },
        { hash: 'y', subject: 'manual2', at: 103, files: ['d/x.ts'], author: 'Y' }
      ],
      protectedGlobs: ['a']
    })
    expect(events.length).toBeLessThanOrEqual(5)
    const severities = events.map((e) => e.severity)
    const ordered = [...severities].sort((a, b) => {
      const o: Record<string, number> = { critical: 0, warning: 1, info: 2 }
      return (o[a] ?? 9) - (o[b] ?? 9)
    })
    expect(severities).toEqual(ordered)
  })
})
