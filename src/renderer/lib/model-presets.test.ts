import { describe, expect, it } from 'vitest'
import {
  ANTHROPIC_MODEL_PRESETS,
  OPENAI_MODEL_PRESETS,
  PROVIDER_LABELS,
  defaultModelFor,
  presetsFor
} from './model-presets'

describe('model-presets', () => {
  it('presetsFor returns the matching list per provider', () => {
    expect(presetsFor('openai')).toBe(OPENAI_MODEL_PRESETS)
    expect(presetsFor('anthropic')).toBe(ANTHROPIC_MODEL_PRESETS)
  })

  it('defaultModelFor returns a model that is in that provider preset list', () => {
    expect(OPENAI_MODEL_PRESETS).toContain(defaultModelFor('openai'))
    expect(ANTHROPIC_MODEL_PRESETS).toContain(defaultModelFor('anthropic'))
  })

  it('every provider has a human label', () => {
    expect(PROVIDER_LABELS.openai).toBeTruthy()
    expect(PROVIDER_LABELS.anthropic).toBeTruthy()
  })

  it('preset lists are non-empty and unique', () => {
    for (const list of [OPENAI_MODEL_PRESETS, ANTHROPIC_MODEL_PRESETS]) {
      expect(list.length).toBeGreaterThan(0)
      expect(new Set(list).size).toBe(list.length)
    }
  })
})
