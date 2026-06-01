// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { CodeMap } from './CodeMap'
import { useAppStore } from '../stores/app-store'
import { useCrewStore } from '../stores/crew-store'
import { useEditorStore } from '../stores/editor-store'

const MAP = {
  modules: [
    { id: 'src/main', label: 'src/main', fileCount: 6, loc: 800, files: ['src/main/agent.ts', 'src/main/crew.ts'] },
    { id: 'src/auth', label: 'src/auth', fileCount: 2, loc: 100, files: ['src/auth/login.ts'] },
    { id: 'src/shared', label: 'src/shared', fileCount: 3, loc: 200, files: ['src/shared/types.ts'] }
  ],
  edges: [{ from: 'src/main', to: 'src/shared', weight: 4 }]
}

beforeEach(() => {
  ;(window as unknown as { kairoAPI: unknown }).kairoAPI = {
    getCodeMap: vi.fn().mockResolvedValue({ ok: true, map: MAP }),
    updateConfig: vi.fn().mockResolvedValue({ ok: true }),
    readFile: vi.fn().mockResolvedValue({ ok: true, content: 'export const x = 1' }),
    getChanges: vi.fn().mockResolvedValue({ ok: true, changes: [] }),
    getLastSeen: vi.fn().mockResolvedValue({ ok: true, at: 0 }),
    markSeen: vi.fn().mockResolvedValue({ ok: true }),
    getGateDecisions: vi.fn().mockResolvedValue({ ok: true, decisions: [] }),
    getGitHistory: vi.fn().mockResolvedValue({ ok: true, commits: [] }),
    getFileDeps: vi.fn().mockResolvedValue({ ok: true, importers: [], imports: [] }),
    getCoupling: vi.fn().mockResolvedValue({ ok: true, edges: [] }),
    lensForCommit: vi.fn().mockResolvedValue({ ok: true, lens: { filesChanged: ['src/shared/types.ts'], blastRadius: [], verification: { ran: [], filesWritten: [], testsRun: false }, uncertaintyFlags: [], behaviorDelta: [{ kind: 'api-removed', file: 'src/shared/types.ts', detail: 'x' }] } }),
    getDrills: vi.fn().mockResolvedValue({ ok: true, results: [] }),
    recordDrill: vi.fn().mockResolvedValue({ ok: true }),
    getRankedDiff: vi.fn().mockResolvedValue({
      ok: true,
      hunks: [
        { file: 'src/api.ts', header: 'getUser', kind: 'contract', score: 100, reasons: ['改动了导出/签名/类型(契约)'], added: 1, removed: 1, sample: [] },
        { file: 'src/style.css', header: '', kind: 'cosmetic', score: 5, reasons: ['仅格式/注释改动'], added: 2, removed: 0, sample: [] }
      ]
    }),
    getServiceGraph: vi.fn().mockResolvedValue({ ok: true, graph: { nodes: [], edges: [] } }),
    askBrain: vi.fn().mockResolvedValue({ ok: false })
  }
  useEditorStore.getState().setEditorVisible(false)
  useCrewStore.getState().reset()
  useAppStore.getState().setProtectedGlobs(['**/auth/**'])
  useAppStore.getState().setWorkspacePath('/ws')
  useAppStore.getState().setCodeMapOpen(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CodeMap', () => {
  it('does not render when closed', () => {
    useAppStore.getState().setCodeMapOpen(false)
    const { container } = render(<CodeMap />)
    expect(container.firstChild).toBeNull()
  })

  it('scans on open and renders a node per module + edges', async () => {
    const { container, findByText } = render(<CodeMap />)
    await findByText(/3 modules · 1 deps/)
    // 3 module circles, 1 edge line.
    expect(container.querySelectorAll('circle')).toHaveLength(3)
    expect(container.querySelectorAll('line')).toHaveLength(1)
  })

  it('highlights the blast radius of the last crew change', async () => {
    // A crew lens marking src/main as changed.
    useCrewStore.getState().apply({
      type: 'crew-start',
      crewId: 'c',
      sessionId: 's',
      task: 't',
      strategy: 'sequential',
      roles: [{ id: 'coder', label: 'Coder' }]
    })
    useCrewStore.getState().setLens({
      blastRadius: [{ module: 'src/main', files: ['src/main/x.ts'] }],
      filesChanged: ['src/main/x.ts'],
      verification: { ran: [], filesWritten: ['src/main/x.ts'], testsRun: false },
      uncertaintyFlags: []
    })
    const { container, findByText } = render(<CodeMap />)
    await findByText(/3 modules/)
    // The changed module is filled with the accent color.
    const filled = [...container.querySelectorAll('circle')].filter(
      (c) => c.getAttribute('fill') === 'var(--color-accent)'
    )
    expect(filled.length).toBe(1)
  })

  it('rings a module with a contract change (breaking behavior delta)', async () => {
    useCrewStore.getState().apply({
      type: 'crew-start', crewId: 'c', sessionId: 's', task: 't', strategy: 'sequential',
      roles: [{ id: 'coder', label: 'Coder' }]
    })
    useCrewStore.getState().setLens({
      blastRadius: [{ module: 'src/main', files: ['src/main/agent.ts'] }],
      filesChanged: ['src/main/agent.ts'],
      verification: { ran: [], filesWritten: ['src/main/agent.ts'], testsRun: false },
      uncertaintyFlags: [],
      behaviorDelta: [{ kind: 'api-removed', file: 'src/main/agent.ts', detail: '删除/改名导出 run' }]
    })
    const { findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    // The src/main node gets the dashed contract ring; src/auth does not.
    await findByTestId('map-contract-src/main')
  })

  it('overlays a live agent on the module it is working in (World overlay)', async () => {
    useCrewStore.getState().apply({
      type: 'crew-start', crewId: 'c', sessionId: 's', task: 't', strategy: 'sequential',
      roles: [{ id: 'coder', label: 'Coder' }]
    })
    useCrewStore.getState().apply({ type: 'agent-start', crewId: 'c', roleId: 'coder' })
    // Coder touches a file under src/main → agent should appear on that node.
    useCrewStore.getState().apply({ type: 'agent-tool', crewId: 'c', roleId: 'coder', toolName: 'edit', path: 'src/main/agent.ts' })
    const { findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    await findByTestId('map-agent-coder')
  })

  it('colors a newly-introduced dependency edge and shows it on hover (inverted signal)', async () => {
    useCrewStore.getState().apply({
      type: 'crew-start', crewId: 'c', sessionId: 's', task: 't', strategy: 'sequential',
      roles: [{ id: 'coder', label: 'Coder' }]
    })
    // src/main → src/shared is an existing MAP edge; mark it as a new dependency.
    useCrewStore.getState().setLens({
      blastRadius: [{ module: 'src/main', files: ['src/main/agent.ts'] }],
      filesChanged: ['src/main/agent.ts'],
      verification: { ran: [], filesWritten: ['src/main/agent.ts'], testsRun: false },
      uncertaintyFlags: [],
      deviations: [{ kind: 'new-dependency', fromModule: 'src/main', toModule: 'src/shared', file: 'src/main/agent.ts', detail: '新建依赖：src/main → src/shared' }]
    })
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    // The deviating edge is colored/dashed.
    await findByTestId('map-deviation-src/main-src/shared')
    // Hovering the source module surfaces the deviation row.
    fireEvent.mouseOver(getByTestId('map-node-src/main'))
    await findByTestId('hover-deviations')
    await findByText('新建依赖：src/main → src/shared')
  })

  it('hangs the Brain (decision history) on a module and jumps to the focus file', async () => {
    ;(window as unknown as { kairoAPI: { getGateDecisions: ReturnType<typeof vi.fn> } }).kairoAPI.getGateDecisions =
      vi.fn().mockResolvedValue({
        ok: true,
        decisions: [
          { at: Date.now() - 1000, outcome: 'changes', question: '这次改动碰了不变量区吗？', files: ['src/main/agent.ts'], modules: ['src/main'], focus: 'src/main/agent.ts' }
        ]
      })
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    fireEvent.mouseOver(getByTestId('map-node-src/main'))
    const brain = await findByTestId('hover-brain')
    const decision = within(brain).getByText('这次改动碰了不变量区吗？')
    fireEvent.click(decision)
    const readFile = (window as unknown as { kairoAPI: { readFile: ReturnType<typeof vi.fn> } }).kairoAPI.readFile
    await waitFor(() => expect(readFile).toHaveBeenCalledWith('/ws/src/main/agent.ts'))
  })

  it('Ask the Map: querying a module shows its Brain dossier + dims the rest', async () => {
    const { getByTestId, findByText, findByTestId, queryByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    // Query "shared" → focus src/shared; src/main depends on it (MAP edge).
    fireEvent.change(getByTestId('map-query-input'), { target: { value: 'shared' } })
    const dossier = await findByTestId('map-dossier')
    expect(dossier.textContent).toMatch(/src\/shared/)
    expect(dossier.textContent).toMatch(/被 1 个依赖/)
    await findByTestId('map-query-focus-src/shared')
    // Unrelated module (src/auth) is dimmed.
    await waitFor(() =>
      expect(getByTestId('map-node-src/auth').getAttribute('style')).toMatch(/opacity:\s*0\.22/)
    )
    // Clearing the query removes the dossier.
    fireEvent.change(getByTestId('map-query-input'), { target: { value: '' } })
    await waitFor(() => expect(queryByTestId('map-dossier')).toBeNull())
  })

  it('Ask the Map: dossier flags an invariant region, shows a verdict, sends to chat', async () => {
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    // src/auth matches the protected glob (**/auth/**) → invariant flag + verdict.
    fireEvent.change(getByTestId('map-query-input'), { target: { value: 'auth' } })
    const flags = await findByTestId('dossier-flags')
    expect(flags.textContent).toMatch(/不变量/)
    // The <60s verdict is pinned on top (invariant region → at least "watch").
    const verdict = await findByTestId('dossier-verdict')
    expect(['watch', 'risk']).toContain(verdict.getAttribute('data-level'))
    // Send-to-chat injects the dossier as code context (Map → Crew loop).
    const { useChatStore } = await import('../stores/chat-store')
    useChatStore.getState().clearCodeContext()
    fireEvent.click(getByTestId('dossier-send-to-chat'))
    await waitFor(() => expect(useChatStore.getState().codeContext).toMatch(/Module dossier: `src\/auth`/))
  })

  it('Ask the Map: decision history shows the captured rationale (the why)', async () => {
    ;(window as unknown as { kairoAPI: { getGateDecisions: ReturnType<typeof vi.fn> } }).kairoAPI.getGateDecisions =
      vi.fn().mockResolvedValue({
        ok: true,
        decisions: [
          { at: 1, outcome: 'passed', question: '碰了不变量吗？', rationale: '幂等性已由上层保证', files: [], modules: ['src/shared'] }
        ]
      })
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    fireEvent.change(getByTestId('map-query-input'), { target: { value: 'shared' } })
    const decisions = await findByTestId('dossier-decisions')
    // Prefers the rationale (why) over the gate question.
    expect(decisions.textContent).toMatch(/幂等性已由上层保证/)
    expect(decisions.textContent).not.toMatch(/碰了不变量吗/)
  })

  it('Ask the Map: hidden coupling (non-import edges) shows in the dossier and on the map', async () => {
    ;(window as unknown as { kairoAPI: { getCoupling: ReturnType<typeof vi.fn> } }).kairoAPI.getCoupling =
      vi.fn().mockResolvedValue({
        ok: true,
        edges: [{ from: 'src/main', to: 'src/auth', kind: 'table', key: 'sessions' }]
      })
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    // The coupling edge is drawn between the two modules that share the table.
    await findByTestId('map-coupling-src/main-src/auth')
    // Querying src/main surfaces the hidden coupling in its dossier.
    fireEvent.change(getByTestId('map-query-input'), { target: { value: 'main' } })
    const coupling = await findByTestId('dossier-coupling')
    expect(coupling.textContent).toMatch(/sessions/)
  })

  it('Ask the Map: plugin map annotations show in the dossier', async () => {
    useAppStore.setState({ pluginAnnotations: [{ module: 'src/shared', label: '领域', note: '插件备注' }] })
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    fireEvent.change(getByTestId('map-query-input'), { target: { value: 'shared' } })
    const ann = await findByTestId('dossier-annotations')
    expect(ann.textContent).toMatch(/领域/)
    expect(ann.textContent).toMatch(/插件备注/)
    useAppStore.setState({ pluginAnnotations: [] })
  })

  it('Ask the Map: a safety-intent query leads with the impact block', async () => {
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    // "shared 安全吗" → safety intent → impact block is pinned first (data-lead).
    fireEvent.change(getByTestId('map-query-input'), { target: { value: 'shared 安全吗' } })
    const impact = await findByTestId('dossier-impact')
    expect(impact.closest('[data-lead]')).not.toBeNull()
  })

  it('Ask the Map: git history (non-crew commits) hangs on the dossier', async () => {
    ;(window as unknown as { kairoAPI: { getGitHistory: ReturnType<typeof vi.fn> } }).kairoAPI.getGitHistory =
      vi.fn().mockResolvedValue({
        ok: true,
        commits: [{ hash: 'h1', at: Date.now(), author: 'Ada Lovelace', subject: '手动重构 shared 类型', files: ['src/shared/types.ts'] }]
      })
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    fireEvent.change(getByTestId('map-query-input'), { target: { value: 'shared' } })
    const history = await findByTestId('dossier-history')
    expect(history.textContent).toMatch(/手动重构 shared 类型/)
    // Freshness: the dossier shows when the module last changed.
    await findByTestId('dossier-freshness')
    // Clicking a commit computes its Change Lens (instrument works on any commit).
    fireEvent.click(history.querySelector('button')!)
    const api = (window as unknown as { kairoAPI: { lensForCommit: ReturnType<typeof vi.fn> } }).kairoAPI
    await waitFor(() => expect(api.lensForCommit).toHaveBeenCalledWith('h1', '/ws'))
  })

  it('Ask the Map: a file query answers at file level (who imports it)', async () => {
    ;(window as unknown as { kairoAPI: { getFileDeps: ReturnType<typeof vi.fn> } }).kairoAPI.getFileDeps =
      vi.fn().mockResolvedValue({ ok: true, importers: ['src/main/agent.ts'], imports: [] })
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    // 'types.ts' resolves to the file src/shared/types.ts → file-level panel.
    fireEvent.change(getByTestId('map-query-input'), { target: { value: 'types.ts' } })
    const panel = await findByTestId('map-file-deps')
    expect(panel.textContent).toMatch(/文件级/)
    expect(panel.textContent).toMatch(/agent\.ts/)
  })

  it('comprehension health bar scores the human model and points at drift', async () => {
    // A change on src/main with no engagement → that module is stale.
    ;(window as unknown as { kairoAPI: { getChanges: ReturnType<typeof vi.fn> } }).kairoAPI.getChanges =
      vi.fn().mockResolvedValue({
        ok: true,
        changes: [{ at: Date.now(), task: 't', modules: ['src/main'], filesChanged: [], risk: 'review', verified: false }]
      })
    const { findByTestId } = render(<CodeMap />)
    const bar = await findByTestId('comprehension-health')
    // src/main is the only live module and it's stale → score 0.
    expect(bar.getAttribute('data-score')).toBe('0')
    expect(bar.textContent).toMatch(/理解力/)
  })

  it('与系统对话: a grounded answer renders with clickable citations', async () => {
    ;(window as unknown as { kairoAPI: { askBrain: ReturnType<typeof vi.fn> } }).kairoAPI.askBrain =
      vi.fn().mockResolvedValue({ ok: true, answer: 'src/main 是枢纽 [E1]' })
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    fireEvent.click(getByTestId('brain-chat')!.querySelector('button')!)
    fireEvent.change(getByTestId('brain-chat-input'), { target: { value: 'main 是什么' } })
    fireEvent.click(getByTestId('brain-chat-ask'))
    const ans = await findByTestId('brain-chat-answer')
    expect(ans.textContent).toMatch(/src\/main 是枢纽/)
    expect(ans.textContent).toMatch(/\[E1\]/)
  })

  it('与系统对话: with no model, still shows the grounding evidence', async () => {
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    fireEvent.click(getByTestId('brain-chat')!.querySelector('button')!)
    fireEvent.change(getByTestId('brain-chat-input'), { target: { value: 'main' } })
    fireEvent.click(getByTestId('brain-chat-ask'))
    await findByTestId('brain-chat-nomodel')
    const ev = await findByTestId('brain-chat-evidence')
    expect(ev.textContent).toMatch(/src\/main/)
  })

  it('派单前预测: predicts a task blast radius and lights up the map', async () => {
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    fireEvent.click(getByTestId('advanced-tools-toggle'))
    fireEvent.click(getByTestId('preflight')!.querySelector('button')!)
    fireEvent.change(getByTestId('preflight-input'), { target: { value: '重构 shared 模块' } })
    fireEvent.click(getByTestId('preflight-run'))
    const result = await findByTestId('preflight-result')
    expect(result.textContent).toMatch(/大概率改/)
    // src/main imports src/shared → it's in the predicted blast → ringed on the map.
    await findByTestId('map-predicted-src/main')
  })

  it('理解力回放: scrubbing the timeline lights up the changed module', async () => {
    ;(window as unknown as { kairoAPI: { getGitHistory: ReturnType<typeof vi.fn> } }).kairoAPI.getGitHistory =
      vi.fn().mockResolvedValue({
        ok: true,
        commits: [{ hash: 'h1', at: 1000, author: 'A', subject: '改 main', files: ['src/main/agent.ts'] }]
      })
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    fireEvent.click(getByTestId('replay')!.querySelector('button')!)
    const slider = await findByTestId('replay-slider')
    fireEvent.change(slider, { target: { value: '0' } })
    // The step shows the commit; src/main lights up on the map.
    const step = await findByTestId('replay-step')
    expect(step.textContent).toMatch(/改 main/)
    await findByTestId('map-replay-src/main')
  })

  it('服务图: renders an SVG graph of services sharing an event/route', async () => {
    useAppStore.getState().setWorkspacePath('/ws/checkout')
    useAppStore.setState({ serviceRoots: ['/ws/fulfillment'] })
    ;(window as unknown as { kairoAPI: { getServiceGraph: ReturnType<typeof vi.fn> } }).kairoAPI.getServiceGraph =
      vi.fn().mockResolvedValue({
        ok: true,
        graph: {
          nodes: [
            { name: 'checkout', contracts: 2 },
            { name: 'fulfillment', contracts: 1 }
          ],
          edges: [{ from: 'checkout', to: 'fulfillment', kind: 'event', key: 'order.paid' }]
        }
      })
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    fireEvent.click(getByTestId('advanced-tools-toggle'))
    fireEvent.click(getByTestId('service-map')!.querySelector('button')!)
    await findByTestId('service-graph-svg')
    await findByTestId('service-node-checkout')
    await findByTestId('service-node-fulfillment')
    useAppStore.setState({ serviceRoots: [] })
  })

  it('关键改动: ranks meaningful hunks first and folds cosmetic churn', async () => {
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    fireEvent.click(getByTestId('advanced-tools-toggle'))
    fireEvent.click(getByTestId('ranked-diff')!.querySelector('button')!)
    const body = await findByTestId('ranked-diff-body')
    expect(body.textContent).toMatch(/契约/) // the contract hunk surfaced
    expect(body.textContent).toMatch(/1 处关键 · 1 处装饰/)
    // Cosmetic churn is hidden behind a toggle, not shown inline.
    expect(getByTestId('ranked-diff-cosmetic-toggle').textContent).toMatch(/展开 1 处/)
  })

  it('理解力自测: answering a drill scores it and reveals the answer', async () => {
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    fireEvent.click(getByTestId('advanced-tools-toggle'))
    fireEvent.click(getByTestId('drill-panel')!.querySelector('button')!)
    const q = await findByTestId('drill-question')
    expect(q.textContent).toMatch(/谁直接依赖/)
    fireEvent.click(getByTestId('drill-option-0'))
    // After answering, a "next" button appears and the score is tracked.
    await findByTestId('drill-next')
    expect(getByTestId('drill-panel').textContent).toMatch(/准确率/)
    // The result is persisted so measured accuracy accrues across sessions.
    const api = (window as unknown as { kairoAPI: { recordDrill: ReturnType<typeof vi.fn> } }).kairoAPI
    await waitFor(() => expect(api.recordDrill).toHaveBeenCalled())
  })

  it('理解上手之旅: steps through hubs and focuses them on the map', async () => {
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    fireEvent.click(getByTestId('advanced-tools-toggle'))
    fireEvent.click(getByTestId('onboarding-tour')!.querySelector('button')!)
    const step = await findByTestId('tour-step')
    expect(step.textContent).toMatch(/系统概览/)
    fireEvent.click(getByTestId('tour-next'))
    // Advancing focuses a module → the query input reflects it (drives dossier).
    await waitFor(() => expect((getByTestId('map-query-input') as HTMLInputElement).value.length).toBeGreaterThan(0))
  })

  it('governance banner freezes dispatch when debt crosses the threshold', async () => {
    const at = Date.now()
    ;(window as unknown as { kairoAPI: { getChanges: ReturnType<typeof vi.fn> } }).kairoAPI.getChanges =
      vi.fn().mockResolvedValue({
        ok: true,
        changes: [
          { at: at - 3, task: 'a', modules: ['src/main'], filesChanged: [], risk: 'review', verified: false },
          { at: at - 2, task: 'b', modules: ['src/auth'], filesChanged: [], risk: 'review', verified: false },
          { at: at - 1, task: 'c', modules: ['src/shared'], filesChanged: [], risk: 'review', verified: false }
        ]
      })
    const { findByTestId } = render(<CodeMap />)
    const banner = await findByTestId('governance-banner')
    expect(banner.getAttribute('data-action')).toBe('freeze')
  })

  it('hovering a node reveals its dependency details and routes the eye', async () => {
    const { getByTestId, findByText, queryByText } = render(<CodeMap />)
    await findByText(/3 modules/)
    // Before hover, no dependency card.
    expect(queryByText(/used by ←/)).toBeNull()
    // Hover src/main (which imports src/shared ×4). React derives onMouseEnter
    // from mouseover at the root, so fire mouseOver/mouseOut.
    fireEvent.mouseOver(getByTestId('map-node-src/main'))
    await findByText(/used by ←/)
    // The card lists the outgoing dependency to src/shared with its weight.
    expect(queryByText('→ src/shared')).not.toBeNull()
    expect(queryByText('×4')).not.toBeNull()
    // Unrelated node (src/auth) is dimmed to route the eye.
    const auth = getByTestId('map-node-src/auth')
    await waitFor(() => expect(auth.getAttribute('style')).toMatch(/opacity:\s*0\.22/))
    // Leaving clears the card.
    fireEvent.mouseOut(getByTestId('map-node-src/main'))
    await waitFor(() => expect(queryByText(/used by ←/)).toBeNull())
  })

  it('shows an Agent Track Record bar from the change log + gate decisions', async () => {
    ;(window as unknown as { kairoAPI: { getChanges: ReturnType<typeof vi.fn>; getGateDecisions: ReturnType<typeof vi.fn> } }).kairoAPI.getChanges =
      vi.fn().mockResolvedValue({
        ok: true,
        changes: [
          { at: 1, task: 'a', modules: ['src/main'], filesChanged: [], risk: 'auto', verified: true },
          { at: 2, task: 'b', modules: ['src/main'], filesChanged: [], risk: 'review', verified: false }
        ]
      })
    ;(window as unknown as { kairoAPI: { getGateDecisions: ReturnType<typeof vi.fn> } }).kairoAPI.getGateDecisions =
      vi.fn().mockResolvedValue({ ok: true, decisions: [{ at: 2, outcome: 'passed', files: [], modules: ['src/main'] }] })

    const { findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    const bar = await findByTestId('track-record')
    expect(bar.textContent).toMatch(/2 次变更/)
    expect(bar.textContent).toMatch(/auto\s*50%/)
    expect(bar.textContent).toMatch(/验证\s*50%/)
    expect(bar.textContent).toMatch(/采纳\s*100%/)
    // With ≥2 changes, the drift sparkline renders.
    await findByTestId('drift-trend')
  })

  it('quantifies comprehension debt: unconfirmed high-risk changes get an indicator + ring', async () => {
    ;(window as unknown as { kairoAPI: { getChanges: ReturnType<typeof vi.fn>; getGateDecisions: ReturnType<typeof vi.fn> } }).kairoAPI.getChanges =
      vi.fn().mockResolvedValue({
        ok: true,
        changes: [
          { at: 100, task: 'risky', modules: ['src/main'], filesChanged: ['src/main/agent.ts'], risk: 'review', verified: false }
        ]
      })
    // No decision ever confirmed it → it's debt.
    ;(window as unknown as { kairoAPI: { getGateDecisions: ReturnType<typeof vi.fn> } }).kairoAPI.getGateDecisions =
      vi.fn().mockResolvedValue({ ok: true, decisions: [] })

    const { findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    const debt = await findByTestId('debt-indicator')
    expect(debt.textContent).toMatch(/理解债 1/)
    await findByTestId('map-debt-src/main')
  })

  it('shows a Map Delta banner with changes-since + needs-judgment, and glows delta modules', async () => {
    const now = Date.now()
    ;(window as unknown as { kairoAPI: { getChanges: ReturnType<typeof vi.fn>; getLastSeen: ReturnType<typeof vi.fn> } }).kairoAPI.getChanges =
      vi.fn().mockResolvedValue({
        ok: true,
        changes: [
          { at: now - 100, task: 'x', modules: ['src/main'], filesChanged: ['src/main/agent.ts'], risk: 'review' },
          { at: now - 50, task: 'y', modules: ['src/shared'], filesChanged: ['src/shared/types.ts'], risk: 'auto' }
        ]
      })
    ;(window as unknown as { kairoAPI: { getLastSeen: ReturnType<typeof vi.fn> } }).kairoAPI.getLastSeen =
      vi.fn().mockResolvedValue({ ok: true, at: 0 })

    const { findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    const banner = await findByTestId('map-delta-banner')
    expect(banner.textContent).toMatch(/2 处变更/)
    expect(banner.textContent).toMatch(/1 处待你判断/)
    // Both changed modules glow as delta.
    await findByTestId('map-delta-src/main')
    await findByTestId('map-delta-src/shared')
  })

  it('hides the Map Delta banner when caught up (lastSeen past all changes)', async () => {
    const now = Date.now()
    ;(window as unknown as { kairoAPI: { getChanges: ReturnType<typeof vi.fn>; getLastSeen: ReturnType<typeof vi.fn> } }).kairoAPI.getChanges =
      vi.fn().mockResolvedValue({
        ok: true,
        changes: [{ at: now - 100, task: 'x', modules: ['src/main'], filesChanged: [], risk: 'review' }]
      })
    ;(window as unknown as { kairoAPI: { getLastSeen: ReturnType<typeof vi.fn> } }).kairoAPI.getLastSeen =
      vi.fn().mockResolvedValue({ ok: true, at: now })

    const { findByText, queryByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    expect(queryByTestId('map-delta-banner')).toBeNull()
  })

  it('lights up the transitive downstream of a change (system > diff)', async () => {
    useCrewStore.getState().apply({
      type: 'crew-start', crewId: 'c', sessionId: 's', task: 't', strategy: 'sequential',
      roles: [{ id: 'coder', label: 'Coder' }]
    })
    // src/main imports src/shared (MAP edge). Changing src/shared → src/main is
    // a 1-hop downstream impact and should get the dashed impact ring.
    useCrewStore.getState().setLens({
      blastRadius: [{ module: 'src/shared', files: ['src/shared/types.ts'] }],
      filesChanged: ['src/shared/types.ts'],
      verification: { ran: [], filesWritten: ['src/shared/types.ts'], testsRun: false },
      uncertaintyFlags: []
    })
    const { findByText, findByTestId, queryByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    // src/main is downstream of the change → impact ring; src/auth is not.
    await findByTestId('map-impact-src/main')
    expect(queryByTestId('map-impact-src/auth')).toBeNull()
    // The changed module itself is not marked as downstream.
    expect(queryByTestId('map-impact-src/shared')).toBeNull()
  })

  it('shows behavior-delta signals on hover and jumps to the changed file', async () => {
    useCrewStore.getState().apply({
      type: 'crew-start', crewId: 'c', sessionId: 's', task: 't', strategy: 'sequential',
      roles: [{ id: 'coder', label: 'Coder' }]
    })
    useCrewStore.getState().setLens({
      blastRadius: [{ module: 'src/main', files: ['src/main/agent.ts'] }],
      filesChanged: ['src/main/agent.ts'],
      verification: { ran: [], filesWritten: ['src/main/agent.ts'], testsRun: false },
      uncertaintyFlags: [],
      behaviorDelta: [{ kind: 'api-removed', file: 'src/main/agent.ts', detail: '删除/改名导出 run' }]
    })
    const { getByTestId, findByText } = render(<CodeMap />)
    await findByText(/3 modules/)
    fireEvent.mouseOver(getByTestId('map-node-src/main'))
    // The hover card surfaces the observable behavior change…
    await findByText(/behavior delta/i)
    const sig = await findByText('删除/改名导出 run')
    // …and clicking it opens the file whose contract changed.
    fireEvent.click(sig)
    const readFile = (window as unknown as { kairoAPI: { readFile: ReturnType<typeof vi.fn> } }).kairoAPI.readFile
    await waitFor(() => expect(readFile).toHaveBeenCalledWith('/ws/src/main/agent.ts'))
  })

  it('clicking a dependency in the hover card drills into that module', async () => {
    const { getByTestId, findByText, findByTestId } = render(<CodeMap />)
    await findByText(/3 modules/)
    fireEvent.mouseOver(getByTestId('map-node-src/main'))
    // Click the outgoing dependency → drill into src/shared (drawer + its file).
    const dep = await findByText('→ src/shared')
    fireEvent.click(dep)
    await findByTestId('map-drawer')
    await findByText('types.ts')
  })

  it('drilling into a module lists its files and opens one in the editor', async () => {
    const { getByTestId, findByTestId, findByText } = render(<CodeMap />)
    await findByText(/3 modules/)
    // Click the src/main node → drawer lists its files.
    getByTestId('map-node-src/main').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await findByTestId('map-drawer')
    const fileBtn = await findByText('agent.ts')
    fileBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const readFile = (window as unknown as { kairoAPI: { readFile: ReturnType<typeof vi.fn> } }).kairoAPI.readFile
    await waitFor(() => expect(readFile).toHaveBeenCalledWith('/ws/src/main/agent.ts'))
    await waitFor(() => {
      const ed = useEditorStore.getState()
      expect(ed.openFiles.some((f) => f.path === '/ws/src/main/agent.ts')).toBe(true)
      expect(ed.editorVisible).toBe(true)
    })
  })
})
