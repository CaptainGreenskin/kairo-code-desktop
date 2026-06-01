/**
 * Single source of truth for constructing a model provider from an
 * {@link AgentConfig}. Used by the main agent, subagents, the crew
 * coordinator, and compaction so provider/model selection stays consistent
 * (and so multi-model support never silently regresses in one call site).
 */

import { AnthropicProvider, OpenAIProvider } from '@kairo/core'
import type { ModelProvider } from '@kairo/api'
import type { AgentConfig } from './agent'

export const DEFAULT_OPENAI_MODEL = 'glm-5.1'
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'

/**
 * Build the configured provider and resolve its model name. Throws a
 * user-facing error when the required API key is missing.
 */
export function buildProvider(cfg: AgentConfig): { provider: ModelProvider; modelName: string } {
  // Use `||` (not `??`) so an empty-string from the UI ("not configured")
  // falls back to the environment rather than clobbering it.
  if (cfg.provider === 'anthropic') {
    const apiKey = cfg.anthropicApiKey || process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error('Missing Anthropic API key: set it in Settings or the ANTHROPIC_API_KEY env var')
    }
    const baseURL = cfg.anthropicBaseUrl || process.env.ANTHROPIC_BASE_URL
    return {
      provider: new AnthropicProvider({
        apiKey,
        ...(baseURL ? { baseURL } : {})
      }),
      modelName: cfg.model || DEFAULT_ANTHROPIC_MODEL
    }
  }

  const apiKey = cfg.apiKey || process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY: set it in Settings or the environment')
  }
  const modelName = cfg.model || DEFAULT_OPENAI_MODEL
  let baseURL = cfg.baseUrl || process.env.OPENAI_BASE_URL
  // Auto-detect well-known model providers when no base URL is configured.
  if (!baseURL && /^glm-/i.test(modelName)) {
    baseURL = 'https://open.bigmodel.cn/api/coding/paas/v4'
  }
  return {
    provider: new OpenAIProvider({
      apiKey,
      ...(baseURL ? { baseURL } : {})
    }),
    modelName
  }
}
