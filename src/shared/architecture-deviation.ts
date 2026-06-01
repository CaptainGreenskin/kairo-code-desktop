/**
 * Architecture Deviation — the other half of the "inverted signal" (only show
 * where the AI departs from established patterns; hide the confident parts). We
 * treat the current Code Map's dependency structure as the established pattern,
 * and flag the cross-module dependencies a crew change *newly introduces* —
 * especially ones that close a cycle. Attention is routed to the structural
 * connections the AI changed quietly and a human would most want to question.
 *
 * Pure + browser-safe. Source of truth: the `edit` tool's before/after text
 * (so we can tell a *new* import from a pre-existing one) + the Code Map.
 */

import { dirOf, extractImports, langOf, resolveImport, type CodeMap, type CodeMapEdge, type CodeModule, type SourceLang } from './code-map'

export type DeviationKind = 'new-dependency' | 'cyclic-dependency'

export interface DeviationSignal {
  kind: DeviationKind
  fromModule: string
  toModule: string
  /** The file whose edit introduced the dependency. */
  file: string
  detail: string
}

/** Minimal shape of a crew tool record this analyzer reads. */
export interface DeviationRecordLike {
  toolName: string
  args: Record<string, unknown>
}

const MAX_SIGNALS = 6

function fileArg(args: Record<string, unknown>): string {
  const p = args.path ?? args.file ?? args.filePath
  return typeof p === 'string' ? p.replace(/\\/g, '/').replace(/^\.\//, '') : ''
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

/** Can `start` reach `target` by following `from → to` edges? (BFS) */
export function reaches(edges: CodeMapEdge[], start: string, target: string): boolean {
  if (start === target) return true
  const out = new Map<string, string[]>()
  for (const e of edges) {
    const arr = out.get(e.from)
    if (arr) arr.push(e.to)
    else out.set(e.from, [e.to])
  }
  const seen = new Set<string>([start])
  const queue = [start]
  for (let i = 0; i < queue.length; i++) {
    for (const next of out.get(queue[i]!) ?? []) {
      if (next === target) return true
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return false
}

/** Find the in-repo module a resolved path/package maps to, by suffix match. */
function matchModule(modules: CodeModule[], target: string): string | null {
  if (!target) return null
  return modules.find((m) => m.id === target || m.id.endsWith(`/${target}`))?.id ?? null
}

/**
 * Resolve an import specifier to the in-repo module it targets, per language.
 * JS/TS uses relative-path resolution; Java/Python/Go match the (package) path
 * against the Code Map's known modules — which also filters out external
 * packages (`java.util.*`, `os`, `fmt`) since they have no in-repo module.
 */
export function resolveSpecToModule(
  spec: string,
  fromFile: string,
  lang: SourceLang,
  codeMap: CodeMap
): string | null {
  if (lang === 'js') {
    const resolved = resolveImport(fromFile, spec)
    return resolved == null ? null : dirOf(resolved)
  }
  const mods = codeMap.modules
  if (lang === 'java') {
    const p = spec.replace(/\./g, '/')
    const pkg = p.slice(0, p.lastIndexOf('/')) // drop the class name
    return matchModule(mods, pkg)
  }
  if (lang === 'py') {
    let path: string
    if (spec.startsWith('.')) {
      const dots = spec.length - spec.replace(/^\.+/, '').length
      const base = dirOf(fromFile) === '(root)' ? [] : dirOf(fromFile).split('/')
      for (let i = 1; i < dots; i++) base.pop()
      path = base.concat(spec.slice(dots).split('.').filter(Boolean)).join('/')
    } else {
      path = spec.replace(/\./g, '/')
    }
    return matchModule(mods, path) ?? matchModule(mods, path.slice(0, path.lastIndexOf('/')))
  }
  if (lang === 'go') {
    const parts = spec.split('/')
    for (let i = 0; i < parts.length; i++) {
      const hit = matchModule(mods, parts.slice(i).join('/'))
      if (hit) return hit
    }
    return null
  }
  return null
}

/**
 * Detect the cross-module dependencies a crew change newly introduced. A new
 * edge `from → to` is `cyclic-dependency` when `to` already (transitively)
 * depends back on `from` in the current map; otherwise `new-dependency`.
 *
 * Resolves JS/TS (relative paths) + Java/Python/Go (package paths matched
 * against the Code Map). Brand-new files (`write_file`) are skipped since
 * establishing dependencies is expected there.
 */
export function detectArchitectureDeviations(
  records: DeviationRecordLike[],
  codeMap: CodeMap
): DeviationSignal[] {
  const out: DeviationSignal[] = []
  const seen = new Set<string>()

  for (const rec of records) {
    if (rec.toolName !== 'edit') continue
    const file = fileArg(rec.args)
    const lang = file ? langOf(file) : 'other'
    if (!file || lang === 'other') continue
    const fromModule = dirOf(file)

    for (const { oldText, newText } of editReplacements(rec.args)) {
      const before = new Set(extractImports(oldText, lang))
      const newSpecs = extractImports(newText, lang).filter((s) => !before.has(s))
      for (const spec of newSpecs) {
        const toModule = resolveSpecToModule(spec, file, lang, codeMap)
        if (!toModule || toModule === fromModule) continue
        const key = `${fromModule} ${toModule}`
        if (seen.has(key)) continue
        seen.add(key)
        const cyclic = reaches(codeMap.edges, toModule, fromModule)
        out.push(
          cyclic
            ? {
                kind: 'cyclic-dependency',
                fromModule,
                toModule,
                file,
                detail: `成环依赖：${fromModule} ⇄ ${toModule}`
              }
            : {
                kind: 'new-dependency',
                fromModule,
                toModule,
                file,
                detail: `新建依赖：${fromModule} → ${toModule}`
              }
        )
        if (out.length >= MAX_SIGNALS) return out
      }
    }
  }
  return out
}

/** True for the structurally riskier deviation (a dependency cycle). */
export function isCyclic(sig: DeviationSignal): boolean {
  return sig.kind === 'cyclic-dependency'
}
