import { describe, expect, it } from 'vitest'
import { evaluateGate } from './comprehension-gate'
import type { ChangeLens } from './types'

const lens = (over: Partial<ChangeLens> = {}): ChangeLens => ({
  blastRadius: [],
  filesChanged: [],
  verification: { ran: [], filesWritten: [], testsRun: false },
  uncertaintyFlags: [],
  ...over
})

const GLOBS = ['**/auth/**', '**/payment*/**']

describe('evaluateGate', () => {
  it('auto-passes when nothing changed', () => {
    const v = evaluateGate(lens(), GLOBS)
    expect(v.risk).toBe('auto')
    expect(v.summary).toMatch(/没有文件改动/)
  })

  it('auto-passes a small, tested change in a normal path', () => {
    const v = evaluateGate(
      lens({
        filesChanged: ['src/util/a.ts'],
        blastRadius: [{ module: 'src/util', files: ['src/util/a.ts'] }],
        verification: { ran: [{ command: 'npm test', ok: true }], filesWritten: ['src/util/a.ts'], testsRun: true }
      }),
      GLOBS
    )
    expect(v.risk).toBe('auto')
  })

  it('escalates to review when an invariant region is touched, and points at it', () => {
    const v = evaluateGate(
      lens({
        filesChanged: ['src/auth/login.ts', 'src/util/a.ts'],
        blastRadius: [
          { module: 'src/auth', files: ['src/auth/login.ts'] },
          { module: 'src/util', files: ['src/util/a.ts'] }
        ],
        verification: { ran: [{ command: 'npm test', ok: true }], filesWritten: ['src/auth/login.ts'], testsRun: true }
      }),
      GLOBS
    )
    expect(v.risk).toBe('review')
    expect(v.reasons[0]?.kind).toBe('protected')
    expect(v.focus?.file).toBe('src/auth/login.ts')
    expect(v.question).toMatch(/不变量区/)
  })

  it('escalates on a failed command', () => {
    const v = evaluateGate(
      lens({
        filesChanged: ['src/a.ts'],
        blastRadius: [{ module: 'src', files: ['src/a.ts'] }],
        verification: { ran: [{ command: 'npm run build', ok: false }], filesWritten: ['src/a.ts'], testsRun: false }
      }),
      GLOBS
    )
    expect(v.risk).toBe('review')
    expect(v.reasons[0]?.kind).toBe('failed')
    expect(v.question).toMatch(/执行失败/)
  })

  it('escalates and surfaces the agent uncertainty flag as the question', () => {
    const v = evaluateGate(
      lens({
        filesChanged: ['src/a.ts'],
        blastRadius: [{ module: 'src', files: ['src/a.ts'] }],
        verification: { ran: [{ command: 'npm test', ok: true }], filesWritten: ['src/a.ts'], testsRun: true },
        uncertaintyFlags: ['error handling in the retry path may be wrong']
      }),
      GLOBS
    )
    expect(v.risk).toBe('review')
    expect(v.reasons[0]?.kind).toBe('uncertain')
    expect(v.question).toContain('error handling in the retry path')
  })

  it('escalates when 3+ files changed without tests', () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts']
    const v = evaluateGate(
      lens({
        filesChanged: files,
        blastRadius: [{ module: 'src', files }],
        verification: { ran: [], filesWritten: files, testsRun: false }
      }),
      GLOBS
    )
    expect(v.risk).toBe('review')
    expect(v.reasons[0]?.kind).toBe('unverified')
    expect(v.focus?.file).toBe('src/a.ts')
  })

  it('flags a verification gap when behavior changed but no tests ran', () => {
    const v = evaluateGate(
      lens({
        filesChanged: ['src/api.ts'],
        blastRadius: [{ module: 'src', files: ['src/api.ts'] }],
        verification: { ran: [{ command: 'npm run build', ok: true }], filesWritten: ['src/api.ts'], testsRun: false },
        behaviorDelta: [
          { kind: 'api-removed', file: 'src/api.ts', detail: '删除/改名导出 fetchUser', name: 'fetchUser' },
          { kind: 'side-effect', file: 'src/api.ts', detail: '新增网络调用' }
        ]
      }),
      GLOBS
    )
    expect(v.risk).toBe('review')
    // The anti-rubber-stamp string names what went unverified.
    expect(v.verificationGap).toBeDefined()
    expect(v.verificationGap).toMatch(/跑了 1 条命令、未跑测试/)
    expect(v.verificationGap).toMatch(/2 处可观测行为变化（含 1 处契约破坏）无任何测试覆盖/)
  })

  it('escalates a single-file untested change to high when behavior changed', () => {
    // Without behavior, one untested file is only medium → could be auto. With a
    // behavior change, the unverified factor is high regardless of file count.
    const v = evaluateGate(
      lens({
        filesChanged: ['src/x.ts'],
        blastRadius: [{ module: 'src', files: ['src/x.ts'] }],
        verification: { ran: [], filesWritten: ['src/x.ts'], testsRun: false },
        behaviorDelta: [{ kind: 'route', file: 'src/x.ts', detail: '新增路由/端点' }]
      }),
      GLOBS
    )
    expect(v.risk).toBe('review')
    expect(v.reasons.some((r) => r.kind === 'unverified' && r.severity === 'high')).toBe(true)
    expect(v.verificationGap).toMatch(/没跑任何测试/)
  })

  it('does not flag a verification gap when tests ran', () => {
    const v = evaluateGate(
      lens({
        filesChanged: ['src/api.ts'],
        blastRadius: [{ module: 'src', files: ['src/api.ts'] }],
        verification: { ran: [{ command: 'npm test', ok: true }], filesWritten: ['src/api.ts'], testsRun: true },
        behaviorDelta: [{ kind: 'api-added', file: 'src/api.ts', detail: '新增导出 helper' }]
      }),
      GLOBS
    )
    expect(v.verificationGap).toBeUndefined()
  })

  it('escalates a dependency cycle to review and asks the architecture question', () => {
    const v = evaluateGate(
      lens({
        filesChanged: ['src/main/agent.ts'],
        blastRadius: [{ module: 'src/main', files: ['src/main/agent.ts'] }],
        verification: { ran: [{ command: 'npm test', ok: true }], filesWritten: ['src/main/agent.ts'], testsRun: true },
        deviations: [{ kind: 'cyclic-dependency', fromModule: 'src/main', toModule: 'src/shared', file: 'src/main/agent.ts', detail: '成环依赖：src/main ⇄ src/shared' }]
      }),
      GLOBS
    )
    expect(v.risk).toBe('review')
    expect(v.reasons.some((r) => r.kind === 'deviation' && r.severity === 'high')).toBe(true)
    expect(v.question).toMatch(/成环/)
    expect(v.focus?.file).toBe('src/main/agent.ts')
  })

  it('a new (non-cyclic) cross-module dependency is a medium glance, not forced review on its own', () => {
    const v = evaluateGate(
      lens({
        filesChanged: ['src/main/agent.ts'],
        blastRadius: [{ module: 'src/main', files: ['src/main/agent.ts'] }],
        verification: { ran: [{ command: 'npm test', ok: true }], filesWritten: ['src/main/agent.ts'], testsRun: true },
        deviations: [{ kind: 'new-dependency', fromModule: 'src/main', toModule: 'src/shared', file: 'src/main/agent.ts', detail: '新建依赖：src/main → src/shared' }]
      }),
      GLOBS
    )
    expect(v.reasons.some((r) => r.kind === 'deviation' && r.severity === 'medium')).toBe(true)
    expect(v.risk).toBe('auto')
  })

  it('a broad-but-otherwise-clean change alone does NOT force review', () => {
    const blastRadius = ['a', 'b', 'c', 'd'].map((m) => ({ module: m, files: [`${m}/x.ts`] }))
    const v = evaluateGate(
      lens({
        filesChanged: blastRadius.map((m) => m.files[0]!),
        blastRadius,
        verification: { ran: [{ command: 'npm test', ok: true }], filesWritten: [], testsRun: true }
      }),
      GLOBS
    )
    // 4 modules → 'broad' (medium) is recorded, but no high reason ⇒ still auto.
    expect(v.reasons.some((r) => r.kind === 'broad')).toBe(true)
    expect(v.risk).toBe('auto')
  })

  it('a breaking behavior change (removed export) forces review and sharpens the question', () => {
    const v = evaluateGate(
      lens({
        filesChanged: ['src/api.ts'],
        blastRadius: [{ module: 'src', files: ['src/api.ts'] }],
        verification: { ran: [{ command: 'npm test', ok: true }], filesWritten: ['src/api.ts'], testsRun: true },
        behaviorDelta: [{ kind: 'api-removed', file: 'src/api.ts', detail: '删除/改名导出 parseConfig' }]
      }),
      GLOBS
    )
    expect(v.risk).toBe('review')
    expect(v.reasons[0]?.kind).toBe('behavior')
    expect(v.question).toMatch(/调用方都更新了吗/)
    expect(v.focus?.file).toBe('src/api.ts')
  })

  it('a non-breaking behavior signal alone (new side effect, tested) stays auto', () => {
    const v = evaluateGate(
      lens({
        filesChanged: ['src/x.ts'],
        blastRadius: [{ module: 'src', files: ['src/x.ts'] }],
        verification: { ran: [{ command: 'npm test', ok: true }], filesWritten: ['src/x.ts'], testsRun: true },
        behaviorDelta: [{ kind: 'side-effect', file: 'src/x.ts', detail: '新增网络调用' }]
      }),
      GLOBS
    )
    expect(v.reasons.some((r) => r.kind === 'behavior' && r.severity === 'medium')).toBe(true)
    expect(v.risk).toBe('auto')
  })

  it('annotates a non-behavior main question with the lead behavior signal (note)', () => {
    const v = evaluateGate(
      lens({
        filesChanged: ['src/auth/login.ts'],
        blastRadius: [{ module: 'src/auth', files: ['src/auth/login.ts'] }],
        verification: { ran: [{ command: 'npm test', ok: true }], filesWritten: ['src/auth/login.ts'], testsRun: true },
        behaviorDelta: [{ kind: 'api-removed', file: 'src/auth/login.ts', detail: '删除/改名导出 verify' }]
      }),
      GLOBS
    )
    // Protected is the main question; the export change rides along as a note.
    expect(v.reasons[0]?.kind).toBe('protected')
    expect(v.question).toMatch(/不变量区/)
    expect(v.note).toMatch(/同时改了导出契约/)
    expect(v.note).toContain('verify')
  })

  it('no note when behavior IS the main question', () => {
    const v = evaluateGate(
      lens({
        filesChanged: ['src/api.ts'],
        blastRadius: [{ module: 'src', files: ['src/api.ts'] }],
        verification: { ran: [{ command: 'npm test', ok: true }], filesWritten: ['src/api.ts'], testsRun: true },
        behaviorDelta: [{ kind: 'api-removed', file: 'src/api.ts', detail: '删除/改名导出 x' }]
      }),
      GLOBS
    )
    expect(v.reasons[0]?.kind).toBe('behavior')
    expect(v.note).toBeUndefined()
  })

  it('a return-shape change drives the question and focus when it is the lead', () => {
    const v = evaluateGate(
      lens({
        filesChanged: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        blastRadius: [{ module: 'src', files: ['src/a.ts', 'src/b.ts', 'src/c.ts'] }],
        verification: { ran: [], filesWritten: [], testsRun: false },
        behaviorDelta: [{ kind: 'return-shape', file: 'src/b.ts', detail: '返回结构变化：+error' }]
      }),
      GLOBS
    )
    // unverified(3 files) is the high reason → review; focus follows the
    // concrete return-shape change rather than "the biggest module".
    expect(v.risk).toBe('review')
    expect(v.focus?.file).toBe('src/b.ts')
    expect(v.note).toMatch(/返回结构/)
  })

  it('protected outranks other high reasons as the one question', () => {
    const v = evaluateGate(
      lens({
        filesChanged: ['src/auth/login.ts', 'src/a.ts', 'src/b.ts'],
        blastRadius: [
          { module: 'src/auth', files: ['src/auth/login.ts'] },
          { module: 'src', files: ['src/a.ts', 'src/b.ts'] }
        ],
        verification: { ran: [{ command: 'build', ok: false }], filesWritten: [], testsRun: false },
        uncertaintyFlags: ['unsure']
      }),
      GLOBS
    )
    expect(v.risk).toBe('review')
    expect(v.reasons[0]?.kind).toBe('protected')
    expect(v.focus?.file).toBe('src/auth/login.ts')
  })
})
