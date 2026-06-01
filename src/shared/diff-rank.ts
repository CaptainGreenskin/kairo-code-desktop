/**
 * Comprehension-ranked diff — when you DO have to read code, route attention to
 * the lines that matter. Parses a unified diff and scores each hunk by how much
 * it affects understanding: contract/signature changes first, then control-flow
 * logic, then new dependencies, then ordinary edits, with pure formatting /
 * comment churn ranked to the bottom (and flagged "cosmetic" so the UI can hide
 * it). The constitution's "point, don't tell" applied at the line level. Pure +
 * browser-safe.
 */

export type HunkKind = 'contract' | 'logic' | 'dependency' | 'edit' | 'cosmetic'

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx'
  text: string
}
export interface DiffHunk {
  /** The "@@ … @@" trailing context (often the enclosing function). */
  header: string
  lines: DiffLine[]
}
export interface DiffFile {
  path: string
  hunks: DiffHunk[]
}

export interface RankedHunk {
  file: string
  header: string
  kind: HunkKind
  score: number
  reasons: string[]
  added: number
  removed: number
  /** A few changed lines to preview (with +/- markers). */
  sample: string[]
}

/** Parse a unified diff (git show / git diff output) into files + hunks. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git')) {
      file = null
      hunk = null
      continue
    }
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).replace(/^b\//, '').trim()
      file = { path: p === '/dev/null' ? '(deleted)' : p, hunks: [] }
      files.push(file)
      hunk = null
      continue
    }
    if (raw.startsWith('--- ')) continue
    if (raw.startsWith('@@')) {
      const m = /@@[^@]*@@\s?(.*)$/.exec(raw)
      hunk = { header: (m?.[1] ?? '').trim(), lines: [] }
      if (file) file.hunks.push(hunk)
      continue
    }
    if (!hunk) continue
    if (raw.startsWith('\\')) continue // "\ No newline at end of file"
    if (raw.startsWith('+')) hunk.lines.push({ kind: 'add', text: raw.slice(1) })
    else if (raw.startsWith('-')) hunk.lines.push({ kind: 'del', text: raw.slice(1) })
    else hunk.lines.push({ kind: 'ctx', text: raw.startsWith(' ') ? raw.slice(1) : raw })
  }
  return files.filter((f) => f.hunks.length > 0)
}

const CONTRACT_RE = /\b(export|public|module\.exports)\b|^\s*(export\s+)?(async\s+)?(function|class|interface|type|enum|def|func|struct|trait)\b/
const LOGIC_RE = /\b(if|else|for|while|switch|case|catch|throw|await|return|yield)\b/
const DEP_RE = /\b(import|require|from)\b/
const COMMENT_RE = /^\s*(\/\/|#|\*|\/\*|\*\/|<!--|--)/

function isCosmetic(changed: DiffLine[]): boolean {
  return changed.every((l) => {
    const t = l.text.trim()
    return t === '' || COMMENT_RE.test(t)
  })
}

const KIND_SCORE: Record<HunkKind, number> = { contract: 100, logic: 60, dependency: 40, edit: 25, cosmetic: 5 }

/** Score a single hunk by comprehension importance. */
export function scoreHunk(hunk: DiffHunk): { kind: HunkKind; score: number; reasons: string[] } {
  const changed = hunk.lines.filter((l) => l.kind !== 'ctx')
  if (changed.length === 0) return { kind: 'cosmetic', score: 0, reasons: [] }
  if (isCosmetic(changed)) return { kind: 'cosmetic', score: KIND_SCORE.cosmetic, reasons: ['仅格式/注释改动'] }

  const reasons: string[] = []
  const text = changed.map((l) => l.text).join('\n')
  let kind: HunkKind = 'edit'
  if (CONTRACT_RE.test(text)) {
    kind = 'contract'
    reasons.push('改动了导出/签名/类型(契约)')
  } else if (LOGIC_RE.test(text)) {
    kind = 'logic'
    reasons.push('改动了控制流/返回值(逻辑)')
  } else if (DEP_RE.test(text)) {
    kind = 'dependency'
    reasons.push('改动了 import/依赖')
  } else {
    reasons.push('普通改动')
  }
  return { kind, score: KIND_SCORE[kind], reasons }
}

/** Parse + rank a unified diff: hunks most-worth-reading first. */
export function rankDiff(text: string): RankedHunk[] {
  const files = parseUnifiedDiff(text)
  const ranked: RankedHunk[] = []
  for (const f of files) {
    for (const h of f.hunks) {
      const { kind, score, reasons } = scoreHunk(h)
      const changed = h.lines.filter((l) => l.kind !== 'ctx')
      ranked.push({
        file: f.path,
        header: h.header,
        kind,
        score,
        reasons,
        added: changed.filter((l) => l.kind === 'add').length,
        removed: changed.filter((l) => l.kind === 'del').length,
        sample: changed.slice(0, 4).map((l) => `${l.kind === 'add' ? '+' : '-'} ${l.text.trim()}`)
      })
    }
  }
  // Stable: by score desc, then file path for determinism.
  return ranked.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
}
