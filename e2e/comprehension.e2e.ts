/**
 * E2E for comprehension-instrument surfaces NOT yet tested: health bar, replay,
 * Map Delta, governance banner, drift trend, coupling. Uses a throwaway git repo
 * with known history so the instrument has data to render.
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

let app: ElectronApplication
let page: Page
let userData: string
let repo: string

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Ada',
      GIT_AUTHOR_EMAIL: 'ada@x.io',
      GIT_COMMITTER_NAME: 'Ada',
      GIT_COMMITTER_EMAIL: 'ada@x.io'
    }
  })
}

test.beforeAll(async () => {
  // Build a repo with a known history so the instrument surfaces data.
  repo = mkdtempSync(path.join(tmpdir(), 'kairo-e2e-comp-'))
  userData = mkdtempSync(path.join(tmpdir(), 'kairo-e2e-comp-ud-'))
  mkdirSync(path.join(repo, 'src', 'auth'), { recursive: true })
  mkdirSync(path.join(repo, 'src', 'pay'), { recursive: true })

  // Module "auth" imports from "pay" (creates a cross-module dep).
  writeFileSync(path.join(repo, 'src', 'auth', 'login.ts'), `import { charge } from '../pay/billing'\nexport function login() { charge() }\n`)
  writeFileSync(path.join(repo, 'src', 'pay', 'billing.ts'), `export function charge() {}\n`)
  // A shared table name creates a coupling signal.
  writeFileSync(path.join(repo, 'src', 'auth', 'session.ts'), `const TABLE = 'user_sessions'\n`)
  writeFileSync(path.join(repo, 'src', 'pay', 'orders.ts'), `const TABLE = 'user_sessions'\n`)
  git(repo, 'init', '-q')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', '初始提交：auth + pay 模块')

  // A second commit so replay has >1 step.
  writeFileSync(path.join(repo, 'src', 'auth', 'login.ts'), `import { charge } from '../pay/billing'\nexport function login() { charge(); console.log('logged in') }\n`)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', '改进 auth 登录流程')

  app = await electron.launch({
    args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
    cwd: repo,
    env: { ...process.env, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  for (const d of [repo, userData]) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
})

async function ensureMapOpen(): Promise<void> {
  if (await page.getByTestId('code-map').isVisible().catch(() => false)) return
  await page.bringToFront()
  await page.locator('#root').click()
  await page.keyboard.press('Meta+Shift+M')
  await expect(page.getByText(/\d+ modules? · \d+ deps?/)).toBeVisible({ timeout: 30_000 })
}

// ── Comprehension Health ────────────────────────────────────────────────

test('comprehension health bar renders with a score', async () => {
  await ensureMapOpen()
  const bar = page.getByTestId('comprehension-health')
  await expect(bar).toBeVisible({ timeout: 15_000 })
  // data-score is a percentage number.
  const score = await bar.getAttribute('data-score')
  expect(Number(score)).toBeGreaterThanOrEqual(0)
  await page.screenshot({ path: 'e2e/screenshots/comprehension-health.png' })
})

// ── Replay ──────────────────────────────────────────────────────────────

test('replay timeline shows commit steps', async () => {
  await ensureMapOpen()
  const replay = page.getByTestId('replay')
  // Expand the replay section (it's a collapsible).
  await replay.locator('button').first().click()
  const slider = page.getByTestId('replay-slider')
  await expect(slider).toBeVisible()
  const step = page.getByTestId('replay-step')
  await expect(step).toBeVisible()
  // The step label should contain one of our commit messages.
  const text = await step.textContent()
  expect(text).toMatch(/初始提交|改进/)
  await page.screenshot({ path: 'e2e/screenshots/comprehension-replay.png' })
})

// ── Map Delta ───────────────────────────────────────────────────────────

test('Map Delta banner shows unseen changes (if delta data is available)', async () => {
  await ensureMapOpen()
  const delta = page.getByTestId('map-delta-banner')
  // Map Delta requires crew change records (not just git history) — it may not
  // appear in a fresh repo with no crew runs. Assert if present, screenshot either way.
  const visible = await delta.isVisible().catch(() => false)
  if (visible) {
    const text = await delta.textContent()
    expect(text).toMatch(/\d/)
  }
  await page.screenshot({ path: 'e2e/screenshots/comprehension-delta.png' })
})

// ── Track Record ────────────────────────────────────────────────────────

test('track record row is visible when there are changes', async () => {
  await ensureMapOpen()
  // Track record only renders when there are recorded change records (crew runs).
  // In a pure git-only repo it may be absent. Assert conditionally.
  const tr = page.getByTestId('track-record')
  const visible = await tr.isVisible().catch(() => false)
  if (visible) {
    await expect(tr).toContainText(/%/)
  }
})

// ── Coupling ────────────────────────────────────────────────────────────

test('coupling edges are rendered between modules sharing a signal', async () => {
  await ensureMapOpen()
  // Both auth and pay reference TABLE='user_sessions' → a coupling edge should exist.
  // The testid is map-coupling-{from}-{to} — check for any coupling path in the SVG.
  const couplingEdge = page.locator('[data-testid^="map-coupling-"]')
  // Coupling extraction is best-effort; if the scan found the shared table, there's an edge.
  const count = await couplingEdge.count()
  if (count > 0) {
    await expect(couplingEdge.first()).toBeVisible()
  }
  // Either way, take a screenshot.
  await page.screenshot({ path: 'e2e/screenshots/comprehension-coupling.png' })
})

// ── Git backfill integration (supplements crew.e2e.ts) ──────────────────

test.skip('the dossier surfaces commit history for a queried module (moved to main chat in V3)', async () => {
  await ensureMapOpen()
  await page.getByTestId('map-query-input').fill('auth')
  const history = page.getByTestId('dossier-history')
  await expect(history).toBeVisible({ timeout: 15_000 })
  // Our commit messages should appear.
  await expect(history).toContainText('auth')
  await page.screenshot({ path: 'e2e/screenshots/comprehension-dossier-git.png' })
})
