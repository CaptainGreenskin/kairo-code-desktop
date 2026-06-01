// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ToolCallBlock } from './ToolCallBlock'
import type { ToolCallDisplay } from '../stores/chat-store'

afterEach(cleanup)

const base: ToolCallDisplay = {
  id: 'parent-1',
  toolName: 'spawn_subagent',
  args: { task: 'find usages of X' },
  result: 'Found 3 usages.',
  startedAt: 1,
  endedAt: 2,
  isExpanded: true,
  subagentDone: true,
  subagentSteps: [
    { id: 's1', name: 'grep', args: '{"pattern":"X"}', result: 'a.ts:10\nb.ts:20', ok: true, startedAt: 100, endedAt: 180 },
    { id: 's2', name: 'read_file', args: '{"path":"a.ts"}', result: 'export const X = 1', ok: true, startedAt: 200, endedAt: 260 }
  ]
}

describe('ToolCallBlock — sub-agent trace', () => {
  it('renders the nested sub-agent trace with each inner tool', () => {
    const { getByTestId, getByText } = render(<ToolCallBlock toolCall={base} />)
    const trace = getByTestId('subagent-trace')
    expect(trace.textContent).toMatch(/Sub-agent trace/)
    // Both inner tools listed, with durations.
    expect(getByText('grep')).toBeTruthy()
    expect(getByText('read_file')).toBeTruthy()
    expect(trace.textContent).toMatch(/80ms/)
  })

  it('shows a step count chip and expands a step to reveal args + result', () => {
    const { getByText, container } = render(<ToolCallBlock toolCall={base} />)
    expect(getByText(/↳ 2 steps/)).toBeTruthy()
    // Result is hidden until the step is expanded.
    expect(container.textContent).not.toContain('a.ts:10')
    fireEvent.click(getByText('grep'))
    expect(container.textContent).toContain('a.ts:10')
  })

  it('marks a still-running trace and step', () => {
    const running: ToolCallDisplay = {
      ...base,
      result: undefined,
      endedAt: undefined,
      subagentDone: false,
      subagentSteps: [{ id: 's1', name: 'grep', args: '{}', startedAt: 100 }]
    }
    const { getByText } = render(<ToolCallBlock toolCall={running} />)
    expect(getByText(/running…/)).toBeTruthy()
    expect(getByText(/↳ 1 step …/)).toBeTruthy()
  })
})
