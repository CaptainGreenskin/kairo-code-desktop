import { describe, expect, it } from 'vitest'
import { comprehensionHealth } from './comprehension-health'
import type { CodeMap } from './code-map'
import type { ChangeRecord } from './map-delta'
import type { GitCommit } from './git-brain'
import type { GateDecision } from './types'

// x → core, y → core  (core has fan-in 2 → weight 3).
const map: CodeMap = {
  modules: [
    { id: 'core', label: 'core', fileCount: 1, loc: 1, files: ['core/a.ts'] },
    { id: 'x', label: 'x', fileCount: 1, loc: 1, files: ['x/a.ts'] },
    { id: 'y', label: 'y', fileCount: 1, loc: 1, files: ['y/a.ts'] }
  ],
  edges: [
    { from: 'x', to: 'core', weight: 1 },
    { from: 'y', to: 'core', weight: 1 }
  ]
}

const empty = { changes: [] as ChangeRecord[], commits: [] as GitCommit[], decisions: [] as GateDecision[], lastSeen: 0 }

describe('comprehensionHealth', () => {
  it('is 100% when nothing has changed (nothing to understand)', () => {
    const h = comprehensionHealth({ map, ...empty })
    expect(h.score).toBe(1)
    expect(h.liveModules).toBe(0)
  })

  it('marks a changed-but-unengaged module as stale', () => {
    const changes: ChangeRecord[] = [
      { at: 100, task: 't', modules: ['core'], filesChanged: [], risk: 'review' }
    ]
    const h = comprehensionHealth({ map, ...empty, changes })
    expect(h.liveModules).toBe(1)
    expect(h.freshModules).toBe(0)
    expect(h.score).toBe(0)
    expect(h.staleModules[0]).toMatchObject({ id: 'core', weight: 3 })
  })

  it('counts a module fresh when a decision engaged it after the change', () => {
    const changes: ChangeRecord[] = [
      { at: 100, task: 't', modules: ['core'], filesChanged: [], risk: 'review' }
    ]
    const decisions: GateDecision[] = [{ at: 150, outcome: 'passed', files: [], modules: ['core'] }]
    const h = comprehensionHealth({ map, ...empty, changes, decisions })
    expect(h.score).toBe(1)
    expect(h.staleModules).toEqual([])
  })

  it('treats a Map-Delta catch-up (lastSeen) as engagement', () => {
    const changes: ChangeRecord[] = [
      { at: 100, task: 't', modules: ['core'], filesChanged: [], risk: 'review' }
    ]
    expect(comprehensionHealth({ map, ...empty, changes, lastSeen: 200 }).score).toBe(1)
    expect(comprehensionHealth({ map, ...empty, changes, lastSeen: 50 }).score).toBe(0)
  })

  it('includes git commits as changes and weights by importance', () => {
    // core changed (git) + unengaged; x changed + engaged. core weight 3, x weight 1.
    const commits: GitCommit[] = [
      { hash: 'a', at: 100, author: 'A', subject: 's', files: ['core/a.ts'] },
      { hash: 'b', at: 100, author: 'B', subject: 's', files: ['x/a.ts'] }
    ]
    const decisions: GateDecision[] = [{ at: 150, outcome: 'passed', files: [], modules: ['x'] }]
    const h = comprehensionHealth({ map, ...empty, commits, decisions })
    expect(h.liveModules).toBe(2)
    // fresh weight = 1 (x); live weight = 3 (core) + 1 (x) = 4 → 0.25.
    expect(h.score).toBeCloseTo(0.25, 5)
    expect(h.staleModules[0]!.id).toBe('core')
  })
})
