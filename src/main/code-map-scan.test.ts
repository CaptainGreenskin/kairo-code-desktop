import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  scanCodeMapWithStats,
  invalidateCodeMapCache,
  applyFileChange,
  getCachedCodeMap
} from './code-map-scan'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemap-'))
})

afterEach(async () => {
  invalidateCodeMapCache(root)
  await fs.rm(root, { recursive: true, force: true })
})

async function write(rel: string, content: string): Promise<void> {
  const full = path.join(root, rel)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content, 'utf-8')
}

describe('scanCodeMapWithStats (incremental cache)', () => {
  it('reads every file on the first scan, then reuses the cache when nothing changed', async () => {
    await write('src/a/one.ts', `import { x } from '../b/two'`)
    await write('src/b/two.ts', `export const x = 1`)

    const first = await scanCodeMapWithStats(root)
    expect(first.stats.total).toBe(2)
    expect(first.stats.read).toBe(2)
    expect(first.stats.reused).toBe(0)
    expect(first.stats.cached).toBe(false)
    expect(first.map.modules.map((m) => m.id).sort()).toEqual(['src/a', 'src/b'])
    expect(first.map.edges.some((e) => e.from === 'src/a' && e.to === 'src/b')).toBe(true)

    const second = await scanCodeMapWithStats(root)
    expect(second.stats.total).toBe(2)
    expect(second.stats.read).toBe(0)
    expect(second.stats.reused).toBe(2)
    expect(second.stats.cached).toBe(true)
    // Same graph, served from cache.
    expect(second.map).toEqual(first.map)
  })

  it('only re-reads the changed file on rescan', async () => {
    await write('src/a/one.ts', `export const a = 1`)
    await write('src/b/two.ts', `export const b = 1`)
    await scanCodeMapWithStats(root)

    // Touch one file with new content (and a new import edge).
    await new Promise((r) => setTimeout(r, 5)) // ensure mtime advances
    await write('src/a/one.ts', `import { b } from '../b/two'\nexport const a = 1`)

    const res = await scanCodeMapWithStats(root)
    expect(res.stats.read).toBe(1)
    expect(res.stats.reused).toBe(1)
    expect(res.map.edges.some((e) => e.from === 'src/a' && e.to === 'src/b')).toBe(true)
  })

  it('prunes deleted files from the map and reports the removal', async () => {
    await write('src/a/one.ts', `export const a = 1`)
    await write('src/a/two.ts', `export const b = 1`)
    await scanCodeMapWithStats(root)

    await fs.rm(path.join(root, 'src/a/two.ts'))
    const res = await scanCodeMapWithStats(root)
    expect(res.stats.removed).toBe(1)
    expect(res.map.modules.find((m) => m.id === 'src/a')?.fileCount).toBe(1)
  })
})

describe('applyFileChange (precise invalidation)', () => {
  it('no-ops before the workspace has been scanned', async () => {
    await write('src/a/one.ts', `export const a = 1`)
    const changed = await applyFileChange(root, path.join(root, 'src/a/one.ts'), 'modified')
    expect(changed).toBe(false)
    expect(getCachedCodeMap(root)).toBeNull()
  })

  it('updates a single file in place and re-assembles from cache (no walk)', async () => {
    await write('src/a/one.ts', `export const a = 1`)
    await write('src/b/two.ts', `export const b = 1`)
    await scanCodeMapWithStats(root)

    // Add a new module + edge by creating a file, then notify the cache.
    await write('src/a/three.ts', `import { b } from '../b/two'`)
    const changed = await applyFileChange(root, path.join(root, 'src/a/three.ts'), 'created')
    expect(changed).toBe(true)

    const map = getCachedCodeMap(root)
    expect(map?.modules.find((m) => m.id === 'src/a')?.fileCount).toBe(2)
    expect(map?.edges.some((e) => e.from === 'src/a' && e.to === 'src/b')).toBe(true)
  })

  it('drops a deleted file from the cached map', async () => {
    await write('src/a/one.ts', `export const a = 1`)
    await write('src/a/two.ts', `export const b = 1`)
    await scanCodeMapWithStats(root)

    const changed = await applyFileChange(root, path.join(root, 'src/a/two.ts'), 'deleted')
    expect(changed).toBe(true)
    expect(getCachedCodeMap(root)?.modules.find((m) => m.id === 'src/a')?.fileCount).toBe(1)
  })

  it('ignores non-source files', async () => {
    await write('src/a/one.ts', `export const a = 1`)
    await scanCodeMapWithStats(root)
    const changed = await applyFileChange(root, path.join(root, 'README.md'), 'created')
    expect(changed).toBe(false)
  })
})
