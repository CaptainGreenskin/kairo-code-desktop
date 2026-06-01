import { describe, expect, it } from 'vitest'
import {
  buildCodeMap,
  buildCouplingGraph,
  buildFileGraph,
  shortenModuleId,
  extractCouplingSignals,
  extractImports,
  fileImporters,
  fileImports,
  resolveImport,
  toFileFacts,
  transitiveImpact,
  type SourceFile
} from './code-map'

describe('extractImports', () => {
  it('captures import / export-from / require specifiers', () => {
    const src = [
      `import { a } from './a'`,
      `import b from "../b/x"`,
      `export { c } from './c'`,
      `const d = require('../d')`,
      `import 'side-effect'`
    ].join('\n')
    expect(extractImports(src)).toEqual(['./a', '../b/x', './c', '../d', 'side-effect'])
  })
})

describe('resolveImport', () => {
  it('resolves relative specifiers against the importing file', () => {
    expect(resolveImport('src/renderer/components/CrewPanel.tsx', '../stores/crew-store')).toBe(
      'src/renderer/stores/crew-store'
    )
    expect(resolveImport('src/main/agent.ts', './provider')).toBe('src/main/provider')
    expect(resolveImport('src/main/agent.ts', '../shared/types')).toBe('src/shared/types')
  })

  it('ignores external packages', () => {
    expect(resolveImport('src/main/agent.ts', 'electron')).toBeNull()
    expect(resolveImport('src/main/agent.ts', '@kairo/core')).toBeNull()
  })
})

describe('buildCodeMap', () => {
  const files: SourceFile[] = [
    { path: 'src/renderer/components/CrewPanel.tsx', content: `import { useCrewStore } from '../stores/crew-store'\nimport { x } from '../../shared/types'` },
    { path: 'src/renderer/stores/crew-store.ts', content: `import type { CrewEvent } from '../../shared/types'` },
    { path: 'src/shared/types.ts', content: `export const x = 1` },
    { path: 'src/main/agent.ts', content: `import { buildProvider } from './provider'\nimport type { T } from '../shared/types'` },
    { path: 'src/main/provider.ts', content: `export const p = 1` }
  ]

  it('groups files into modules by directory', () => {
    const map = buildCodeMap(files)
    const ids = map.modules.map((m) => m.id).sort()
    expect(ids).toEqual(['src/main', 'src/renderer/components', 'src/renderer/stores', 'src/shared'])
    expect(map.modules.find((m) => m.id === 'src/main')?.fileCount).toBe(2)
  })

  it('creates weighted cross-module edges from imports', () => {
    const map = buildCodeMap(files)
    const has = (from: string, to: string): boolean => map.edges.some((e) => e.from === from && e.to === to)
    expect(has('src/renderer/components', 'src/renderer/stores')).toBe(true)
    expect(has('src/renderer/components', 'src/shared')).toBe(true)
    expect(has('src/renderer/stores', 'src/shared')).toBe(true)
    expect(has('src/main', 'src/shared')).toBe(true)
    // No self-edges.
    expect(map.edges.every((e) => e.from !== e.to)).toBe(true)
  })

  it('counts LOC per module', () => {
    const map = buildCodeMap([{ path: 'a/b.ts', content: 'line1\nline2\nline3' }])
    expect(map.modules[0]?.loc).toBe(3)
  })

  it('handles an empty workspace', () => {
    expect(buildCodeMap([])).toEqual({ modules: [], edges: [] })
  })
})

describe('buildCodeMap (Java)', () => {
  const files: SourceFile[] = [
    {
      path: 'src/main/java/com/acme/web/UserController.java',
      content: 'package com.acme.web;\nimport com.acme.service.UserService;\nimport java.util.List;\nclass UserController {}'
    },
    {
      path: 'src/main/java/com/acme/service/UserService.java',
      content: 'package com.acme.service;\nclass UserService {}'
    }
  ]

  it('groups Java files into modules by directory', () => {
    const map = buildCodeMap(files)
    const ids = map.modules.map((m) => m.id).sort()
    expect(ids).toEqual(['src/main/java/com/acme/service', 'src/main/java/com/acme/web'])
  })

  it('resolves FQN imports to the target package directory (edges)', () => {
    const map = buildCodeMap(files)
    expect(
      map.edges.some(
        (e) => e.from === 'src/main/java/com/acme/web' && e.to === 'src/main/java/com/acme/service'
      )
    ).toBe(true)
    // External (java.util.*) imports do not create edges.
    expect(map.edges.length).toBe(1)
  })
})

describe('buildCodeMap (Python)', () => {
  it('resolves absolute and relative imports to package dirs', () => {
    const map = buildCodeMap([
      { path: 'app/api/routes.py', content: 'from app.services.users import get\nfrom . import helpers\nimport os' },
      { path: 'app/services/users.py', content: 'x = 1' },
      { path: 'app/api/helpers.py', content: 'y = 2' }
    ])
    const has = (from: string, to: string): boolean => map.edges.some((e) => e.from === from && e.to === to)
    expect(has('app/api', 'app/services')).toBe(true)
    // `import os` (stdlib / external) makes no edge.
    expect(map.edges.every((e) => e.to !== 'os')).toBe(true)
  })
})

describe('buildCodeMap (Go)', () => {
  it('resolves in-repo import paths by package-dir suffix, ignoring module prefix', () => {
    const map = buildCodeMap([
      { path: 'cmd/server/main.go', content: 'package main\nimport (\n  "github.com/me/proj/internal/store"\n  "fmt"\n)' },
      { path: 'internal/store/store.go', content: 'package store' }
    ])
    expect(map.edges.some((e) => e.from === 'cmd/server' && e.to === 'internal/store')).toBe(true)
    expect(map.edges.every((e) => e.to !== 'fmt')).toBe(true)
  })
})

describe('transitiveImpact', () => {
  // a → b → c (a imports b, b imports c). Changing c impacts b (1) and a (2).
  const edges = [
    { from: 'a', to: 'b', weight: 1 },
    { from: 'b', to: 'c', weight: 1 }
  ]

  it('walks dependents backwards with hop distance from the seed', () => {
    const d = transitiveImpact(edges, ['c'])
    expect(d.get('c')).toBe(0)
    expect(d.get('b')).toBe(1)
    expect(d.get('a')).toBe(2)
  })

  it('a leaf change only impacts itself', () => {
    const d = transitiveImpact(edges, ['a'])
    expect(d.get('a')).toBe(0)
    expect(d.has('b')).toBe(false)
    expect(d.has('c')).toBe(false)
  })

  it('handles multiple seeds and keeps the shortest distance', () => {
    // diamond: a→b, a→c, b→d, c→d. Seed d impacts b,c at 1 and a at 2.
    const dia = [
      { from: 'a', to: 'b', weight: 1 },
      { from: 'a', to: 'c', weight: 1 },
      { from: 'b', to: 'd', weight: 1 },
      { from: 'c', to: 'd', weight: 1 }
    ]
    const d = transitiveImpact(dia, ['d'])
    expect(d.get('d')).toBe(0)
    expect(d.get('b')).toBe(1)
    expect(d.get('c')).toBe(1)
    expect(d.get('a')).toBe(2)
  })

  it('does not loop forever on cycles', () => {
    const cyc = [
      { from: 'a', to: 'b', weight: 1 },
      { from: 'b', to: 'a', weight: 1 }
    ]
    const d = transitiveImpact(cyc, ['a'])
    expect(d.get('a')).toBe(0)
    expect(d.get('b')).toBe(1)
  })
})

describe('buildFileGraph (file-level granularity)', () => {
  const facts = [
    { path: 'src/a.ts', content: `import { b } from './b'\nimport { c } from './sub/c'` },
    { path: 'src/b.ts', content: `import { c } from './sub/c'` },
    { path: 'src/sub/c.ts', content: `export const c = 1` },
    { path: 'src/d.ts', content: `import { a } from './a'` }
  ].map((f) => toFileFacts(f))

  it('resolves JS/TS imports to concrete files', () => {
    const edges = buildFileGraph(facts)
    // who imports src/sub/c.ts → a and b
    expect(fileImporters(edges, 'src/sub/c.ts')).toEqual(['src/a.ts', 'src/b.ts'])
    // what src/a.ts imports → b and sub/c
    expect(fileImports(edges, 'src/a.ts')).toEqual(['src/b.ts', 'src/sub/c.ts'])
    // src/d.ts imports src/a.ts
    expect(fileImporters(edges, 'src/a.ts')).toEqual(['src/d.ts'])
  })
})

describe('extractCouplingSignals + buildCouplingGraph (hidden coupling)', () => {
  it('extracts table/event/http/flag signals from content', () => {
    const sig = extractCouplingSignals(
      `db.from('users').select()\nbus.emit('user.created', x)\nfetch('/api/orders')\nif (isEnabled('new-checkout')) {}`
    )
    const pairs = sig.map((s) => `${s.kind}:${s.key}`).sort()
    expect(pairs).toContain('table:users')
    expect(pairs).toContain('event:user.created')
    expect(pairs).toContain('http:/api/orders')
    expect(pairs).toContain('flag:new-checkout')
  })

  it('links modules that share a table/event but do NOT import each other', () => {
    const facts = [
      // No import between checkout and fulfillment, but both touch the orders table
      // and the order.paid event → hidden coupling.
      { path: 'src/checkout/pay.ts', content: `db.from('orders').insert(x)\nbus.emit('order.paid', x)` },
      { path: 'src/fulfillment/ship.ts', content: `db.from('orders').update(y)\nbus.on('order.paid', y)` },
      { path: 'src/unrelated/x.ts', content: `const z = 1` }
    ].map((f) => toFileFacts(f))
    const edges = buildCouplingGraph(facts)
    const has = (kind: string, key: string): boolean =>
      edges.some(
        (e) =>
          e.kind === kind &&
          e.key === key &&
          ((e.from === 'src/checkout' && e.to === 'src/fulfillment') ||
            (e.from === 'src/fulfillment' && e.to === 'src/checkout'))
      )
    expect(has('table', 'orders')).toBe(true)
    expect(has('event', 'order.paid')).toBe(true)
    // The unrelated module is not coupled.
    expect(edges.every((e) => e.from !== 'src/unrelated' && e.to !== 'src/unrelated')).toBe(true)
  })

  it('skips a key shared by too many modules (generic infra)', () => {
    const facts = Array.from({ length: 8 }, (_, i) => toFileFacts({ path: `src/m${i}/a.ts`, content: `fetch('/health')` }))
    expect(buildCouplingGraph(facts)).toEqual([])
  })
})

describe('extractCouplingSignals precision (noise rejection)', () => {
  it('rejects JS built-ins that look like DB .from() calls', () => {
    const sig = extractCouplingSignals(
      `const a = Array.from('abcdef')\nBuffer.from('deadbeef')\nObject.from('x')\nconst u = db.from('users')`
    )
    const tables = sig.filter((s) => s.kind === 'table').map((s) => s.key)
    expect(tables).toEqual(['users']) // only the real db call survives
  })

  it('drops generic DOM/stream events but keeps namespaced domain topics', () => {
    const sig = extractCouplingSignals(
      `el.on('click', f)\nstream.on('data', g)\nbus.emit('order.paid', x)\nbus.on('user:created', y)`
    )
    const events = sig.filter((s) => s.kind === 'event').map((s) => s.key).sort()
    expect(events).toEqual(['order.paid', 'user:created'])
  })

  it('does not invent table coupling from English prose "from"/"join"', () => {
    const sig = extractCouplingSignals(`// derived from components, then join with stores`)
    expect(sig.filter((s) => s.kind === 'table')).toEqual([])
  })
})

describe('shortenModuleId', () => {
  it('strips Java src/main/java + groupId (com/alibaba/cainiao)', () => {
    expect(shortenModuleId('sre-common/src/main/java/com/alibaba/cainiao/sre/common/utils'))
      .toBe('sre-common/.../sre/common/utils')
  })
  it('drops com/example (2 domain segs when 3rd would empty the tail)', () => {
    expect(shortenModuleId('app/src/main/java/com/example/app/service'))
      .toBe('app/.../service')
  })
  it('handles kotlin/scala/groovy the same way', () => {
    expect(shortenModuleId('mod/src/main/kotlin/com/foo/bar/baz'))
      .toBe('mod/.../baz')
  })
  it('leaves JS/TS paths unchanged', () => {
    expect(shortenModuleId('src/renderer/components')).toBe('src/renderer/components')
  })
  it('leaves short Java paths (no groupId) unchanged', () => {
    expect(shortenModuleId('app/src/main/java/service')).toBe('app/.../service')
  })
})
