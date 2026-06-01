import { describe, expect, it } from 'vitest'
import { contextUsage, estimateMessagesTokens, selectRecentWindow } from './compaction-budget'
import type { SessionMessage } from '../shared/types'

// Deterministic estimator: 1 token per character (so sizes = text length).
const est = (t: string): number => t.length

const msg = (id: string, content: string): SessionMessage => ({
  id,
  role: 'user',
  content,
  timestamp: 0
})

describe('estimateMessagesTokens', () => {
  it('sums message text including tool calls', () => {
    const m: SessionMessage = {
      id: 'a',
      role: 'assistant',
      content: 'hi',
      timestamp: 0,
      toolCalls: [{ id: 't', toolName: 'bash', args: { cmd: 'ls' }, result: 'ok', startedAt: 0 }]
    }
    // "assistant: hi" + " bash {"cmd":"ls"} ok" — just assert it's > content-only.
    expect(estimateMessagesTokens([m], est)).toBeGreaterThan(est('assistant: hi'))
  })
})

describe('contextUsage', () => {
  it('reports ratio and flags compaction past the threshold', () => {
    const msgs = [msg('a', 'x'.repeat(80))]
    const u = contextUsage(msgs, 100, est, 0.8)
    expect(u.tokens).toBeGreaterThanOrEqual(80)
    expect(u.shouldCompact).toBe(true) // "user: " prefix pushes it over 80/100
    expect(contextUsage([msg('b', 'x'.repeat(10))], 100, est, 0.8).shouldCompact).toBe(false)
  })
})

describe('selectRecentWindow', () => {
  it('keeps at least minKeep even when they exceed the tail budget', () => {
    const msgs = Array.from({ length: 6 }, (_, i) => msg(`m${i}`, 'x'.repeat(100)))
    // tiny budget, minKeep 4 → keep exactly the last 4 (index 2).
    expect(selectRecentWindow(msgs, 1, est, 4)).toBe(2)
  })

  it('keeps more small messages when the tail budget allows', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => msg(`m${i}`, 'x'.repeat(5)))
    // generous budget → keep all (index 0).
    expect(selectRecentWindow(msgs, 10_000, est, 4)).toBe(0)
  })

  it('returns 0 when there are fewer than minKeep messages', () => {
    expect(selectRecentWindow([msg('a', 'x'), msg('b', 'y')], 1, est, 4)).toBe(0)
  })
})
