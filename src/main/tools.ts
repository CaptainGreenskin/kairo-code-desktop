/**
 * Built-in coding tool definitions registered with the agent's tool registry.
 *
 * `kairo-ts` ships the tool *runtime* (registry, executor, permission guard,
 * approval flow) but no concrete tool implementations — those are an
 * application concern. This module supplies the minimum set required for a
 * coding assistant: read_file, write_file, list_directory, bash.
 *
 * All paths are resolved against `ctx.workingDirectory`, which the agent
 * manager sets to the active session's workspace root before every turn.
 */

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import type {
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
  ToolExecutor,
  ToolRegistry
} from '@kairo/api'
import { CommandSafetyPolicy } from '@kairo/core'
import { clampSleepSeconds } from '../shared/sleep-policy'
import { guardFileContent } from '../shared/secret-guard'
import { snapshotFile } from './checkpoint'

interface CodingTool {
  definition: ToolDefinition
  executor: ToolExecutor
}

/**
 * Catastrophic-command guard. Reuses kairo-ts's own CommandSafetyPolicy (ported
 * from the Java core) and adds a few project-specific blocks — force-push,
 * piping a remote script straight into a shell. Dangerous commands are refused
 * BEFORE execution regardless of permission mode, so an unattended overnight run
 * can never run a destructive command even if it would otherwise auto-approve.
 */
const commandSafety = new CommandSafetyPolicy({
  blockedPatterns: [
    /\bgit\s+push\b[^\n]*\s(--force\b|-f\b)/, // force push
    /\bgit\s+push\b[^\n]*\s--force-with-lease\b/,
    /\bgit\s+reset\s+--hard\b[^\n]*\borigin\//, // hard reset to remote
    /\bcurl\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/, // curl | sh
    /\bwget\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/, // wget | sh
    /\bgit\s+clean\s+-[^\s]*f[^\s]*d|\bgit\s+clean\s+-[^\s]*d[^\s]*f/ // git clean -fd
  ]
})

/** Returns the safety verdict for a shell command (refused before execution). */
export function isDangerousCommand(command: string): { dangerous: boolean; reason?: string } {
  return commandSafety.isDangerous(command)
}

function resolveWorkspacePath(ctx: ToolContext, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(ctx.workingDirectory, p)
}

// ─── read_file ───────────────────────────────────────────────────────────────

const readFileTool: CodingTool = {
  definition: {
    name: 'read_file',
    description:
      'Read the UTF-8 contents of a text file. Accepts absolute paths or paths relative to the workspace root.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read.' }
      },
      required: ['path']
    },
    permission: 'read'
  },
  executor: {
    async execute(_name, args, ctx): Promise<ToolExecutionResult> {
      const raw = typeof args.path === 'string' ? args.path : ''
      if (!raw) {
        return { content: "Missing required argument 'path'.", isError: true }
      }
      const target = resolveWorkspacePath(ctx, raw)
      try {
        // Auto-fallback: if the path is a directory, list it instead of erroring.
        const st = await stat(target)
        if (st.isDirectory()) {
          const entries = await readdir(target, { withFileTypes: true })
          const listing = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n')
          return { content: `(directory listing for ${raw})\n${listing}` }
        }
        const content = await fs.readFile(target, 'utf-8')
        // Secret guard: redact key material / credentials before they enter the
        // model context (so an autonomous agent can't exfiltrate secret values).
        const guarded = guardFileContent(target, content)
        return {
          content: guarded,
          metadata: { path: target, bytes: content.length, redacted: guarded !== content }
        }
      } catch (err) {
        return {
          content: `Failed to read '${target}': ${(err as Error).message}`,
          isError: true
        }
      }
    }
  }
}

// ─── write_file ──────────────────────────────────────────────────────────────

const writeFileTool: CodingTool = {
  definition: {
    name: 'write_file',
    description:
      'Write UTF-8 content to a file, creating parent directories as needed. Overwrites any existing file at the path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write.' },
        content: { type: 'string', description: 'Full file content (UTF-8).' }
      },
      required: ['path', 'content']
    },
    permission: 'write'
  },
  executor: {
    async execute(_name, args, ctx): Promise<ToolExecutionResult> {
      const raw = typeof args.path === 'string' ? args.path : ''
      const content = typeof args.content === 'string' ? args.content : ''
      if (!raw) {
        return { content: "Missing required argument 'path'.", isError: true }
      }
      const target = resolveWorkspacePath(ctx, raw)
      try {
        await snapshotFile(ctx.workingDirectory, target) // checkpoint before overwrite
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, content, 'utf-8')
        return {
          content: `Wrote ${content.length} bytes to ${target}`,
          metadata: { path: target, bytes: content.length }
        }
      } catch (err) {
        return {
          content: `Failed to write '${target}': ${(err as Error).message}`,
          isError: true
        }
      }
    }
  }
}

// ─── list_directory ──────────────────────────────────────────────────────────

const listDirectoryTool: CodingTool = {
  definition: {
    name: 'list_directory',
    description:
      'List files and subdirectories of a directory. Directory entries are suffixed with "/". Defaults to the workspace root.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list. Defaults to the workspace root.',
          default: '.'
        }
      }
    },
    permission: 'read'
  },
  executor: {
    async execute(_name, args, ctx): Promise<ToolExecutionResult> {
      const raw = typeof args.path === 'string' && args.path ? args.path : '.'
      const target = resolveWorkspacePath(ctx, raw)
      try {
        const entries = await fs.readdir(target, { withFileTypes: true })
        const lines = entries
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort((a, b) => a.localeCompare(b))
        return {
          content: lines.length ? lines.join('\n') : '(empty)',
          metadata: { path: target, count: entries.length }
        }
      } catch (err) {
        return {
          content: `Failed to list '${target}': ${(err as Error).message}`,
          isError: true
        }
      }
    }
  }
}

// ─── bash ────────────────────────────────────────────────────────────────────

const DEFAULT_BASH_TIMEOUT_MS = 30_000

const bashTool: CodingTool = {
  definition: {
    name: 'bash',
    description:
      'Execute a shell command via /bin/sh in the workspace directory. Returns combined stdout/stderr and exit code. Use for build/test/git commands.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute.' },
        timeout_ms: {
          type: 'integer',
          description: `Optional timeout in milliseconds (default ${DEFAULT_BASH_TIMEOUT_MS}).`,
          default: DEFAULT_BASH_TIMEOUT_MS
        }
      },
      required: ['command']
    },
    permission: 'system'
  },
  executor: {
    async execute(_name, args, ctx): Promise<ToolExecutionResult> {
      const command = typeof args.command === 'string' ? args.command.trim() : ''
      if (!command) {
        return { content: "Missing required argument 'command'.", isError: true }
      }
      // Safety line: refuse catastrophic commands before they ever run.
      const safety = isDangerousCommand(command)
      if (safety.dangerous) {
        return {
          content: `🛑 已拦截危险命令（${safety.reason}）。如确需执行，请手动在终端运行。`,
          isError: true,
          metadata: { blocked: true, reason: safety.reason }
        }
      }
      const timeoutMs =
        typeof args.timeout_ms === 'number' && args.timeout_ms > 0
          ? args.timeout_ms
          : DEFAULT_BASH_TIMEOUT_MS

      return new Promise<ToolExecutionResult>((resolve) => {
        const child = spawn('/bin/sh', ['-c', command], {
          cwd: ctx.workingDirectory,
          env: process.env
        })

        let stdout = ''
        let stderr = ''
        let timedOut = false

        const timer = setTimeout(() => {
          timedOut = true
          child.kill('SIGTERM')
        }, timeoutMs)

        const onAbort = (): void => {
          child.kill('SIGTERM')
        }
        if (ctx.abortSignal.aborted) onAbort()
        else ctx.abortSignal.addEventListener('abort', onAbort, { once: true })

        child.stdout?.on('data', (d: Buffer) => {
          stdout += d.toString('utf-8')
        })
        child.stderr?.on('data', (d: Buffer) => {
          stderr += d.toString('utf-8')
        })

        child.on('error', (err) => {
          clearTimeout(timer)
          ctx.abortSignal.removeEventListener('abort', onAbort)
          resolve({
            content: `Failed to spawn shell: ${err.message}`,
            isError: true
          })
        })

        child.on('close', (code, signal) => {
          clearTimeout(timer)
          ctx.abortSignal.removeEventListener('abort', onAbort)
          const parts: string[] = []
          if (stdout.trimEnd()) parts.push(`[stdout]\n${stdout.trimEnd()}`)
          if (stderr.trimEnd()) parts.push(`[stderr]\n${stderr.trimEnd()}`)
          parts.push(
            `[exit] code=${code ?? 'null'}${signal ? ` signal=${signal}` : ''}${
              timedOut ? ' (timeout)' : ''
            }`
          )
          resolve({
            content: parts.join('\n\n') || '(no output)',
            isError: timedOut || (code !== null && code !== 0),
            metadata: {
              exitCode: code,
              signal,
              timedOut,
              cwd: ctx.workingDirectory
            }
          })
        })
      })
    }
  }
}

// ─── grep ────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_RESULTS = 50

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.cache', 'coverage'
])

const looksBinary = (buf: Buffer): boolean => {
  const sample = Math.min(buf.length, 8 * 1024)
  for (let i = 0; i < sample; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

interface GrepMatch {
  file: string
  line: number
  text: string
}

const tryRipgrep = (
  pattern: string,
  searchPath: string,
  include: string | undefined,
  maxResults: number,
  signal: AbortSignal
): Promise<GrepMatch[] | null> => {
  return new Promise((resolve) => {
    const args = ['--no-heading', '--line-number', '--color', 'never', '-m', String(maxResults)]
    if (include) args.push('--glob', include)
    args.push('--', pattern, searchPath)

    const child = spawn('rg', args, { signal })
    let stdout = ''

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString('utf-8') })
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      if (code === 2) { resolve(null); return }
      const matches: GrepMatch[] = []
      for (const line of stdout.split('\n')) {
        if (!line) continue
        const firstColon = line.indexOf(':')
        if (firstColon === -1) continue
        const secondColon = line.indexOf(':', firstColon + 1)
        if (secondColon === -1) continue
        const file = line.slice(0, firstColon)
        const lineNo = parseInt(line.slice(firstColon + 1, secondColon), 10)
        const text = line.slice(secondColon + 1)
        if (!Number.isFinite(lineNo)) continue
        matches.push({ file, line: lineNo, text })
        if (matches.length >= maxResults) break
      }
      resolve(matches)
    })
  })
}

const fallbackGrep = async (
  pattern: string,
  searchPath: string,
  include: string | undefined,
  maxResults: number,
  signal: AbortSignal
): Promise<GrepMatch[]> => {
  const regex = new RegExp(pattern)
  const includeRe = include ? globToRegExp(include) : null
  const matches: GrepMatch[] = []

  const visit = async (current: string): Promise<void> => {
    if (signal.aborted || matches.length >= maxResults) return
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (signal.aborted || matches.length >= maxResults) return
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await visit(full)
      } else if (entry.isFile()) {
        if (includeRe && !includeRe.test(entry.name)) continue
        try {
          const buf = await readFile(full)
          if (looksBinary(buf)) continue
          const text = buf.toString('utf-8')
          const lines = text.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i]!)) {
              matches.push({ file: full, line: i + 1, text: lines[i]! })
              if (matches.length >= maxResults) return
            }
          }
        } catch { /* skip unreadable */ }
      }
    }
  }

  const info = await stat(searchPath).catch(() => null)
  if (!info) return matches
  if (info.isFile()) {
    try {
      const buf = await readFile(searchPath)
      if (!looksBinary(buf)) {
        const text = buf.toString('utf-8')
        const lines = text.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i]!)) {
            matches.push({ file: searchPath, line: i + 1, text: lines[i]! })
            if (matches.length >= maxResults) break
          }
        }
      }
    } catch { /* ignore */ }
  } else {
    await visit(searchPath)
  }
  return matches
}

const globToRegExp = (glob: string): RegExp => {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if ('.+^$()|{}\\'.includes(c)) re += `\\${c}`
    else re += c
  }
  return new RegExp(`^${re}$`)
}

const grepTool: CodingTool = {
  definition: {
    name: 'grep',
    description:
      'Search for a regex pattern in files. Returns matching lines with file paths and line numbers. Uses ripgrep when available, falls back to built-in search.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (regex supported).' },
        path: {
          type: 'string',
          description: 'Directory or file to search in. Defaults to workspace root.'
        },
        include: {
          type: 'string',
          description: 'Glob pattern for files to include (e.g., "*.ts").'
        },
        maxResults: {
          type: 'integer',
          description: 'Maximum number of results (default: 50).',
          default: DEFAULT_MAX_RESULTS
        }
      },
      required: ['pattern']
    },
    permission: 'read'
  },
  executor: {
    async execute(_name, args, ctx): Promise<ToolExecutionResult> {
      const pattern = typeof args.pattern === 'string' ? args.pattern : ''
      if (!pattern) {
        return { content: "Missing required argument 'pattern'.", isError: true }
      }
      try { new RegExp(pattern) } catch (e) {
        return {
          content: `Invalid regex pattern: ${(e as Error).message}`,
          isError: true
        }
      }
      const searchPath = resolveWorkspacePath(
        ctx,
        typeof args.path === 'string' && args.path ? args.path : '.'
      )
      const include = typeof args.include === 'string' ? args.include : undefined
      const maxResults =
        typeof args.maxResults === 'number' && args.maxResults > 0
          ? args.maxResults
          : DEFAULT_MAX_RESULTS

      try {
        let matches = await tryRipgrep(pattern, searchPath, include, maxResults, ctx.abortSignal)
        if (!matches) {
          matches = await fallbackGrep(pattern, searchPath, include, maxResults, ctx.abortSignal)
        }
        if (matches.length === 0) {
          return {
            content: `No matches for "${pattern}" in ${searchPath}`,
            metadata: { count: 0, searchPath }
          }
        }
        const body = matches
          .map((m) => {
            const rel = path.relative(ctx.workingDirectory, m.file) || m.file
            return `${rel}:${m.line}: ${m.text}`
          })
          .join('\n')
        return {
          content: body,
          metadata: { count: matches.length, truncated: matches.length >= maxResults, searchPath }
        }
      } catch (err) {
        return {
          content: `Error searching ${searchPath}: ${(err as Error).message}`,
          isError: true
        }
      }
    }
  }
}

// ─── edit ────────────────────────────────────────────────────────────────────

const countOccurrences = (haystack: string, needle: string): number => {
  if (needle.length === 0) return 0
  let count = 0
  let from = 0
  while (true) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) break
    count++
    from = idx + needle.length
  }
  return count
}

const snippet = (text: string, max = 80): string => {
  const flat = text.replace(/\n/g, '\\n')
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

const editTool: CodingTool = {
  definition: {
    name: 'edit',
    description:
      'Make search-and-replace edits to a file. Each replacement must match exactly once in the file. Use this for precise, surgical edits rather than rewriting entire files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to edit.' },
        replacements: {
          type: 'array',
          description: 'List of replacements to apply in order.',
          items: {
            type: 'object',
            properties: {
              oldText: {
                type: 'string',
                description: 'Exact text to find (must match uniquely).'
              },
              newText: { type: 'string', description: 'Text to replace with.' }
            },
            required: ['oldText', 'newText']
          }
        }
      },
      required: ['path', 'replacements']
    },
    permission: 'write'
  },
  executor: {
    async execute(_name, args, ctx): Promise<ToolExecutionResult> {
      const raw = typeof args.path === 'string' ? args.path : ''
      if (!raw) {
        return { content: "Missing required argument 'path'.", isError: true }
      }
      const replacements = Array.isArray(args.replacements) ? args.replacements : []
      if (replacements.length === 0) {
        return { content: "Missing required argument 'replacements'.", isError: true }
      }
      const target = resolveWorkspacePath(ctx, raw)
      try {
        let contents = await fs.readFile(target, 'utf-8')
        for (let i = 0; i < replacements.length; i++) {
          const r = replacements[i] as { oldText?: string; newText?: string }
          const oldText = typeof r.oldText === 'string' ? r.oldText : ''
          const newText = typeof r.newText === 'string' ? r.newText : ''
          if (!oldText) {
            return {
              content: `Replacement #${i + 1} has empty oldText.`,
              isError: true
            }
          }
          const matches = countOccurrences(contents, oldText)
          if (matches === 0) {
            return {
              content: `oldText not found for replacement #${i + 1}: "${snippet(oldText)}"`,
              isError: true
            }
          }
          if (matches > 1) {
            return {
              content: `oldText for replacement #${i + 1} matches ${matches} times; must be unique. Snippet: "${snippet(oldText)}"`,
              isError: true
            }
          }
          const idx = contents.indexOf(oldText)
          contents = contents.slice(0, idx) + newText + contents.slice(idx + oldText.length)
        }
        await snapshotFile(ctx.workingDirectory, target) // checkpoint before overwrite
        await fs.writeFile(target, contents, 'utf-8')
        return {
          content: `Applied ${replacements.length} replacement${replacements.length === 1 ? '' : 's'} to ${target}`,
          metadata: { path: target, count: replacements.length }
        }
      } catch (err) {
        return {
          content: `Error editing '${target}': ${(err as Error).message}`,
          isError: true
        }
      }
    }
  }
}

// ─── git_status ─────────────────────────────────────────────────────────────

const execGit = (
  args: string[],
  cwd: string,
  signal: AbortSignal
): Promise<{ stdout: string; stderr: string; code: number | null }> => {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, signal })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString('utf-8') })
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf-8') })
    child.on('error', (err) => resolve({ stdout: '', stderr: err.message, code: 1 }))
    child.on('close', (code) => resolve({ stdout, stderr, code }))
  })
}

const gitStatusTool: CodingTool = {
  definition: {
    name: 'git_status',
    description:
      'Show the working tree status: staged, modified, and untracked files. Returns structured output with file paths grouped by status.',
    parameters: {
      type: 'object',
      properties: {}
    },
    permission: 'read'
  },
  executor: {
    async execute(_name, _args, ctx): Promise<ToolExecutionResult> {
      try {
        const { stdout, stderr, code } = await execGit(
          ['status', '--porcelain=v1', '-uall'],
          ctx.workingDirectory,
          ctx.abortSignal
        )
        if (code !== 0 && code !== null) {
          return { content: `git status failed: ${stderr.trim()}`, isError: true }
        }
        const branch = await execGit(
          ['rev-parse', '--abbrev-ref', 'HEAD'],
          ctx.workingDirectory,
          ctx.abortSignal
        )
        const branchName = branch.stdout.trim() || 'unknown'
        if (!stdout.trim()) {
          return {
            content: JSON.stringify({ branch: branchName, staged: [], modified: [], untracked: [], clean: true }),
            metadata: { branch: branchName }
          }
        }
        const staged: string[] = []
        const modified: string[] = []
        const untracked: string[] = []
        for (const line of stdout.split('\n')) {
          if (!line || line.length < 4) continue
          const x = line[0]!
          const y = line[1]!
          const file = line.slice(3)
          if (x === '?' && y === '?') {
            untracked.push(file)
          } else {
            if (x !== ' ' && x !== '?') staged.push(file)
            if (y !== ' ' && y !== '?') modified.push(file)
          }
        }
        return {
          content: JSON.stringify({ branch: branchName, staged, modified, untracked, clean: false }),
          metadata: { branch: branchName, staged: staged.length, modified: modified.length, untracked: untracked.length }
        }
      } catch (err) {
        return { content: `git status error: ${(err as Error).message}`, isError: true }
      }
    }
  }
}

// ─── git_diff ───────────────────────────────────────────────────────────────

const gitDiffTool: CodingTool = {
  definition: {
    name: 'git_diff',
    description:
      'Show changes in the working tree or between commits. Supports --staged flag, file path filter, and commit range.',
    parameters: {
      type: 'object',
      properties: {
        staged: {
          type: 'boolean',
          description: 'Show staged (cached) changes instead of unstaged.',
          default: false
        },
        path: {
          type: 'string',
          description: 'Limit diff to a specific file or directory.'
        },
        ref: {
          type: 'string',
          description: 'Commit ref or range (e.g., "HEAD~3", "main..feature").'
        }
      }
    },
    permission: 'read'
  },
  executor: {
    async execute(_name, args, ctx): Promise<ToolExecutionResult> {
      try {
        const gitArgs = ['diff', '--no-color']
        if (args.staged === true) gitArgs.push('--cached')
        if (typeof args.ref === 'string' && args.ref) gitArgs.push(args.ref)
        if (typeof args.path === 'string' && args.path) {
          gitArgs.push('--', resolveWorkspacePath(ctx, args.path))
        }
        const { stdout, stderr, code } = await execGit(
          gitArgs,
          ctx.workingDirectory,
          ctx.abortSignal
        )
        if (code !== 0 && code !== null) {
          return { content: `git diff failed: ${stderr.trim()}`, isError: true }
        }
        return {
          content: stdout.trim() || '(no changes)',
          metadata: { staged: !!args.staged }
        }
      } catch (err) {
        return { content: `git diff error: ${(err as Error).message}`, isError: true }
      }
    }
  }
}

// ─── git_log ────────────────────────────────────────────────────────────────

const gitLogTool: CodingTool = {
  definition: {
    name: 'git_log',
    description:
      'Show commit history. Returns structured JSON with hash, author, date, and message for each commit.',
    parameters: {
      type: 'object',
      properties: {
        count: {
          type: 'integer',
          description: 'Number of commits to show (default: 10).',
          default: 10
        },
        path: {
          type: 'string',
          description: 'Limit log to a specific file or directory.'
        },
        oneline: {
          type: 'boolean',
          description: 'Show compact one-line format.',
          default: false
        }
      }
    },
    permission: 'read'
  },
  executor: {
    async execute(_name, args, ctx): Promise<ToolExecutionResult> {
      try {
        const count = typeof args.count === 'number' && args.count > 0 ? args.count : 10
        const gitArgs = [
          'log',
          `-${count}`,
          '--format=%H%x00%an%x00%aI%x00%s',
          '--no-color'
        ]
        if (typeof args.path === 'string' && args.path) {
          gitArgs.push('--', resolveWorkspacePath(ctx, args.path))
        }
        const { stdout, stderr, code } = await execGit(
          gitArgs,
          ctx.workingDirectory,
          ctx.abortSignal
        )
        if (code !== 0 && code !== null) {
          return { content: `git log failed: ${stderr.trim()}`, isError: true }
        }
        if (!stdout.trim()) {
          return { content: JSON.stringify([]), metadata: { count: 0 } }
        }
        const commits = stdout
          .trim()
          .split('\n')
          .map((line) => {
            const [hash, author, date, ...rest] = line.split('\x00')
            return { hash, author, date, message: rest.join('\x00') }
          })
        return {
          content: JSON.stringify(commits),
          metadata: { count: commits.length }
        }
      } catch (err) {
        return { content: `git log error: ${(err as Error).message}`, isError: true }
      }
    }
  }
}

// ─── git_commit ─────────────────────────────────────────────────────────────

const gitCommitTool: CodingTool = {
  definition: {
    name: 'git_commit',
    description:
      'Stage specified files (or all changes) and create a commit. Returns the commit hash and summary.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Commit message.'
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files to stage before committing. If empty or omitted, stages all changes (git add -A).'
        }
      },
      required: ['message']
    },
    permission: 'write'
  },
  executor: {
    async execute(_name, args, ctx): Promise<ToolExecutionResult> {
      const message = typeof args.message === 'string' ? args.message.trim() : ''
      if (!message) {
        return { content: "Missing required argument 'message'.", isError: true }
      }
      try {
        const files = Array.isArray(args.files) ? args.files.filter((f): f is string => typeof f === 'string') : []
        if (files.length > 0) {
          const addResult = await execGit(
            ['add', '--', ...files.map((f) => resolveWorkspacePath(ctx, f))],
            ctx.workingDirectory,
            ctx.abortSignal
          )
          if (addResult.code !== 0 && addResult.code !== null) {
            return { content: `git add failed: ${addResult.stderr.trim()}`, isError: true }
          }
        } else {
          const addResult = await execGit(
            ['add', '-A'],
            ctx.workingDirectory,
            ctx.abortSignal
          )
          if (addResult.code !== 0 && addResult.code !== null) {
            return { content: `git add -A failed: ${addResult.stderr.trim()}`, isError: true }
          }
        }
        const { stdout, stderr, code } = await execGit(
          ['commit', '-m', message],
          ctx.workingDirectory,
          ctx.abortSignal
        )
        if (code !== 0 && code !== null) {
          return { content: `git commit failed: ${stderr.trim() || stdout.trim()}`, isError: true }
        }
        const hashResult = await execGit(
          ['rev-parse', '--short', 'HEAD'],
          ctx.workingDirectory,
          ctx.abortSignal
        )
        const hash = hashResult.stdout.trim()
        return {
          content: JSON.stringify({ hash, message, filesStaged: files.length || 'all' }),
          metadata: { hash, message }
        }
      } catch (err) {
        return { content: `git commit error: ${(err as Error).message}`, isError: true }
      }
    }
  }
}

// ─── memory ────────────────────────────────────────────────────────────────

import { WorkspaceMemory } from './memory'

const workspaceMemory = new WorkspaceMemory()

const memoryReadTool: CodingTool = {
  definition: {
    name: 'memory_read',
    description:
      'Read the workspace memory file (.kairo/memory.md). Contains user preferences, project patterns, and notes that persist across sessions.',
    parameters: {
      type: 'object',
      properties: {}
    },
    permission: 'read'
  },
  executor: {
    async execute(_name, _args, ctx): Promise<ToolExecutionResult> {
      try {
        const content = await workspaceMemory.read(ctx.workingDirectory)
        return {
          content: content || '(no workspace memory yet)',
          metadata: { path: ctx.workingDirectory }
        }
      } catch (err) {
        return {
          content: `Failed to read memory: ${(err as Error).message}`,
          isError: true
        }
      }
    }
  }
}

const memoryWriteTool: CodingTool = {
  definition: {
    name: 'memory_write',
    description:
      'Write to the workspace memory file (.kairo/memory.md). Use to remember user preferences, project conventions, frequently-needed context, or notes for future sessions. Content persists across sessions.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The content to write. Use markdown format. Will overwrite existing memory.'
        },
        append: {
          type: 'boolean',
          description: 'If true, append as a timestamped entry instead of overwriting.',
          default: false
        }
      },
      required: ['content']
    },
    permission: 'write'
  },
  executor: {
    async execute(_name, args, ctx): Promise<ToolExecutionResult> {
      const content = typeof args.content === 'string' ? args.content : ''
      if (!content.trim()) {
        return { content: "Missing required argument 'content'.", isError: true }
      }
      try {
        if (args.append === true) {
          await workspaceMemory.append(ctx.workingDirectory, content)
          return { content: 'Appended entry to workspace memory.' }
        }
        await workspaceMemory.write(ctx.workingDirectory, content)
        return { content: 'Updated workspace memory.' }
      } catch (err) {
        return {
          content: `Failed to write memory: ${(err as Error).message}`,
          isError: true
        }
      }
    }
  }
}

// ─── spawn_subagent ────────────────────────────────────────────────────────

import type { SubagentFactory } from './subagent'

export function registerSubagentTool(
  registry: ToolRegistry,
  factory: SubagentFactory,
  getContext?: () => { sessionId: string; turnId: string }
): void {
  const typeList = [
    '- "explore": Fast read-only search/scan. For finding files, grepping, listing dirs, checking git.',
    '- "analyze": Deep code analysis. For tracing call chains, understanding architecture, investigating bugs.',
    '- "worker": Can read AND write files, run commands. Only for tasks requiring modifications.'
  ].join('\n')
  const definition: ToolDefinition = {
    name: 'spawn_subagent',
    description:
      'Spawn a focused sub-agent to handle a task. Choose the right agent type:\n' + typeList +
      '\n\nUse "explore" for quick searches, "analyze" for deep investigation, "worker" only when files must be modified.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'A clear description of what the sub-agent should do.'
        },
        agentType: {
          type: 'string',
          description: 'Agent type: "explore" (fast, read-only), "analyze" (deep, read-only), or "worker" (can write files).'
        },
        background: {
          type: 'boolean',
          description: 'Run in background (non-blocking). Default false. Use for long tasks where you can continue other work while waiting.'
        }
      },
      required: ['task']
    },
    permission: 'system'
  }
  const executor: ToolExecutor = {
    async execute(_name, args, toolCtx): Promise<ToolExecutionResult> {
      const task = typeof args.task === 'string' ? args.task.trim() : ''
      if (!task) {
        return { content: "Missing required argument 'task'.", isError: true }
      }
      const agentTypeId = typeof args.agentType === 'string' ? args.agentType : undefined
      try {
        const ctx = getContext?.() ?? { sessionId: '', turnId: '' }
        const parentToolCallId = toolCtx?.toolCallId ?? ''
        const result = await factory.spawn(task, undefined, ctx.sessionId, ctx.turnId, parentToolCallId, agentTypeId)
        const toolCallsSummary = result.toolCalls
          ?.map((tc) => `- ${tc.name}${tc.durationMs ? ` (${tc.durationMs}ms)` : ''}`)
          .join('\n')
        const metadata: Record<string, unknown> = {
          ...(result.tokensUsed !== undefined ? { tokensUsed: result.tokensUsed } : {}),
          ...(result.toolCalls ? { subagentToolCalls: result.toolCalls } : {}),
          ...(result.agentType ? { agentType: result.agentType } : {}),
          ...(result.filesRead ? { filesRead: result.filesRead } : {}),
          ...(result.filesChanged ? { filesChanged: result.filesChanged } : {})
        }
        const filesInfo = [
          result.filesRead?.length ? `read ${result.filesRead.length} file(s)` : '',
          result.filesChanged?.length ? `changed ${result.filesChanged.length} file(s)` : ''
        ].filter(Boolean).join(', ')
        const header = `[${result.agentType ?? 'subagent'}: ${result.toolCalls?.length ?? 0} tool(s)${filesInfo ? `, ${filesInfo}` : ''}]`
        const content = `${header}\n${toolCallsSummary ? toolCallsSummary + '\n\n' : ''}${result.text}`
        return { content, metadata }
      } catch (err) {
        return {
          content: `Subagent failed: ${err instanceof Error ? err.message : String(err)}`,
          isError: true
        }
      }
    }
  }
  registry.register(definition, executor)
}

// ─── MCP tool proxy ─────────────────────────────────────────────────────────

import type { McpManager } from './mcp-manager'

export function registerMcpTools(
  registry: ToolRegistry,
  mcpManager: McpManager
): void {
  for (const mcpTool of mcpManager.getTools()) {
    const definition: ToolDefinition = {
      name: mcpTool.qualifiedName,
      description: mcpTool.description,
      parameters: mcpTool.inputSchema as ToolDefinition['parameters'],
      permission: 'system'
    }
    const executor: ToolExecutor = {
      async execute(_name, args): Promise<ToolExecutionResult> {
        const result = await mcpManager.callTool(
          mcpTool.serverName,
          mcpTool.name,
          args
        )
        return {
          content: result.content,
          isError: result.isError
        }
      }
    }
    registry.register(definition, executor)
  }
}

// ─── Registration ────────────────────────────────────────────────────────────

// ─── sleep (pacing for autonomous/overnight runs) ────────────────────────────
const sleepTool: CodingTool = {
  definition: {
    name: 'sleep',
    description:
      'Pace yourself during an autonomous/overnight run: request to WAIT before your next iteration ' +
      '(e.g. while a build/test/deploy finishes, or when there is nothing to do right now). Give a short ' +
      'reason. The loop honours this delay and wakes early if the user steps in. Outside autonomous mode it ' +
      'is a no-op. Do not emit "still waiting" filler — call sleep instead.',
    parameters: {
      type: 'object',
      properties: {
        seconds: { type: 'number', description: 'Seconds to wait before the next iteration (0–300).' },
        reason: { type: 'string', description: 'Why you are pausing (shown to the user).' }
      },
      required: ['seconds']
    },
    permission: 'read'
  },
  executor: {
    async execute(_name, args): Promise<ToolExecutionResult> {
      const ms = clampSleepSeconds(args.seconds)
      const secs = Math.round(ms / 1000)
      const reason = typeof args.reason === 'string' && args.reason.trim() ? `：${args.reason.trim()}` : ''
      // The actual wait happens between iterations in the nightwatch loop, which
      // reads this requested duration from the tool call; the tool only records
      // intent so it stays observable in the trace.
      return { content: `将在下一轮前等待约 ${secs}s${reason}`, metadata: { sleepMs: ms } }
    }
  }
}

const ALL_TOOLS: readonly CodingTool[] = [
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  bashTool,
  grepTool,
  editTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitCommitTool,
  memoryReadTool,
  memoryWriteTool,
  sleepTool
]

/**
 * Register the standard coding toolset (read_file, write_file,
 * list_directory, bash) on the supplied {@link ToolRegistry}.
 */
export function registerCodingTools(registry: ToolRegistry): void {
  for (const tool of ALL_TOOLS) {
    registry.register(tool.definition, tool.executor)
  }
}

/**
 * Register the `understand_system` tool — lets the main agent query the Code Map
 * Brain for module-level understanding (dependencies, health, decisions, blast
 * radius) without needing the separate BrainChat UI.
 */
export function registerComprehensionTool(
  registry: ToolRegistry,
  getWorkingDirectory: () => string
): void {
  const def: ToolDefinition = {
    name: 'understand_system',
    description:
      'Query the workspace\'s system map for module-level understanding. ' +
      'Returns module dependencies, health status, recent changes, coupling, and decision history. ' +
      'Use when the user asks about architecture, dependencies, what changed, or blast radius.',
    parameters: {
      type: 'object' as const,
      properties: {
        question: {
          type: 'string' as const,
          description: 'The question to answer about the system (e.g. "what depends on auth?", "what changed recently?")'
        }
      },
      required: ['question']
    },
    permission: 'read' as const
  }

  const executor: ToolExecutor = {
    async execute(_toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
      const question = (args.question as string) ?? ''
      const cwd = getWorkingDirectory()
      try {
        const { gatherEvidence } = await import('../shared/brain-qa')
        const { buildCodeMap } = await import('../shared/code-map')
        const { parseGitLog } = await import('../shared/git-brain')
        const { promises: fsp } = await import('node:fs')
        const { execFile: execFileCb } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execFileAsync = promisify(execFileCb)
        const nodePath = await import('node:path')

        // Scan the code map
        const { getCachedCodeMap, scanCodeMap } = await import('./code-map-scan')
        const map = getCachedCodeMap(cwd) ?? await scanCodeMap(cwd).catch(() => buildCodeMap([]))

        // Load decisions + git commits
        let decisions: import('../shared/types').GateDecision[] = []
        try {
          decisions = JSON.parse(await fsp.readFile(nodePath.join(cwd, '.kairo', 'decisions.json'), 'utf-8'))
        } catch { /* no decisions */ }

        let commits: ReturnType<typeof parseGitLog> = []
        try {
          const { stdout: raw } = await execFileAsync('git', [
            'log', '--no-merges', '-20', '--name-only',
            '--pretty=format:%x01%H%x1f%at%x1f%an%x1f%s'
          ], { cwd, encoding: 'utf-8', timeout: 5000 })
          commits = parseGitLog(raw)
        } catch { /* not a git repo */ }

        let changes: import('../shared/map-delta').ChangeRecord[] = []
        try {
          changes = JSON.parse(await fsp.readFile(nodePath.join(cwd, '.kairo', 'changes.json'), 'utf-8'))
        } catch { /* no changes */ }

        const evidence = gatherEvidence(question, { map, decisions, commits, changes })
        const lines = evidence.items.map((e) => `[${e.id}] (${e.kind}) ${e.text}`)

        // Extract module IDs from evidence and notify the renderer to focus the map.
        const mentionedModules = [...new Set(evidence.items.flatMap((e) =>
          [e.module, ...(e.file ? [e.file.split('/').slice(0, -1).join('/')] : [])].filter(Boolean) as string[]
        ))]
        if (mentionedModules.length > 0) {
          const { BrowserWindow } = await import('electron')
          const win = BrowserWindow.getAllWindows()[0]
          if (win) win.webContents.send('kairo:focusModules', mentionedModules)
        }

        return {
          content: lines.length > 0
            ? `Found ${lines.length} evidence items for "${question}":\n${lines.join('\n')}`
            : `No evidence found for "${question}" in the system map.`,
          isError: false
        }
      } catch (err) {
        return { content: `Error querying system map: ${err instanceof Error ? err.message : String(err)}`, isError: true }
      }
    }
  }

  registry.register(def, executor)
}
