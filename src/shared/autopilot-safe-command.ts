/**
 * Overnight bash allowlist (positive security). When unattended, a bash call
 * normally auto-denies after the approval timeout — which keeps the agent safe
 * but unable to build/test. This lets a NARROW, known-safe set of commands
 * auto-run overnight (build/test/lint/read + read-only git), while everything
 * else (network, push/commit, package install scripts, redirection, command
 * substitution, fs mutation) stays blocked. Default-deny: false negatives are
 * fine, false positives are not. Combined with the catastrophic-command guard,
 * this is the second safety layer for unattended autonomy. Pure + browser-safe.
 */

/** Programs that are inherently safe to run unattended (no net, no fs-destroy). */
const SAFE_PROGRAMS = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'sort', 'uniq', 'echo', 'pwd', 'date',
  'grep', 'rg', 'find', 'diff', 'tree', 'which', 'env', 'true',
  'tsc', 'eslint', 'prettier', 'biome', 'vitest', 'jest', 'mocha', 'pytest', 'ruff', 'mypy'
])

/** Package managers: only their read/build/test subcommands are safe. */
const PM_SAFE_SUB: Record<string, Set<string>> = {
  npm: new Set(['test', 'run', 'lint', 'typecheck', 'build', 'ls', 'why']),
  pnpm: new Set(['test', 'run', 'lint', 'typecheck', 'build', 'ls', 'why']),
  yarn: new Set(['test', 'run', 'lint', 'typecheck', 'build']),
  bun: new Set(['test', 'run', 'build', 'x'])
}

/** git: only read-only / non-destructive subcommands (no commit/push/reset). */
const GIT_SAFE_SUB = new Set(['status', 'diff', 'log', 'show', 'branch', 'add', 'stash'])

/** Shell features that make a command's effect un-analyzable → never auto-run. */
// Note: `(?<!&)&(?!&)` matches a lone background `&` but NOT the `&&` operator.
const DANGEROUS_SHELL = /[`]|\$\(|>>?|<|(?<!&)&(?!&)|\bsudo\b|\bnc\b|\bssh\b|\bscp\b|\bcurl\b|\bwget\b/

function segmentSafe(segment: string): boolean {
  const tokens = segment.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const prog = tokens[0]!.replace(/^.*\//, '') // strip path prefix
  const sub = tokens[1]
  if (SAFE_PROGRAMS.has(prog)) return true
  if (prog in PM_SAFE_SUB) return sub != null && PM_SAFE_SUB[prog]!.has(sub)
  if (prog === 'git') return sub != null && GIT_SAFE_SUB.has(sub)
  return false
}

/**
 * Is this shell command safe to auto-run unattended? Every `&&`/`||`/`;`/`|`
 * segment must be on the allowlist, and the command must use no un-analyzable
 * shell features (redirection, substitution, network tools, sudo).
 */
export function isAutopilotSafeCommand(command: string): boolean {
  const cmd = command.trim()
  if (!cmd) return false
  if (DANGEROUS_SHELL.test(cmd)) return false
  const segments = cmd.split(/&&|\|\||;|\|/)
  return segments.every(segmentSafe)
}
