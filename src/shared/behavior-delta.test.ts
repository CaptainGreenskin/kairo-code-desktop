import { describe, expect, it } from 'vitest'
import { analyzeBehaviorDelta, isBreaking, type ChangeRecordLike } from './behavior-delta'

const edit = (path: string, reps: Array<{ oldText: string; newText: string }>): ChangeRecordLike => ({
  toolName: 'edit',
  args: { path, replacements: reps }
})
const write = (path: string, content: string): ChangeRecordLike => ({
  toolName: 'write_file',
  args: { path, content }
})

describe('analyzeBehaviorDelta', () => {
  it('flags a removed export as api-removed', () => {
    const sigs = analyzeBehaviorDelta([
      edit('src/api.ts', [{ oldText: 'export function parseConfig() {}', newText: '' }])
    ])
    expect(sigs).toContainEqual(
      expect.objectContaining({ kind: 'api-removed', file: 'src/api.ts', name: 'parseConfig' })
    )
  })

  it('flags a changed signature of a kept export as api-changed', () => {
    const sigs = analyzeBehaviorDelta([
      edit('src/api.ts', [
        { oldText: 'export function load(a) {', newText: 'export function load(a, b) {' }
      ])
    ])
    expect(sigs.some((s) => s.kind === 'api-changed' && /load/.test(s.detail))).toBe(true)
  })

  it('captures the exact before/after line for a changed export (answer-in-place)', () => {
    const sigs = analyzeBehaviorDelta([
      edit('src/api.ts', [
        { oldText: 'export function load(a) {', newText: 'export function load(a, b) {' }
      ])
    ])
    const changed = sigs.find((s) => s.kind === 'api-changed')!
    expect(changed.before).toBe('export function load(a) {')
    expect(changed.after).toBe('export function load(a, b) {')
  })

  it('a removed export carries its before line; an added export carries its after line', () => {
    const removed = analyzeBehaviorDelta([
      edit('src/api.ts', [{ oldText: 'export const gone = 1', newText: '' }])
    ]).find((s) => s.kind === 'api-removed')!
    expect(removed.before).toBe('export const gone = 1')
    const added = analyzeBehaviorDelta([
      edit('src/api.ts', [{ oldText: '', newText: 'export const fresh = 2' }])
    ]).find((s) => s.kind === 'api-added')!
    expect(added.after).toBe('export const fresh = 2')
  })

  it('flags a newly added export as api-added', () => {
    const sigs = analyzeBehaviorDelta([
      edit('src/api.ts', [{ oldText: 'const x = 1', newText: 'const x = 1\nexport const NEW = 2' }])
    ])
    expect(sigs.some((s) => s.kind === 'api-added' && /NEW/.test(s.detail))).toBe(true)
  })

  it('flags newly introduced side effects, not pre-existing ones', () => {
    const sigs = analyzeBehaviorDelta([
      edit('src/x.ts', [{ oldText: 'const a = 1', newText: 'const a = 1\nawait fetch(url)' }])
    ])
    expect(sigs.some((s) => s.kind === 'side-effect' && /网络/.test(s.detail))).toBe(true)

    // A fetch that existed before and after is NOT a new signal.
    const none = analyzeBehaviorDelta([
      edit('src/x.ts', [{ oldText: 'await fetch(a)', newText: 'await fetch(b)' }])
    ])
    expect(none.some((s) => s.kind === 'side-effect')).toBe(false)
  })

  it('flags route changes', () => {
    const sigs = analyzeBehaviorDelta([
      edit('src/server.ts', [{ oldText: 'const r = 1', newText: "router.get('/users', h)" }])
    ])
    expect(sigs.some((s) => s.kind === 'route')).toBe(true)
  })

  it('a new file (write_file) surfaces side effects/routes but not api-added noise', () => {
    const sigs = analyzeBehaviorDelta([
      write('src/new.ts', "export const a = 1\nexport function b() {}\nawait fetch(u)")
    ])
    expect(sigs.some((s) => s.kind === 'side-effect')).toBe(true)
    expect(sigs.some((s) => s.kind === 'api-added')).toBe(false)
  })

  it('flags a changed return-object shape', () => {
    const sigs = analyzeBehaviorDelta([
      edit('src/h.ts', [
        {
          oldText: 'function f() {\n  return { ok: true, value: x }\n}',
          newText: 'function f() {\n  return { ok: true, value: x, error: e }\n}'
        }
      ])
    ])
    const rs = sigs.find((s) => s.kind === 'return-shape')
    expect(rs).toBeTruthy()
    expect(rs?.detail).toContain('+error')
  })

  it('handles multi-line returns with nested objects (brace-balanced)', () => {
    const oldText = [
      'function f() {',
      '  return {',
      '    ok: true,',
      '    data: { x: 1, y: 2 },',
      '  }',
      '}'
    ].join('\n')
    const newText = [
      'function f() {',
      '  return {',
      '    ok: true,',
      '    data: { x: 1, y: 2 },',
      '    error: e,',
      '  }',
      '}'
    ].join('\n')
    const sigs = analyzeBehaviorDelta([edit('src/h.ts', [{ oldText, newText }])])
    const rs = sigs.find((s) => s.kind === 'return-shape')
    expect(rs?.detail).toContain('+error')
    // The nested `data` object's inner keys must NOT be treated as top-level.
    expect(rs?.detail).not.toContain('x')
  })

  it('does not flag return-shape when keys are unchanged', () => {
    const sigs = analyzeBehaviorDelta([
      edit('src/h.ts', [
        { oldText: 'return { a: 1, b: 2 }', newText: 'return { a: 10, b: 20 }' }
      ])
    ])
    expect(sigs.some((s) => s.kind === 'return-shape')).toBe(false)
  })

  it('de-dupes identical signals', () => {
    const sigs = analyzeBehaviorDelta([
      edit('src/x.ts', [
        { oldText: 'a', newText: 'fetch(1)' },
        { oldText: 'b', newText: 'fetch(2)' }
      ])
    ])
    expect(sigs.filter((s) => s.kind === 'side-effect').length).toBe(1)
  })

  it('isBreaking marks removed/changed exports', () => {
    expect(isBreaking({ kind: 'api-removed', file: 'f', detail: '' })).toBe(true)
    expect(isBreaking({ kind: 'api-changed', file: 'f', detail: '' })).toBe(true)
    expect(isBreaking({ kind: 'api-added', file: 'f', detail: '' })).toBe(false)
    expect(isBreaking({ kind: 'side-effect', file: 'f', detail: '' })).toBe(false)
  })
})
