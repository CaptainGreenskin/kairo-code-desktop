import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type {
  McpServerConfig,
  McpServerStatus,
  McpToolInfo
} from '../shared/types'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface McpToolSchema {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

interface McpConnection {
  config: McpServerConfig
  process?: ChildProcess
  connected: boolean
  tools: McpToolSchema[]
  error?: string
  pending: Map<string | number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }>
  buffer: string
}

export class McpManager extends EventEmitter {
  private connections = new Map<string, McpConnection>()
  private nextId = 1

  async addServer(config: McpServerConfig): Promise<void> {
    if (this.connections.has(config.name)) {
      await this.removeServer(config.name)
    }
    const conn: McpConnection = {
      config,
      connected: false,
      tools: [],
      pending: new Map(),
      buffer: ''
    }
    this.connections.set(config.name, conn)
    if (config.enabled && config.autoConnect !== false) {
      await this.connectServer(config.name)
    }
  }

  async removeServer(name: string): Promise<void> {
    const conn = this.connections.get(name)
    if (!conn) return
    this.disconnectServer(conn)
    this.connections.delete(name)
  }

  async enableServer(name: string): Promise<void> {
    const conn = this.connections.get(name)
    if (!conn) return
    conn.config.enabled = true
    if (!conn.connected) {
      await this.connectServer(name)
    }
  }

  disableServer(name: string): void {
    const conn = this.connections.get(name)
    if (!conn) return
    conn.config.enabled = false
    this.disconnectServer(conn)
  }

  getServers(): McpServerStatus[] {
    return Array.from(this.connections.values()).map((conn) => ({
      name: conn.config.name,
      transport: conn.config.transport,
      connected: conn.connected,
      toolCount: conn.tools.length,
      enabled: conn.config.enabled,
      ...(conn.error ? { error: conn.error } : {})
    }))
  }

  getTools(): McpToolInfo[] {
    const tools: McpToolInfo[] = []
    for (const conn of this.connections.values()) {
      if (!conn.connected || !conn.config.enabled) continue
      for (const tool of conn.tools) {
        tools.push({
          serverName: conn.config.name,
          name: tool.name,
          qualifiedName: `mcp__${conn.config.name}__${tool.name}`,
          description: tool.description ?? '',
          inputSchema: tool.inputSchema ?? { type: 'object', properties: {} }
        })
      }
    }
    return tools
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ content: string; isError?: boolean }> {
    const conn = this.connections.get(serverName)
    if (!conn) {
      return { content: `MCP server '${serverName}' not found`, isError: true }
    }
    if (!conn.connected) {
      try {
        await this.connectServer(serverName)
      } catch {
        return { content: `Failed to reconnect to '${serverName}': ${conn.error ?? 'unknown'}`, isError: true }
      }
    }
    try {
      const result = await this.sendRequest(conn, 'tools/call', {
        name: toolName,
        arguments: args
      })
      const res = result as { content?: Array<{ type: string; text?: string }>; isError?: boolean }
      const text = res.content
        ?.map((c) => c.text ?? JSON.stringify(c))
        .join('\n') ?? JSON.stringify(result)
      return { content: text, isError: res.isError }
    } catch (err) {
      return {
        content: `MCP tool error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true
      }
    }
  }

  shutdown(): void {
    for (const conn of this.connections.values()) {
      this.disconnectServer(conn)
    }
    this.connections.clear()
  }

  getConfigs(): McpServerConfig[] {
    return Array.from(this.connections.values()).map((c) => ({ ...c.config }))
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async connectServer(name: string): Promise<void> {
    const conn = this.connections.get(name)
    if (!conn) return
    if (conn.config.transport === 'stdio') {
      await this.connectStdio(conn)
    } else {
      await this.connectSse(conn)
    }
  }

  private async connectStdio(conn: McpConnection): Promise<void> {
    const { command, args = [], env = {} } = conn.config
    if (!command) {
      conn.error = 'No command specified for stdio transport'
      return
    }
    try {
      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env }
      })
      conn.process = child
      conn.buffer = ''

      child.stdout?.on('data', (chunk: Buffer) => {
        conn.buffer += chunk.toString('utf-8')
        this.processBuffer(conn)
      })

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8').trim()
        if (text) {
          this.emit('log', { server: conn.config.name, level: 'error', message: text })
        }
      })

      child.on('error', (err) => {
        conn.error = err.message
        conn.connected = false
        this.emit('serverError', { server: conn.config.name, error: err.message })
      })

      child.on('exit', (code) => {
        conn.connected = false
        if (code !== 0 && code !== null) {
          conn.error = `Process exited with code ${code}`
          this.emit('serverError', { server: conn.config.name, error: conn.error })
        }
        for (const [, pending] of conn.pending) {
          pending.reject(new Error('MCP server process exited'))
        }
        conn.pending.clear()
      })

      await this.initialize(conn)
    } catch (err) {
      conn.error = err instanceof Error ? err.message : String(err)
      conn.connected = false
    }
  }

  private async connectSse(conn: McpConnection): Promise<void> {
    const { url } = conn.config
    if (!url) {
      conn.error = 'No URL specified for SSE transport'
      return
    }
    // SSE transport uses HTTP POST for requests
    conn.connected = false
    conn.error = 'SSE transport: connecting...'
    try {
      await this.initializeSse(conn)
    } catch (err) {
      conn.error = err instanceof Error ? err.message : String(err)
      conn.connected = false
    }
  }

  private async initializeSse(conn: McpConnection): Promise<void> {
    const url = conn.config.url!
    try {
      const initRes = await fetch(`${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.nextId++,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'kairo-code', version: '1.0.0' }
          }
        })
      })
      if (!initRes.ok) {
        throw new Error(`HTTP ${initRes.status}: ${await initRes.text()}`)
      }
      conn.connected = true
      conn.error = undefined

      const toolsRes = await fetch(`${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.nextId++,
          method: 'tools/list',
          params: {}
        })
      })
      if (toolsRes.ok) {
        const body = (await toolsRes.json()) as JsonRpcResponse
        if (body.result) {
          const list = body.result as { tools?: McpToolSchema[] }
          conn.tools = list.tools ?? []
        }
      }
    } catch (err) {
      throw err
    }
  }

  private async initialize(conn: McpConnection): Promise<void> {
    const initResult = await this.sendRequest(conn, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'kairo-code', version: '1.0.0' }
    })
    conn.connected = true
    conn.error = undefined

    // Send initialized notification
    this.sendNotification(conn, 'notifications/initialized', {})

    // Discover tools
    try {
      const toolsResult = await this.sendRequest(conn, 'tools/list', {})
      const list = toolsResult as { tools?: McpToolSchema[] }
      conn.tools = list.tools ?? []
    } catch {
      conn.tools = []
    }

    this.emit('serverConnected', {
      server: conn.config.name,
      toolCount: conn.tools.length,
      capabilities: initResult
    })
  }

  private sendRequest(conn: McpConnection, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params
      }

      if (conn.config.transport === 'sse') {
        // For SSE, use HTTP POST
        const url = conn.config.url!
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request)
        })
          .then(async (res) => {
            if (!res.ok) {
              reject(new Error(`HTTP ${res.status}`))
              return
            }
            const body = (await res.json()) as JsonRpcResponse
            if (body.error) {
              reject(new Error(body.error.message))
            } else {
              resolve(body.result)
            }
          })
          .catch(reject)
        return
      }

      // For stdio, write to stdin
      conn.pending.set(id, { resolve, reject })
      const data = JSON.stringify(request) + '\n'
      conn.process?.stdin?.write(data, (err) => {
        if (err) {
          conn.pending.delete(id)
          reject(err)
        }
      })

      // Timeout after 30s
      setTimeout(() => {
        if (conn.pending.has(id)) {
          conn.pending.delete(id)
          reject(new Error(`MCP request timeout: ${method}`))
        }
      }, 30_000)
    })
  }

  private sendNotification(conn: McpConnection, method: string, params: unknown): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'
    if (conn.config.transport === 'stdio') {
      conn.process?.stdin?.write(msg)
    }
  }

  private processBuffer(conn: McpConnection): void {
    const lines = conn.buffer.split('\n')
    conn.buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse
        if (msg.id !== undefined && msg.id !== null) {
          const pending = conn.pending.get(msg.id)
          if (pending) {
            conn.pending.delete(msg.id)
            if (msg.error) {
              pending.reject(new Error(msg.error.message))
            } else {
              pending.resolve(msg.result)
            }
          }
        }
      } catch {
        // Not valid JSON — skip
      }
    }
  }

  private disconnectServer(conn: McpConnection): void {
    conn.connected = false
    for (const [, pending] of conn.pending) {
      pending.reject(new Error('Server disconnected'))
    }
    conn.pending.clear()
    if (conn.process) {
      try {
        conn.process.kill('SIGTERM')
      } catch {
        // best-effort
      }
      conn.process = undefined
    }
  }
}
