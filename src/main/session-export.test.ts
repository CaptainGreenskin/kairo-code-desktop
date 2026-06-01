import { describe, expect, it, vi } from 'vitest'
import type { SessionFile } from '../shared/types'

// session-export imports loadSession from './sessions', which pulls in Electron
// app paths. Mock it so the markdown serializer can be tested in isolation.
const loadSession = vi.fn<(id: string) => Promise<SessionFile | null>>()
vi.mock('./sessions', () => ({ loadSession: (id: string) => loadSession(id) }))

import { exportSessionToMarkdown } from './session-export'

const baseSession = (overrides: Partial<SessionFile> = {}): SessionFile => ({
  id: 'sess-123456789',
  name: 'My Session',
  createdAt: Date.UTC(2026, 4, 29),
  updatedAt: Date.UTC(2026, 4, 29),
  messages: [],
  ...overrides
})

describe('exportSessionToMarkdown', () => {
  it('throws when the session does not exist', async () => {
    loadSession.mockResolvedValueOnce(null)
    await expect(exportSessionToMarkdown('missing')).rejects.toThrow(/not found/)
  })

  it('emits YAML front-matter with name, model and workspace', async () => {
    loadSession.mockResolvedValueOnce(
      baseSession({ model: 'glm-4-flash', workspaceRoot: '/proj', messages: [] })
    )
    const md = await exportSessionToMarkdown('sess')
    expect(md).toContain('title: "My Session"')
    expect(md).toContain('model: glm-4-flash')
    expect(md).toContain('workspace: /proj')
    expect(md).toContain('messages: 0')
  })

  it('renders user and assistant headings', async () => {
    loadSession.mockResolvedValueOnce(
      baseSession({
        messages: [
          { id: 'm1', role: 'user', content: 'hi', timestamp: 1 },
          { id: 'm2', role: 'assistant', content: 'hello', timestamp: 2 }
        ]
      })
    )
    const md = await exportSessionToMarkdown('sess')
    expect(md).toContain('### User')
    expect(md).toContain('### Assistant')
    expect(md).toContain('hello')
  })

  it('serializes tool-call args as JSON (regression: args is an object, not a string)', async () => {
    loadSession.mockResolvedValueOnce(
      baseSession({
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            content: 'done',
            timestamp: 1,
            toolCalls: [
              {
                id: 't1',
                toolName: 'read_file',
                args: { path: 'src/index.ts', limit: 10 },
                result: 'file contents',
                startedAt: 1
              }
            ]
          }
        ]
      })
    )
    const md = await exportSessionToMarkdown('sess')
    expect(md).toContain('Tool: read_file')
    // The bug was pushing the raw object (rendered "[object Object]"); it must be JSON.
    expect(md).not.toContain('[object Object]')
    expect(md).toContain('"path": "src/index.ts"')
    expect(md).toContain('"limit": 10')
    expect(md).toContain('file contents')
  })

  it('escapes double quotes in the title', async () => {
    loadSession.mockResolvedValueOnce(baseSession({ name: 'A "quoted" name' }))
    const md = await exportSessionToMarkdown('sess')
    expect(md).toContain('title: "A \\"quoted\\" name"')
  })
})
