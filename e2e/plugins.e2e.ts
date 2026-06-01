import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

// Write a CC-compatible plugin (`.claude-plugin/plugin.json` + a command) into
// `<dir>/<name>/`. `withMcp` adds an MCP server + an agent so the trust gate
// engages (both are code-running components).
function writePlugin(dir: string, name: string, withMcp: boolean): void {
  const root = path.join(dir, name)
  mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  mkdirSync(path.join(root, 'commands'), { recursive: true })
  writeFileSync(
    path.join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify(
      {
        name,
        version: '1.0.0',
        description: `${name} test plugin`,
        ...(withMcp ? { mcpServers: { demo: { command: 'echo', args: ['hi'] } } } : {}),
        gateRules: [{ glob: 'src/**', severity: 'review', message: 'careful' }]
      },
      null,
      2
    )
  )
  writeFileSync(path.join(root, 'commands', 'hello.md'), '---\ndescription: say hi\n---\nHello from ' + name)
  if (withMcp) {
    mkdirSync(path.join(root, 'agents'), { recursive: true })
    writeFileSync(path.join(root, 'agents', 'helper.md'), '---\nname: helper\ndescription: helps\ntools: Read, Grep\n---\nYou assist with ' + name)
  }
}

let app: ElectronApplication
let page: Page
let userData: string
let workspace: string

test.beforeAll(async () => {
  // A throwaway workspace becomes process.cwd(); with no workspace set in the
  // app, main scans cwd/.kairo/plugins — so a seeded plugin shows up on launch,
  // and installs land in this temp dir (never the real repo).
  workspace = mkdtempSync(path.join(tmpdir(), 'kairo-e2e-pl-ws-'))
  userData = mkdtempSync(path.join(tmpdir(), 'kairo-e2e-pl-ud-'))
  writePlugin(path.join(workspace, '.kairo', 'plugins'), 'seeded-plugin', true)

  app = await electron.launch({
    args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`],
    cwd: workspace,
    env: { ...process.env, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  for (const d of [workspace, userData]) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }
})

/** Ensure Settings is open and the Plugins section mounted. Idempotent — ⌘,
 * toggles, so we only press it when the panel isn't already showing. */
async function openSettings(): Promise<void> {
  const list = page.getByTestId('plugin-list')
  if (await list.isVisible().catch(() => false)) return
  await page.keyboard.press('Meta+Comma')
  await expect(list).toBeVisible()
}

test('a seeded plugin is discovered on launch and shown in Settings', async () => {
  await openSettings()
  // The seeded plugin's enable toggle is present (it loaded from cwd/.kairo/plugins).
  await expect(page.getByTestId('plugin-toggle-seeded-plugin')).toBeVisible()
  await page.screenshot({ path: 'e2e/screenshots/plugins-seeded.png' })
})

test('a plugin agent is loaded and shown in the plugin row', async () => {
  await openSettings()
  // The seeded plugin ships one agent (agents/helper.md) → surfaced as a count.
  await expect(page.getByText(/1 agents/)).toBeVisible()
})

test('trust gate: a code plugin is untrusted by default and can be trusted', async () => {
  await openSettings()
  const trust = page.getByTestId('plugin-trust-seeded-plugin')
  // The trust toggle renders for plugins with code components (MCP / agents).
  await expect(trust).toBeVisible()
  await expect(trust).not.toBeChecked() // untrusted by default — MCP + agents stay dormant
  await trust.check()
  await expect(trust).toBeChecked()
  // The label enumerates the code components gated by trust (MCP + agents).
  await expect(page.getByText(/已信任 —.*MCP 服务.*agents/)).toBeVisible()
  await page.screenshot({ path: 'e2e/screenshots/plugins-trusted.png' })

  // Untrusting flips it back.
  await trust.uncheck()
  await expect(trust).not.toBeChecked()
})

test('install from a local path adds the plugin to the list', async () => {
  // A separate source dir (outside the workspace) we install FROM.
  const srcRoot = mkdtempSync(path.join(tmpdir(), 'kairo-e2e-pl-src-'))
  writePlugin(srcRoot, 'local-installed', false)

  await openSettings()
  await expect(page.getByTestId('plugin-toggle-local-installed')).toHaveCount(0) // not yet present

  await page.getByTestId('plugin-install-source').fill(path.join(srcRoot, 'local-installed'))
  await page.getByTestId('plugin-install-button').click()

  // After install, loadPlugins() re-scans and the new plugin appears.
  await expect(page.getByTestId('plugin-toggle-local-installed')).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: 'e2e/screenshots/plugins-installed.png' })

  rmSync(srcRoot, { recursive: true, force: true })
})

test('install rejects an unrecognized source with an error toast', async () => {
  await openSettings()
  await page.getByTestId('plugin-install-source').fill('not-a-valid-source-spec')
  await page.getByTestId('plugin-install-button').click()
  await expect(page.getByText(/安装失败/)).toBeVisible({ timeout: 15_000 })
})

test('uninstall removes a plugin from the list', async () => {
  // `local-installed` was installed by the previous test; remove it.
  await openSettings()
  await expect(page.getByTestId('plugin-toggle-local-installed')).toBeVisible()
  await page.getByTestId('plugin-uninstall-local-installed').click()
  await expect(page.getByTestId('plugin-toggle-local-installed')).toHaveCount(0, { timeout: 15_000 })
  await page.screenshot({ path: 'e2e/screenshots/plugins-uninstalled.png' })
})

test('update button re-installs from recorded source (picks up new version)', async () => {
  // Install a local plugin, then update it after bumping the source version.
  const src = mkdtempSync(path.join(tmpdir(), 'kairo-e2e-upd-'))
  writePlugin(path.join(src), 'updatable', false)
  try {
    await openSettings()
    await page.getByTestId('plugin-install-source').fill(path.join(src, 'updatable'))
    await page.getByTestId('plugin-install-button').click()
    await expect(page.getByTestId('plugin-toggle-updatable')).toBeVisible({ timeout: 15_000 })
    // The update button should now be present (we installed from a local source).
    await expect(page.getByTestId('plugin-update-updatable')).toBeVisible()
    // Bump the source version.
    writeFileSync(
      path.join(src, 'updatable', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'updatable', version: '2.0.0' })
    )
    await page.getByTestId('plugin-update-updatable').click()
    // After the update, the new version should appear in the row.
    await expect(page.getByText('v2.0.0')).toBeVisible({ timeout: 15_000 })
    // Cleanup: uninstall.
    await page.getByTestId('plugin-uninstall-updatable').click()
    await expect(page.getByTestId('plugin-toggle-updatable')).toHaveCount(0, { timeout: 15_000 })
    await page.screenshot({ path: 'e2e/screenshots/plugins-updated.png' })
  } finally {
    rmSync(src, { recursive: true, force: true })
  }
})

test('built-in slash commands are available (plugin commands are a known gap)', async () => {
  // Plugin commands are stored in app-store but NOT yet wired into the static
  // SLASH_COMMANDS array — a known feature gap. Verify built-in commands work.
  const closeBtn = page.getByLabel('Close settings')
  if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click()
  const input = page.getByPlaceholder(/plan and build/i)
  await input.click()
  await input.fill('/')
  await expect(page.getByText('/new')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('/settings')).toBeVisible()
  await input.fill('')
})

test('marketplace: register, browse, and one-click install', async () => {
  // A local marketplace repo: .claude-plugin/marketplace.json + a bundled plugin.
  const mkt = mkdtempSync(path.join(tmpdir(), 'kairo-e2e-mkt-'))
  mkdirSync(path.join(mkt, '.claude-plugin'), { recursive: true })
  writePlugin(path.join(mkt, 'plugins'), 'market-demo', false)
  writeFileSync(
    path.join(mkt, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'e2e-market',
      owner: { name: 'tester' },
      plugins: [{ name: 'market-demo', source: './plugins/market-demo', description: 'from the market' }]
    })
  )

  try {
    await openSettings()
    // Register the marketplace.
    await page.getByTestId('marketplace-source').fill(mkt)
    await page.getByTestId('marketplace-add').click()
    await expect(page.getByTestId('marketplace-list')).toBeVisible({ timeout: 15_000 })

    // Browse it → the entry shows up.
    await page.getByTestId('marketplace-browse-0').click()
    await expect(page.getByTestId('marketplace-entry-market-demo')).toBeVisible({ timeout: 15_000 })

    // One-click install → the plugin appears in the installed list.
    await page.getByTestId('marketplace-install-market-demo').click()
    await expect(page.getByTestId('plugin-toggle-market-demo')).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: 'e2e/screenshots/plugins-marketplace.png' })
  } finally {
    rmSync(mkt, { recursive: true, force: true })
  }
})
