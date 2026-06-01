import { describe, expect, it } from 'vitest'
import { parseInstalledRegistry, upsertRecord, removeRecord, findRecord, type InstalledRecord } from '@kairo/plugin'

describe('parseInstalledRegistry', () => {
  it('accepts a bare array and a {plugins} wrapper', () => {
    const arr = [{ name: 'a', source: 'github:x/a', installedAt: 1 }]
    expect(parseInstalledRegistry(arr)).toEqual(arr)
    expect(parseInstalledRegistry({ plugins: arr })).toEqual(arr)
  })

  it('drops entries missing name or source, and defaults installedAt', () => {
    const out = parseInstalledRegistry([
      { name: 'ok', source: '/p' },
      { name: '', source: '/p' },
      { source: '/p' },
      { name: 'no-source' },
      'garbage'
    ])
    expect(out).toEqual([{ name: 'ok', source: '/p', version: undefined, installedAt: 0 }])
  })

  it('returns [] for non-array/non-wrapper input', () => {
    expect(parseInstalledRegistry(null)).toEqual([])
    expect(parseInstalledRegistry(42)).toEqual([])
  })
})

describe('upsert/remove/find', () => {
  const base: InstalledRecord[] = [{ name: 'b', source: 's-b', installedAt: 1 }]

  it('upsert replaces by name and keeps sorted order', () => {
    const out = upsertRecord(base, { name: 'a', source: 's-a', installedAt: 2 })
    expect(out.map((r) => r.name)).toEqual(['a', 'b'])
    const replaced = upsertRecord(out, { name: 'a', source: 's-a2', installedAt: 9 })
    expect(replaced.filter((r) => r.name === 'a')).toHaveLength(1)
    expect(findRecord(replaced, 'a')?.source).toBe('s-a2')
  })

  it('remove drops by name', () => {
    expect(removeRecord(base, 'b')).toEqual([])
    expect(removeRecord(base, 'nope')).toEqual(base)
  })
})
