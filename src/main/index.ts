import { app, BrowserWindow, Menu, MenuItem, session, shell } from 'electron'
import { join } from 'path'
import { createAgentManager } from './agent'
import { FileWatcher } from './file-watcher'
import { McpManager } from './mcp-manager'
import { registerIpcHandlers, unregisterIpcHandlers } from './ipc-handlers'
import { initAutoUpdater } from './updater'

const isDev = !app.isPackaged

let fileWatcher: FileWatcher | null = null
let mcpManager: McpManager | null = null

function createWindow(): BrowserWindow {
  // Window chrome differs by platform: macOS hides the titlebar inset and
  // positions the traffic-light controls inside our drag region; Windows
  // and Linux keep the standard frame.
  const platformChrome =
    process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 12, y: 10 }
        }
      : {}

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Kairo Code',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0f',
    ...platformChrome,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Native context menu for text selection / editable inputs.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu()
    if (params.selectionText && params.selectionText.trim().length > 0) {
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }))
    }
    if (params.isEditable) {
      if (menu.items.length > 0) menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({ label: 'Cut', role: 'cut' }))
      menu.append(new MenuItem({ label: 'Paste', role: 'paste' }))
      menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }))
    }
    if (menu.items.length > 0) {
      menu.popup({ window: mainWindow })
    }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  // Set CSP for production builds. We allow:
  //  - 'self' for scripts so eval/inline scripts are blocked.
  //  - 'unsafe-inline' for styles because shiki emits inline style attributes
  //    on every highlighted token; without it, code blocks render unstyled.
  //  - data: URIs for images so embedded icons / base64 thumbnails work.
  //  - Outbound connections to the model providers we ship adapters for, plus
  //    a permissive https://* fallback so users can point at custom OpenAI-
  //    compatible base URLs (Zhipu, OpenRouter, Azure, self-hosted, ...).
  if (!isDev) {
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://api.openai.com https://api.anthropic.com https://*.zhipuai.cn https://*"
    ].join('; ')
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp]
        }
      })
    })
  }

  const mainWindow = createWindow()
  mcpManager = new McpManager()
  const agentManager = createAgentManager(mainWindow, mcpManager)
  fileWatcher = new FileWatcher(mainWindow)
  registerIpcHandlers(mainWindow, agentManager, fileWatcher, mcpManager)
  initAutoUpdater(mainWindow)

  // Release the watcher when the bound window goes away to avoid stale
  // sends to a destroyed webContents on subsequent `watch()` calls.
  mainWindow.on('closed', () => {
    fileWatcher?.stop()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  unregisterIpcHandlers()
  fileWatcher?.stop()
  fileWatcher = null
  mcpManager?.shutdown()
  mcpManager = null
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
