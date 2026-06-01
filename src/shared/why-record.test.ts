import { describe, expect, it } from 'vitest'
import { parseWhyRecords, appendWhyRecord, whyForFile, buildWhyFromTask, type WhyRecord } from './why-record'

describe('parseWhyRecords', () => {
  it('parses valid records and skips malformed ones', () => {
    const out = parseWhyRecords([
      { file: 'a.ts', why: 'fix bug', at: 100 },
      { file: 'b.ts' }, // missing why
      'garbage',
      { file: 'c.ts', why: 'refactor', task: 'clean up', at: 200 }
    ])
    expect(out).toHaveLength(2)
    expect(out[1]!.task).toBe('clean up')
  })

  it('returns [] for non-array', () => {
    expect(parseWhyRecords(null)).toEqual([])
  })
})

describe('appendWhyRecord', () => {
  it('appends and caps at 500', () => {
    const big: WhyRecord[] = Array.from({ length: 500 }, (_, i) => ({ file: `${i}.ts`, why: 'w', at: i }))
    const next = appendWhyRecord(big, { file: 'new.ts', why: 'new', at: 999 })
    expect(next).toHaveLength(500)
    expect(next[next.length - 1]!.file).toBe('new.ts')
    expect(next[0]!.file).toBe('1.ts') // oldest dropped
  })
})

describe('whyForFile', () => {
  it('returns records for a file, newest first', () => {
    const records: WhyRecord[] = [
      { file: 'a.ts', why: 'old', at: 1 },
      { file: 'b.ts', why: 'other', at: 2 },
      { file: 'a.ts', why: 'new', at: 3 }
    ]
    const result = whyForFile(records, 'a.ts')
    expect(result).toHaveLength(2)
    expect(result[0]!.why).toBe('new')
  })
})

describe('buildWhyFromTask', () => {
  it('creates one record per file', () => {
    const records = buildWhyFromTask('fix auth bug', ['auth/login.ts', 'auth/session.ts'])
    expect(records).toHaveLength(2)
    expect(records[0]!.why).toBe('fix auth bug')
    expect(records[0]!.file).toBe('auth/login.ts')
  })
})
