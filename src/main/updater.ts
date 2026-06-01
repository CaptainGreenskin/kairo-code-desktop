import { app, BrowserWindow } from 'electron'
import log from 'electron-log'
import { autoUpdater } from 'electron-updater'

/**
 * Initialise the auto-updater. We only check for updates in packaged builds —
 * during development the runtime metadata required by electron-updater (e.g.
 * `app-update.yml`) is not produced and `checkForUpdates` would noisily fail.
 */
export function initAutoUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged || process.env.NODE_ENV === 'development') return

  autoUpdater.logger = log
  // Ask the user before consuming bandwidth.
  autoUpdater.autoDownload = false

  autoUpdater.on('update-available', (info) => {
    if (mainWindow.isDestroyed()) return
    mainWindow.webContents.send('update:available', {
      version: info.version,
      releaseNotes: info.releaseNotes
    })
  })

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow.isDestroyed()) return
    mainWindow.webContents.send('update:downloaded')
  })

  autoUpdater.on('error', (err) => {
    log.error('Auto-updater error:', err)
  })

  // Stagger the first check so we don't compete with initial UI rendering,
  // and swallow network failures (offline boot is a common case).
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.warn('Auto-updater initial check failed:', err)
    })
  }, 10_000)
}

export function downloadUpdate(): Promise<unknown> {
  return autoUpdater.downloadUpdate()
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}
