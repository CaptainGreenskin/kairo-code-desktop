/**
 * Agent type registry — defines the kinds of subagents the system can spawn.
 * Each type has a purpose, tool set, and behavioral constraints. The main agent
 * picks the type based on the task (or the user specifies it explicitly).
 *
 * This is the foundation for upgrading subagents from "a tool call" to "a
 * first-class delegation primitive". Pure + browser-safe.
 */

export interface AgentType {
  id: string
  label: string
  description: string
  systemPrompt: string
  /** Tool names this agent type may use. Empty = read-only default set. */
  tools: string[]
  /** Whether this agent can modify files (determines permission model). */
  canWrite: boolean
  /** Maximum reasoning iterations before forced stop. */
  maxIterations: number
}

/** Read-only tools shared by Explore and Analyze agents. */
export const READ_ONLY_TOOLS = [
  'read_file', 'list_directory', 'grep', 'git_status', 'git_diff', 'git_log', 'memory_read'
]

/** Full tool set for agents that can modify files. */
export const WRITER_AGENT_TOOLS = [
  ...READ_ONLY_TOOLS,
  'write_file', 'edit', 'bash', 'git_commit'
]

export const BUILTIN_AGENT_TYPES: AgentType[] = [
  {
    id: 'explore',
    label: 'Explore',
    description: 'Fast read-only search and scan. Use for finding files, grepping patterns, listing directories, checking git history. Cannot modify anything.',
    systemPrompt: 'You are a focused exploration agent. Search the codebase to answer the question. Be concise — return findings, not commentary. If you cannot find the answer, say so clearly.',
    tools: READ_ONLY_TOOLS,
    canWrite: false,
    maxIterations: 8
  },
  {
    id: 'analyze',
    label: 'Analyze',
    description: 'Deep code analysis and understanding. Use for tracing call chains, understanding architecture, investigating bugs, explaining complex logic. Read-only but more thorough than Explore.',
    systemPrompt: 'You are a code analysis agent. Read the relevant source files, trace call chains, and provide a thorough analysis. Cite specific file paths and line numbers. Structure your findings clearly.',
    tools: READ_ONLY_TOOLS,
    canWrite: false,
    maxIterations: 15
  },
  {
    id: 'worker',
    label: 'Worker',
    description: 'Can read AND write files, run commands. Use for implementing changes, fixing bugs, running tests. Only spawn when the task requires file modifications.',
    systemPrompt: 'You are a coding agent. Implement the requested change precisely. Read the relevant files first, then make targeted edits. Run tests if available. Report what you changed and why.',
    tools: WRITER_AGENT_TOOLS,
    canWrite: true,
    maxIterations: 20
  }
]

/** Look up an agent type by id. Falls back to 'explore' if not found. */
export function resolveAgentType(id: string | undefined, extra: AgentType[] = []): AgentType {
  const all = [...BUILTIN_AGENT_TYPES, ...extra]
  return all.find((t) => t.id === id) ?? all.find((t) => t.id === 'explore')!
}

/** Build a type description block for the LLM's tool schema. */
export function agentTypeDescriptions(extra: AgentType[] = []): string {
  return [...BUILTIN_AGENT_TYPES, ...extra]
    .map((t) => `- "${t.id}": ${t.description}`)
    .join('\n')
}
