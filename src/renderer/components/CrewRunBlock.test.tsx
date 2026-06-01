// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { CrewRunBlock } from './CrewRunBlock'
import type { CrewRunView } from '../../shared/crew-run'

beforeEach(() => {
  ;(window as unknown as { kairoAPI: unknown }).kairoAPI = {
    readFile: vi.fn().mockResolvedValue({ ok: true, content: '' }),
    getGateDecisions: vi.fn().mockResolvedValue({ ok: true, decisions: [] })
  }
})
afterEach(cleanup)

const doneCrew = (over: Partial<CrewRunView>): CrewRunView => ({
  crewId: 'c1',
  task: 'change users',
  strategy: 'sequential',
  phase: 'done',
  reason: 'completed',
  roles: [],
  agents: [],
  lens: {
    blastRadius: [
      { module: 'src/main', files: ['src/main/agent.ts'] },
      { module: 'src/shared', files: ['src/shared/types.ts'] }
    ],
    filesChanged: ['src/main/agent.ts', 'src/shared/types.ts'],
    verification: { ran: [{ command: 'npm test', ok: true }], filesWritten: [], testsRun: true },
    uncertaintyFlags: []
  },
  ...over
})

describe('CrewRunBlock — Expectation Diff', () => {
  it('highlights modules the human did not expect to be touched', () => {
    const { getByTestId } = render(<CrewRunBlock crew={doneCrew({ expectedModules: ['src/main'] })} />)
    const block = getByTestId('expectation-diff')
    expect(block.textContent).toMatch(/你没料到的改动/)
    expect(block.textContent).toMatch(/src\/shared/)
  })

  it('confirms when the blast radius matched the expectation', () => {
    const { getByTestId } = render(
      <CrewRunBlock crew={doneCrew({ expectedModules: ['src/main', 'src/shared'] })} />
    )
    expect(getByTestId('expectation-diff').textContent).toMatch(/与你的预期一致/)
  })

  it('shows nothing when no expectation was set', () => {
    const { queryByTestId } = render(<CrewRunBlock crew={doneCrew({})} />)
    expect(queryByTestId('expectation-diff')).toBeNull()
  })
})

describe('CrewRunBlock — key diff (answer-in-place)', () => {
  it('shows the exact before→after lines of the contract change at the gate', () => {
    const crew = doneCrew({
      lens: {
        blastRadius: [{ module: 'src/api', files: ['src/api/users.ts'] }],
        filesChanged: ['src/api/users.ts'],
        verification: { ran: [{ command: 'npm test', ok: true }], filesWritten: ['src/api/users.ts'], testsRun: true },
        uncertaintyFlags: [],
        behaviorDelta: [
          {
            kind: 'api-changed',
            file: 'src/api/users.ts',
            detail: '导出 fetchUser 的签名/形状变化',
            name: 'fetchUser',
            before: 'export function fetchUser(id) {',
            after: 'export function fetchUser(id, opts) {'
          }
        ]
      }
    })
    const { getByTestId } = render(<CrewRunBlock crew={crew} />)
    const keydiff = getByTestId('gate-keydiff')
    expect(keydiff.textContent).toMatch(/export function fetchUser\(id\) \{/)
    expect(keydiff.textContent).toMatch(/export function fetchUser\(id, opts\) \{/)
  })
})

describe('CrewRunBlock — Comprehension Probe', () => {
  it('reveals the blind spot when the human under-guesses the impact', () => {
    // High-risk (untested + behavior) lens so the gate is in review mode, with
    // a transitive downstream module the human is likely to miss.
    const crew = doneCrew({
      lens: {
        blastRadius: [{ module: 'src/main', files: ['src/main/agent.ts'] }],
        filesChanged: ['src/main/agent.ts'],
        verification: { ran: [], filesWritten: ['src/main/agent.ts'], testsRun: false },
        uncertaintyFlags: [],
        behaviorDelta: [{ kind: 'api-removed', file: 'src/main/agent.ts', detail: '删除导出 run', name: 'run' }],
        downstreamModules: ['src/renderer']
      }
    })
    const { getByTestId } = render(<CrewRunBlock crew={crew} />)
    const probe = getByTestId('gate-probe')
    // Guess only the directly-changed module, then compare.
    fireEvent.click(within(probe).getByText('src/main'))
    fireEvent.click(within(probe).getByText('对照真实影响'))
    const result = getByTestId('probe-result')
    expect(result.textContent).toMatch(/盲区/)
    expect(result.textContent).toMatch(/src\/renderer/)
  })
})
