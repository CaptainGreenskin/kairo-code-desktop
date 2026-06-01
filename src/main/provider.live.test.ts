/**
 * LIVE smoke test against the real model endpoint (智谱 GLM by default).
 *
 * Opt-in only: runs only when RUN_LIVE_LLM=1, so the normal `npm test` stays
 * offline, fast, and free. Reads credentials from .env if not already in env.
 *
 *   RUN_LIVE_LLM=1 npx vitest run src/main/provider.live.test.ts
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildProvider } from './provider'
import type { StreamEvent } from '@kairo/api'

function loadDotEnv(): void {
  try {
    const raw = readFileSync(path.resolve(__dirname, '../../.env'), 'utf-8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch {
    /* no .env — rely on ambient env */
  }
}

const LIVE = process.env.RUN_LIVE_LLM === '1'

describe.skipIf(!LIVE)('live model smoke (智谱 GLM / OpenAI-compatible)', () => {
  it('streams a real completion from the configured provider', async () => {
    loadDotEnv()
    const { provider, modelName } = buildProvider({
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL ?? 'glm-4-flash'
    })
    expect(provider.name).toBe('openai')

    let text = ''
    let thinking = ''
    let errored: Error | null = null
    const seen: Record<string, number> = {}
    for await (const ev of provider.stream({
      messages: [{ role: 'user', content: 'Reply with exactly the word: PONG' }],
      config: { model: modelName, maxTokens: 512 }
    }) as AsyncIterable<StreamEvent>) {
      seen[ev.type] = (seen[ev.type] ?? 0) + 1
      if (ev.type === 'text_delta') text += ev.text
      else if (ev.type === 'thinking_delta') thinking += ev.text
      else if (ev.type === 'error') errored = ev.error
    }

    // eslint-disable-next-line no-console
    console.log(`[live] ${modelName} event types:`, seen)
    // eslint-disable-next-line no-console
    console.log(`[live] text=${JSON.stringify(text.trim().slice(0, 120))} thinking=${JSON.stringify(thinking.trim().slice(0, 80))}`)

    expect(errored).toBeNull()
    // A reasoning model may answer via text and/or thinking; require some output.
    expect((text + thinking).trim().length).toBeGreaterThan(0)
  }, 60_000)
})
