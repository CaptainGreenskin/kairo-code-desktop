/**
 * Change Story — generate a human-readable narrative from a Change Lens.
 * Instead of "3 files changed, 2 behavior deltas", say:
 * "AI 重构了 auth 模块。以前走 session 现在改 JWT。影响了 3 个下游服务。"
 *
 * Two modes:
 * 1. buildChangeStoryPrompt(): Pure — builds the LLM prompt from lens data.
 * 2. The actual LLM call happens in the host (main process).
 */

import type { ChangeLens } from '../shared/types'

export interface ChangeStoryInput {
  task: string
  lens: ChangeLens
}

/**
 * Build an LLM prompt that generates a human-readable change story.
 * The prompt constrains the model to be concise and actionable.
 */
export function buildChangeStoryPrompt(input: ChangeStoryInput): string {
  const { task, lens } = input
  const parts: string[] = []

  parts.push(`任务：${task}`)
  parts.push(`改动了 ${lens.filesChanged.length} 个文件`)

  if (lens.blastRadius.length > 0) {
    parts.push(`影响模块：${lens.blastRadius.map((b) => b.module).join('、')}`)
  }

  if (lens.behaviorDelta && lens.behaviorDelta.length > 0) {
    parts.push(`行为变化：${lens.behaviorDelta.map((d) => `${d.kind}: ${d.detail}`).join('；')}`)
  }

  if (lens.verification) {
    parts.push(`验证：${lens.verification.testsRun ? '跑了测试' : '没跑测试'}，${lens.verification.ran.length} 个命令`)
  }

  if (lens.uncertaintyFlags && lens.uncertaintyFlags.length > 0) {
    parts.push(`不确定处：${lens.uncertaintyFlags.join('、')}`)
  }

  return `你是一个代码变更解说员。根据以下变更信息，用 2-3 句中文讲一个简短的变更故事。
要求：
1. 用人话，不用技术术语堆砌
2. 说清楚：改了什么、为什么改、影响什么、需要人确认什么
3. 如果没跑测试，要提醒

变更信息：
${parts.join('\n')}

用 2-3 句话讲这个变更故事：`
}

/**
 * Generate a change story without LLM — pure template-based fallback.
 * Used when no model is configured.
 */
export function buildChangeStoryFallback(input: ChangeStoryInput): string {
  const { task, lens } = input
  const lines: string[] = []

  lines.push(`**${task}** — 改动了 ${lens.filesChanged.length} 个文件`)

  if (lens.blastRadius.length > 0) {
    lines.push(`影响 ${lens.blastRadius.length} 个模块：${lens.blastRadius.slice(0, 3).map((b) => b.module.split('/').pop()).join('、')}`)
  }

  if (lens.behaviorDelta && lens.behaviorDelta.length > 0) {
    const breaking = lens.behaviorDelta.filter((d) => d.kind === 'api-removed' || d.kind === 'api-changed').length
    if (breaking > 0) lines.push(`⚠️ ${breaking} 处破坏性行为变化`)
  }

  if (lens.verification && !lens.verification.testsRun) {
    lines.push(`🔴 没有跑测试`)
  }

  return lines.join('。') + '。'
}
