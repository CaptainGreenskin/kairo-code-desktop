/**
 * Workspace file system watcher.
 *
 * Wraps a single chokidar instance bound to a {@link BrowserWindow} and
 * forwards add/change/unlink events to the renderer through the
 * `kairo:fileChange` IPC channel.
 *
 * Only one directory is watched at a time; calling {@link FileWatcher.watch}
 * with a different path replaces the prior watch. `stop()` is invoked from
 * `main/index.ts` on app quit so file handles release cleanly.
 */

import type { BrowserWindow } from 'electron'
import chokidar, { type FSWatcher } from 'chokidar'
import type { FileChangeEvent } from '../shared/types'
import { applyFileChange, getCachedCodeMap } from './code-map-scan'

const IGNORED_GLOBS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.DS_Store',
  '**/*.lock'
]

type ChokidarEvent = 'add' | 'change' | 'unlink'

const CHANGE_TYPE: Record<ChokidarEvent, FileChangeEvent['changeType']> = {
  add: 'created',
  change: 'modified',
  unlink: 'deleted'
}

/** Coalesce bursts of file events (e.g. `git checkout`) into one map push. */
const CODE_MAP_PUSH_DEBOUNCE_MS = 150

export class FileWatcher {
  private watcher: FSWatcher | null = null
  private watchedPath: string | null = null
  private readonly mainWindow: BrowserWindow
  private codeMapPushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  /** Returns the currently watched directory or null if not watching. */
  get current(): string | null {
    return this.watchedPath
  }

  watch(directory: string): void {
    if (this.watchedPath === directory && this.watcher) return
    this.stop()

    const watcher = chokidar.watch(directory, {
      ignored: IGNORED_GLOBS,
      persistent: true,
      ignoreInitial: true,
      // chokidar's defaults can fire multiple events for a single edit on
      // some editors; stabilizing keeps the renderer's UI churn-free.
      awaitWriteFinish: {
        stabilityThreshold: 75,
        pollInterval: 25
      }
    })

    watcher.on('add', (filePath) => this.notify('add', filePath))
    watcher.on('change', (filePath) => this.notify('change', filePath))
    watcher.on('unlink', (filePath) => this.notify('unlink', filePath))
    watcher.on('error', (err) => {
      // We don't surface watcher errors to the renderer today; log so they
      // are visible during development but don't crash the main process.
      // eslint-disable-next-line no-console
      console.error('[file-watcher] error', err)
    })

    this.watcher = watcher
    this.watchedPath = directory
  }

  private notify(event: ChokidarEvent, filePath: string): void {
    if (this.mainWindow.isDestroyed()) return
    const payload: FileChangeEvent = {
      path: filePath,
      changeType: CHANGE_TYPE[event],
      at: Date.now()
    }
    this.mainWindow.webContents.send('kairo:fileChange', payload)
    // Precise Code Map invalidation: update just this file in the cache and push
    // the refreshed map (no full re-scan). Drives the live "World" map without
    // the renderer polling.
    void this.refreshCodeMap(event, filePath)
  }

  private async refreshCodeMap(event: ChokidarEvent, filePath: string): Promise<void> {
    const root = this.watchedPath
    if (!root) return
    try {
      // Update the cache immediately (cheap, single file), but coalesce the
      // map push so a burst of events yields one re-assembly + one send.
      const changed = await applyFileChange(root, filePath, CHANGE_TYPE[event])
      if (changed) this.scheduleCodeMapPush()
    } catch {
      // best-effort; the next explicit scan will reconcile.
    }
  }

  private scheduleCodeMapPush(): void {
    if (this.codeMapPushTimer) clearTimeout(this.codeMapPushTimer)
    this.codeMapPushTimer = setTimeout(() => {
      this.codeMapPushTimer = null
      const root = this.watchedPath
      if (!root || this.mainWindow.isDestroyed()) return
      const map = getCachedCodeMap(root)
      if (map) this.mainWindow.webContents.send('kairo:codeMapChanged', { map })
    }, CODE_MAP_PUSH_DEBOUNCE_MS)
  }

  stop(): void {
    if (this.codeMapPushTimer) {
      clearTimeout(this.codeMapPushTimer)
      this.codeMapPushTimer = null
    }
    if (this.watcher) {
      void this.watcher.close().catch(() => {
        // best-effort close
      })
    }
    this.watcher = null
    this.watchedPath = null
  }
}
