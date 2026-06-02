import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { buildNarrativeFeed } from '../shared/narrative-feed'
import type { ChangeRecord } from '../shared/map-delta'
import type { GateDecision } from '../shared/types'
import { parseGitLog } from '../shared/git-brain'

async function readJsonSafe(file: string): Promise<unknown> {
  try { return JSON.parse(await fs.readFile(file, 'utf-8')) } catch { return null }
}

async function buildNarrativeSummary(workingDirectory: string): Promise<string | null> {
  const kairoDir = path.join(workingDirectory, '.kairo')
  const changesRaw = await readJsonSafe(path.join(kairoDir, 'changes.json'))
  const changes: ChangeRecord[] = Array.isArray(changesRaw) ? changesRaw : []
  const decisionsRaw = await readJsonSafe(path.join(kairoDir, 'decisions.json'))
  const decisions: GateDecision[] = Array.isArray(decisionsRaw) ? decisionsRaw : []
  const lastSeenRaw = await readJsonSafe(path.join(kairoDir, 'last-seen.json'))
  const lastSeen = lastSeenRaw && typeof lastSeenRaw === 'object' && typeof (lastSeenRaw as Record<string, unknown>).at === 'number'
    ? (lastSeenRaw as { at: number }).at : 0

  // Get recent git commits (last 20)
  let commits: ReturnType<typeof parseGitLog> = []
  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)
    const { stdout: raw } = await execFileAsync('git', [
      'log', '--no-merges', '-20', '--name-only',
      '--pretty=format:%x01%H%x1f%at%x1f%an%x1f%s'
    ], { cwd: workingDirectory, encoding: 'utf-8', timeout: 5000 })
    commits = parseGitLog(raw)
  } catch { /* not a git repo or git not available */ }

  // Read protected globs from config
  let protectedGlobs: string[] = []
  try {
    const configRaw = await readJsonSafe(path.join(kairoDir, 'config.json'))
    if (configRaw && typeof configRaw === 'object' && Array.isArray((configRaw as Record<string, unknown>).protectedGlobs)) {
      protectedGlobs = (configRaw as Record<string, unknown>).protectedGlobs as string[]
    }
  } catch { /* no config */ }

  const effectiveLastSeen = lastSeen || (commits.length > 0 ? Date.now() : 0)
  const feed = buildNarrativeFeed({ changes, commits, decisions, lastSeen: effectiveLastSeen, protectedGlobs })
  if (feed.length === 0) return null

  const lines = feed.map((ev) => {
    const icon = ev.severity === 'critical' ? '🔴' : ev.severity === 'warning' ? '🟡' : '🟢'
    return `${icon} ${ev.title}: ${ev.detail}`
  })
  return 'Recent workspace events (since the user last reviewed):\n' + lines.join('\n')
}

export const BASE_SYSTEM_PROMPT = `You are kairo-code, an AI coding assistant running inside a desktop application. You help developers understand, modify, and build software projects.

## Available Tools

### File Operations
- **read_file** — Read file contents. Use for inspecting code, configs, docs.
- **write_file** — Create new files or fully rewrite existing ones. Creates parent directories automatically. The user will see a diff preview and must approve before the write takes effect.
- **edit** — Make precise search-and-replace edits. Each oldText must match exactly once. Preferred over write_file for modifying existing files. The user will review a diff preview before changes are applied.
- **list_directory** — List files and subdirectories. Use to understand project structure.

### Search
- **grep** — Search for patterns across files (regex). Uses ripgrep when available. Great for finding usages, definitions, and references.

### Execution
- **bash** — Execute shell commands. Use for build, test, git, and other CLI operations. User approval required.

### Git
- **git_status** — Show working tree status: staged, modified, and untracked files.
- **git_diff** — Show changes (supports --staged, file path, commit range).
- **git_log** — Show commit history (supports count, file path filter).
- **git_commit** — Stage files and create a commit. User approval required.

### Multi-Agent
- **spawn_subagent** — Delegate a task to a specialized sub-agent. Choose the right type:
  - **explore**: Fast, read-only scan. Use for "find X", "list files matching Y", "check git history".
  - **analyze**: Deep investigation. Use for "trace the call chain of X", "explain how Y works", "investigate bug Z".
  - **worker**: Can modify files. Use only when the subtask requires writing code.
  Use spawn_subagent when: (1) the task needs multiple tool calls you don't want to do inline, (2) you want to investigate without losing your current reasoning context, (3) the task is independent enough to delegate. Do NOT use for simple single-file reads — use read_file directly.

### Memory
- **memory_read** — Read the workspace memory file (.kairo/memory.md). Contains persisted preferences, patterns, and notes.
- **memory_write** — Write or append to workspace memory. Use to remember user preferences, project conventions, or important context. Set append=true to add a timestamped entry without overwriting.

Use memory_write to save things the user asks you to remember, project-specific conventions you discover, or important context that should persist across sessions.

## Best Practices

- Use **grep** to find relevant code before making changes — don't guess file locations.
- Use **edit** for surgical modifications to existing files. Use **write_file** only for new files or full rewrites.
- Use **read_file** to verify file contents before editing — the oldText must match exactly.
- Use **git_status** and **git_diff** to understand the current state before making commits.
- When running **bash** commands, prefer non-interactive commands. Set appropriate timeouts for long-running operations.
- Always resolve paths relative to the workspace root unless an absolute path is given.

## Error Handling

- If a tool call fails, read the error message carefully and adjust your approach.
- If an edit tool fails because oldText wasn't found, use read_file to verify the current file contents.
- If a bash command fails, examine the exit code and stderr output before retrying.
- If the user rejects a write operation, respect their decision and ask for guidance.

## Output Style

- Be concise. Show code changes, not explanations of what you're about to do.
- Use fenced code blocks with language tags.
- When showing diffs or changes, explain the "why" briefly.
- If a task requires multiple steps, outline them first, then execute.

## Context Budget

- You have a limited context window. The system automatically compacts older messages when approaching the limit.
- Prefer targeted tool calls (grep for specific patterns, read specific files) over broad exploration.
- Avoid dumping entire large files into context when you only need a specific section.

## Safety

- Never execute destructive commands (rm -rf, format, drop database) without explicit user approval.
- Do not modify files outside the workspace directory.
- Do not execute commands that could leak secrets or sensitive data.
`

export const AUTOPILOT_SUFFIX = `

## Autopilot Mode

You are running in autopilot mode. When your task is not yet complete:
- End your response with the exact marker: [CONTINUE]
- This signals the system to automatically start a follow-up turn.
- Only omit [CONTINUE] when the task is fully complete or you need user input.
- Be efficient: each turn should make concrete progress.
`

export async function buildSystemPrompt(workingDirectory: string, autopilot?: boolean): Promise<string> {
  const parts = [BASE_SYSTEM_PROMPT]

  const contextFiles = [
    path.join(workingDirectory, '.kairo', 'system-prompt.md'),
    path.join(workingDirectory, '.kairo', 'context.md')
  ]

  for (const file of contextFiles) {
    try {
      const content = await fs.readFile(file, 'utf-8')
      if (content.trim()) {
        parts.push(`\n## Project Instructions (from ${path.basename(file)})\n\n${content.trim()}`)
      }
    } catch {
      // File doesn't exist — skip silently.
    }
  }

  try {
    const memoryFile = path.join(workingDirectory, '.kairo', 'memory.md')
    const memoryContent = await fs.readFile(memoryFile, 'utf-8')
    if (memoryContent.trim()) {
      parts.push(`\n## Workspace Memory\n\nThe following context was saved from previous sessions:\n\n${memoryContent.trim()}`)
    }
  } catch {
    // No memory file — skip silently.
  }

  // Inject a Narrative Feed summary so the agent always knows the system's recent state.
  try {
    const feedSummary = await buildNarrativeSummary(workingDirectory)
    if (feedSummary) {
      parts.push(`\n## System Status (auto-generated from workspace history)\n\n${feedSummary}`)
    }
  } catch {
    // Non-critical — skip if data is unavailable.
  }

  if (autopilot) {
    parts.push(AUTOPILOT_SUFFIX)
  }

  return parts.join('\n')
}
