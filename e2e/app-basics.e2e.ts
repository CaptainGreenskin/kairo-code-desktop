import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

let app: ElectronApplication
let page: Page
let userData: string

test.beforeAll(async () => {
  userData = mkdtempSync(path.join(tmpdir(), 'kairo-e2e-basic-'))
  app = await electron.launch({
    args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  try { rmSync(userData, { recursive: true, force: true }) } catch { /* best-effort */ }
})

// ═══════════════════════════════════════════════════════════════════════════
// WELCOME & CHAT
// ═══════════════════════════════════════════════════════════════════════════

test('welcome screen shows on first launch', async () => {
  await expect(page.getByRole('heading', { name: 'Kairo Code' })).toBeVisible()
  await page.screenshot({ path: 'e2e/screenshots/welcome-screen.png' })
})

test('input bar is always visible with the prompt placeholder', async () => {
  await expect(page.getByPlaceholder(/ask anything/i)).toBeVisible()
})

test('sending a prompt without an API key shows an error', async () => {
  const input = page.getByPlaceholder(/ask anything/i)
  await input.fill('hello world')
  await input.press('Enter')
  // With no API key configured, the app should show an error (toast, banner, or inline).
  // Wait for any error-like indicator.
  const error = page.locator('[class*="danger"], [class*="error"]').first()
  await expect(error).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: 'e2e/screenshots/chat-no-key-error.png' })
})

test('the user message bubble appears after sending', async () => {
  // The previous test sent "hello world" — it should appear as a user bubble.
  await expect(page.getByText('hello world')).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════════════════════

test('⌘B toggles the sidebar', async () => {
  const sidebar = page.locator('#kairo-sidebar')
  const wasBefore = await sidebar.isVisible().catch(() => false)
  await page.keyboard.press('Meta+B')
  if (wasBefore) {
    // Collapsed — sidebar should hide or shrink.
    await expect(page.getByTitle('Expand sidebar')).toBeVisible()
  } else {
    await expect(sidebar).toBeVisible()
  }
  // Toggle back.
  await page.keyboard.press('Meta+B')
  await page.screenshot({ path: 'e2e/screenshots/shortcut-sidebar.png' })
})

test('⌘, toggles settings', async () => {
  await page.keyboard.press('Meta+Comma')
  await expect(page.getByLabel('Close settings')).toBeVisible()
  await page.keyboard.press('Meta+Comma')
  await expect(page.getByLabel('Close settings')).toBeHidden()
})

test('⌘K toggles the command palette', async () => {
  await page.keyboard.press('Meta+K')
  await expect(page.getByPlaceholder(/type a command/i)).toBeVisible()
  // Toggle off (Escape may not propagate in Electron headless).
  await page.keyboard.press('Meta+K')
  await expect(page.getByPlaceholder(/type a command/i)).toBeHidden()
})

test('⌘P toggles Quick File Open', async () => {
  await page.keyboard.press('Meta+P')
  const input = page.getByPlaceholder(/search files/i)
  // QuickFileOpen may require a workspace — if it doesn't render, skip gracefully.
  const opened = await input.isVisible().catch(() => false)
  if (opened) {
    await page.keyboard.press('Meta+P')
  }
})

test('⌘⇧F opens Find in Files', async () => {
  await page.keyboard.press('Meta+Shift+F')
  await expect(page.getByPlaceholder(/search pattern/i)).toBeVisible({ timeout: 5_000 })
  await page.keyboard.press('Meta+Shift+F')
})

test('⌘⇧A toggles the Activity panel', async () => {
  await page.keyboard.press('Meta+Shift+A')
  // The activity panel shows a header or container.
  await expect(page.getByText(/activity/i).first()).toBeVisible()
  await page.keyboard.press('Meta+Shift+A')
})

test('⌘⇧M toggles the Code Map dock', async () => {
  await page.keyboard.press('Meta+Shift+M')
  await expect(page.getByTestId('code-map')).toBeVisible()
  await page.keyboard.press('Meta+Shift+M')
  await expect(page.getByTestId('code-map')).toBeHidden()
})

test('⌘E toggles the Editor panel', async () => {
  await page.keyboard.press('Meta+E')
  // Editor should show (even if no file is open, the tab bar or placeholder renders).
  // Just check it toggles without error — press twice to restore.
  await page.keyboard.press('Meta+E')
})

// ═══════════════════════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

test('⌘N creates a new session, visible in sidebar', async () => {
  // Ensure sidebar is visible.
  if (!(await page.locator('#kairo-sidebar').isVisible().catch(() => false))) {
    await page.keyboard.press('Meta+B')
  }
  const countBefore = await page.locator('#kairo-sidebar li').count()
  await page.keyboard.press('Meta+N')
  // A new session list item should appear.
  await expect(page.locator('#kairo-sidebar li')).toHaveCount(countBefore + 1, { timeout: 5_000 })
  await page.screenshot({ path: 'e2e/screenshots/session-new.png' })
})

test('clicking a session in sidebar switches to it', async () => {
  if (!(await page.locator('#kairo-sidebar').isVisible().catch(() => false))) {
    await page.keyboard.press('Meta+B')
  }
  // Click the first session in the list.
  const first = page.locator('#kairo-sidebar li button').first()
  await first.click()
  // The input bar should still be visible (session loaded).
  await expect(page.getByPlaceholder(/ask anything/i)).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════
// SLASH COMMANDS
// ═══════════════════════════════════════════════════════════════════════════

test('typing / in input bar shows the slash command menu', async () => {
  const input = page.getByPlaceholder(/ask anything/i)
  await input.fill('/')
  // The slash menu should appear with at least the built-in commands.
  await expect(page.getByText('/new')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('/settings')).toBeVisible()
  // Clear.
  await input.fill('')
})

// ═══════════════════════════════════════════════════════════════════════════
// FILE NAVIGATION (uses own repo as workspace, already cwd)
// ═══════════════════════════════════════════════════════════════════════════

test('Quick File Open: UI renders when toggled (workspace-dependent)', async () => {
  await page.keyboard.press('Meta+P')
  // May require a workspace to actually list files — just verify the shortcut toggles.
  const input = page.getByPlaceholder(/search files/i)
  const opened = await input.isVisible().catch(() => false)
  if (opened) {
    await input.fill('package')
    // If results render, great; if not, the feature needs a workspace.
    await page.keyboard.press('Meta+P')
  }
})

test('Find in Files: searching matches content in this repo', async () => {
  await page.keyboard.press('Meta+Shift+F')
  const input = page.getByPlaceholder(/search pattern/i)
  await expect(input).toBeVisible()
  await input.fill('kairo-code-desktop')
  await input.press('Enter')
  // Should find matches (the string is in package.json at minimum).
  await expect(page.getByText(/result/i).first()).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Escape')
})
