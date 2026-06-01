/**
 * File checkpoint / rollback — the safety net for unattended writes. Before a
 * write/edit tool first touches a file, its prior content (or "absent") is
 * snapshotted under `.kairo/checkpoints/<workspace>`. A rollback restores every
 * snapshotted file to its pre-run state (and deletes files that were newly
 * created), so you can undo what an overnight run did in one action.
 *
 * Keyed per-workspace; an autonomous run resets the baseline at start, so
 * "rollback" means "undo since this run began". First-touch-only snapshots keep
 * the original pre-run content even across many edits to the same file.
 * Ported in spirit from the Kairo (Java) CheckpointManager.
 */

import { promises as fs } from 'node:fs'
import * as nodePath from 'node:path'
import { createHash } from 'node:crypto'

interface SnapshotEntry {
  /** Whether the file existed before the first touch. */
  existed: boolean
  /** Blob filename holding the prior content (when existed). */
  blob: string
}

type CheckpointIndex = Record<string, SnapshotEntry>

const dirFor = (workspaceRoot: string): string =>
  nodePath.join(workspaceRoot, '.kairo', 'checkpoints')
const indexFile = (workspaceRoot: string): string => nodePath.join(dirFor(workspaceRoot), 'index.json')

async function readIndex(workspaceRoot: string): Promise<CheckpointIndex> {
  try {
    const parsed = JSON.parse(await fs.readFile(indexFile(workspaceRoot), 'utf-8')) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as CheckpointIndex) : {}
  } catch {
    return {}
  }
}

/** Snapshot a file's prior state before it is first modified this run. */
export async function snapshotFile(workspaceRoot: string, absPath: string): Promise<void> {
  try {
    const dir = dirFor(workspaceRoot)
    const index = await readIndex(workspaceRoot)
    if (index[absPath]) return // already captured this run — keep the original
    await fs.mkdir(dir, { recursive: true })
    let existed = true
    let content = ''
    try {
      content = await fs.readFile(absPath, 'utf-8')
    } catch {
      existed = false
    }
    const blob = createHash('sha1').update(absPath).digest('hex')
    if (existed) await fs.writeFile(nodePath.join(dir, blob), content, 'utf-8')
    index[absPath] = { existed, blob }
    await fs.writeFile(indexFile(workspaceRoot), JSON.stringify(index, null, 2), 'utf-8')
  } catch {
    // Best-effort: a checkpoint failure must never block the actual edit.
  }
}

/** Number of files captured in the current checkpoint baseline. */
export async function checkpointCount(workspaceRoot: string): Promise<number> {
  return Object.keys(await readIndex(workspaceRoot)).length
}

/** Reset the baseline (start of a fresh run) — discards prior snapshots. */
export async function resetCheckpoint(workspaceRoot: string): Promise<void> {
  try {
    await fs.rm(dirFor(workspaceRoot), { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
}

export interface RollbackResult {
  restored: number
  deleted: number
}

/** Restore all snapshotted files to their pre-run state; clears the baseline. */
export async function rollbackChanges(workspaceRoot: string): Promise<RollbackResult> {
  const dir = dirFor(workspaceRoot)
  const index = await readIndex(workspaceRoot)
  let restored = 0
  let deleted = 0
  for (const [absPath, entry] of Object.entries(index)) {
    try {
      if (entry.existed) {
        const content = await fs.readFile(nodePath.join(dir, entry.blob), 'utf-8')
        await fs.writeFile(absPath, content, 'utf-8')
        restored += 1
      } else {
        await fs.unlink(absPath).catch(() => {})
        deleted += 1
      }
    } catch {
      /* skip unreadable/unwritable entries */
    }
  }
  await resetCheckpoint(workspaceRoot)
  return { restored, deleted }
}
