import { describe, expect, it } from 'vitest'
import { commitsForModule, gitModulesSince, parseGitLog, type GitCommit } from './git-brain'

const REC = '\x01'
const F = '\x1f'

describe('parseGitLog', () => {
  it('parses delimited commits with their files', () => {
    const raw =
      `${REC}abc123${F}1700000000${F}Alice${F}fix auth bug\nsrc/auth/login.ts\nsrc/auth/token.ts\n` +
      `${REC}def456${F}1700000100${F}Bob${F}add map\nsrc/shared/code-map.ts\n`
    const commits = parseGitLog(raw)
    expect(commits).toHaveLength(2)
    expect(commits[0]).toMatchObject({ hash: 'abc123', author: 'Alice', subject: 'fix auth bug' })
    expect(commits[0]!.at).toBe(1700000000 * 1000)
    expect(commits[0]!.files).toEqual(['src/auth/login.ts', 'src/auth/token.ts'])
    expect(commits[1]!.files).toEqual(['src/shared/code-map.ts'])
  })

  it('tolerates empty input and commits with no files', () => {
    expect(parseGitLog('')).toEqual([])
    const raw = `${REC}h1${F}1700000000${F}Ann${F}empty commit\n`
    expect(parseGitLog(raw)[0]!.files).toEqual([])
  })
})

const commits: GitCommit[] = [
  { hash: 'a', at: 300, author: 'A', subject: 'touch auth', files: ['src/auth/login.ts'] },
  { hash: 'b', at: 200, author: 'B', subject: 'touch shared', files: ['src/shared/x.ts'] },
  { hash: 'c', at: 100, author: 'C', subject: 'touch auth again', files: ['src/auth/token.ts'] }
]

describe('commitsForModule', () => {
  it('returns commits touching the module, newest first', () => {
    const r = commitsForModule(commits, 'src/auth')
    expect(r.map((c) => c.hash)).toEqual(['a', 'c'])
  })
})

describe('gitModulesSince', () => {
  it('returns distinct module dirs changed after the anchor', () => {
    expect(gitModulesSince(commits, 150).sort()).toEqual(['src/auth', 'src/shared'])
    expect(gitModulesSince(commits, 250)).toEqual(['src/auth'])
  })
})
