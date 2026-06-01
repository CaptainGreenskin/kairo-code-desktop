import { describe, expect, it } from 'vitest'
import {
  buildChangeLens,
  lensToMarkdown,
  moduleOf,
  parseUncertaintyFlags,
  type CrewToolRecord
} from './change-lens'

const rec = (toolName: string, args: Record<string, unknown>, ok = true): CrewToolRecord => ({
  toolName,
  args,
  ok
})

describe('moduleOf', () => {
  it('groups by the first two path segments', () => {
    expect(moduleOf('src/main/crew.ts')).toBe('src/main')
    expect(moduleOf('./src/renderer/components/CrewPanel.tsx')).toBe('src/renderer')
    expect(moduleOf('README.md')).toBe('(root)')
  })
})

describe('buildChangeLens', () => {
  it('collects written files and groups them into blast radius by module', () => {
    const lens = buildChangeLens([
      rec('write_file', { path: 'src/main/a.ts' }),
      rec('edit', { path: 'src/main/b.ts' }),
      rec('write_file', { path: 'src/renderer/c.tsx' }),
      rec('read_file', { path: 'src/main/ignored.ts' })
    ])
    expect(lens.filesChanged).toEqual(['src/main/a.ts', 'src/main/b.ts', 'src/renderer/c.tsx'])
    expect(lens.blastRadius).toEqual([
      { module: 'src/main', files: ['src/main/a.ts', 'src/main/b.ts'] },
      { module: 'src/renderer', files: ['src/renderer/c.tsx'] }
    ])
  })

  it('records executed commands with pass/fail in the verification ledger', () => {
    const lens = buildChangeLens([
      rec('write_file', { path: 'src/main/a.ts' }),
      rec('bash', { command: 'npm run build' }, true),
      rec('bash', { command: 'npm test' }, true)
    ])
    expect(lens.verification.ran).toEqual([
      { command: 'npm run build', ok: true },
      { command: 'npm test', ok: true }
    ])
    expect(lens.verification.testsRun).toBe(true)
    expect(lens.verification.warning).toBeUndefined()
  })

  it('warns (anti-rubber-stamp) when files changed but no tests ran', () => {
    const lens = buildChangeLens([
      rec('write_file', { path: 'src/main/a.ts' }),
      rec('bash', { command: 'ls -la' }, true)
    ])
    expect(lens.verification.testsRun).toBe(false)
    expect(lens.verification.warning).toMatch(/No tests were run for 1 changed file/)
  })

  it('warns when nothing was executed at all', () => {
    const lens = buildChangeLens([rec('write_file', { path: 'src/main/a.ts' })])
    expect(lens.verification.warning).toMatch(/Nothing was executed/)
  })

  it('flags failed verification commands', () => {
    const lens = buildChangeLens([
      rec('write_file', { path: 'src/main/a.ts' }),
      rec('bash', { command: 'npm test' }, false)
    ])
    expect(lens.verification.testsRun).toBe(true)
    expect(lens.verification.warning).toMatch(/Some executed commands failed/)
  })

  it('surfaces behavior delta from edit replacements', () => {
    const lens = buildChangeLens([
      rec('edit', {
        path: 'src/api.ts',
        replacements: [{ oldText: 'export function parseConfig() {}', newText: '' }]
      })
    ])
    expect(lens.behaviorDelta?.some((s) => s.kind === 'api-removed')).toBe(true)
  })

  it('caps uncertainty flags at 3', () => {
    const lens = buildChangeLens([], ['a', 'b', 'c', 'd'])
    expect(lens.uncertaintyFlags).toEqual(['a', 'b', 'c'])
  })

  it('handles an empty run', () => {
    const lens = buildChangeLens([])
    expect(lens.filesChanged).toEqual([])
    expect(lens.blastRadius).toEqual([])
    expect(lens.verification.ran).toEqual([])
    expect(lens.verification.warning).toBeUndefined()
  })
})

describe('parseUncertaintyFlags', () => {
  it('parses a JSON array', () => {
    expect(parseUncertaintyFlags('["x", "y"]')).toEqual(['x', 'y'])
  })

  it('extracts a JSON array embedded in prose', () => {
    expect(parseUncertaintyFlags('Here are the flags: ["a", "b"]. Done.')).toEqual(['a', 'b'])
  })

  it('falls back to bullet/numbered lists', () => {
    expect(parseUncertaintyFlags('- first\n- second')).toEqual(['first', 'second'])
    expect(parseUncertaintyFlags('1. one\n2) two')).toEqual(['one', 'two'])
  })

  it('caps at 3 and drops empties', () => {
    expect(parseUncertaintyFlags('["a","b","c","d"]')).toEqual(['a', 'b', 'c'])
  })

  it('returns empty for junk', () => {
    expect(parseUncertaintyFlags('')).toEqual([])
  })
})

describe('lensToMarkdown', () => {
  it('renders blast radius, verification and flags without throwing', () => {
    const md = lensToMarkdown(
      buildChangeLens(
        [rec('write_file', { path: 'src/main/a.ts' }), rec('bash', { command: 'npm test' }, true)],
        ['unsure about ordering']
      )
    )
    expect(md).toContain('Change Lens')
    expect(md).toContain('src/main')
    expect(md).toContain('npm test')
    expect(md).toContain('unsure about ordering')
  })
})
