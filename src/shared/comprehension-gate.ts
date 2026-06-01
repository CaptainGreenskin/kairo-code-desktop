/**
 * Comprehension Gate — turns a {@link ChangeLens} into a verdict that routes the
 * human's attention. It replaces rubber-stamp "Approve" with: low-risk changes
 * pass automatically (don't waste the human), high-risk / high-uncertainty
 * changes surface exactly ONE question plus the place the answer lives ("point,
 * don't tell"). Pure + deterministic — no LLM, no prose generation.
 *
 * Constitution it serves: (4) point, don't tell; (5) the human must be able to
 * answer the one architectural question in <60s, not re-read 500 lines.
 */

import type { ChangeLens } from './types'
import { isProtectedPath } from './comprehension-router'
import { isBreaking, type BehaviorSignal } from './behavior-delta'
import { isCyclic, type DeviationSignal } from './architecture-deviation'

export type GateRisk = 'auto' | 'review'

export type GateReasonKind =
  | 'protected'
  | 'failed'
  | 'behavior'
  | 'deviation'
  | 'uncertain'
  | 'unverified'
  | 'broad'

export interface GateReason {
  kind: GateReasonKind
  severity: 'high' | 'medium'
  /** Glanceable explanation of this risk factor. */
  detail: string
}

/** Where the answer lives — the one place the human should look first. */
export interface GateFocus {
  /** Path (relative to workspace) to open. */
  file: string
  why: string
  /** Identifier to locate within the file (so the UI can show those lines). */
  symbol?: string
}

export interface GateVerdict {
  risk: GateRisk
  /** The single highest-leverage question to answer (only when risk='review'). */
  question?: string
  /** Pointer to where the answer lives (only when risk='review'). */
  focus?: GateFocus
  /** Contributing risk factors, highest severity first (for the "why" disclosure). */
  reasons: GateReason[]
  /** Compact one-liner summarizing the verdict. */
  summary: string
  /**
   * Secondary behavior-delta annotation — surfaced even when the main question
   * is about something else (e.g. a protected-region change that ALSO altered an
   * export contract). Undefined when behavior is already the main question.
   */
  note?: string
  /**
   * Anti-rubber-stamp: when observable behavior changed but no tests were run,
   * this names exactly what went unverified ("changed 3 contracts, 0 tests
   * cover them"). Turns the Verification Ledger from "what ran" into "what
   * should have been verified but wasn't".
   */
  verificationGap?: string
}

/** A change touching this many modules is "broad" enough to flag. */
const BROAD_MODULE_THRESHOLD = 4
/** Unverified changes at/above this file count escalate from medium to high. */
const UNVERIFIED_HIGH_THRESHOLD = 3

const KIND_PRIORITY: GateReasonKind[] = ['protected', 'failed', 'deviation', 'behavior', 'uncertain', 'unverified', 'broad']

/** Most decision-worthy deviation: a cycle outranks a plain new dependency. */
function leadDeviation(sigs: DeviationSignal[]): DeviationSignal | undefined {
  if (sigs.length === 0) return undefined
  return [...sigs].sort((a, b) => (isCyclic(a) ? 0 : 1) - (isCyclic(b) ? 0 : 1))[0]
}

/** Most decision-worthy signal: breaking > return-shape > route > side-effect > added. */
function leadBehavior(signals: BehaviorSignal[]): BehaviorSignal | undefined {
  if (signals.length === 0) return undefined
  const rank = (s: BehaviorSignal): number =>
    isBreaking(s) ? 0 : s.kind === 'return-shape' ? 1 : s.kind === 'route' ? 2 : s.kind === 'side-effect' ? 3 : 4
  return [...signals].sort((a, b) => rank(a) - rank(b))[0]
}

/** Short annotation describing the lead behavior signal (for the gate `note`). */
function behaviorNote(lead: BehaviorSignal): string {
  if (isBreaking(lead)) return `⚠ 同时改了导出契约：${lead.detail}（${lead.file}）`
  if (lead.kind === 'return-shape') return `同时改了返回结构：${lead.detail}（${lead.file}）`
  if (lead.kind === 'route') return `同时改动了端点：${lead.detail}（${lead.file}）`
  if (lead.kind === 'side-effect') return `同时引入副作用：${lead.detail}（${lead.file}）`
  return `同时新增导出：${lead.detail}（${lead.file}）`
}

/** Name what went unverified: the Ledger's "what should have been verified". */
function verificationGapNote(lens: ChangeLens, behavior: BehaviorSignal[]): string {
  const ran = lens.verification.ran.length
  const breaking = behavior.filter(isBreaking).length
  const ledger = ran > 0 ? `跑了 ${ran} 条命令、未跑测试` : '没跑任何测试'
  const contracts = breaking > 0 ? `（含 ${breaking} 处契约破坏）` : ''
  return `${ledger}；${behavior.length} 处可观测行为变化${contracts}无任何测试覆盖`
}

/** The file in the largest changed module — a sensible default focus. */
function biggestModuleFile(lens: ChangeLens): string | undefined {
  const biggest = [...lens.blastRadius].sort((a, b) => b.files.length - a.files.length)[0]
  return biggest?.files[0]
}

function pickFocus(top: GateReason, lens: ChangeLens, protectedFiles: string[]): GateFocus | undefined {
  if (top.kind === 'protected' && protectedFiles[0]) {
    return { file: protectedFiles[0], why: '这是被改动的不变量区文件' }
  }
  if (top.kind === 'behavior') {
    const lead = leadBehavior(lens.behaviorDelta ?? [])
    if (lead) return { file: lead.file, why: '行为契约在这里发生变化', ...(lead.name ? { symbol: lead.name } : {}) }
  }
  if (top.kind === 'deviation') {
    const lead = leadDeviation(lens.deviations ?? [])
    if (lead) return { file: lead.file, why: '这条新依赖在这里引入' }
  }
  // For attention-only tops (unsure / untested / broad), a concrete contract or
  // return-shape change is a better place to look than "the biggest module".
  if (top.kind === 'uncertain' || top.kind === 'unverified' || top.kind === 'broad') {
    const lead = leadBehavior(lens.behaviorDelta ?? [])
    if (lead && (lead.kind === 'api-removed' || lead.kind === 'api-changed' || lead.kind === 'return-shape')) {
      return { file: lead.file, why: '行为契约在这里发生变化', ...(lead.name ? { symbol: lead.name } : {}) }
    }
  }
  const file = biggestModuleFile(lens)
  if (!file) return undefined
  const why =
    top.kind === 'failed'
      ? '从受影响最大的模块开始核验'
      : top.kind === 'uncertain'
        ? 'Agent 自标不确定，先看这里'
        : top.kind === 'unverified'
          ? '改动最多、却没有测试覆盖'
          : '爆炸半径的中心'
  return { file, why }
}

function toQuestion(top: GateReason, lens: ChangeLens, protectedFiles: string[]): string {
  switch (top.kind) {
    case 'protected': {
      const region = protectedFiles[0] ?? lens.filesChanged[0] ?? '不变量区'
      return `这次改动碰了不变量区（${region}）——在该契约下它仍然成立吗？`
    }
    case 'failed': {
      const cmd = lens.verification.ran.find((r) => !r.ok)?.command ?? '某条命令'
      return `有命令执行失败（${cmd}）——这个改动真的完成了吗？`
    }
    case 'behavior': {
      const lead = leadBehavior(lens.behaviorDelta ?? [])
      const d = lead?.detail ?? '可观测行为'
      if (lead && isBreaking(lead)) return `${d}——依赖它的调用方都更新了吗？`
      if (lead?.kind === 'return-shape') return `${d}——返回契约的消费方都适配了吗？`
      if (lead?.kind === 'route') return `${d}——契约/调用方对齐了吗？`
      if (lead?.kind === 'side-effect') return `${d}——这是预期内的吗？`
      return `${d}——命名与契约稳定吗？`
    }
    case 'deviation': {
      const lead = leadDeviation(lens.deviations ?? [])
      if (lead && isCyclic(lead)) {
        return `新建依赖让 ${lead.fromModule} 与 ${lead.toModule} 成环——这是有意的架构变化吗？`
      }
      return `这次新建了依赖 ${lead?.fromModule} → ${lead?.toModule}——符合架构意图吗？`
    }
    case 'uncertain':
      return `Agent 最不确定的一处：「${top.detail}」——它判断对了吗？`
    case 'unverified': {
      const behavior = lens.behaviorDelta ?? []
      if (behavior.length > 0) {
        return `改了 ${behavior.length} 处可观测行为却没跑任何测试——这些变化你凭什么相信它对？`
      }
      return `${lens.filesChanged.length} 个文件改了但没跑测试——这个风险你接受吗？`
    }
    case 'broad':
      return `改动横跨 ${lens.blastRadius.length} 个模块——这个影响面在预期内吗？`
  }
}

/** Evaluate the Comprehension Gate for a finished change. */
export function evaluateGate(lens: ChangeLens, protectedGlobs: string[]): GateVerdict {
  const reasons: GateReason[] = []
  const changed = lens.filesChanged
  const protectedFiles = changed.filter((f) => isProtectedPath(f, protectedGlobs))

  if (protectedFiles.length > 0) {
    reasons.push({
      kind: 'protected',
      severity: 'high',
      detail: `改动触及不变量区：${protectedFiles.slice(0, 3).join(', ')}`
    })
  }

  const failed = lens.verification.ran.filter((r) => !r.ok)
  if (failed.length > 0) {
    reasons.push({
      kind: 'failed',
      severity: 'high',
      detail: `${failed.length} 条执行失败，例如 ${failed[0]!.command}`
    })
  }

  const behavior = lens.behaviorDelta ?? []
  if (behavior.length > 0) {
    const breaking = behavior.some(isBreaking)
    const lead = leadBehavior(behavior)!
    reasons.push({
      kind: 'behavior',
      // A removed/changed export breaks callers → high. New exports / side
      // effects / routes are worth a glance → medium.
      severity: breaking ? 'high' : 'medium',
      detail: lead.detail
    })
  }

  const deviations = lens.deviations ?? []
  if (deviations.length > 0) {
    const lead = leadDeviation(deviations)!
    reasons.push({
      // A new cycle is a structural smell → high; a novel cross-module edge is
      // worth a glance to confirm it matches the intended architecture → medium.
      kind: 'deviation',
      severity: isCyclic(lead) ? 'high' : 'medium',
      detail: lead.detail
    })
  }

  if (lens.uncertaintyFlags.length > 0) {
    reasons.push({ kind: 'uncertain', severity: 'high', detail: lens.uncertaintyFlags[0]! })
  }

  // Observable behavior changed but no tests ran → the sharpest rubber-stamp
  // trap: a contract/effect moved and nothing verified it. Always high.
  const behaviorUnverified = behavior.length > 0 && !lens.verification.testsRun
  if (changed.length > 0 && !lens.verification.testsRun) {
    reasons.push({
      kind: 'unverified',
      severity: behaviorUnverified || changed.length >= UNVERIFIED_HIGH_THRESHOLD ? 'high' : 'medium',
      detail: behaviorUnverified
        ? `${behavior.length} 处可观测行为变化没有任何测试覆盖`
        : `${changed.length} 个改动文件没有测试覆盖`
    })
  }

  if (lens.blastRadius.length >= BROAD_MODULE_THRESHOLD) {
    reasons.push({
      kind: 'broad',
      severity: 'medium',
      detail: `爆炸半径横跨 ${lens.blastRadius.length} 个模块`
    })
  }

  reasons.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1
    return KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind)
  })

  const hasHigh = reasons.some((r) => r.severity === 'high')
  if (!hasHigh) {
    return {
      risk: 'auto',
      reasons,
      summary:
        changed.length === 0
          ? '没有文件改动。'
          : `低风险：${changed.length} 个文件 / ${lens.blastRadius.length} 个模块，已自动放行。`
    }
  }

  const top = reasons[0]!
  const lead = leadBehavior(behavior)
  const note = lead && top.kind !== 'behavior' ? behaviorNote(lead) : undefined
  const verificationGap = behaviorUnverified ? verificationGapNote(lens, behavior) : undefined
  return {
    risk: 'review',
    question: toQuestion(top, lens, protectedFiles),
    focus: pickFocus(top, lens, protectedFiles),
    reasons,
    summary: `需要你确认 1 处：${top.detail}`,
    ...(note ? { note } : {}),
    ...(verificationGap ? { verificationGap } : {})
  }
}
