import { describe, expect, it } from 'vitest'
import { mapQuery, resolveQueryModule, resolveQueryModules } from './map-query'
import type { CodeMap } from './code-map'

// a → b → c (a imports b, b imports c)
const map: CodeMap = {
  modules: [
    { id: 'src/a', label: 'src/a', fileCount: 1, loc: 1, files: [] },
    { id: 'src/b', label: 'src/b', fileCount: 1, loc: 1, files: [] },
    { id: 'src/c', label: 'src/c', fileCount: 1, loc: 1, files: [] }
  ],
  edges: [
    { from: 'src/a', to: 'src/b', weight: 1 },
    { from: 'src/b', to: 'src/c', weight: 1 }
  ]
}

describe('resolveQueryModule', () => {
  it('matches by suffix and substring, preferring the shortest', () => {
    expect(resolveQueryModule(map, 'b')).toBe('src/b')
    expect(resolveQueryModule(map, 'src/c')).toBe('src/c')
    expect(resolveQueryModule(map, 'zzz')).toBeNull()
  })
})

describe('resolveQueryModules (disambiguation)', () => {
  const multi: CodeMap = {
    modules: [
      { id: 'src/auth', label: 'src/auth', fileCount: 1, loc: 1, files: [] },
      { id: 'src/main/auth', label: 'src/main/auth', fileCount: 1, loc: 1, files: [] },
      { id: 'src/util', label: 'src/util', fileCount: 1, loc: 1, files: [] }
    ],
    edges: []
  }

  it('returns ranked candidates (suffix, shortest first)', () => {
    expect(resolveQueryModules(multi, 'auth')).toEqual(['src/auth', 'src/main/auth'])
  })

  it('returns [] for no match and respects the limit', () => {
    expect(resolveQueryModules(multi, 'zzz')).toEqual([])
    expect(resolveQueryModules(multi, 'src', 1)).toHaveLength(1)
  })
})

describe('mapQuery', () => {
  it('returns transitive dependents and dependencies of the focus', () => {
    const r = mapQuery(map, 'b')!
    expect(r.focus).toBe('src/b')
    // a (transitively) depends on b; c is what b depends on.
    expect(r.dependents.sort()).toEqual(['src/a'])
    expect(r.dependencies.sort()).toEqual(['src/c'])
  })

  it('a leaf module has dependents but no dependencies', () => {
    const r = mapQuery(map, 'c')!
    expect(r.dependents.sort()).toEqual(['src/a', 'src/b'])
    expect(r.dependencies).toEqual([])
  })

  it('returns null for an unknown query', () => {
    expect(mapQuery(map, 'nope')).toBeNull()
  })
})
