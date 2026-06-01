import { describe, expect, it } from 'vitest'
import { detectArchitectureDeviations, reaches } from './architecture-deviation'
import type { CodeMap } from './code-map'

const editRec = (path: string, oldText: string, newText: string) => ({
  toolName: 'edit',
  args: { path, replacements: [{ oldText, newText }] }
})

const map = (edges: Array<[string, string]>, moduleIds: string[] = []): CodeMap => ({
  modules: moduleIds.map((id) => ({ id, label: id, fileCount: 1, loc: 1, files: [] })),
  edges: edges.map(([from, to]) => ({ from, to, weight: 1 }))
})

describe('reaches', () => {
  it('finds transitive reachability over from→to edges', () => {
    const m = map([['a', 'b'], ['b', 'c']])
    expect(reaches(m.edges, 'a', 'c')).toBe(true)
    expect(reaches(m.edges, 'c', 'a')).toBe(false)
  })
})

describe('detectArchitectureDeviations', () => {
  it('flags a newly introduced cross-module dependency', () => {
    const recs = [
      editRec('src/main/agent.ts', 'const x = 1', "import { y } from '../shared/util'\nconst x = 1")
    ]
    const sigs = detectArchitectureDeviations(recs, map([]))
    expect(sigs).toHaveLength(1)
    expect(sigs[0]).toMatchObject({ kind: 'new-dependency', fromModule: 'src/main', toModule: 'src/shared' })
  })

  it('escalates to cyclic when the target already depends back on the source', () => {
    // Existing graph: src/shared → src/main. Now src/main newly imports src/shared
    // → closes a cycle.
    const recs = [
      editRec('src/main/agent.ts', '', "import { y } from '../shared/util'")
    ]
    const sigs = detectArchitectureDeviations(recs, map([['src/shared', 'src/main']]))
    expect(sigs).toHaveLength(1)
    expect(sigs[0]).toMatchObject({ kind: 'cyclic-dependency', fromModule: 'src/main', toModule: 'src/shared' })
  })

  it('ignores imports that already existed (not net-new)', () => {
    const recs = [
      editRec(
        'src/main/agent.ts',
        "import { y } from '../shared/util'\nconst x = 1",
        "import { y } from '../shared/util'\nconst x = 2"
      )
    ]
    expect(detectArchitectureDeviations(recs, map([]))).toHaveLength(0)
  })

  it('ignores external packages and same-module imports', () => {
    const recs = [
      editRec('src/main/agent.ts', '', "import express from 'express'\nimport { z } from './sibling'")
    ]
    expect(detectArchitectureDeviations(recs, map([]))).toHaveLength(0)
  })

  it('ignores brand-new files (write_file) — establishing deps is expected', () => {
    const recs = [
      { toolName: 'write_file', args: { path: 'src/main/new.ts', content: "import { y } from '../shared/util'" } }
    ]
    expect(detectArchitectureDeviations(recs, map([]))).toHaveLength(0)
  })

  it('resolves a new Java FQN import to its package module (and ignores java.util.*)', () => {
    const codeMap = map([], ['src/main/java/com/acme/web', 'src/main/java/com/acme/service'])
    const recs = [
      editRec(
        'src/main/java/com/acme/web/UserController.java',
        'class UserController {}',
        'import com.acme.service.UserService;\nimport java.util.List;\nclass UserController {}'
      )
    ]
    const sigs = detectArchitectureDeviations(recs, codeMap)
    expect(sigs).toHaveLength(1)
    expect(sigs[0]).toMatchObject({
      kind: 'new-dependency',
      fromModule: 'src/main/java/com/acme/web',
      toModule: 'src/main/java/com/acme/service'
    })
  })

  it('detects a Java cyclic dependency via the existing graph', () => {
    const codeMap = map(
      [['src/main/java/com/acme/service', 'src/main/java/com/acme/web']],
      ['src/main/java/com/acme/web', 'src/main/java/com/acme/service']
    )
    const recs = [
      editRec('src/main/java/com/acme/web/UserController.java', '', 'import com.acme.service.UserService;')
    ]
    const sigs = detectArchitectureDeviations(recs, codeMap)
    expect(sigs[0]?.kind).toBe('cyclic-dependency')
  })

  it('resolves a new Python package import (and ignores stdlib)', () => {
    const codeMap = map([], ['app/api', 'app/services'])
    const recs = [
      editRec('app/api/routes.py', 'x = 1', 'from app.services.users import get\nimport os\nx = 1')
    ]
    const sigs = detectArchitectureDeviations(recs, codeMap)
    expect(sigs).toHaveLength(1)
    expect(sigs[0]).toMatchObject({ kind: 'new-dependency', fromModule: 'app/api', toModule: 'app/services' })
  })

  it('resolves a new Go in-repo import by package-dir suffix (and ignores fmt)', () => {
    const codeMap = map([], ['cmd/server', 'internal/store'])
    const recs = [
      editRec('cmd/server/main.go', 'package main', 'package main\nimport (\n  "github.com/me/proj/internal/store"\n  "fmt"\n)')
    ]
    const sigs = detectArchitectureDeviations(recs, codeMap)
    expect(sigs).toHaveLength(1)
    expect(sigs[0]).toMatchObject({ kind: 'new-dependency', fromModule: 'cmd/server', toModule: 'internal/store' })
  })
})
