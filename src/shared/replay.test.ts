import { describe, expect, it } from 'vitest'
import { buildReplay, cumulativeModules } from './replay'
import type { ChangeRecord } from './map-delta'
import type { GitCommit } from './git-brain'

const changes: ChangeRecord[] = [
  { at: 300, task: 'crew refactor api', modules: ['src/api'], filesChanged: [], risk: 'review' }
]
const commits: GitCommit[] = [
  { hash: 'a', at: 100, author: 'A', subject: 'init ui', files: ['src/ui/app.ts'] },
  { hash: 'b', at: 200, author: 'B', subject: 'add db', files: ['src/db/x.ts', 'src/db/y.ts'] }
]

describe('buildReplay', () => {
  it('merges crew + git into one chronological timeline (oldest first)', () => {
    const steps = buildReplay({ changes, commits })
    expect(steps.map((s) => s.at)).toEqual([100, 200, 300])
    expect(steps.map((s) => s.source)).toEqual(['git', 'git', 'crew'])
    expect(steps[1]!.modules).toEqual(['src/db']) // dedup'd from two files
    expect(steps[2]!.label).toBe('crew refactor api')
  })

  it('keeps only the most recent `limit` steps', () => {
    const many: GitCommit[] = Array.from({ length: 5 }, (_, i) => ({
      hash: `h${i}`,
      at: i + 1,
      author: 'A',
      subject: `c${i}`,
      files: [`m${i}/a.ts`]
    }))
    const steps = buildReplay({ changes: [], commits: many }, 2)
    expect(steps.map((s) => s.label)).toEqual(['c3', 'c4'])
  })
})

describe('cumulativeModules', () => {
  it('accumulates touched modules up to a step', () => {
    const steps = buildReplay({ changes, commits })
    expect([...cumulativeModules(steps, 0)]).toEqual(['src/ui'])
    expect([...cumulativeModules(steps, 2)].sort()).toEqual(['src/api', 'src/db', 'src/ui'])
  })
})
