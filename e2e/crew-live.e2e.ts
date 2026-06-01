/**
 * MOCK-FREE crew end-to-end against the real model (智谱 GLM-5.1 coding plan).
 *
 * Launches the built Electron app with an isolated userData dir and a throwaway
 * workspace, runs a real Planner→Coder→Reviewer crew on a tiny file-creation
 * task, auto-approves the permission dialogs, and asserts a real file landed on
 * disk and the result was written back into the conversation.
 *
 * Opt-in only (real LLM = slow + costs tokens):
 *   RUN_LIVE_LLM=1 npx playwright test e2e/crew-live.e2e.ts
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const LIVE = process.env.RUN_LIVE_LLM === '1'

function dotenv(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const raw = readFileSync(path.join(ROOT, '.env'), 'utf-8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2]
    }
  } catch {
    /* rely on ambient env */
  }
  return out
}

test.describe('live crew end-to-end (GLM-5.1)', () => {
  test.skip(!LIVE, 'set RUN_LIVE_LLM=1 to run the real-LLM crew end-to-end')
  test.setTimeout(240_000)

  let app: ElectronApplication
  let page: Page
  let workspace: string
  let userData: string

  test.beforeAll(async () => {
    workspace = mkdtempSync(path.join(tmpdir(), 'kairo-crew-ws-'))
    userData = mkdtempSync(path.join(tmpdir(), 'kairo-crew-ud-'))
    const env = dotenv()
    app = await electron.launch({
      args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
      cwd: workspace, // crew falls back to process.cwd() when the session has no workspaceRoot
      env: {
        ...process.env,
        OPENAI_API_KEY: env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
        OPENAI_BASE_URL: env.OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? '',
        OPENAI_MODEL: env.OPENAI_MODEL ?? 'glm-5.1'
      }
    })
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
  })

  test.afterAll(async () => {
    await app?.close()
    for (const dir of [workspace, userData]) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* best-effort cleanup */
      }
    }
  })

  test('Planner→Coder→Reviewer really runs, approves, and writes a file', async () => {
    // Open the crew panel.
    const heading = page.getByRole('heading', { name: 'Crew', exact: true })
    if (!(await heading.isVisible().catch(() => false))) {
      await page.keyboard.press('Meta+Shift+C')
    }
    await expect(heading).toBeVisible()

    // A maximally prescriptive task to keep the Coder deterministic.
    const task =
      'Create a file named hello.txt in the current working directory containing exactly this single line: hello from crew. ' +
      'Use the write_file tool with a relative path. Do not create any other files.'
    // Plan Gate: plan first, review, then approve to execute.
    await page.getByPlaceholder(/describe a task/i).fill(task)
    await page.getByRole('button', { name: 'Plan Crew' }).click()
    await page.getByRole('button', { name: 'Approve & Run' }).click({ timeout: 60_000 })

    // Drive the run: auto-approve any permission dialog until the crew finishes.
    const deadline = Date.now() + 210_000
    let approvals = 0
    let finished = false
    while (Date.now() < deadline) {
      // "Always Allow" collapses repeated prompts for the same tool.
      const always = page.getByRole('button', { name: 'Always Allow' })
      if (await always.isVisible().catch(() => false)) {
        await always.click().catch(() => {})
        approvals++
        continue
      }
      const done = page.getByText(/Crew completed\.|Crew failed\.|Crew aborted\./)
      if (await done.isVisible().catch(() => false)) {
        finished = true
        break
      }
      await page.waitForTimeout(500)
    }

    // eslint-disable-next-line no-console
    console.log(`[live-crew] finished=${finished} approvals=${approvals} files=`, readdirSync(workspace))
    await page.screenshot({ path: 'e2e/screenshots/crew-live-end.png' })

    expect(finished, 'crew should reach a terminal state').toBe(true)
    await expect(page.getByText('Crew completed.')).toBeVisible()

    // The file really exists on disk with the requested content.
    const target = path.join(workspace, 'hello.txt')
    const content = readFileSync(target, 'utf-8')
    expect(content.toLowerCase()).toContain('hello from crew')

    // Comprehension routing: an ordinary (non-protected) file write auto-runs,
    // so the file landing on disk — not an approval prompt — is the proof it ran.
    // (Approvals only happen for protected regions / shell commands.)

    // The Bridge renders the live crew dependency graph.
    await expect(page.getByTestId('crew-graph').first()).toBeVisible()

    // The Change Lens renders with a verification ledger (comprehension-first).
    // It appears both in the panel and in the chat write-back, hence .first().
    await expect(page.getByText('Change Lens').first()).toBeVisible()
    await expect(page.getByText('Verification').first()).toBeVisible()

    // Close the panel and confirm the result + lens were written back into chat.
    await page.keyboard.press('Escape')
    await expect(page.getByText('[Crew] Create a file named hello.txt', { exact: false })).toBeVisible()
  })

  test('parallel strategy: read-only roles fan out and run concurrently (no approvals)', async () => {
    // Open the crew panel.
    const heading = page.getByRole('heading', { name: 'Crew', exact: true })
    if (!(await heading.isVisible().catch(() => false))) {
      await page.keyboard.press('Meta+Shift+C')
    }
    await expect(heading).toBeVisible()

    // Reconfigure: parallel, and make every role read-only (uncheck the Coder's
    // "can write") so the fan-out needs no approvals and cannot conflict on disk.
    await page.getByRole('button', { name: 'Configure' }).click()
    await page.getByText('Parallel (fan-out)').click()
    const canWrite = page.getByText('can write')
    const count = await canWrite.count()
    for (let i = 0; i < count; i++) {
      const cb = page.locator('input[type="checkbox"]').nth(i)
      if (await cb.isChecked()) await cb.uncheck()
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('parallel', { exact: true })).toBeVisible()

    // A read-only task, via the Plan Gate.
    const task = 'List the files in the current working directory and report how many there are.'
    await page.getByPlaceholder(/describe a task/i).fill(task)
    await page.getByRole('button', { name: 'Plan Crew' }).click()
    await page.getByRole('button', { name: 'Approve & Run' }).click({ timeout: 60_000 })

    const deadline = Date.now() + 180_000
    let approvals = 0
    let finished = false
    while (Date.now() < deadline) {
      const always = page.getByRole('button', { name: 'Always Allow' })
      if (await always.isVisible().catch(() => false)) {
        await always.click().catch(() => {})
        approvals++
        continue
      }
      if (await page.getByText(/Crew completed\.|Crew failed\.|Crew aborted\./).isVisible().catch(() => false)) {
        finished = true
        break
      }
      await page.waitForTimeout(500)
    }

    // eslint-disable-next-line no-console
    console.log(`[live-crew parallel] finished=${finished} approvals=${approvals}`)
    await page.screenshot({ path: 'e2e/screenshots/crew-live-parallel.png' })

    expect(finished).toBe(true)
    await expect(page.getByText('Crew completed.')).toBeVisible()
    // Read-only roles → no write/exec tools → no approval prompts.
    expect(approvals).toBe(0)

    // The combined parallel summary lands in the chat (markdown renders the
    // per-role "## <Label>" sections as headings, so match the labels).
    await page.keyboard.press('Escape')
    await expect(page.getByText('[Crew] List the files', { exact: false })).toBeVisible()
    await expect(page.getByText(/Planner/).first()).toBeVisible()
    await expect(page.getByText(/Reviewer/).first()).toBeVisible()
  })

  test('auto-compose: a research task gets a research crew (no code written)', async () => {
    const heading = page.getByRole('heading', { name: 'Crew', exact: true })
    if (!(await heading.isVisible().catch(() => false))) {
      await page.keyboard.press('Meta+Shift+C')
    }
    await expect(heading).toBeVisible()

    const before = readdirSync(workspace)
    const task =
      'Research and compare two approaches to caching (in-memory vs Redis) for this kind of project. ' +
      'Write a short recommendation. This is a research task — do NOT create or modify any files.'
    await page.getByPlaceholder(/describe a task/i).fill(task)
    await page.getByRole('button', { name: 'Plan Crew' }).click()
    // The composed plan appears for review.
    await page.getByRole('button', { name: 'Approve & Run' }).click({ timeout: 60_000 })

    const deadline = Date.now() + 200_000
    let approvals = 0
    let finished = false
    while (Date.now() < deadline) {
      const always = page.getByRole('button', { name: 'Always Allow' })
      if (await always.isVisible().catch(() => false)) {
        await always.click().catch(() => {})
        approvals++
        continue
      }
      if (await page.getByText(/Crew completed\.|Crew failed\.|Crew aborted\./).isVisible().catch(() => false)) {
        finished = true
        break
      }
      await page.waitForTimeout(500)
    }

    // eslint-disable-next-line no-console
    console.log(`[live-crew research] finished=${finished} approvals=${approvals} newFiles=`, readdirSync(workspace).filter((f) => !before.includes(f)))
    await page.screenshot({ path: 'e2e/screenshots/crew-live-research.png' })

    expect(finished).toBe(true)
    await expect(page.getByText('Crew completed.')).toBeVisible()
    // Research is read-only: no approvals, no new files written.
    expect(approvals).toBe(0)
    expect(readdirSync(workspace).filter((f) => !before.includes(f))).toEqual([])
  })
})
