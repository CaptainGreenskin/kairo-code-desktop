import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { snapshotFile, rollbackChanges, checkpointCount, resetCheckpoint } from './checkpoint'

let ws: string

beforeEach(() => {
  ws = mkdtempSync(path.join(tmpdir(), 'kairo-ckpt-'))
})
afterEach(() => {
  rmSync(ws, { recursive: true, force: true })
})

describe('checkpoint', () => {
  it('restores a modified file to its pre-snapshot content', async () => {
    const f = path.join(ws, 'a.txt')
    await fs.writeFile(f, 'original', 'utf-8')
    await snapshotFile(ws, f)
    await fs.writeFile(f, 'MODIFIED', 'utf-8')
    expect(await checkpointCount(ws)).toBe(1)

    const r = await rollbackChanges(ws)
    expect(r).toEqual({ restored: 1, deleted: 0 })
    expect(await fs.readFile(f, 'utf-8')).toBe('original')
    expect(await checkpointCount(ws)).toBe(0) // baseline cleared after rollback
  })

  it('deletes a newly-created file on rollback', async () => {
    const f = path.join(ws, 'new.txt')
    await snapshotFile(ws, f) // captured as absent
    await fs.writeFile(f, 'created by agent', 'utf-8')

    const r = await rollbackChanges(ws)
    expect(r).toEqual({ restored: 0, deleted: 1 })
    await expect(fs.readFile(f, 'utf-8')).rejects.toThrow()
  })

  it('keeps the ORIGINAL across multiple edits (first-touch only)', async () => {
    const f = path.join(ws, 'b.txt')
    await fs.writeFile(f, 'v0', 'utf-8')
    await snapshotFile(ws, f)
    await fs.writeFile(f, 'v1', 'utf-8')
    await snapshotFile(ws, f) // no-op: already captured
    await fs.writeFile(f, 'v2', 'utf-8')

    await rollbackChanges(ws)
    expect(await fs.readFile(f, 'utf-8')).toBe('v0')
  })

  it('reset clears the baseline without touching files', async () => {
    const f = path.join(ws, 'c.txt')
    await fs.writeFile(f, 'keep', 'utf-8')
    await snapshotFile(ws, f)
    await resetCheckpoint(ws)
    expect(await checkpointCount(ws)).toBe(0)
    expect(await fs.readFile(f, 'utf-8')).toBe('keep')
  })
})
