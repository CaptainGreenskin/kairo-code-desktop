// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { CrewPanel } from './CrewPanel'
import { useAppStore } from '../stores/app-store'
import { useChatStore } from '../stores/chat-store'
import { useCrewStore } from '../stores/crew-store'
import { useCrewRosterStore } from '../stores/crew-roster-store'

function stubKairoAPI(overrides: Record<string, unknown> = {}): void {
  ;(window as unknown as { kairoAPI: unknown }).kairoAPI = {
    getConfigStatus: vi.fn().mockResolvedValue({ hasModel: true, provider: 'openai' }),
    updateConfig: vi.fn().mockResolvedValue({ ok: true }),
    planCrew: vi.fn().mockResolvedValue({
      ok: true,
      plan: {
        approach: 'do it',
        roles: [{ id: 'researcher', label: 'Researcher', systemPrompt: 'research' }],
        steps: [{ roleId: 'researcher', brief: 'investigate' }]
      }
    }),
    runCrew: vi.fn().mockResolvedValue({ ok: true, summary: 'CREW RESULT', reason: 'completed' }),
    abortCrew: vi.fn().mockResolvedValue({ ok: true }),
    readFile: vi.fn().mockResolvedValue({ ok: true, content: 'export const x = 1' }),
    recordDecision: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides
  }
}

const cleanLens = {
  blastRadius: [{ module: 'src/util', files: ['src/util/a.ts'] }],
  filesChanged: ['src/util/a.ts'],
  verification: { ran: [{ command: 'npm test', ok: true }], filesWritten: ['src/util/a.ts'], testsRun: true },
  uncertaintyFlags: []
}

const riskyLens = {
  blastRadius: [{ module: 'src/auth', files: ['src/auth/login.ts'] }],
  filesChanged: ['src/auth/login.ts'],
  verification: { ran: [{ command: 'npm test', ok: true }], filesWritten: ['src/auth/login.ts'], testsRun: true },
  uncertaintyFlags: []
}

/** Drive the Plan Gate: type a task, plan, then approve & run. */
async function planAndApprove(
  utils: { getByPlaceholderText: (re: RegExp) => HTMLElement; getByText: (t: string) => HTMLElement; findByText: (t: string) => Promise<HTMLElement> },
  task: string
): Promise<void> {
  fireEvent.change(utils.getByPlaceholderText(/describe a task/i), { target: { value: task } })
  fireEvent.click(utils.getByText('Plan Crew'))
  const approve = await utils.findByText('Approve & Run')
  fireEvent.click(approve)
}

beforeEach(() => {
  stubKairoAPI()
  useChatStore.getState().resetForSession('sess-1')
  useCrewStore.getState().reset()
  useCrewRosterStore.getState().resetToDefault()
  useAppStore.getState().setCrewPanelOpen(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CrewPanel', () => {
  it('renders as a modal layered below the permission dialog (z-40 invariant)', () => {
    const { container } = render(<CrewPanel />)
    // CrewPanel sits at z-40; PermissionDialog is z-50 so approvals surface above it.
    expect(container.querySelector('.z-40')).not.toBeNull()
  })

  it('does not render when the panel is closed', () => {
    useAppStore.getState().setCrewPanelOpen(false)
    const { container } = render(<CrewPanel />)
    expect(container.firstChild).toBeNull()
  })

  it('plans first, then on approval launches the crew with the task + plan (Plan Gate)', async () => {
    const utils = render(<CrewPanel />)
    await planAndApprove(utils, 'refactor the parser')

    const api = (window as unknown as {
      kairoAPI: { planCrew: ReturnType<typeof vi.fn>; runCrew: ReturnType<typeof vi.fn> }
    }).kairoAPI
    // The Team Lead was asked to plan first.
    await waitFor(() => expect(api.planCrew).toHaveBeenCalledTimes(1))
    expect(api.planCrew.mock.calls[0][0]).toBe('refactor the parser')
    // Then, after approval, the crew ran with the task + the approved plan.
    await waitFor(() => expect(api.runCrew).toHaveBeenCalledTimes(1))
    const args = api.runCrew.mock.calls[0]
    expect(args[1]).toBe('sess-1') // sessionId
    expect(args[2]).toBe('refactor the parser') // task
    // The Team-Lead-composed roster (from the plan) is what runs.
    expect((args[3] as Array<{ id: string }>).map((r) => r.id)).toEqual(['researcher'])
    expect(args[5]).toMatchObject({ approach: 'do it' }) // plan
  })

  it('writes the crew result back into the conversation (not ephemeral)', async () => {
    const utils = render(<CrewPanel />)
    await planAndApprove(utils, 'add tests')

    await waitFor(() => {
      const msgs = useChatStore.getState().messages
      expect(msgs.length).toBeGreaterThanOrEqual(2)
    })
    const msgs = useChatStore.getState().messages
    const user = msgs.find((m) => m.role === 'user')
    const assistant = msgs.find((m) => m.role === 'assistant')
    expect(user?.content).toBe('[Crew] add tests')
    expect(assistant?.content).toContain('CREW RESULT')
  })

  it('renders the Change Lens (verification warning + blast radius) and folds it into the chat', async () => {
    const lens = {
      blastRadius: [{ module: 'src/main', files: ['src/main/a.ts'] }],
      filesChanged: ['src/main/a.ts'],
      verification: { ran: [], filesWritten: ['src/main/a.ts'], testsRun: false, warning: 'No tests were run for 1 changed file(s).' },
      uncertaintyFlags: ['unsure about error handling']
    }
    stubKairoAPI({
      planCrew: vi.fn().mockResolvedValue({
        ok: true,
        plan: { approach: 'a', roles: [{ id: 'planner', label: 'Planner', systemPrompt: 'p' }], steps: [{ roleId: 'planner', brief: 'b' }] }
      }),
      runCrew: vi.fn().mockResolvedValue({ ok: true, summary: 'DID IT', reason: 'completed', lens })
    })
    const utils = render(<CrewPanel />)
    const { findByText } = utils
    await planAndApprove(utils, 'do a thing')

    // The Comprehension Gate routes attention to the one question — here the
    // agent's own uncertainty flag — rather than dumping the whole lens.
    await findByText(/unsure about error handling/)
    // Expanding the lens reveals the anti-rubber-stamp warning + blast radius.
    fireEvent.click(await findByText(/展开完整 Change Lens/))
    await findByText(/No tests were run/)
    await findByText(/src\/main \(1\)/)

    // The lens is also folded into the chat write-back so it persists.
    const assistant = useChatStore.getState().messages.find((m) => m.role === 'assistant')
    expect(assistant?.content).toContain('Change Lens')
    expect(assistant?.content).toContain('No tests were run')
  })

  it('Configure shows the DAG execution preview and reacts to strategy (The Bridge)', async () => {
    const utils = render(<CrewPanel />)
    fireEvent.click(utils.getByText('Configure'))
    await utils.findByText('Execution preview')
    // Parallel → all roles collapse into a single concurrent wave.
    fireEvent.click(utils.getByText('Parallel (fan-out)'))
    await utils.findByText(/Planner ∥ Coder ∥ Reviewer/)
  })

  it('shows an onboarding banner and disables Plan Crew when no model is configured', async () => {
    stubKairoAPI({ getConfigStatus: vi.fn().mockResolvedValue({ hasModel: false, provider: 'openai' }) })
    const utils = render(<CrewPanel />)
    await utils.findByText(/No model configured/)
    fireEvent.change(utils.getByPlaceholderText(/describe a task/i), { target: { value: 'do x' } })
    // Plan Crew stays disabled even with a task typed.
    const btn = utils.getByText('Plan Crew') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('Plan Gate: cancelling the plan does NOT run the crew', async () => {
    const utils = render(<CrewPanel />)
    const { getByPlaceholderText, getByText, findByText } = utils
    fireEvent.change(getByPlaceholderText(/describe a task/i), { target: { value: 'risky thing' } })
    fireEvent.click(getByText('Plan Crew'))
    // The plan shows for review (the brief is editable).
    await findByText('Approve & Run')
    fireEvent.click(getByText('Cancel'))

    const api = (window as unknown as { kairoAPI: { runCrew: ReturnType<typeof vi.fn> } }).kairoAPI
    expect(api.runCrew).not.toHaveBeenCalled()
  })

  it('surfaces an error toast when the crew fails', async () => {
    stubKairoAPI({
      planCrew: vi.fn().mockResolvedValue({
        ok: true,
        plan: { approach: 'a', roles: [{ id: 'planner', label: 'Planner', systemPrompt: 'p' }], steps: [{ roleId: 'planner', brief: 'b' }] }
      }),
      runCrew: vi.fn().mockResolvedValue({ ok: false, error: 'no api key' })
    })
    const utils = render(<CrewPanel />)
    await planAndApprove(utils, 'x')

    const { useToastStore } = await import('../stores/toast-store')
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.type === 'error')).toBe(true)
    })
    // A failed crew must not inject a result message into the chat.
    expect(useChatStore.getState().messages).toHaveLength(0)
  })

  it('Comprehension Gate auto-clears a low-risk, tested change', async () => {
    useAppStore.getState().setProtectedGlobs(['**/auth/**'])
    stubKairoAPI({
      planCrew: vi.fn().mockResolvedValue({
        ok: true,
        plan: { approach: 'a', roles: [{ id: 'coder', label: 'Coder', systemPrompt: 'c' }], steps: [{ roleId: 'coder', brief: 'b' }] }
      }),
      runCrew: vi.fn().mockResolvedValue({ ok: true, summary: 'OK', reason: 'completed', lens: cleanLens })
    })
    const utils = render(<CrewPanel />)
    await planAndApprove(utils, 'tweak a util')
    await utils.findByTestId('gate-auto')
    expect(utils.queryByTestId('gate-review')).toBeNull()
  })

  it('Comprehension Gate escalates an invariant-region change and records the decision (with rationale) to Brain', async () => {
    useAppStore.getState().setProtectedGlobs(['**/auth/**'])
    const recordGateDecision = vi.fn().mockResolvedValue({ ok: true })
    stubKairoAPI({
      planCrew: vi.fn().mockResolvedValue({
        ok: true,
        plan: { approach: 'a', roles: [{ id: 'coder', label: 'Coder', systemPrompt: 'c' }], steps: [{ roleId: 'coder', brief: 'b' }] }
      }),
      runCrew: vi.fn().mockResolvedValue({ ok: true, summary: 'OK', reason: 'completed', lens: riskyLens }),
      recordGateDecision
    })
    const utils = render(<CrewPanel />)
    await planAndApprove(utils, 'touch auth')

    // The gate asks the one question and points at the invariant file.
    await utils.findByTestId('gate-review')
    await utils.findByText(/在该契约下/)
    await utils.findByTestId('gate-focus')

    // The human captures WHY before approving — the rationale (#5) the Brain keeps.
    fireEvent.change(utils.getByTestId('gate-rationale'), { target: { value: '幂等性已由上层保证' } })
    fireEvent.click(utils.getByText('理解了，通过'))
    const api = (window as unknown as { kairoAPI: { recordDecision: ReturnType<typeof vi.fn> } }).kairoAPI
    await waitFor(() => expect(api.recordDecision).toHaveBeenCalledTimes(1))
    expect(String(api.recordDecision.mock.calls[0][0])).toContain('Comprehension Gate')
    // The structured decision carries the rationale so it can hang on the module.
    await waitFor(() => expect(recordGateDecision).toHaveBeenCalledTimes(1))
    expect(recordGateDecision.mock.calls[0][0]).toMatchObject({ outcome: 'passed', rationale: '幂等性已由上层保证' })
  })

  it('Comprehension Gate surfaces a verification gap when behavior changed untested', async () => {
    useAppStore.getState().setProtectedGlobs(['**/auth/**'])
    const untestedBehaviorLens = {
      blastRadius: [{ module: 'src/api', files: ['src/api/users.ts'] }],
      filesChanged: ['src/api/users.ts'],
      verification: { ran: [{ command: 'npm run build', ok: true }], filesWritten: ['src/api/users.ts'], testsRun: false },
      uncertaintyFlags: [],
      behaviorDelta: [{ kind: 'api-removed', file: 'src/api/users.ts', detail: '删除/改名导出 fetchUser', name: 'fetchUser' }]
    }
    stubKairoAPI({
      planCrew: vi.fn().mockResolvedValue({
        ok: true,
        plan: { approach: 'a', roles: [{ id: 'coder', label: 'Coder', systemPrompt: 'c' }], steps: [{ roleId: 'coder', brief: 'b' }] }
      }),
      runCrew: vi.fn().mockResolvedValue({ ok: true, summary: 'OK', reason: 'completed', lens: untestedBehaviorLens })
    })
    const utils = render(<CrewPanel />)
    await planAndApprove(utils, 'change the users API')
    await utils.findByTestId('gate-review')
    const gap = await utils.findByTestId('gate-verification-gap')
    expect(gap.textContent).toMatch(/未验证/)
    expect(gap.textContent).toMatch(/无任何测试覆盖/)
  })
})
