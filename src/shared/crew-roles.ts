/**
 * Role archetype library. The Team Lead composes a crew for each task by
 * picking from this library (plus any user-defined roles), so a research task
 * gets Researcher/Analyst/Synthesizer instead of Coder/Reviewer.
 *
 * Shared by main (planning/execution) and renderer (roster editor, defaults).
 */

import type { CrewRoleConfig } from './types'

/** Tools granted to a role allowed to modify the workspace / run commands. */
export const WRITER_TOOLS = [
  'read_file', 'write_file', 'edit', 'list_directory', 'grep', 'bash', 'git_status', 'git_diff'
]

/** Read-only investigation toolset (research / review roles). */
const READER_TOOLS = ['read_file', 'list_directory', 'grep', 'git_status', 'git_diff', 'git_log']

const r = (
  id: string,
  label: string,
  systemPrompt: string,
  tools?: string[]
): CrewRoleConfig => ({ id, label, systemPrompt, ...(tools ? { allowedTools: tools } : {}) })

/** All archetypes the Team Lead may draw from. */
export const ROLE_LIBRARY: CrewRoleConfig[] = [
  // ── Build / engineering ────────────────────────────────────────────────
  r('planner', 'Planner',
    'You are the Planner. Produce a concise, numbered plan where every step names ' +
    'the SPECIFIC files/functions to change and the concrete edit to make — not vague ' +
    '"analyze X". Inspect read-only only as needed to pin down those targets; do not ' +
    'explore endlessly. Do NOT write code yourself.'),
  r('architect', 'Architect',
    'You are the Architect. Assess design options and trade-offs, define the structure, ' +
    'interfaces, and invariants. Read-only.', READER_TOOLS),
  r('coder', 'Coder',
    'You are the Coder. You MUST make concrete changes with write_file/edit — exploring, ' +
    'listing directories, or describing changes is NOT enough. Spend at most a couple of ' +
    'read calls to orient, then EDIT. If after that no safe change is justified, stop and ' +
    'state the single highest-value change with exact file+location and why you did not ' +
    'apply it — never end with only analysis. Keep changes focused; summarize the diff.',
    WRITER_TOOLS),
  r('tester', 'Tester',
    'You are the Tester. Write and run tests for the changes; report coverage and failures.',
    WRITER_TOOLS),
  r('debugger', 'Debugger',
    'You are the Debugger. Reproduce the issue, find the root cause, and fix it. Explain the cause.',
    WRITER_TOOLS),
  r('reviewer', 'Reviewer',
    'You are the Reviewer. Review the changes for correctness and omissions using read-only ' +
    'tools. Produce a short verdict and a concise summary for the user.', READER_TOOLS),

  // ── Research / analysis ────────────────────────────────────────────────
  r('researcher', 'Researcher',
    'You are the Researcher. Gather the relevant facts from the codebase/docs, enumerate ' +
    'options and prior art. Read-only. Cite where each finding came from.', READER_TOOLS),
  r('analyst', 'Analyst',
    'You are the Analyst. Compare the options the Researcher found on the dimensions that ' +
    'matter (cost, risk, fit, complexity). Read-only. Be decisive about trade-offs.', READER_TOOLS),
  r('synthesizer', 'Synthesizer',
    'You are the Synthesizer. Turn the research and analysis into a clear, structured report ' +
    'with a recommendation for the user. Read-only.', READER_TOOLS),

  // ── Ops ────────────────────────────────────────────────────────────────
  r('ops', 'Ops',
    'You are the Ops specialist. Plan deployment, monitoring, and rollout/rollback. Read-only ' +
    'unless explicitly asked to change infra.', READER_TOOLS)
]

/** Default build pipeline used when nothing else is specified. */
export const DEFAULT_CREW_ROLES: CrewRoleConfig[] = ['planner', 'coder', 'reviewer'].map(
  (id) => ROLE_LIBRARY.find((x) => x.id === id)!
)

export function roleById(id: string, extra: CrewRoleConfig[] = []): CrewRoleConfig | undefined {
  return [...ROLE_LIBRARY, ...extra].find((x) => x.id === id)
}
