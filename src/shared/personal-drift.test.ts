import { describe, expect, it } from 'vitest'
import { personalDrift } from './personal-drift'
import type { ChangeRecord } from './map-delta'
import type { GitCommit } from './git-brain'
import type { GateDecision } from './types'

const decisions: GateDecision[] = [
  { at: 100, outcome: 'passed', files: [], modules: ['src/auth'] },
  { at: 100, outcome: 'passed', files: [], modules: ['src/util'] }
]

describe('personalDrift', () => {
  it('flags an engaged module that changed AFTER you understood it', () => {
    const changes: ChangeRecord[] = [
      { at: 200, task: 't', modules: ['src/auth'], filesChanged: [], risk: 'review' }
    ]
    const d = personalDrift({ changes, commits: [], decisions })
    expect(d.map((m) => m.id)).toEqual(['src/auth'])
    expect(d[0]).toMatchObject({ understoodAt: 100, changedAt: 200 })
  })

  it('ignores changes that predate your understanding', () => {
    const changes: ChangeRecord[] = [
      { at: 50, task: 't', modules: ['src/auth'], filesChanged: [], risk: 'review' }
    ]
    expect(personalDrift({ changes, commits: [], decisions })).toEqual([])
  })

  it('counts git commits as drift and ranks most-recent first', () => {
    const commits: GitCommit[] = [
      { hash: 'a', at: 300, author: 'X', subject: 's', files: ['src/util/x.ts'] },
      { hash: 'b', at: 250, author: 'Y', subject: 's', files: ['src/auth/y.ts'] }
    ]
    const d = personalDrift({ changes: [], commits, decisions })
    expect(d.map((m) => m.id)).toEqual(['src/util', 'src/auth'])
  })

  it('returns nothing when you engaged nothing', () => {
    expect(personalDrift({ changes: [{ at: 9, task: 't', modules: ['x'], filesChanged: [], risk: 'review' }], commits: [], decisions: [] })).toEqual([])
  })
})
