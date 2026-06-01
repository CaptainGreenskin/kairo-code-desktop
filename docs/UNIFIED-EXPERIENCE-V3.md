# Unified Experience v3 — 一个入口，什么都能做

> 设计文档。边设计边反思，每处标注。

---

## 问题

截图说明了一切：用户面前有三个独立的交互面——Agent（底部输入框）、Crew（底部 toggle）、Code Map（右下角按钮打开独立 dock）。它们各自有自己的输入、自己的输出区、自己的状态。

这不是"功能太多"的问题，是**入口太多**的问题。用户不应该需要判断"这个问题该在 Agent 里问还是在 Code Map 对话里问"——这个判断本身就说明架构错了。

---

## 反思 1：为什么会变成三个入口？

因为是增量开发的。先有 Agent（基本对话）→ 加了 Crew（多角色协作）→ 加了 Code Map（理解仪表盘）。每个阶段都觉得"新东西放哪里？给它一个自己的面板吧"。

这是**功能驱动的设计**——每个功能有自己的 UI。应该是**任务驱动的设计**——用户有一个任务，系统决定用什么功能完成它。

Claude Code 就是一个入口。你输入什么它都处理——问问题、写代码、跑命令、调工具。它不会让你切到另一个面板去"问系统"。

---

## 反思 2：Code Map dock 应该是什么？

v1 的定位是"理解力仪表盘"——一个独立的面板，放地图、指标、7 个工具。v2 把 BrainChat 升级成了主内容区。但它仍然是一个**独立 dock**，有自己的对话框。

**Code Map 不应该是一个交互面。** 它应该是一个**上下文面板**——像 IDE 的 Outline View 或 Terminal 面板。它展示信息（地图、指标、事件 feed），但交互发生在主聊天区。

类比：
- VS Code 的 Outline → 展示当前文件的结构，但编辑在编辑器里
- Chrome DevTools 的 Network tab → 展示请求信息，但操作在页面里
- Code Map → 展示系统结构和理解状态，但提问和操作在主聊天里

---

## 反思 3：Agent/Crew toggle 的本质是什么？

用户切 Agent/Crew 是在说"我想一个人做"还是"我想派一个团队做"。但这真的需要用户自己判断吗？

**Claude Code 的做法**：用户只管输入。系统判断要不要 spawn subagent、要不要并行。用户不需要提前选"单 agent 模式"或"多 agent 模式"。

**kairo-code-desktop 应该做同样的事**。取消 Agent/Crew toggle，让系统根据任务复杂度自动决定：
- "这个项目是什么？" → 单 agent 读代码回答
- "重构 auth 模块" → 自动组 crew（Planner + Coder + Reviewer）
- "修这个 bug" → 单 agent 直接改

**但这需要一个智能路由**——比当前的 toggle 难做得多。可以分两步：
1. 先统一入口（合并 UI），保留用户手动选模式（/crew 命令或快捷键切换）
2. 后面做自动路由（LLM 判断任务复杂度→自动选单/多 agent）

---

## 设计方案

### 布局：两栏制

```
┌──────────────────────────────────────────────────────┐
│  Sidebar          │  Main Chat Area                  │
│  ┌──────────┐     │  ┌──────────────────────────────┐│
│  │ Sessions │     │  │  Chat messages               ││
│  │ Files    │     │  │  (Agent + Crew + Lens + Gate) ││
│  │ Git      │     │  │                              ││
│  │ Map  ←NEW│     │  │  Crew results inline ✓       ││
│  └──────────┘     │  │  Tool calls inline ✓         ││
│                   │  │  Code Map insights inline ✓  ││
│  当 Map tab 被选中:│  │                              ││
│  ┌──────────┐     │  ├──────────────────────────────┤│
│  │ 理解力 %  │     │  │  Input bar                   ││
│  │ Feed事件  │     │  │  (统一入口，不区分模式)       ││
│  │ 模块图    │     │  └──────────────────────────────┘│
│  │ 图例     │     │                                  │
│  └──────────┘     │                                  │
└──────────────────────────────────────────────────────┘
```

**核心变化：**
1. **Code Map 从右侧 dock → 左侧 sidebar 的一个 tab**（和 Sessions/Files/Git 并列）
2. **删除 Code Map 里的"与系统对话"输入框**（合并进主聊天的输入框）
3. **Agent/Crew toggle 保留但降级**：不在输入框旁边占位置；改为 `/crew` 命令或 `⌘⇧C` 快捷键切换（已有），默认是 Agent

### 侧栏 Map tab 的内容

从现在的 Code Map dock 精简而来，**只保留展示性内容**：

1. **理解力条**（ComprehensionHealthBar）— 总分 + 进度条
2. **Narrative Feed**（3-5 条事件）— 点击事件 → 主聊天自动填入相关问题
3. **迷你地图**（CodeMapView 缩小版）— 展示模块拓扑，hover 看依赖
4. **图例**（一行）

**删掉的：**
- "与系统对话"输入框（合并进主聊天）
- "更多工具"折叠（OnboardingTour/Drill/Preflight/ServiceMap → 通过 `/` 命令访问）
- Replay slider（通过命令访问）
- Ask the Map 查询框（用主聊天的输入框问就行）

### 主聊天的统一输入

一个输入框，什么都能做：

```
用户输入                          → 系统行为
───────────────────────────────────────────────────
普通对话/问题                    → Agent 模式，直接回答
/crew 重构 auth 模块             → 切 Crew 模式，组队执行
这个项目的核心模块有哪些？        → Agent 读代码回答（tool-augmented）
shared 模块的依赖关系？           → Agent 用 Code Map evidence 回答
```

**关键改动：主 agent 获得 Code Map 的上下文。** 不再需要单独的 BrainChat agent——把 gatherEvidence + Code Map 数据注入主 agent 的系统提示。

### 反思 4：主 agent 怎么获得 Code Map 上下文？

两种方式：

**方案 A（简单）**：每次主 agent 开始新 turn 时，把 Code Map 的 Narrative Feed 注入系统提示的末尾。这样 agent 始终知道"系统最近发生了什么变化"。

优点：简单，不需要额外 tool call。
缺点：系统提示变长，token 消耗增加。

**方案 B（精准）**：给主 agent 加一个 `understand_system` 工具，LLM 按需调用。

```ts
// 主 agent 的新工具
understand_system({ question: "shared 模块的依赖关系" })
→ 调用 gatherEvidence(question, { map, decisions, commits, changes })
→ 返回结构化 evidence
```

优点：精准，只在需要时消耗 token。
缺点：LLM 可能不知道何时该调用这个工具（特别是隐含的 Code Map 问题，如"这个项目怎么样"）。

**我选方案 A + B 结合**：系统提示注入 Narrative Feed 摘要（一段简短的"你正在工作的系统的最新状态"），同时注册 `understand_system` 工具供深度查询。

---

### 反思 5：Crew 结果放在哪里？

现在 Crew 结果已经在聊天流里了（CrewRunBlock 组件）——这是对的。统一后不变。

但 Crew 的**计划审批**（Plan Gate）目前在 CrewPanel（底部弹出）。统一后应该也在聊天流里——像一条特殊的 assistant 消息：

```
ASSISTANT (Team Lead):
  我建议的方案：Planner → Coder → Reviewer
  预计影响模块：auth, pay
  [Approve & Run]  [Edit Plan]  [Cancel]
```

用户在聊天里直接审批，不需要弹出另一个面板。

---

### 反思 6：File Tree / Git Panel 的角色

现在 Sidebar 有 Sessions / Files / Git 三个 tab。加 Map 后变成四个。

**更好的分法**：不按功能分 tab，按**上下文需求**分：

- **会话 tab**（默认）：Session 列表 — 就是现在的
- **工作区 tab**：Files + Git + Map 合并 — "你在操作的系统的全貌"

这减少了 tab 数量（4→2），同时把相关信息放在一起。但这是进一步的优化，第一步先简单地加 Map tab 就行。

---

## 实施分期

### 第一步：Map 移到侧栏（纯布局重构，不改逻辑）

- 把 Code Map dock 从 App.tsx 右侧 → 侧栏新 tab
- 删除 BrainChat 的输入框和回答区域（保留 Narrative Feed 在 Map tab 展示）
- 保留 ⌘⇧M 快捷键（改为切到 Map tab 而不是打开 dock）
- **不改主 agent 逻辑**——Code Map 只是换了个位置

预计改动：App.tsx（布局）、Sidebar.tsx（新 tab）、CodeMap.tsx（去掉对话区+dock容器→sidebar panel 容器）

### 第二步：主 agent 获得 Code Map 上下文

- 系统提示注入 Narrative Feed 摘要（纯文本，10-15 行）
- 注册 `understand_system` 工具到主 agent
- 主 agent 能回答 "shared 模块的依赖？" 这类以前只有 Code Map 对话能答的问题

预计改动：agent.ts（系统提示 + 工具注册）、tools.ts（新工具定义）

### 第三步：Plan Gate 内联到聊天流

- CrewPanel 的 PlanReview 组件改为 ChatPanel 里的一种特殊消息类型
- 用户在聊天里审批 Crew 计划
- CrewPanel 只保留执行期的 live status 展示（底部条或 toast）

### 第四步（远期）：自动路由

- 删除 Agent/Crew toggle
- 主 agent 根据任务复杂度自动决定是否组 Crew
- `/crew` 命令作为手动 override 保留

---

## 不做的事

1. **不动 Crew 的执行引擎**（DAG executor、role library、crew coordinator 完全不改）
2. **不动 Change Lens / Comprehension Gate / Verification Ledger**（这些 v1 做对的东西原样保留）
3. **不重写 CodeMapView SVG 图**（图本身的渲染逻辑不变，只是容器从 dock 变成 sidebar panel）
4. **不做自动路由的 LLM 判断**（第四步是远期，不在这轮）

---

## 反思 7：这个方向对吗？

回到最初的问题：用户说"太割裂了"。

**割裂的根源**是我们在不同阶段给不同功能各自造了 UI。统一入口是正确的方向——Claude Code 证明了单入口可以覆盖所有场景。

但要注意一个 tradeoff：**单入口意味着失去了视觉上的"这里有个功能"的提醒。** 现在用户看到 Agent/Crew toggle 就知道"哦可以切 Crew"。统一后如果没有视觉提示，用户可能不知道 Crew 功能存在。

解决方法：**不是 toggle 按钮，而是输入提示**。placeholder 可以写 "Ask anything · /crew for team · ⌘⇧M for map"——用文字提示功能存在，但不用独立按钮占空间。

---

## 最终的 mental model

对用户来说：

> Kairo Code 就是一个聊天窗口。你问什么它都能答——理解代码、修改代码、组队协作。左边侧栏能看到文件、git 状态和系统地图。但你不需要去侧栏里"操作"什么——所有操作都在聊天里完成。

对开发者来说：

> 主 agent 是唯一的交互层。Code Map 的理解能力（evidence、Narrative Feed、tools）注入主 agent。Crew 的协作能力通过 /crew 命令触发。侧栏只展示上下文，不是交互面。
