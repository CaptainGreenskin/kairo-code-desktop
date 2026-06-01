import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { CodeMap, CouplingEdge } from '../shared/code-map'
import type { ServiceGraph } from '../shared/service-graph'
import type { Evidence } from '../shared/brain-qa'
import type { GitCommit } from '../shared/git-brain'
import type { NightwatchSession } from '../shared/nightwatch-session'
import type { RankedHunk } from '../shared/diff-rank'
import type { PluginManifest, Marketplace } from '@kairo/plugin'
import type { ChangeRecord } from '../shared/map-delta'
import type { CodeMapScanStats, GateDecision } from '../shared/types'
import type {
  ActivityEvent,
  AgentConfig,
  ChangeLens,
  CrewEvent,
  CrewPlan,
  CrewRoleConfig,
  CrewStrategy,
  FileChangeEvent,
  McpServerConfig,
  McpServerStatus,
  McpToolInfo,
  PermissionDecision,
  PermissionRequest,
  SessionFile,
  SessionMeta,
  StateUpdate,
  StreamToken,
  ToolCallEvent,
  ToolResultEvent,
  TurnEndEvent,
  WritePreviewEvent
} from '../shared/types'

type Unsubscribe = () => void

function subscribe<T>(
  channel: string,
  listener: (payload: T) => void
): Unsubscribe {
  const wrapped = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const kairoAPI = {
  // Invocations (renderer -> main)
  sendPrompt: (sessionId: string, prompt: string, config?: AgentConfig): Promise<{ turnId: string }> =>
    ipcRenderer.invoke('kairo:sendPrompt', { sessionId, prompt, config }),

  abort: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('kairo:abort', { sessionId }),

  updateConfig: (config: {
    model?: string
    apiKey?: string
    baseUrl?: string
    provider?: 'openai' | 'anthropic'
    anthropicApiKey?: string
    anthropicBaseUrl?: string
    protectedGlobs?: string[]
    trustedPlugins?: string[]
    disabledPlugins?: string[]
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('kairo:updateConfig', config),

  getConfigStatus: (): Promise<{ hasModel: boolean; provider: 'openai' | 'anthropic' }> =>
    ipcRenderer.invoke('kairo:getConfigStatus'),

  setWorkspace: (workspacePath: string | null): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('kairo:setWorkspace', { workspacePath }),

  setAutopilotMode: (enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('kairo:setAutopilotMode', { enabled }),

  getCodeMap: (
    workspacePath?: string
  ): Promise<{ ok: boolean; map?: CodeMap; stats?: CodeMapScanStats; error?: string }> =>
    ipcRenderer.invoke('kairo:getCodeMap', { workspacePath }),

  getGitHistory: (
    workspacePath?: string,
    limit?: number
  ): Promise<{ ok: boolean; commits: GitCommit[] }> =>
    ipcRenderer.invoke('kairo:getGitHistory', { workspacePath, limit }),

  getFileDeps: (
    file: string,
    workspacePath?: string
  ): Promise<{ ok: boolean; importers?: string[]; imports?: string[]; error?: string }> =>
    ipcRenderer.invoke('kairo:getFileDeps', { file, workspacePath }),

  lensForCommit: (
    sha: string,
    workspacePath?: string
  ): Promise<{ ok: boolean; lens?: ChangeLens; error?: string }> =>
    ipcRenderer.invoke('kairo:lensForCommit', { sha, workspacePath }),

  getRankedDiff: (
    workspacePath?: string,
    sha?: string
  ): Promise<{ ok: boolean; hunks?: RankedHunk[]; error?: string }> =>
    ipcRenderer.invoke('kairo:getRankedDiff', { workspacePath, sha }),

  getPlugins: (
    workspacePath?: string,
    trustedNames?: string[]
  ): Promise<{ ok: boolean; plugins?: PluginManifest[]; error?: string }> =>
    ipcRenderer.invoke('kairo:getPlugins', { workspacePath, trustedNames }),

  installPlugin: (
    source: string,
    workspacePath?: string
  ): Promise<{ ok: boolean; name?: string; error?: string }> =>
    ipcRenderer.invoke('kairo:installPlugin', { source, workspacePath }),

  uninstallPlugin: (
    name: string,
    workspacePath?: string
  ): Promise<{ ok: boolean; name?: string; error?: string }> =>
    ipcRenderer.invoke('kairo:uninstallPlugin', { name, workspacePath }),

  updatePlugin: (
    name: string,
    workspacePath?: string
  ): Promise<{ ok: boolean; name?: string; error?: string }> =>
    ipcRenderer.invoke('kairo:updatePlugin', { name, workspacePath }),

  getMarketplaces: (workspacePath?: string): Promise<{ ok: boolean; sources?: string[]; error?: string }> =>
    ipcRenderer.invoke('kairo:getMarketplaces', { workspacePath }),

  addMarketplace: (
    source: string,
    workspacePath?: string
  ): Promise<{ ok: boolean; name?: string; error?: string }> =>
    ipcRenderer.invoke('kairo:addMarketplace', { source, workspacePath }),

  removeMarketplace: (
    source: string,
    workspacePath?: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('kairo:removeMarketplace', { source, workspacePath }),

  browseMarketplace: (
    source: string
  ): Promise<{ ok: boolean; marketplace?: Marketplace; error?: string }> =>
    ipcRenderer.invoke('kairo:browseMarketplace', { source }),

  saveFlow: (flow: unknown, workspacePath?: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('kairo:saveFlow', { flow, workspacePath }),

  getFlow: (scenario: string, workspacePath?: string): Promise<{ ok: boolean; flow?: unknown }> =>
    ipcRenderer.invoke('kairo:getFlow', { scenario, workspacePath }),

  getWhyRecords: (workspacePath?: string): Promise<{ ok: boolean; records?: unknown[] }> =>
    ipcRenderer.invoke('kairo:getWhyRecords', { workspacePath }),

  recordWhy: (records: unknown[], workspacePath?: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('kairo:recordWhy', { records, workspacePath }),

  askBrain: (
    question: string,
    evidence: Evidence
  ): Promise<{ ok: boolean; answer?: string; error?: string }> =>
    ipcRenderer.invoke('kairo:askBrain', { question, evidence }),

  contextUsage: (
    sessionId: string,
    maxTokens?: number
  ): Promise<{ ok: boolean; usage?: { tokens: number; maxTokens: number; ratio: number; shouldCompact: boolean }; error?: string }> =>
    ipcRenderer.invoke('kairo:contextUsage', { sessionId, maxTokens }),

  rollbackChanges: (
    workspacePath?: string
  ): Promise<{ ok: boolean; result?: { restored: number; deleted: number }; error?: string }> =>
    ipcRenderer.invoke('kairo:rollbackChanges', { workspacePath }),
  resetCheckpoint: (workspacePath?: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('kairo:resetCheckpoint', { workspacePath }),
  checkpointCount: (workspacePath?: string): Promise<{ ok: boolean; count: number }> =>
    ipcRenderer.invoke('kairo:checkpointCount', { workspacePath }),

  recordDrill: (correct: boolean, workspacePath?: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('kairo:recordDrill', { correct, workspacePath }),
  getDrills: (workspacePath?: string): Promise<{ ok: boolean; results: boolean[] }> =>
    ipcRenderer.invoke('kairo:getDrills', { workspacePath }),

  saveNightwatch: (record: NightwatchSession, workspacePath?: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('kairo:saveNightwatch', { record, workspacePath }),
  loadNightwatch: (workspacePath?: string): Promise<{ ok: boolean; record: NightwatchSession | null }> =>
    ipcRenderer.invoke('kairo:loadNightwatch', { workspacePath }),
  clearNightwatch: (workspacePath?: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('kairo:clearNightwatch', { workspacePath }),

  getCoupling: (
    workspacePath?: string
  ): Promise<{ ok: boolean; edges?: CouplingEdge[]; error?: string }> =>
    ipcRenderer.invoke('kairo:getCoupling', { workspacePath }),

  getServiceGraph: (
    roots: string[]
  ): Promise<{ ok: boolean; graph?: ServiceGraph; error?: string }> =>
    ipcRenderer.invoke('kairo:getServiceGraph', { roots }),

  discoverServices: (
    workspacePath?: string
  ): Promise<{ ok: boolean; roots?: string[]; error?: string }> =>
    ipcRenderer.invoke('kairo:discoverServices', { workspacePath }),

  recordDecision: (
    entry: string,
    workspacePath?: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('kairo:recordDecision', { entry, workspacePath }),

  recordFeedback: (
    text: string,
    rating?: number
  ): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('kairo:recordFeedback', { text, rating }),

  recordGateDecision: (
    decision: GateDecision,
    workspacePath?: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('kairo:recordGateDecision', { decision, workspacePath }),

  getGateDecisions: (
    workspacePath?: string
  ): Promise<{ ok: boolean; decisions: GateDecision[] }> =>
    ipcRenderer.invoke('kairo:getGateDecisions', { workspacePath }),

  // ── Map Delta: change log + "last seen" anchor ──────────────────────────
  recordChange: (
    change: ChangeRecord,
    workspacePath?: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('kairo:recordChange', { change, workspacePath }),

  getChanges: (
    workspacePath?: string
  ): Promise<{ ok: boolean; changes: ChangeRecord[] }> =>
    ipcRenderer.invoke('kairo:getChanges', { workspacePath }),

  getLastSeen: (
    workspacePath?: string
  ): Promise<{ ok: boolean; at: number }> =>
    ipcRenderer.invoke('kairo:getLastSeen', { workspacePath }),

  markSeen: (
    at?: number,
    workspacePath?: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('kairo:markSeen', { at, workspacePath }),

  planCrew: (
    task: string,
    roles?: CrewRoleConfig[]
  ): Promise<{ ok: boolean; plan?: CrewPlan; error?: string }> =>
    ipcRenderer.invoke('kairo:planCrew', { task, roles }),

  runCrew: (
    crewId: string,
    sessionId: string,
    task: string,
    roles?: CrewRoleConfig[],
    strategy?: CrewStrategy,
    plan?: CrewPlan
  ): Promise<{ ok: boolean; summary?: string; reason?: string; error?: string; lens?: ChangeLens }> =>
    ipcRenderer.invoke('kairo:runCrew', { crewId, sessionId, task, roles, strategy, plan }),

  abortCrew: (crewId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('kairo:abortCrew', { crewId }),

  getSessions: (): Promise<SessionMeta[]> =>
    ipcRenderer.invoke('kairo:getSessions'),

  loadSession: (sessionId: string): Promise<SessionFile | null> =>
    ipcRenderer.invoke('kairo:loadSession', { sessionId }),

  createSession: (input?: {
    name?: string
    workspaceRoot?: string
    model?: string
  }): Promise<SessionFile> => ipcRenderer.invoke('kairo:createSession', input ?? {}),

  saveSession: (session: SessionFile): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('kairo:saveSession', session),

  deleteSession: (sessionId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('kairo:deleteSession', { sessionId }),

  renameSession: (sessionId: string, name: string): Promise<SessionMeta | null> =>
    ipcRenderer.invoke('kairo:renameSession', { sessionId, name }),

  executeCommand: (sessionId: string, command: string, args?: string[]): Promise<unknown> =>
    ipcRenderer.invoke('kairo:executeCommand', { sessionId, command, args }),

  approveToolCall: (decision: PermissionDecision): Promise<void> =>
    ipcRenderer.invoke('kairo:approveToolCall', decision),

  openFolder: (path?: string): Promise<string | null> =>
    ipcRenderer.invoke('kairo:openFolder', { path }),

  approveWrite: (toolCallId: string, accepted: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('kairo:approveWrite', { toolCallId, accepted }),

  saveFile: (filePath: string, content: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('kairo:saveFile', { filePath, content }),

  applyDiff: (filePath: string, content: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('kairo:applyDiff', { filePath, content }),

  readFile: (filePath: string): Promise<{ ok: boolean; content?: string; error?: string }> =>
    ipcRenderer.invoke('kairo:readFile', { filePath }),

  listDir: (dirPath: string): Promise<Array<{ name: string; path: string; type: 'file' | 'directory' }>> =>
    ipcRenderer.invoke('kairo:listDir', { dirPath }),

  gitStatus: (workspacePath: string): Promise<{
    ok: boolean
    error?: string
    branch?: string
    staged?: Array<{ path: string; status: string }>
    modified?: Array<{ path: string; status: string }>
    untracked?: Array<{ path: string; status: string }>
  }> => ipcRenderer.invoke('kairo:gitStatus', { workspacePath }),

  gitQuickCommit: (
    workspacePath: string,
    files: string[],
    message: string
  ): Promise<{ ok: boolean; hash?: string; error?: string }> =>
    ipcRenderer.invoke('kairo:gitQuickCommit', { workspacePath, files, message }),

  terminalExec: (
    command: string,
    cwd: string
  ): Promise<{ ok: boolean; stdout?: string; stderr?: string; exitCode?: number | null; error?: string }> =>
    ipcRenderer.invoke('kairo:terminalExec', { command, cwd }),

  grepFiles: (
    searchPath: string,
    pattern: string,
    include?: string,
    maxResults?: number
  ): Promise<Array<{ file: string; line: number; text: string }>> =>
    ipcRenderer.invoke('kairo:grepFiles', { searchPath, pattern, include, maxResults }),

  listAllFiles: (
    workspacePath: string
  ): Promise<Array<{ name: string; relativePath: string; absolutePath: string }>> =>
    ipcRenderer.invoke('kairo:listAllFiles', { workspacePath }),

  watchFolder: (folder: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('kairo:watchFolder', { folder }),

  // MCP management
  getMcpServers: (): Promise<McpServerStatus[]> =>
    ipcRenderer.invoke('kairo:getMcpServers'),

  addMcpServer: (config: McpServerConfig): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('kairo:addMcpServer', config),

  removeMcpServer: (name: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('kairo:removeMcpServer', { name }),

  enableMcpServer: (name: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('kairo:enableMcpServer', { name }),

  disableMcpServer: (name: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('kairo:disableMcpServer', { name }),

  getMcpTools: (): Promise<McpToolInfo[]> =>
    ipcRenderer.invoke('kairo:getMcpTools'),

  // Event subscriptions (main -> renderer); each returns an unsubscribe function
  onToken: (listener: (token: StreamToken) => void): Unsubscribe =>
    subscribe<StreamToken>('kairo:token', listener),

  onToolCall: (listener: (event: ToolCallEvent) => void): Unsubscribe =>
    subscribe<ToolCallEvent>('kairo:toolCall', listener),

  onToolResult: (listener: (event: ToolResultEvent) => void): Unsubscribe =>
    subscribe<ToolResultEvent>('kairo:toolResult', listener),

  onTurnEnd: (listener: (event: TurnEndEvent) => void): Unsubscribe =>
    subscribe<TurnEndEvent>('kairo:turnEnd', listener),

  onPermissionRequest: (listener: (request: PermissionRequest) => void): Unsubscribe =>
    subscribe<PermissionRequest>('kairo:permissionRequest', listener),

  onError: (listener: (error: { code: string; message: string }) => void): Unsubscribe =>
    subscribe<{ code: string; message: string }>('kairo:error', listener),

  onFileChange: (listener: (event: FileChangeEvent) => void): Unsubscribe =>
    subscribe<FileChangeEvent>('kairo:fileChange', listener),

  onCodeMapChanged: (listener: (payload: { map: CodeMap }) => void): Unsubscribe =>
    subscribe<{ map: CodeMap }>('kairo:codeMapChanged', listener),

  onStateUpdate: (listener: (state: StateUpdate) => void): Unsubscribe =>
    subscribe<StateUpdate>('kairo:stateUpdate', listener),

  onWritePreview: (listener: (event: WritePreviewEvent) => void): Unsubscribe =>
    subscribe<WritePreviewEvent>('kairo:writePreview', listener),

  onActivity: (listener: (event: ActivityEvent) => void): Unsubscribe =>
    subscribe<ActivityEvent>('kairo:activity', listener),

  onCrewEvent: (listener: (event: CrewEvent) => void): Unsubscribe =>
    subscribe<CrewEvent>('kairo:crew', listener),

  onTerminalData: (listener: (event: { type: 'stdout' | 'stderr'; text: string }) => void): Unsubscribe =>
    subscribe<{ type: 'stdout' | 'stderr'; text: string }>('kairo:terminalData', listener),

  onTerminalExit: (listener: (event: { exitCode: number | null }) => void): Unsubscribe =>
    subscribe<{ exitCode: number | null }>('kairo:terminalExit', listener)
}

export type KairoAPI = typeof kairoAPI

contextBridge.exposeInMainWorld('kairoAPI', kairoAPI)
