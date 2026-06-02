/**
 * First-Run Setup Wizard — shown when no API key is configured.
 * Three steps: Provider → API Key → Workspace. Blocks access to the main
 * interface until complete. Inspired by Cursor's onboarding.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../stores/app-store'
import { Button } from './ui/Button'

type Provider = 'openai' | 'anthropic'

const PROVIDERS = [
  {
    id: 'openai' as Provider,
    name: 'GLM / OpenAI',
    desc: 'GLM-5.1, DeepSeek, Qwen, OpenAI 及所有兼容端点'
  },
  {
    id: 'anthropic' as Provider,
    name: 'Anthropic',
    desc: 'Claude Opus / Sonnet / Haiku'
  }
]

const STEP_ANIM = {
  initial: { opacity: 0, x: 40 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -40 },
  transition: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }
}

export function SetupWizard(): JSX.Element {
  const [step, setStep] = useState(0)
  const [provider, setProvider] = useState<Provider>('openai')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('glm-5.1')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null)

  const handleTestKey = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      // Quick validation: try a tiny completion
      const url = baseUrl || (model.startsWith('glm') ? 'https://open.bigmodel.cn/api/coding/paas/v4' : 'https://api.openai.com/v1')
      const res = await fetch(`${url}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 })
      })
      setTestResult(res.ok ? 'ok' : 'fail')
    } catch {
      setTestResult('fail')
    } finally {
      setTesting(false)
    }
  }

  const handleComplete = (): void => {
    // Save all settings
    useAppStore.getState().setProvider(provider)
    useAppStore.getState().setModel(model)
    useAppStore.getState().setApiKey(apiKey)
    useAppStore.getState().setBaseUrl(baseUrl)
    // Direct IPC push
    void window.kairoAPI?.updateConfig({
      provider,
      model,
      apiKey,
      ...(baseUrl ? { baseUrl } : {})
    })
    // Open folder picker
    void window.kairoAPI.openFolder().then((folder) => {
      if (folder) useAppStore.getState().setWorkspacePath(folder)
    })
    // Mark setup as done
    useAppStore.getState().setSetupDone(true)
  }

  return (
    <div className="fixed inset-0 bg-surface-0 flex items-center justify-center z-50">
      <div className="w-full max-w-lg px-8">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                i === step ? 'w-6 bg-accent' : i < step ? 'bg-accent/50' : 'bg-surface-3'
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div key="provider" {...STEP_ANIM} className="space-y-6">
              <div className="text-center">
                <div className="text-4xl mb-3">✦</div>
                <h1 className="text-xl font-semibold text-text-primary">欢迎使用 Kairo Code</h1>
                <p className="text-sm text-text-muted mt-1">选择你的 AI 模型提供商</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setProvider(p.id)
                      setModel(p.id === 'anthropic' ? 'claude-sonnet-4-6' : 'glm-5.1')
                    }}
                    className={`text-left p-4 rounded-xl border transition-all duration-150 hover-lift ${
                      provider === p.id
                        ? 'border-accent bg-accent/8 shadow-sm'
                        : 'border-border bg-surface-2/60 hover:border-accent/30'
                    }`}
                  >
                    <div className="text-sm font-semibold text-text-primary">{p.name}</div>
                    <div className="text-xs text-text-muted mt-0.5">{p.desc}</div>
                  </button>
                ))}
              </div>
              <div className="flex justify-end">
                <Button variant="primary" onClick={() => setStep(1)}>下一步</Button>
              </div>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div key="apikey" {...STEP_ANIM} className="space-y-5">
              <div className="text-center">
                <h1 className="text-xl font-semibold text-text-primary">配置 API Key</h1>
                <p className="text-sm text-text-muted mt-1">
                  {provider === 'anthropic' ? 'Anthropic API Key' : 'GLM / OpenAI 兼容 API Key'}
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-text-secondary mb-1 block">API Key</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => { setApiKey(e.target.value); setTestResult(null) }}
                    placeholder={provider === 'anthropic' ? 'sk-ant-...' : '你的 API Key'}
                    className="w-full px-3 py-2.5 rounded-lg bg-surface-2 border border-border text-sm text-text-primary outline-none focus:border-accent input-glow font-mono"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-xs text-text-secondary mb-1 block">Model</label>
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="glm-5.1"
                    className="w-full px-3 py-2.5 rounded-lg bg-surface-2 border border-border text-sm text-text-primary outline-none focus:border-accent font-mono"
                  />
                </div>

                {provider === 'openai' && (
                  <div>
                    <label className="text-xs text-text-secondary mb-1 block">Base URL <span className="text-text-muted">（GLM 留空自动检测）</span></label>
                    <input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="GLM 留空 · 其他填端点 URL"
                      className="w-full px-3 py-2.5 rounded-lg bg-surface-2 border border-border text-sm text-text-primary outline-none focus:border-accent font-mono"
                    />
                  </div>
                )}

                {/* Test connection */}
                {apiKey && (
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => void handleTestKey()} disabled={testing}>
                      {testing ? '测试中…' : '测试连接'}
                    </Button>
                    {testResult === 'ok' && <span className="text-xs text-success">✓ 连接成功</span>}
                    {testResult === 'fail' && <span className="text-xs text-danger">✗ 连接失败，请检查 Key 和 URL</span>}
                  </div>
                )}
              </div>

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(0)}>上一步</Button>
                <Button variant="primary" onClick={() => setStep(2)} disabled={!apiKey}>下一步</Button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="workspace" {...STEP_ANIM} className="space-y-6">
              <div className="text-center">
                <h1 className="text-xl font-semibold text-text-primary">打开一个项目</h1>
                <p className="text-sm text-text-muted mt-1">选择你要工作的代码目录</p>
              </div>

              <div className="flex flex-col items-center gap-4">
                <Button variant="primary" onClick={handleComplete} className="px-8 py-3 text-base">
                  📂 选择文件夹
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    // Skip workspace selection — just save API config
                    useAppStore.getState().setProvider(provider)
                    useAppStore.getState().setModel(model)
                    useAppStore.getState().setApiKey(apiKey)
                    useAppStore.getState().setBaseUrl(baseUrl)
                    void window.kairoAPI?.updateConfig({ provider, model, apiKey, ...(baseUrl ? { baseUrl } : {}) })
                    useAppStore.getState().setSetupDone(true)
                  }}
                  className="text-xs text-text-muted hover:text-text-secondary transition-colors"
                >
                  稍后再选 →
                </button>
              </div>

              <div className="flex justify-start">
                <Button variant="ghost" onClick={() => setStep(1)}>上一步</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
