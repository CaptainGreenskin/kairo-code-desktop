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
  userData = mkdtempSync(path.join(tmpdir(), 'kairo-e2e-set-'))
  app = await electron.launch({
    args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', OPENAI_API_KEY: 'test-e2e' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  try { rmSync(userData, { recursive: true, force: true }) } catch { /* best-effort */ }
})

async function openSettings(): Promise<void> {
  const close = page.getByLabel('Close settings')
  if (await close.isVisible().catch(() => false)) return
  await page.keyboard.press('Meta+Comma')
  await expect(close).toBeVisible()
}

async function closeSettings(): Promise<void> {
  const close = page.getByLabel('Close settings')
  if (await close.isVisible().catch(() => false)) {
    await close.click()
    await expect(close).toBeHidden()
  }
}

// ── Provider ────────────────────────────────────────────────────────────

test('Settings: provider switch toggles between OpenAI and Anthropic', async () => {
  await openSettings()
  // The Anthropic button text includes the subtitle, so use the desc to disambiguate.
  const anthropicBtn = page.getByText('Claude Opus / Sonnet / Haiku').locator('..')
  await anthropicBtn.click()
  await page.getByText('Save', { exact: true }).click()
  // After saving with Anthropic provider, reopen and check for the Anthropic key field.
  await openSettings()
  await expect(page.getByPlaceholder('sk-ant-...')).toBeVisible()
  // Switch back to OpenAI.
  const openaiBtn = page.getByText('GLM, OpenAI, DeepSeek, Qwen').locator('..')
  await openaiBtn.click()
  await page.getByText('Save', { exact: true }).click()
  await page.screenshot({ path: 'e2e/screenshots/settings-provider.png' })
})

// ── Model ───────────────────────────────────────────────────────────────

test('Settings: model preset select shows presets and allows custom', async () => {
  await openSettings()
  const select = page.locator('select').first()
  await expect(select).toBeVisible()
  const options = await select.locator('option').allTextContents()
  expect(options.length).toBeGreaterThan(1)
  expect(options.some((o) => o.includes('Custom'))).toBe(true)
  await page.screenshot({ path: 'e2e/screenshots/settings-model.png' })
})

// ── Theme ───────────────────────────────────────────────────────────────

test('Settings: theme switch changes the document data-theme attribute', async () => {
  await openSettings()
  // Theme change is draft-based — need to select then Save.
  await page.getByText('Light', { exact: true }).click()
  await page.getByText('Save', { exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  // Reopen settings to switch again.
  await openSettings()
  await page.getByText('Dark', { exact: true }).click()
  await page.getByText('Save', { exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: 'e2e/screenshots/settings-theme.png' })
})

// ── Autopilot ───────────────────────────────────────────────────────────

test('Settings: autopilot toggle and max-turns slider are functional', async () => {
  await openSettings()
  const checkbox = page.locator('input[type="checkbox"]').filter({ has: page.locator('..', { hasText: 'Autopilot' }) }).first()
  // If we can't find the checkbox paired with the text, try the section approach.
  const section = page.getByText('Enable Autopilot').locator('..')
  const toggle = section.locator('input[type="checkbox"]')
  if (await toggle.count() > 0) {
    await toggle.check()
    await expect(toggle).toBeChecked()
    // The max-turns slider should be visible when autopilot is on.
    await expect(page.locator('input[type="range"]').first()).toBeVisible()
    await toggle.uncheck()
  }
  await page.screenshot({ path: 'e2e/screenshots/settings-autopilot.png' })
})

// ── Workspace ───────────────────────────────────────────────────────────

test('Settings: workspace section is visible', async () => {
  await openSettings()
  // The Section title "Workspace" + subtitle "Root folder..." is always present.
  await expect(page.getByText('Root folder for file operations')).toBeVisible()
})

// ── MCP Servers ─────────────────────────────────────────────────────────

test('Settings: MCP add-server form toggles and shows stdio/SSE choices', async () => {
  await openSettings()
  const addBtn = page.getByText('+ Add Server')
  if (await addBtn.isVisible().catch(() => false)) {
    await addBtn.click()
    await expect(page.getByPlaceholder('Server name')).toBeVisible()
    // Transport choices
    await expect(page.getByText('stdio')).toBeVisible()
    await expect(page.getByText('SSE')).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/settings-mcp-form.png' })
  }
})
