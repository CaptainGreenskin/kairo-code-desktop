import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff, scoreHunk, rankDiff } from './diff-rank'

const diff = `diff --git a/src/api.ts b/src/api.ts
--- a/src/api.ts
+++ b/src/api.ts
@@ -1,3 +1,3 @@ export function getUser
-export function getUser(id: string): User {
+export function getUser(id: string): User | null {
   return db.find(id)
 }
diff --git a/src/util.ts b/src/util.ts
--- a/src/util.ts
+++ b/src/util.ts
@@ -10,2 +10,3 @@ function helper
   const x = 1
+  // a clarifying comment
diff --git a/src/logic.ts b/src/logic.ts
--- a/src/logic.ts
+++ b/src/logic.ts
@@ -5,3 +5,4 @@ function process
   const y = compute()
+  if (y > threshold) return early()
 `

describe('parseUnifiedDiff', () => {
  it('parses files and hunks with +/- lines', () => {
    const files = parseUnifiedDiff(diff)
    expect(files.map((f) => f.path)).toEqual(['src/api.ts', 'src/util.ts', 'src/logic.ts'])
    expect(files[0]!.hunks[0]!.header).toContain('getUser')
    const changed = files[0]!.hunks[0]!.lines.filter((l) => l.kind !== 'ctx')
    expect(changed.some((l) => l.kind === 'add')).toBe(true)
    expect(changed.some((l) => l.kind === 'del')).toBe(true)
  })
})

describe('scoreHunk', () => {
  it('flags signature/contract changes highest', () => {
    const s = scoreHunk(parseUnifiedDiff(diff)[0]!.hunks[0]!)
    expect(s.kind).toBe('contract')
  })
  it('flags comment-only changes as cosmetic', () => {
    const s = scoreHunk(parseUnifiedDiff(diff)[1]!.hunks[0]!)
    expect(s.kind).toBe('cosmetic')
  })
  it('flags control-flow as logic', () => {
    const s = scoreHunk(parseUnifiedDiff(diff)[2]!.hunks[0]!)
    expect(s.kind).toBe('logic')
  })
})

describe('rankDiff', () => {
  it('orders contract > logic > cosmetic', () => {
    const ranked = rankDiff(diff)
    expect(ranked.map((r) => r.kind)).toEqual(['contract', 'logic', 'cosmetic'])
    expect(ranked[0]!.file).toBe('src/api.ts')
    expect(ranked[0]!.sample.some((s) => s.includes('User | null'))).toBe(true)
  })
  it('handles empty input', () => {
    expect(rankDiff('')).toEqual([])
  })
})
