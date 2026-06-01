import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildProvider, DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL } from './provider'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('buildProvider', () => {
  it('builds an OpenAI-compatible provider by default', () => {
    const { provider, modelName } = buildProvider({ apiKey: 'sk-test', model: 'glm-4-flash' })
    expect(provider.name).toBe('openai')
    expect(modelName).toBe('glm-4-flash')
  })

  it('falls back to the default OpenAI model when none is set', () => {
    const { modelName } = buildProvider({ apiKey: 'sk-test' })
    expect(modelName).toBe(DEFAULT_OPENAI_MODEL)
  })

  it('builds an Anthropic provider when provider=anthropic', () => {
    const { provider, modelName } = buildProvider({
      provider: 'anthropic',
      anthropicApiKey: 'sk-ant-test',
      model: 'claude-opus-4-7'
    })
    expect(provider.name).toBe('anthropic')
    expect(modelName).toBe('claude-opus-4-7')
  })

  it('falls back to the default Anthropic model when none is set', () => {
    const { modelName } = buildProvider({ provider: 'anthropic', anthropicApiKey: 'sk-ant-test' })
    expect(modelName).toBe(DEFAULT_ANTHROPIC_MODEL)
  })

  it('throws a clear error when the OpenAI key is missing', () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(() => buildProvider({ provider: 'openai' })).toThrow(/OPENAI_API_KEY/)
  })

  it('treats empty-string config as "unset" and falls back to env (regression: UI sync must not clobber .env)', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-from-env')
    vi.stubEnv('OPENAI_BASE_URL', 'https://open.bigmodel.cn/api/coding/paas/v4')
    // The renderer's startup sync can push empty strings for unset fields.
    const { provider, modelName } = buildProvider({
      provider: 'openai',
      apiKey: '',
      baseUrl: '',
      model: ''
    })
    expect(provider.name).toBe('openai')
    expect(modelName).toBe(DEFAULT_OPENAI_MODEL) // not '' — empty model falls back too
  })

  it('throws a clear error when the Anthropic key is missing', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect(() => buildProvider({ provider: 'anthropic' })).toThrow(/Anthropic API key/)
  })

  it('uses the Anthropic key even when no OpenAI key exists (regression: subagent/compaction under Anthropic)', () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    // Previously subagent/compaction always built an OpenAIProvider, which broke
    // under the Anthropic provider. buildProvider must not need an OpenAI key.
    const { provider } = buildProvider({ provider: 'anthropic', anthropicApiKey: 'sk-ant-test' })
    expect(provider.name).toBe('anthropic')
  })
})
