import type { ModelProviderKind } from '../../shared/types'

export const OPENAI_MODEL_PRESETS = [
  'glm-5.1',
  'glm-4-plus',
  'glm-4-flash',
  'gpt-4o',
  'gpt-4o-mini',
  'deepseek-chat',
  'qwen2.5-coder-32b-instruct'
] as const

export const ANTHROPIC_MODEL_PRESETS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001'
] as const

export function presetsFor(provider: ModelProviderKind): readonly string[] {
  return provider === 'anthropic' ? ANTHROPIC_MODEL_PRESETS : OPENAI_MODEL_PRESETS
}

export function defaultModelFor(provider: ModelProviderKind): string {
  return provider === 'anthropic' ? 'claude-sonnet-4-6' : 'glm-5.1'
}

export const PROVIDER_LABELS: Record<ModelProviderKind, string> = {
  openai: 'OpenAI-compatible',
  anthropic: 'Anthropic'
}
