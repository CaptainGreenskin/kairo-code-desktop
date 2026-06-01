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

test.beforeAll(async () => {
  // Isolated userData so the test never reads or mutates the real app's
  // sessions / crew roster (localStorage lives under userData).
  userData = mkdtempSync(path.join(tmpdir(), 'kairo-e2e-ud-'))
  app = await electron.launch({
    // First arg = app path (Electron reads package.json "main" → out/main/index.js).
    args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  try {
    rmSync(userData, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

/** The inline composer is in Crew mode when its helper line is showing. */
const crewModeHint = (): ReturnType<Page['getByText']> =>
  page.getByText('Crew 模式')

test('app boots and renders the main window', async () => {
  await expect(page.locator('#root')).toBeVisible()
  // The renderer mounted React — the input bar is always present.
  await expect(page.getByPlaceholder(/ask anything/i)).toBeVisible()
  await page.screenshot({ path: 'e2e/screenshots/boot.png' })
})

test('⌘⇧C activates Crew mode with indicator and cancel', async () => {
  await page.keyboard.press('Meta+Shift+C')
  await expect(crewModeHint()).toBeVisible()
  // No toggle buttons — Crew mode is entered via shortcut or /crew command.
  await expect(page.getByRole('heading', { name: 'Crew', exact: true })).toHaveCount(0)
  // Cancel returns to normal mode.
  await page.getByText('取消').click()
  await expect(crewModeHint()).toBeHidden()
  await page.screenshot({ path: 'e2e/screenshots/crew-composer.png' })
})

test('Command palette "Run Crew" enters Crew mode', async () => {
  await page.keyboard.press('Meta+K')
  const palette = page.getByPlaceholder(/type a command/i)
  await expect(palette).toBeVisible()
  await palette.fill('Run Crew')
  await page.getByText('Run Crew', { exact: true }).click()

  await expect(crewModeHint()).toBeVisible()
  // Cancel for cleanup
  await page.getByText('取消').click()
})

test('Code Map renders the workspace module graph (from real imports)', async () => {
  // Close any open panel, then open the Code Map. It scans the launch cwd
  // (this very repo) since no workspace is set.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+Shift+M')
  const map = page.getByTestId('code-map')
  await expect(map).toBeVisible()
  // The scan resolves to a non-trivial module graph of our own source.
  await expect(page.getByText(/\d+ modules · \d+ deps/)).toBeVisible({ timeout: 30_000 })
  const circles = await map.locator('circle').count()
  expect(circles).toBeGreaterThan(3)
  await page.screenshot({ path: 'e2e/screenshots/code-map.png' })
})

test.skip('Ask the Map: a query shows the module Brain dossier and sends it to chat (moved to main chat in V3)', async () => {
  // The Code Map dock is open from the previous test; ensure it is.
  if (!(await page.getByTestId('code-map').isVisible())) {
    await page.keyboard.press('Meta+Shift+M')
  }
  await expect(page.getByText(/\d+ modules · \d+ deps/)).toBeVisible({ timeout: 30_000 })

  // Ask about our own `src/shared` module (resolved by suffix from "shared").
  await page.getByTestId('map-query-input').fill('shared')
  const dossier = page.getByTestId('map-dossier')
  await expect(dossier).toBeVisible()
  // The dossier fuses topology onto the answer: "被 N 个依赖 · 依赖 M 个".
  await expect(dossier).toContainText('被')
  await expect(dossier).toContainText('依赖')
  // The focus node is highlighted on the graph.
  await expect(page.getByTestId('map-query-focus-src/shared')).toBeVisible()
  await page.screenshot({ path: 'e2e/screenshots/ask-the-map-dossier.png' })

  // Map → Crew loop: "发给对话" injects the dossier as chat grounding, which
  // surfaces as a code-context chip whose first line is the dossier header.
  await page.getByTestId('dossier-send-to-chat').click()
  await expect(page.getByText(/Module dossier:/)).toBeVisible()
  await page.screenshot({ path: 'e2e/screenshots/ask-the-map-send-to-chat.png' })
})

test.skip('Ask the Map: the dossier pins a <60s health verdict (moved to main chat in V3)', async () => {
  if (!(await page.getByTestId('code-map').isVisible())) {
    await page.keyboard.press('Meta+Shift+M')
  }
  await expect(page.getByText(/\d+ modules · \d+ deps/)).toBeVisible({ timeout: 30_000 })
  // The verdict (#2) is always present — the <60s "should I worry?" answer.
  // (Git history is data-dependent and only shows when the workspace is a repo.)
  await page.getByTestId('map-query-input').fill('shared')
  await expect(page.getByTestId('dossier-verdict')).toBeVisible()
  await page.screenshot({ path: 'e2e/screenshots/ask-the-map-verdict.png' })
})

test.skip('Ask the Map: a file query answers at file level (moved to main chat in V3)', async () => {
  if (!(await page.getByTestId('code-map').isVisible())) {
    await page.keyboard.press('Meta+Shift+M')
  }
  await expect(page.getByText(/\d+ modules · \d+ deps/)).toBeVisible({ timeout: 30_000 })
  // A concrete file → file-level "who imports this file".
  await page.getByTestId('map-query-input').fill('module-brain.ts')
  await expect(page.getByTestId('map-file-deps')).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: 'e2e/screenshots/ask-the-map-file-level.png' })
})

test('派单前预测: predicts a task blast radius before dispatch', async () => {
  if (!(await page.getByTestId('code-map').isVisible())) {
    await page.keyboard.press('Meta+Shift+M')
  }
  await expect(page.getByText(/\d+ modules · \d+ deps/)).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('advanced-tools-toggle').click()
  await page.getByTestId('preflight').locator('button').first().click()
  await page.getByTestId('preflight-input').fill('重构 shared 模块的类型')
  await page.getByTestId('preflight-run').click()
  const result = page.getByTestId('preflight-result')
  await expect(result).toBeVisible({ timeout: 15_000 })
  await expect(result).toContainText('大概率改')
  await page.screenshot({ path: 'e2e/screenshots/preflight-predict.png' })
})

test('服务图: the cross-repo panel renders', async () => {
  if (!(await page.getByTestId('code-map').isVisible())) {
    await page.keyboard.press('Meta+Shift+M')
  }
  await expect(page.getByText(/\d+ modules · \d+ deps/)).toBeVisible({ timeout: 30_000 })
  // Service map is in the "advanced tools" group.
  if (!(await page.getByTestId('service-map').isVisible().catch(() => false))) {
    await page.getByTestId('advanced-tools-toggle').click()
  }
  await page.getByTestId('service-map').locator('button').first().click()
  // Single workspace → empty-state prompt to add more service folders.
  await expect(page.getByTestId('service-add')).toBeVisible()
})

test.skip('与系统对话: a question is answered from grounded Brain evidence (moved to main chat in V3)', async () => {
  if (!(await page.getByTestId('code-map').isVisible())) {
    await page.keyboard.press('Meta+Shift+M')
  }
  await expect(page.getByText(/\d+ modules · \d+ deps/)).toBeVisible({ timeout: 30_000 })
  // Open the grounded Q&A and ask about a real module.
  await page.getByTestId('brain-chat').locator('button').first().click()
  await page.getByTestId('brain-chat-input').fill('为什么 shared 被这么多模块依赖？')
  await page.getByTestId('brain-chat-ask').click()
  // No model key in CI → no LLM answer, but the grounding evidence still shows
  // (the instrument never degrades into ungrounded prose).
  const evidence = page.getByTestId('brain-chat-evidence')
  await expect(evidence).toBeVisible({ timeout: 15_000 })
  await expect(evidence).toContainText('src/shared')
  await page.screenshot({ path: 'e2e/screenshots/brain-chat-grounded.png' })
})

test.skip('git backfill: a real repo surfaces non-crew commits in the dossier (dossier moved to main chat in V3)', async () => {
  // Build a throwaway git repo with real commits, launch a fresh app whose cwd
  // is that repo (no workspace set → main scans + git-logs process.cwd()).
  const repo = mkdtempSync(path.join(tmpdir(), 'kairo-e2e-git-'))
  const gitUd = mkdtempSync(path.join(tmpdir(), 'kairo-e2e-gud-'))
  const git = (...a: string[]): void => {
    execFileSync('git', a, {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Ada Lovelace',
        GIT_AUTHOR_EMAIL: 'ada@example.com',
        GIT_COMMITTER_NAME: 'Ada Lovelace',
        GIT_COMMITTER_EMAIL: 'ada@example.com'
      }
    })
  }
  mkdirSync(path.join(repo, 'src'), { recursive: true })
  writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(path.join(repo, 'src', 'b.ts'), `import { a } from './a'\nexport const b = a + 1\n`)
  git('init', '-q')
  git('add', '-A')
  git('commit', '-q', '-m', '手动重构 src 模块')

  const repoApp = await electron.launch({
    args: [ROOT, '--no-sandbox', `--user-data-dir=${gitUd}`],
    cwd: repo,
    env: { ...process.env, NODE_ENV: 'production' }
  })
  try {
    const rp = await repoApp.firstWindow()
    await rp.waitForLoadState('domcontentloaded')
    // A second Electron window can launch unfocused (the shared app still runs),
    // so the accelerator would go to the wrong window — focus this one first.
    await rp.bringToFront()
    await rp.locator('#root').click()
    await rp.keyboard.press('Meta+Shift+M')
    await expect(rp.getByText(/\d+ modules · \d+ deps/)).toBeVisible({ timeout: 30_000 })
    await rp.getByTestId('map-query-input').fill('src')
    // The dossier now carries the manual commit (the Brain saw a non-crew change).
    const history = rp.getByTestId('dossier-history')
    await expect(history).toBeVisible({ timeout: 15_000 })
    await expect(history).toContainText('手动重构 src 模块')
    // Comprehension Health: src changed (git) and nobody engaged → it's live + stale.
    await expect(rp.getByTestId('comprehension-health')).toBeVisible()
    // Comprehension Replay: the commit is a step on the timeline.
    await rp.getByTestId('replay').locator('button').first().click()
    await expect(rp.getByTestId('replay-step')).toContainText('手动重构 src 模块')
    await rp.screenshot({ path: 'e2e/screenshots/ask-the-map-git-history.png' })
  } finally {
    await repoApp.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(gitUd, { recursive: true, force: true })
  }
})
