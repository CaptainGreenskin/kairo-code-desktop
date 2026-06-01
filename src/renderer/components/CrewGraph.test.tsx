// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { CrewGraph } from './CrewGraph'
import type { CrewRoleConfig } from '../../shared/types'

const role = (id: string, dependsOn?: string[]): CrewRoleConfig => ({
  id,
  label: id[0]!.toUpperCase() + id.slice(1),
  systemPrompt: id,
  ...(dependsOn ? { dependsOn } : {})
})

afterEach(cleanup)

describe('CrewGraph', () => {
  it('renders a node per role and an edge per dependency', () => {
    const roles = [role('planner'), role('coder', ['planner']), role('reviewer', ['coder'])]
    const { container, getByText } = render(<CrewGraph roles={roles} strategy="sequential" />)
    getByText('Planner')
    getByText('Coder')
    getByText('Reviewer')
    // 3 nodes → 3 <rect>; chain has 2 dependency edges → 2 <path>.
    expect(container.querySelectorAll('rect')).toHaveLength(3)
    expect(container.querySelectorAll('path')).toHaveLength(2)
  })

  it('renders a parallel fork (diamond) with the right edge count', () => {
    const roles = [
      role('planner'),
      role('fe', ['planner']),
      role('be', ['planner']),
      role('reviewer', ['fe', 'be'])
    ]
    const { container } = render(<CrewGraph roles={roles} strategy="sequential" />)
    expect(container.querySelectorAll('rect')).toHaveLength(4)
    // edges: planner→fe, planner→be, fe→reviewer, be→reviewer = 4
    expect(container.querySelectorAll('path')).toHaveLength(4)
  })

  it('renders nothing for an empty roster', () => {
    const { container } = render(<CrewGraph roles={[]} />)
    expect(container.querySelector('[data-testid="crew-graph"]')).toBeNull()
  })
})
