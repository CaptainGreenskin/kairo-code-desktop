/**
 * Behavior Delta — derives *observable* behavior changes from a crew run's edit
 * activity, statically (from the before/after text the tools already carry), not
 * from prose. It answers "what behavior changed?" rather than "what lines moved":
 * the public export surface (added / removed / changed signatures), newly
 * introduced side effects (network / fs / process / throw), and route/endpoint
 * changes. Pure + browser-safe so the renderer and the Comprehension Gate can
 * both consume it.
 *
 * Source of truth: the `edit` tool carries `replacements[{oldText,newText}]`
 * (a real before/after), and `write_file` carries the full `content`. We need no
 * git and no disk read.
 */

export type BehaviorSignalKind =
  | 'api-added'
  | 'api-removed'
  | 'api-changed'
  | 'return-shape'
  | 'side-effect'
  | 'route'

export interface BehaviorSignal {
  kind: BehaviorSignalKind
  /** File the signal was observed in (relative path). */
  file: string
  /** Glanceable description, e.g. "导出 parseConfig" or "新增 fetch()". */
  detail: string
  /** The identifier this signal concerns (export/return key), for locating it. */
  name?: string
  /** The exact line(s) that triggered this signal — answer-in-place, not the
   * whole diff. `before` is the removed/old side, `after` the added/new side. */
  before?: string
  after?: string
}

/** Minimal shape of a crew tool record this analyzer reads. */
export interface ChangeRecordLike {
  toolName: string
  args: Record<string, unknown>
}

const MAX_SIGNALS = 8

/** Risky calls whose *introduction* changes observable behavior. */
const SIDE_EFFECTS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(fetch|axios)\s*\(/, label: '新增网络调用' },
  { re: /\b(readFile|writeFile|appendFile|unlink|mkdir|rmdir|rm)\b|\bfs\.\w+/, label: '新增文件系统操作' },
  { re: /\bexec(Sync)?\s*\(|\bspawn(Sync)?\s*\(/, label: '新增子进程' },
  { re: /process\.env\b/, label: '新增环境变量读取' },
  { re: /\b(localStorage|sessionStorage)\b/, label: '新增本地存储' },
  { re: /\bthrow\s+/, label: '新增抛错路径' }
]

/** Route/endpoint registrations whose change alters the surface. */
const ROUTE_RES: RegExp[] = [
  /\.(get|post|put|delete|patch)\s*\(\s*['"`]/i,
  /@(Get|Post|Put|Delete|Patch|RequestMapping)\s*\(/,
  /(app|router)\.(use|route|all)\s*\(/
]

function lines(s: string): string[] {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/** Map of exported identifier → its declaration line, parsed from source lines. */
function exportedNames(src: string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of src) {
    const decl = line.match(
      /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_$]+)/
    )
    if (decl?.[1]) {
      out.set(decl[1], line)
      continue
    }
    const named = line.match(/^export\s*\{([^}]*)\}/)
    if (named?.[1]) {
      for (const part of named[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/i).pop()?.trim()
        if (name) out.set(name, line)
      }
    }
  }
  return out
}

/** Brace-balanced bodies of every `return { ... }` literal (multi-line, nested). */
function returnBlocks(text: string): string[] {
  const blocks: string[] = []
  const re = /return\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const open = m.index + m[0].length - 1 // index of the '{'
    let depth = 0
    for (let i = open; i < text.length; i++) {
      const c = text[i]
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          blocks.push(text.slice(open + 1, i))
          re.lastIndex = i + 1
          break
        }
      }
    }
  }
  return blocks
}

/** Top-level keys of an object-literal body, ignoring nested braces/brackets/parens. */
function topLevelKeys(body: string): string[] {
  const keys: string[] = []
  let depth = 0
  let cur = ''
  const flush = (): void => {
    const key = cur.split(':')[0]!.trim()
    if (/^[A-Za-z0-9_$]+$/.test(key)) keys.push(key)
    cur = ''
  }
  for (const c of body) {
    if ('([{'.includes(c)) {
      depth++
      cur += c
    } else if (')]}'.includes(c)) {
      depth--
      cur += c
    } else if (c === ',' && depth === 0) {
      flush()
    } else {
      cur += c
    }
  }
  flush()
  return keys
}

/** Top-level keys of every `return { ... }` literal in a snippet. */
function returnKeys(text: string): Set<string> {
  const keys = new Set<string>()
  for (const body of returnBlocks(text)) {
    for (const k of topLevelKeys(body)) keys.add(k)
  }
  return keys
}

/** Detect a changed return-object shape between a replacement's before/after. */
function returnShapeSignal(file: string, oldText: string, newText: string): BehaviorSignal | null {
  const oldK = returnKeys(oldText)
  const newK = returnKeys(newText)
  if (oldK.size === 0 && newK.size === 0) return null
  const added = [...newK].filter((k) => !oldK.has(k))
  const removed = [...oldK].filter((k) => !newK.has(k))
  if (added.length === 0 && removed.length === 0) return null
  const parts: string[] = []
  if (added.length) parts.push(`+${added.join(',')}`)
  if (removed.length) parts.push(`-${removed.join(',')}`)
  const firstReturn = (t: string): string | undefined => {
    const i = t.indexOf('return')
    if (i === -1) return undefined
    const line = t.slice(i).split('\n')[0]!.trim()
    return line.length > 120 ? line.slice(0, 120) + '…' : line
  }
  return {
    kind: 'return-shape',
    file,
    detail: `返回结构变化：${parts.join(' ')}`,
    name: added[0] ?? removed[0],
    ...(firstReturn(oldText) ? { before: firstReturn(oldText) } : {}),
    ...(firstReturn(newText) ? { after: firstReturn(newText) } : {})
  }
}

function diffLines(added: string[], removed: string[]): { netAdded: string[]; netRemoved: string[] } {
  const addedSet = new Set(added)
  const removedSet = new Set(removed)
  return {
    netAdded: added.filter((l) => !removedSet.has(l)),
    netRemoved: removed.filter((l) => !addedSet.has(l))
  }
}

function analyzeEdit(file: string, added: string[], removed: string[]): BehaviorSignal[] {
  const out: BehaviorSignal[] = []
  const { netAdded, netRemoved } = diffLines(added, removed)

  // Export surface: compare exported identifiers on each side.
  const addedExp = exportedNames(netAdded)
  const removedExp = exportedNames(netRemoved)
  for (const [name, line] of addedExp) {
    if (removedExp.has(name)) {
      if (removedExp.get(name) !== line) {
        out.push({ kind: 'api-changed', file, detail: `导出 ${name} 的签名/形状变化`, name, before: removedExp.get(name), after: line })
      }
    } else {
      out.push({ kind: 'api-added', file, detail: `新增导出 ${name}`, name, after: line })
    }
  }
  for (const [name, line] of removedExp) {
    if (!addedExp.has(name)) {
      out.push({ kind: 'api-removed', file, detail: `删除/改名导出 ${name}`, name, before: line })
    }
  }

  // Side effects newly introduced (present in added, absent from removed).
  const addedText = netAdded.join('\n')
  const removedText = netRemoved.join('\n')
  for (const { re, label } of SIDE_EFFECTS) {
    if (re.test(addedText) && !re.test(removedText)) {
      out.push({ kind: 'side-effect', file, detail: label })
    }
  }

  // Route/endpoint changes.
  const routeAdded = ROUTE_RES.some((re) => re.test(addedText))
  const routeRemoved = ROUTE_RES.some((re) => re.test(removedText))
  if (routeAdded && !routeRemoved) out.push({ kind: 'route', file, detail: '新增路由/端点' })
  else if (routeRemoved && !routeAdded) out.push({ kind: 'route', file, detail: '移除路由/端点' })

  return out
}

function analyzeWrite(file: string, content: string[]): BehaviorSignal[] {
  // A freshly written file has no "before", so exports are expected and low
  // signal — only surface newly-present side effects and routes.
  const out: BehaviorSignal[] = []
  const text = content.join('\n')
  for (const { re, label } of SIDE_EFFECTS) {
    if (re.test(text)) out.push({ kind: 'side-effect', file, detail: label })
  }
  if (ROUTE_RES.some((re) => re.test(text))) {
    out.push({ kind: 'route', file, detail: '新增路由/端点' })
  }
  return out
}

function editReplacements(args: Record<string, unknown>): Array<{ oldText: string; newText: string }> {
  const reps = Array.isArray(args.replacements) ? args.replacements : []
  return reps
    .map((r) => {
      const o = (r as Record<string, unknown>)?.oldText
      const n = (r as Record<string, unknown>)?.newText
      return { oldText: typeof o === 'string' ? o : '', newText: typeof n === 'string' ? n : '' }
    })
    .filter((r) => r.oldText || r.newText)
}

function fileArg(args: Record<string, unknown>): string {
  const p = args.path ?? args.file ?? args.filePath
  return typeof p === 'string' ? p.replace(/\\/g, '/').replace(/^\.\//, '') : ''
}

/** Derive behavior-change signals from a crew run's tool records. */
export function analyzeBehaviorDelta(records: ChangeRecordLike[]): BehaviorSignal[] {
  const signals: BehaviorSignal[] = []

  for (const rec of records) {
    const file = fileArg(rec.args)
    if (!file) continue
    if (rec.toolName === 'edit') {
      const reps = editReplacements(rec.args)
      const added = reps.flatMap((r) => lines(r.newText))
      const removed = reps.flatMap((r) => lines(r.oldText))
      signals.push(...analyzeEdit(file, added, removed))
      // Return-shape needs per-replacement before/after (a contiguous block).
      for (const r of reps) {
        const sig = returnShapeSignal(file, r.oldText, r.newText)
        if (sig) signals.push(sig)
      }
    } else if (rec.toolName === 'write_file') {
      const content = typeof rec.args.content === 'string' ? rec.args.content : ''
      if (content) signals.push(...analyzeWrite(file, lines(content)))
    }
  }

  // De-dupe (kind+file+detail) and cap.
  const seen = new Set<string>()
  const deduped: BehaviorSignal[] = []
  for (const s of signals) {
    const key = `${s.kind}|${s.file}|${s.detail}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(s)
    if (deduped.length >= MAX_SIGNALS) break
  }
  return deduped
}

/** True for signals that likely break callers (contract removed or changed). */
export function isBreaking(sig: BehaviorSignal): boolean {
  return sig.kind === 'api-removed' || sig.kind === 'api-changed'
}
