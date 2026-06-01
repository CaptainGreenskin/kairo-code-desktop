/**
 * Code System Map model — turns source files + their imports into a module
 * dependency graph. The map IS the real system (derived from actual imports),
 * not a decorative diagram. Pure + browser-safe (no node deps).
 */

export interface CodeModule {
  /** Module id = the file's directory, relative + normalized (e.g. 'src/main'). */
  id: string
  label: string
  fileCount: number
  loc: number
  /** Relative paths of the files in this module (for drill-down). */
  files: string[]
}

/** A concrete reason an edge exists: which file imported which target. */
export interface CodeMapRef {
  /** Importing file (relative path). */
  file: string
  /** What it imported (resolved target path / FQN / specifier). */
  imports: string
}

export interface CodeMapEdge {
  from: string
  to: string
  /** Number of cross-module import references. */
  weight: number
  /** A few concrete references that explain the edge (capped). */
  refs?: CodeMapRef[]
}

export interface CodeMap {
  modules: CodeModule[]
  edges: CodeMapEdge[]
}

/**
 * Transitive blast radius: starting from the changed (`seed`) modules, walk the
 * dependency graph *backwards* (an edge `from → to` means `from` imports `to`,
 * so if `to` changed, `from` is impacted) to find every downstream module that
 * could be affected, with its distance in hops. Seeds map to depth 0; their
 * direct importers to 1; and so on. Pure + deterministic.
 *
 * This serves the constitution's "system > diff": the human sees not just what
 * changed, but the whole region that *could* break because of it.
 */
export function transitiveImpact(edges: CodeMapEdge[], seeds: string[]): Map<string, number> {
  // to → [from...] : who imports `to` (its dependents).
  const dependents = new Map<string, string[]>()
  for (const e of edges) {
    const arr = dependents.get(e.to)
    if (arr) arr.push(e.from)
    else dependents.set(e.to, [e.from])
  }
  const depth = new Map<string, number>()
  const queue: string[] = []
  for (const s of seeds) {
    if (!depth.has(s)) {
      depth.set(s, 0)
      queue.push(s)
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!
    const d = depth.get(cur)!
    for (const dep of dependents.get(cur) ?? []) {
      if (!depth.has(dep)) {
        depth.set(dep, d + 1)
        queue.push(dep)
      }
    }
  }
  return depth
}

export interface SourceFile {
  /** Path relative to the workspace root, using '/' separators. */
  path: string
  content: string
}

/** A file-level import edge: `from` imports `to` (both relative paths). */
export interface FileEdge {
  from: string
  to: string
}

/**
 * Per-file extraction result — the expensive part of building the map (reading
 * + parsing). Caching these (keyed by mtime/size) lets large-repo rescans skip
 * unchanged files and only re-assemble the cheap graph. See `code-map-scan.ts`.
 */
export type SourceLang = 'js' | 'java' | 'py' | 'go' | 'other'

export interface FileFacts {
  /** Path relative to the workspace root, normalized to '/' separators. */
  path: string
  loc: number
  imports: string[]
  /** Language family, decides how imports resolve to modules. */
  lang: SourceLang
  /** Hidden-coupling signals (shared DB tables, events, HTTP routes, flags). */
  signals: CouplingSignal[]
}

/**
 * A non-import coupling signal. Two modules that touch the same table / event
 * topic / HTTP route / feature flag are coupled even with NO import edge — and
 * those are the breakages the import graph can't see.
 */
export type CouplingKind = 'table' | 'event' | 'http' | 'flag'
export interface CouplingSignal {
  kind: CouplingKind
  /** The shared identifier (table name, topic, route, flag), lower-cased. */
  key: string
}

/** Classify a file by extension into an import-resolution family. */
export function langOf(path: string): SourceLang {
  const p = norm(path).toLowerCase()
  if (/\.(tsx|ts|jsx|js|mjs|cjs)$/.test(p)) return 'js'
  if (p.endsWith('.java')) return 'java'
  if (p.endsWith('.py')) return 'py'
  if (p.endsWith('.go')) return 'go'
  return 'other'
}

/** Extract the cacheable facts (loc + imports + coupling signals) from a file. */
export function toFileFacts(file: SourceFile): FileFacts {
  const lang = langOf(file.path)
  return {
    path: norm(file.path),
    loc: file.content ? file.content.split('\n').length : 0,
    imports: extractImports(file.content, lang),
    lang,
    signals: extractCouplingSignals(file.content)
  }
}

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function dirOf(path: string): string {
  const p = norm(path)
  const i = p.lastIndexOf('/')
  return i === -1 ? '(root)' : p.slice(0, i)
}

/** Resolve a relative import specifier against the importing file's path. */
export function resolveImport(fromPath: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null // external package — not part of the map
  const fromDir = dirOf(fromPath)
  const parts = (fromDir === '(root)' ? [] : fromDir.split('/')).concat(spec.split('/'))
  const out: string[] = []
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

const IMPORT_RE =
  /(?:import\s[^'"]*?from\s*|import\s*|export\s[^'"]*?from\s*|require\(\s*)['"]([^'"]+)['"]/g

/** `import com.foo.Bar;` / `import static com.foo.Bar.baz;` (Java FQN imports). */
const JAVA_IMPORT_RE = /^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm

/** Python: `from a.b import c` / `import a.b, c` (incl. relative `.`/`..`). */
const PY_FROM_RE = /^\s*from\s+(\.*[\w.]*)\s+import\b/gm
const PY_IMPORT_RE = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm

/** Go: `import "x/y/z"` and block `import ( "a/b" \n "c/d" )`. */
const GO_BLOCK_RE = /import\s*\(([\s\S]*?)\)/g
const GO_STR_RE = /(?:^|\s)import\s+"([^"]+)"/gm
const GO_INBLOCK_RE = /"([^"]+)"/g

function extractPython(content: string): string[] {
  const specs: string[] = []
  let m: RegExpExecArray | null
  PY_FROM_RE.lastIndex = 0
  while ((m = PY_FROM_RE.exec(content)) !== null) {
    if (m[1]) specs.push(m[1])
  }
  PY_IMPORT_RE.lastIndex = 0
  while ((m = PY_IMPORT_RE.exec(content)) !== null) {
    for (const part of m[1]!.split(',')) {
      const s = part.trim().split(/\s+as\s+/)[0]!.trim()
      if (s) specs.push(s)
    }
  }
  return specs
}

function extractGo(content: string): string[] {
  const specs: string[] = []
  let m: RegExpExecArray | null
  GO_BLOCK_RE.lastIndex = 0
  while ((m = GO_BLOCK_RE.exec(content)) !== null) {
    let g: RegExpExecArray | null
    GO_INBLOCK_RE.lastIndex = 0
    while ((g = GO_INBLOCK_RE.exec(m[1]!)) !== null) {
      if (g[1]) specs.push(g[1])
    }
  }
  GO_STR_RE.lastIndex = 0
  while ((m = GO_STR_RE.exec(content)) !== null) {
    if (m[1]) specs.push(m[1])
  }
  return specs
}

/** Extract import specifiers from a source file's content, per language. */
export function extractImports(content: string, lang: SourceLang = 'js'): string[] {
  const specs: string[] = []
  let m: RegExpExecArray | null
  if (lang === 'java') {
    JAVA_IMPORT_RE.lastIndex = 0
    while ((m = JAVA_IMPORT_RE.exec(content)) !== null) {
      if (m[1]) specs.push(m[1])
    }
    return specs
  }
  if (lang === 'py') return extractPython(content)
  if (lang === 'go') return extractGo(content)
  if (lang === 'other') return []
  IMPORT_RE.lastIndex = 0
  while ((m = IMPORT_RE.exec(content)) !== null) {
    if (m[1]) specs.push(m[1])
  }
  return specs
}

/**
 * Build the module dependency map. Modules are file directories; an edge
 * `from → to` exists when a file in `from` imports a file in `to`.
 */
export function buildCodeMap(files: SourceFile[]): CodeMap {
  return buildCodeMapFromFacts(files.map(toFileFacts))
}

/**
 * Assemble the module dependency map from already-extracted per-file facts.
 * This is the cheap half of the scan (no I/O, no regex over file content), so
 * an incremental scanner can call it on every refresh while reusing cached
 * {@link FileFacts} for unchanged files.
 */
export function buildCodeMapFromFacts(facts: FileFacts[]): CodeMap {
  const modules = new Map<string, { fileCount: number; loc: number; files: string[] }>()
  const edgeW = new Map<string, number>() // "from to" → weight

  // Resolved target → its module, for import resolution. We don't have the real
  // file extension, so map by stripped path prefix.
  const fileDirByStripped = new Map<string, string>()
  // Java index: class name -> candidate files, so an FQN import (`com.foo.Bar`)
  // maps to the dir whose path ends with `com/foo/Bar`.
  const javaByClass = new Map<string, Array<{ stripped: string; dir: string }>>()
  // Python files (stripped of .py) and every module dir, for dir/file suffix
  // matching used by Python + Go import resolution.
  const pyFiles: Array<{ stripped: string; dir: string }> = []
  const allDirs = new Set<string>()
  for (const f of facts) {
    const p = norm(f.path)
    allDirs.add(dirOf(p))
    if (f.lang === 'java') {
      const stripped = p.replace(/\.java$/, '')
      const cls = stripped.slice(stripped.lastIndexOf('/') + 1)
      const list = javaByClass.get(cls) ?? []
      list.push({ stripped, dir: dirOf(p) })
      javaByClass.set(cls, list)
    } else if (f.lang === 'py') {
      pyFiles.push({ stripped: p.replace(/\.py$/, ''), dir: dirOf(p) })
    } else if (f.lang === 'js') {
      const stripped = p.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, '')
      fileDirByStripped.set(stripped, dirOf(p))
    }
  }
  const dirList = [...allDirs]
  const matchDir = (target: string): string | null =>
    dirList.find((d) => d === target || d.endsWith(`/${target}`)) ?? null

  const resolveJava = (fqn: string): string | null => {
    const parts = fqn.split('.')
    const cls = parts[parts.length - 1]!
    const fqnPath = parts.join('/')
    const cands = javaByClass.get(cls)
    if (!cands) return null
    const hit = cands.find((c) => c.stripped === fqnPath || c.stripped.endsWith(`/${fqnPath}`))
    return hit?.dir ?? null
  }

  const resolvePyTarget = (target: string): string | null => {
    if (!target) return null
    const fileHit = pyFiles.find((c) => c.stripped === target || c.stripped.endsWith(`/${target}`))
    if (fileHit) return fileHit.dir
    const dirHit = matchDir(target)
    if (dirHit) return dirHit
    const parent = target.split('/').slice(0, -1).join('/') // `from a.b import C` → pkg a/b
    return parent ? matchDir(parent) : null
  }

  const resolvePy = (spec: string, fromPath: string): string | null => {
    if (spec.startsWith('.')) {
      const dots = spec.length - spec.replace(/^\.+/, '').length
      const fromDir = dirOf(fromPath)
      const base = fromDir === '(root)' ? [] : fromDir.split('/')
      for (let i = 1; i < dots; i++) base.pop()
      const rest = spec.slice(dots).split('.').filter(Boolean)
      return resolvePyTarget(base.concat(rest).join('/'))
    }
    return resolvePyTarget(spec.replace(/\./g, '/'))
  }

  const resolveGo = (spec: string): string | null => {
    const parts = spec.split('/')
    // Import paths carry a module prefix (github.com/me/proj/…); try the
    // longest tail first so we match the in-repo package dir.
    for (let i = 0; i < parts.length; i++) {
      const hit = matchDir(parts.slice(i).join('/'))
      if (hit) return hit
    }
    return null
  }

  for (const f of facts) {
    const p = norm(f.path)
    const dir = dirOf(p)
    const cur = modules.get(dir) ?? { fileCount: 0, loc: 0, files: [] }
    cur.fileCount += 1
    cur.loc += f.loc
    cur.files.push(p)
    modules.set(dir, cur)

    for (const spec of f.imports) {
      let targetDir: string | null
      if (f.lang === 'java') {
        targetDir = resolveJava(spec)
      } else if (f.lang === 'py') {
        targetDir = resolvePy(spec, p)
      } else if (f.lang === 'go') {
        targetDir = resolveGo(spec)
      } else {
        const resolved = resolveImport(p, spec)
        if (resolved == null) continue
        // The resolved path may omit extension or point at an index file.
        targetDir =
          fileDirByStripped.get(resolved) ??
          fileDirByStripped.get(`${resolved}/index`) ??
          dirOf(resolved)
      }
      if (!targetDir || targetDir === dir) continue
      const key = `${dir} ${targetDir}`
      edgeW.set(key, (edgeW.get(key) ?? 0) + 1)
    }
  }

  const moduleList: CodeModule[] = [...modules.entries()]
    .map(([id, v]) => ({ id, label: id, fileCount: v.fileCount, loc: v.loc, files: v.files.sort() }))
    .sort((a, b) => b.fileCount - a.fileCount || a.id.localeCompare(b.id))

  const known = new Set(moduleList.map((m) => m.id))
  const edges: CodeMapEdge[] = [...edgeW.entries()]
    .map(([k, weight]) => {
      const [from, to] = k.split(' ') as [string, string]
      return { from, to, weight }
    })
    .filter((e) => known.has(e.from) && known.has(e.to))
    .sort((a, b) => b.weight - a.weight)

  return { modules: moduleList, edges }
}

/**
 * File-level dependency graph (finer than the module map). The module map
 * collapses a whole directory; this answers "who imports *this file*". JS/TS,
 * Java and Python resolve to concrete files; Go (package-path based) stays
 * module-level and is omitted here. Pure + deterministic.
 */
export function buildFileGraph(facts: FileFacts[]): FileEdge[] {
  const jsByStripped = new Map<string, string>() // stripped path → real path
  const javaByClass = new Map<string, Array<{ stripped: string; path: string }>>()
  const pyByStripped = new Map<string, string>()
  for (const f of facts) {
    const p = norm(f.path)
    if (f.lang === 'js') jsByStripped.set(p.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, ''), p)
    else if (f.lang === 'java') {
      const stripped = p.replace(/\.java$/, '')
      const cls = stripped.slice(stripped.lastIndexOf('/') + 1)
      const list = javaByClass.get(cls) ?? []
      list.push({ stripped, path: p })
      javaByClass.set(cls, list)
    } else if (f.lang === 'py') pyByStripped.set(p.replace(/\.py$/, ''), p)
  }
  const resolveJavaFile = (fqn: string): string | null => {
    const parts = fqn.split('.')
    const fqnPath = parts.join('/')
    const cands = javaByClass.get(parts[parts.length - 1]!)
    return cands?.find((c) => c.stripped === fqnPath || c.stripped.endsWith(`/${fqnPath}`))?.path ?? null
  }
  const resolvePyFile = (spec: string, fromPath: string): string | null => {
    let target: string
    if (spec.startsWith('.')) {
      const dots = spec.length - spec.replace(/^\.+/, '').length
      const base = dirOf(fromPath) === '(root)' ? [] : dirOf(fromPath).split('/')
      for (let i = 1; i < dots; i++) base.pop()
      target = base.concat(spec.slice(dots).split('.').filter(Boolean)).join('/')
    } else target = spec.replace(/\./g, '/')
    return pyByStripped.get(target) ?? null
  }

  const seen = new Set<string>()
  const fileEdges: FileEdge[] = []
  const add = (from: string, to: string): void => {
    if (to === from) return
    const key = `${from} ${to}`
    if (seen.has(key)) return
    seen.add(key)
    fileEdges.push({ from, to })
  }
  for (const f of facts) {
    const p = norm(f.path)
    for (const spec of f.imports) {
      let target: string | null = null
      if (f.lang === 'js') {
        const resolved = resolveImport(p, spec)
        if (resolved == null) continue
        target = jsByStripped.get(resolved) ?? jsByStripped.get(`${resolved}/index`) ?? null
      } else if (f.lang === 'java') target = resolveJavaFile(spec)
      else if (f.lang === 'py') target = resolvePyFile(spec, p)
      if (target) add(p, target)
    }
  }
  return fileEdges
}

/** Files that import the target file. */
export function fileImporters(edges: FileEdge[], target: string): string[] {
  const t = norm(target)
  return edges.filter((e) => e.to === t).map((e) => e.from).sort()
}

/** Files the target file imports. */
export function fileImports(edges: FileEdge[], target: string): string[] {
  const t = norm(target)
  return edges.filter((e) => e.from === t).map((e) => e.to).sort()
}

// Hidden-coupling patterns. High-signal across common stacks; precision-tuned
// (see the denylists + the event filter below) to keep false couplings out.
const COUPLING_PATTERNS: ReadonlyArray<{ kind: CouplingKind; re: RegExp }> = [
  // DB tables: knex/supabase .from('t') / .table('t'). The negative lookbehind
  // rejects JS built-ins (Array.from, Buffer.from, Object.from, …) which are
  // NOT database calls — the single biggest source of `.from()` noise.
  {
    kind: 'table',
    re: /(?<!\b(?:Array|Buffer|Object|Date|String|Number|Promise|Set|Map|WeakMap|WeakSet|Uint8Array|Int8Array|Uint16Array|Int16Array|Uint32Array|Int32Array|Float32Array|Float64Array|BigInt64Array|BigUint64Array|rxjs|of|from)\b)\.(?:from|table)\(\s*['"`]([a-zA-Z_][\w.]*)['"`]/g
  },
  { kind: 'table', re: /\bcollection\(\s*['"`]([a-zA-Z_][\w.]*)['"`]/g },
  { kind: 'table', re: /@Table\s*\(\s*name\s*=\s*['"]([a-zA-Z_][\w.]*)['"]/g },
  // Raw SQL — INSERT INTO is rare in prose; FROM/JOIN/UPDATE are common English
  // words, so we only trust them when the table name is quoted/backticked.
  { kind: 'table', re: /\bINSERT\s+INTO\s+([a-zA-Z_][\w.]*)/gi },
  { kind: 'table', re: /\b(?:FROM|JOIN|UPDATE\s+(?:TABLE\s+)?)[`'"]([a-zA-Z_][\w.]*)[`'"]/gi },
  // Events / message bus: emit/publish/subscribe carry domain topics; `.on`/
  // `.once` are also DOM/stream listeners, so their keys are filtered below.
  { kind: 'event', re: /\.(?:emit|on|once|publish|subscribe|dispatch)\(\s*['"`]([\w.:/-]+)['"`]/g },
  // HTTP routes: fetch/axios/app.get/@GetMapping("/path").
  { kind: 'http', re: /(?:fetch|axios(?:\.\w+)?|\.(?:get|post|put|delete|patch)|@(?:Get|Post|Put|Delete|Patch|Request)Mapping)\(\s*['"`](\/[\w/:{}.-]*)['"`]/g },
  // Feature flags.
  { kind: 'flag', re: /(?:flag|isEnabled|isFeatureEnabled|featureFlag|getFlag|useFlag)\(\s*['"`]([\w.:/-]+)['"`]/g }
]

/** Words that look like table names but aren't (cut FROM/JOIN/from() noise). */
const TABLE_NOISE = new Set(['select', 'where', 'set', 'values', 'dual', 'a', 'b', 'x', 'iterator', 'entries'])

/**
 * Generic DOM / Node-stream events that are listener plumbing, not domain
 * message-bus topics. Bare keys in this set are dropped so two unrelated UI
 * modules don't look "coupled" just because both listen for 'click'.
 */
const GENERIC_EVENTS = new Set([
  'click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'mouseenter', 'mouseleave', 'mouseover', 'mouseout',
  'keydown', 'keyup', 'keypress', 'change', 'input', 'submit', 'focus', 'blur', 'scroll', 'resize',
  'load', 'unload', 'beforeunload', 'error', 'close', 'open', 'data', 'end', 'finish', 'drain', 'readable',
  'message', 'connect', 'disconnect', 'ready', 'abort', 'timeout', 'response', 'request', 'visibilitychange',
  'hashchange', 'popstate', 'contextmenu', 'wheel', 'touchstart', 'touchend', 'touchmove', 'drag', 'drop',
  'dragover', 'dragenter', 'dragleave', 'paste', 'copy', 'cut', 'select', 'play', 'pause', 'ended', 'canplay',
  'progress', 'loadstart', 'loadend', 'animationend', 'transitionend', 'beforeinput', 'pointerdown', 'pointerup',
  'pointermove', 'closed', 'exit', 'spawn', 'tick'
])

/** A domain topic looks namespaced (order.paid, user:created) — keep those even
 * if a fragment collides with a DOM word; otherwise drop generic listeners. */
function isDomainEvent(key: string): boolean {
  if (/[.:/-]/.test(key)) return true
  return key.length >= 3 && !GENERIC_EVENTS.has(key)
}

/** Extract non-import coupling signals from a file's content. Pure. */
export function extractCouplingSignals(content: string): CouplingSignal[] {
  if (!content) return []
  const seen = new Set<string>()
  const out: CouplingSignal[] = []
  for (const { kind, re } of COUPLING_PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const key = (m[1] ?? '').toLowerCase()
      if (!key || key.length > 80) continue
      if (kind === 'table' && TABLE_NOISE.has(key)) continue
      if (kind === 'event' && !isDomainEvent(key)) continue
      const id = `${kind}|${key}`
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ kind, key })
      if (out.length >= 60) return out
    }
  }
  return out
}

/** A hidden-coupling edge between two modules sharing a non-import signal. */
export interface CouplingEdge {
  from: string
  to: string
  kind: CouplingKind
  key: string
}

/**
 * Build the hidden-coupling graph: modules that share a table / event / route /
 * flag, but (often) have no import edge between them. A key shared by too many
 * modules (> 6) is treated as generic infrastructure and skipped to cut noise.
 * Pure + deterministic.
 */
export function buildCouplingGraph(facts: FileFacts[]): CouplingEdge[] {
  // (kind|key) → set of modules referencing it.
  const byKey = new Map<string, { kind: CouplingKind; key: string; modules: Set<string> }>()
  for (const f of facts) {
    const dir = dirOf(norm(f.path))
    for (const s of f.signals ?? []) {
      const id = `${s.kind}|${s.key}`
      let entry = byKey.get(id)
      if (!entry) {
        entry = { kind: s.kind, key: s.key, modules: new Set() }
        byKey.set(id, entry)
      }
      entry.modules.add(dir)
    }
  }
  const seen = new Set<string>()
  const edges: CouplingEdge[] = []
  for (const { kind, key, modules } of byKey.values()) {
    const list = [...modules].sort()
    if (list.length < 2 || list.length > 6) continue // self-only or too generic
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const from = list[i]!
        const to = list[j]!
        const dedup = `${from}|${to}|${kind}|${key}`
        if (seen.has(dedup)) continue
        seen.add(dedup)
        edges.push({ from, to, kind, key })
        if (edges.length >= 300) return edges
      }
    }
  }
  return edges
}

/** Hidden-coupling edges touching a module (as either endpoint). */
export function couplingForModule(edges: CouplingEdge[], moduleId: string): CouplingEdge[] {
  return edges.filter((e) => e.from === moduleId || e.to === moduleId)
}

const JAVA_LIKE_RE = /^(.+?)\/src\/main\/(?:java|kotlin|scala|groovy)\/(.+)$/
const PY_SRC_RE = /^(.+?)\/src\/(?:python|py)\/(.+)$/

/**
 * Shorten a module ID for display by stripping language-conventional boilerplate.
 * Java: `sre-common/src/main/java/com/alibaba/cainiao/sre/common/utils` →
 *       `sre-common/.../sre/common/utils` (drops the reverse-domain groupId).
 * Non-Java paths pass through unchanged.
 */
export function shortenModuleId(id: string): string {
  const m = JAVA_LIKE_RE.exec(id) || PY_SRC_RE.exec(id)
  if (!m) return id
  const root = m[1]!
  const tail = m[2]!
  const segs = tail.split('/')
  if (segs.length === 0) return id
  // Detect a reverse-domain groupId: must start with com/org/net/io/cn/de/...,
  // then drop consecutive all-lowercase segments (the domain portion). The first
  // segment that is NOT a plausible domain segment ends the groupId.
  const DOMAIN_HEADS = new Set(['com', 'org', 'net', 'io', 'cn', 'de', 'uk', 'jp', 'me', 'dev'])
  if (!DOMAIN_HEADS.has(segs[0]!)) {
    return `${root}/.../` + tail
  }
  // The reverse-domain groupId is 2-3 segments (com/alibaba, com/alibaba/cainiao).
  // Drop exactly that prefix. We detect the boundary: the first 2 segs are always
  // domain (com/org + company), the 3rd is domain iff it's short (≤10 chars) AND
  // the 4th segment still exists (otherwise the 3rd IS the project root).
  let drop = 2 // always drop at least the TLD + company (com/alibaba)
  if (segs.length > 3 && segs[2]!.length <= 10 && /^[a-z][a-z0-9]*$/.test(segs[2]!)) {
    drop = 3 // com/alibaba/cainiao → 3 domain segments
  }
  if (drop >= segs.length) return `${root}/.../` + segs.slice(-1).join('/')
  const semantic = segs.slice(drop)
  return semantic.length > 0 ? `${root}/.../` + semantic.join('/') : `${root}/.../` + segs.slice(-1).join('/')
}
