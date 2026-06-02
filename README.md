# ✦ Kairo Code

**The coding tool that makes sure you understand what AI builds for you.**

Every AI coding tool helps you write more code faster. Kairo Code is the only one that makes sure you still understand your codebase after AI writes thousands of lines for you.

---

## The Problem

AI writes code 100x faster than humans. But understanding doesn't scale the same way. After a week of AI-assisted coding, you have a codebase that *works* — but you don't know *how* it works.

Kairo Code solves this by making comprehension a first-class feature.

## Core Features

### 🧠 Comprehension Engine

Ask your codebase anything — in natural language.

- **"How does the auth flow work?"** → Traces the call chain across files, returns cited answers
- **"What changed while I was away?"** → Narrative Feed of the 3-5 things that matter
- **"Why is this function like this?"** → Git history + AI decision records

The AI reads your code, traces dependencies, and answers with file-path citations — no hallucination.

### 🗺️ Living System Map

A real-time module dependency graph derived from actual imports.

- **Context-aware**: shows only the modules relevant to your current task
- **Health score**: tracks how much of the changed system you still understand
- **Hotspot detection**: flags modules that are heavily depended on but rarely touched

### 🤖 Multi-Agent Crew

Delegate complex tasks to a team of specialized AI agents.

- **Planner → Coder → Reviewer** pipeline with DAG execution
- **Comprehension Gate**: AI can't merge changes you don't understand
- **Change Story**: every crew run generates a human-readable narrative of what changed

### 🔌 Plugin Platform

Extend everything with Claude-Code-compatible plugins.

- Slash commands, agents, lifecycle hooks, MCP servers
- Trust gate: code-running components only activate when you trust them
- Marketplace: discover and one-click install from plugin indexes
- `@kairo/plugin` upstream package for ecosystem reuse

## Quick Start

```bash
# macOS
open "Kairo Code.app"

# Or from source
git clone https://github.com/CaptainGreenskin/kairo-code-desktop
cd kairo-code-desktop
npm install
npm run dev
```

Configure your model in Settings (⌘,):
- **GLM**: API Key + Model `glm-5.1` (auto-detects Zhipu endpoint)
- **OpenAI**: API Key + any OpenAI-compatible model
- **Anthropic**: Switch provider to Anthropic + API Key

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| ⌘N | New chat |
| ⌘⇧M | Toggle Code Map |
| ⌘⇧C | Crew mode (multi-agent) |
| ⌘K | Command palette |
| ⌘P | Quick file open |
| ⌘⇧F | Find in files |
| ⌘, | Settings |
| ⌘B | Toggle sidebar |

## Architecture

```
src/
├── main/          # Electron main process (agent, tools, IPC)
├── renderer/      # React UI (Zustand stores, components, hooks)
├── shared/        # Pure functions (browser-safe, no Node deps)
└── preload/       # Electron preload bridge
```

- **Agent**: kairo-ts AgentBuilder + tool registry + hook system
- **Comprehension**: Code Map scan + Narrative Feed + understand_system tool
- **Plugins**: @kairo/plugin parsers + main/plugins.ts loader + trust gate
- **Testing**: 516 unit tests (vitest) + 43 e2e tests (Playwright + Electron)

## Design Philosophy

> **Optimize for human understanding, not AI output.**

1. Every AI change generates a human-readable story, not just a diff
2. Comprehension health decays as AI writes and you don't look
3. The system actively tells you what to pay attention to
4. Understanding accumulates implicitly as you work — no manual tracking

## Tech Stack

- **Framework**: Electron + React 18 + TypeScript
- **Styling**: Tailwind CSS v4 with design tokens
- **State**: Zustand
- **AI**: kairo-ts (AgentBuilder, HookRegistry, tool system)
- **Models**: GLM-5.1, OpenAI-compatible, Anthropic Claude

## License

MIT

---

**✦ Kairo Code** — *Because writing code is easy. Understanding it is hard.*
