/**
 * Talk to the system — but grounded. Natural-language questions about the
 * codebase are answered ONLY from the Brain's evidence graph (real import edges,
 * gate decisions + rationale, git commits), never from the model's imagination.
 * `gatherEvidence` (pure) retrieves the relevant evidence and labels each item
 * [E1], [E2]…; the model is then constrained to answer using only those items
 * and to cite each claim. This file holds the pure retrieval + prompt; the model
 * call lives in main. Constitution: "point, don't tell" — every answer is
 * anchored to a clickable piece of evidence. Pure + browser-safe.
 */

import { dirOf, type CodeMap } from './code-map'
import type { ChangeRecord } from './map-delta'
import type { GitCommit } from './git-brain'
import type { GateDecision } from './types'

export type EvidenceKind = 'module' | 'edge' | 'decision' | 'commit'

export interface EvidenceItem {
  /** Citation label: E1, E2, … */
  id: string
  kind: EvidenceKind
  /** Human-readable evidence line. */
  text: string
  /** A file to open when the citation is clicked (when applicable). */
  file?: string
  /** A module to drill into when the citation is clicked (when applicable). */
  module?: string
}

export interface Evidence {
  items: EvidenceItem[]
  /** The primary module the question is about (best match), or null. */
  focus: string | null
  /** Every module the question mentioned. */
  matched: string[]
}

/** System prompt that constrains the model to the evidence + citations. */
export const BRAIN_QA_SYSTEM =
  '你是这个代码系统的"理解力仪器"。只能依据下面提供的【证据】回答问题；每个论断后用 [E#] 标注它依据的证据项。' +
  '若证据不足以回答，直接说"Brain 里没有足够证据回答这个问题"，并指出还需要什么。' +
  '绝不编造证据里没有的依赖、决策或提交。回答用中文，简洁，直接指向具体证据，不要复述全部证据。'

function matchesModule(id: string, c: string): boolean {
  return id === c || id.startsWith(`${c}/`) || c.startsWith(`${id}/`)
}

/** Modules named in the question, ranked by match specificity then fan-in. */
function matchModules(map: CodeMap, question: string): string[] {
  const q = question.toLowerCase()
  const fanIn = new Map<string, number>()
  for (const e of map.edges) fanIn.set(e.to, (fanIn.get(e.to) ?? 0) + 1)
  const scored: Array<{ id: string; score: number }> = []
  for (const m of map.modules) {
    let best = 0
    for (const seg of m.id.toLowerCase().split('/')) {
      if (seg.length >= 3 && q.includes(seg)) best = Math.max(best, seg.length)
    }
    // The full id (or its tail) appearing verbatim is the strongest signal.
    if (q.includes(m.id.toLowerCase())) best = Math.max(best, m.id.length + 10)
    if (best > 0) scored.push({ id: m.id, score: best * 100 + (fanIn.get(m.id) ?? 0) })
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.id)
}

const KIND_LABEL: Record<EvidenceKind, string> = {
  module: '模块',
  edge: '依赖',
  decision: '决策',
  commit: '提交'
}

/**
 * Retrieve the Brain evidence relevant to a free-text question — deterministic,
 * no model. Returns labeled items (E1…) the model must cite. Caps each category
 * so the prompt stays tight.
 */
export function gatherEvidence(
  question: string,
  data: { map: CodeMap; decisions: GateDecision[]; commits: GitCommit[]; changes: ChangeRecord[] }
): Evidence {
  const { map, decisions, commits } = data
  const matched = matchModules(map, question)
  const focus = matched[0] ?? null
  const inScope = (mods: string[]): boolean => mods.some((m) => matched.some((id) => matchesModule(id, m)))
  const items: EvidenceItem[] = []
  const push = (kind: EvidenceKind, text: string, extra?: { file?: string; module?: string }): void => {
    items.push({ id: `E${items.length + 1}`, kind, text, ...extra })
  }

  // Module summaries for the matched modules.
  const matchSet = new Set(matched.slice(0, 3))
  for (const id of matchSet) {
    const m = map.modules.find((mm) => mm.id === id)
    if (!m) continue
    const usedBy = map.edges.filter((e) => e.to === id).length
    const uses = map.edges.filter((e) => e.from === id).length
    push('module', `${id}：${m.fileCount} 个文件、${m.loc} 行；被 ${usedBy} 个模块依赖、依赖 ${uses} 个`, { module: id })
  }

  // Dependency edges touching the matched modules.
  for (const e of map.edges) {
    if (items.length >= 14) break
    if (matchSet.has(e.from) || matchSet.has(e.to)) {
      push('edge', `${e.from} → ${e.to}（${e.weight} 处引用）`, { module: e.to })
    }
  }

  // Gate decisions (the "why") on the matched modules, newest first.
  for (const d of [...decisions].sort((a, b) => b.at - a.at)) {
    if (items.length >= 18) break
    if (inScope(d.modules)) {
      const why = d.rationale ?? d.question ?? '已在闸门确认'
      push('decision', `[${d.outcome === 'passed' ? '通过' : '改过'}] ${why}`, d.focus ? { file: d.focus } : undefined)
    }
  }

  // Git commits (non-crew history) touching the matched modules, newest first.
  for (const c of commits) {
    if (items.length >= 22) break
    if (c.files.some((f) => matched.some((id) => matchesModule(id, dirOf(f))))) {
      push('commit', `${c.subject} — ${c.author}`, { file: c.files[0] })
    }
  }

  return { items, focus, matched }
}

/** Build the user-message prompt: the question + numbered evidence. */
export function buildQaPrompt(question: string, evidence: Evidence): string {
  if (evidence.items.length === 0) {
    return `问题：${question}\n\n证据：（Brain 里没有与这个问题相关的证据）`
  }
  const lines = evidence.items.map((e) => `[${e.id}] (${KIND_LABEL[e.kind]}) ${e.text}`)
  return `问题：${question}\n\n证据：\n${lines.join('\n')}`
}
