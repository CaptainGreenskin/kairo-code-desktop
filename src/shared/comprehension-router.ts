/**
 * Comprehension Router — decides, per tool call during a crew run, whether to
 * AUTO-run or ESCALATE (ask the human). The point is to spend the human's
 * scarce attention only where their JUDGMENT matters, not on every write
 * (which just trains rubber-stamping).
 *
 * Routing:
 *   - read-only tools            → auto
 *   - write/edit in a normal path → auto (reversible; surfaced in the Change Lens)
 *   - write/edit in a PROTECTED   → ask   (touches an invariant region)
 *   - shell / commit / anything   → ask   (operational/irreversible; no sandbox)
 */

export type RoutingDecision = 'auto' | 'ask'

export interface RoutingResult {
  decision: RoutingDecision
  reason?: string
}

export interface RoutingConfig {
  /** Path globs where human judgment is required (invariant regions). */
  protectedGlobs: string[]
}

/** Default invariant regions — the places a wrong change hurts most. */
export const DEFAULT_PROTECTED_GLOBS = [
  '**/auth/**',
  '**/payment*/**',
  '**/billing/**',
  '**/migrations/**',
  '**/migration/**',
  '**/security/**',
  '**/*secret*',
  '**/.env*',
  '**/credentials*'
]

const READ_ONLY_TOOLS = new Set([
  'read_file', 'list_directory', 'grep', 'git_status', 'git_diff', 'git_log', 'memory_read'
])
const WRITE_TOOLS = new Set(['write_file', 'edit'])

/** Convert a simple glob (`**` = any incl. `/`, `*` = any except `/`) to a RegExp. */
function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++ // consume the slash after **
      } else {
        re += '[^/]*'
      }
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      re += '\\' + c
    } else {
      re += c
    }
  }
  return new RegExp('^' + re + '$', 'i')
}

export function isProtectedPath(path: string, globs: string[]): boolean {
  const norm = path.replace(/\\/g, '/').replace(/^\.\//, '')
  return globs.some((g) => globToRegExp(g).test(norm))
}

function fileArg(args: Record<string, unknown>): string {
  const p = args.path ?? args.file ?? args.filePath
  return typeof p === 'string' ? p : ''
}

/** Decide how a single tool call should be routed. */
export function routeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  config: RoutingConfig
): RoutingResult {
  if (READ_ONLY_TOOLS.has(toolName)) return { decision: 'auto' }

  if (WRITE_TOOLS.has(toolName)) {
    const path = fileArg(args)
    if (path && isProtectedPath(path, config.protectedGlobs)) {
      return { decision: 'ask', reason: `Touches a protected region: ${path}` }
    }
    return { decision: 'auto' }
  }

  // Shell, commits, deletions, and any other non-read tool: no sandbox here,
  // so these are escalated as potentially irreversible.
  return { decision: 'ask', reason: `Irreversible/operational tool: ${toolName}` }
}
