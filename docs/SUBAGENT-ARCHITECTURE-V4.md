# Subagent Architecture v4 — 从"工具调用"到"一等公民"

> 参考 claude-code 的 Agent 设计，重新思考 kairo-code-desktop 的 subagent 架构。边设计边反思。

---

## 问题

当前 `spawn_subagent` 是注册在 `DefaultToolRegistry` 里的一个工具，和 `read_file`/`bash` 平级。

这导致三个层次的问题：

### 1. 机械层面：超时

Tool executor 有统一超时（60s）。subagent 在大项目上读多个文件、做多轮推理，60s 经常不够。用户看到 "Tool 'spawn_subagent' timed out after 60000ms"——这不是 subagent 的错，是把长生命周期的东西塞进了短生命周期的框里。

### 2. 语义层面：LLM 不知道什么时候该用

LLM 看到 `spawn_subagent` 和 `read_file` 在同一个工具列表里，它把 subagent 当成"一个更慢的 read_file"。结果是：
- 该用 subagent 的时候直接 read_file 了（因为更快）
- 不该用 subagent 的时候用了（因为 tool description 太泛）
- 用了但任务描述太模糊（因为 LLM 不理解 subagent 的能力边界）

### 3. 架构层面：subagent 不是工具

工具是**操作**——读文件、写文件、跑命令。subagent 是**委派**——"你去调查这个问题，用你需要的任何工具，回来告诉我结论"。这是两个完全不同的抽象层级。

Claude Code 的做法是对的：Agent 是一个一等公民，不在 tool registry 里。

---

## Claude Code 的 Agent 设计（参考 claude-code-best）

### Agent 工具的定义

Claude Code 的 Agent（`src/tools/agent.ts`）是一个特殊工具，但它的行为和普通工具完全不同：

```
名称: Agent
参数:
  - prompt: string        # 任务描述
  - subagent_type: string # 子 agent 类型（claude/Explore/Plan/code-reviewer/...）
  - isolation: 'worktree' # 可选：在独立 worktree 中运行
  - model: string         # 可选：模型覆盖
  - mode: string          # 权限模式
```

### 关键设计决策

1. **Agent 类型注册表**：不是一种 agent，是多种。`Explore` 只读、快速扫描；`Plan` 设计方案；`code-reviewer` 审查代码。每种类型有不同的工具集、系统提示、权限范围。

2. **独立上下文窗口**：subagent 有自己的完整 conversation context，不和主 agent 共享。主 agent 只看到最终结果（一个文本摘要），不看到 subagent 的工具调用细节。

3. **Worktree 隔离**：`isolation: 'worktree'` 让 subagent 在一个独立的 git worktree 里工作——它可以修改文件而不影响主 agent 的工作目录。

4. **前台/后台**：`run_in_background: true` 让 subagent 在后台跑，主 agent 继续处理其他事情，完成后收到通知。

5. **结果不是 tool result**：普通工具的结果是一段文本。Agent 的结果是"另一个 agent 的完整工作成果"——可能是一份分析报告、一组代码修改、一个调查结论。

---

## 反思 1：kairo-code-desktop 需要哪些 agent 类型？

Claude Code 有通用的 `claude` + 专用的 `Explore`/`Plan`/`code-reviewer`。kairo-code-desktop 应该有什么？

| 类型 | 职责 | 工具集 | 超时 |
|---|---|---|---|
| **Explore** | 只读搜索/扫描 | read_file, grep, list_directory, git_log | 120s |
| **Analyze** | 深度理解（读代码+推理） | read_file, grep, understand_system | 180s |
| **Code** | 写代码/修改文件 | 全部（read/write/edit/bash） | 300s |
| **Review** | 审查变更 | read_file, grep, git_diff | 120s |
| **Research** | 调研（可能需要网络） | read_file, grep, 可选 MCP 工具 | 300s |

主 agent 根据任务决定 spawn 哪种类型：
- "这个文件里有什么？" → 不 spawn，直接 read_file
- "调查一下 auth 模块的安全风险" → spawn Analyze
- "修这个 bug" → spawn Code（如果任务明确）或直接自己做
- "帮我审查最近的 PR" → spawn Review

### 反思：需要这么多类型吗？

Claude Code 一开始也只有一个通用 `claude` 类型，后来才加了 `Explore`。核心区别只有两个维度：
- **读/写** — 能不能修改文件？
- **时长** — 快速扫描还是深入分析？

也许 v4 只需要两种：`Explore`（只读 + 快）和 `Worker`（可写 + 慢）。

---

## 反思 2：subagent 和 Crew 的关系

当前 kairo-code-desktop 有两个并行的"委派"机制：
- **spawn_subagent**：单个 subagent，从 tool registry 调用
- **Crew**：多个角色，从 composer mode 切换触发

它们的区别：
- Subagent 是主 agent **自己决定**要不要 spawn 的
- Crew 是**用户手动选择**"Crew 模式"触发的
- Subagent 结果回到主 agent 的上下文里
- Crew 结果作为聊天流的一条独立消息

**Claude Code 的做法**：没有"Crew"这个概念。它有 `Team`——但 Team 是由 Agent 工具组成的。主 agent spawn 多个 Agent，每个 Agent 独立工作，结果汇总。TeamCreate/SendMessage 是协调原语，但底层都是 Agent。

**kairo-code-desktop 应该统一吗？**

我的判断：**应该，但分两步**。

第一步（v4）：把 `spawn_subagent` 从 tool 升级为一等公民 Agent，支持类型/隔离/后台。Crew 暂时保持独立（它有自己的 plan gate + DAG 执行 + Change Lens，这些和 subagent 机制不在同一层）。

第二步（v5 远期）：Crew 变成"主 agent spawn 多个 Agent 的编排模式"，而不是一个独立的 UI 入口。这就是 V3 设计文档里的"自动路由"——主 agent 根据任务复杂度自动决定是单 agent 做还是组 team。

---

## 反思 3：subagent 的结果应该怎么返回？

当前 `spawn_subagent` 返回一段文本（subagent 的最终输出）。这有两个问题：

1. **信息压缩**：subagent 可能读了 20 个文件、做了 10 轮推理，最终浓缩成一段 200 字的总结。主 agent 丢失了所有中间推理。

2. **不可审计**：用户只看到"spawn_subagent → (一段文字)"，不知道 subagent 做了什么。

Claude Code 的做法：
- subagent 的完整对话记录保存在 transcript 文件里
- 主 agent 只看到最终文本摘要
- UI 里可以展开查看 subagent 的完整工具调用 trace（我们已有这个：subagent trace 展开功能）

**改进点**：让 subagent 返回**结构化结果**，而不只是文本。

```ts
interface AgentResult {
  summary: string           // 给主 agent 看的摘要
  confidence: number        // 0-1，主 agent 可以决定是否需要二次验证
  filesRead: string[]       // 读了哪些文件
  filesChanged?: string[]   // 改了哪些文件（Code 类型）
  findings?: Finding[]      // 结构化发现（Review/Analyze 类型）
}
```

---

## 反思 4：超时和取消

当前 subagent 的超时是 tool executor 层面的 60s 硬限制。这不对。

正确的做法：
- **没有硬超时**——subagent 跑多久由它的 `maxIterations` 控制
- **有心跳**——subagent 每调用一个工具就发一个 activity event（已有）
- **可取消**——主 agent（或用户）可以随时 abort subagent（`subagentFactory.spawn` 已有 abort 机制，但 tool executor 层不知道）
- **后台模式**——长任务不阻塞主 agent

实现：subagent 不走 tool executor 的超时路径。它有自己的生命周期管理。

---

## 反思 5：权限模型

当前 subagent 用 `ALLOW_ALL` 权限（绕过所有审批）。这在 subagent 只有 read-only 工具时是安全的，但如果 subagent 有 write/bash 工具，就不安全了。

Claude Code 的做法：
- 每种 agent 类型有自己的 `permissionMode`
- Explore agent 默认 bypassPermissions（只读无风险）
- Code agent 继承主 agent 的权限模式
- 用户可以 per-spawn 覆盖

kairo-code-desktop 应该跟进：
- Explore/Analyze/Review：read-only → ALLOW_ALL
- Code：继承主 agent 权限（可能需要审批 write_file/bash）
- Research：read-only + MCP → ALLOW_ALL（MCP 工具的权限由 MCP 自身控制）

---

## 实施方案

### Phase 1：Agent 类型注册表 + 分离生命周期

- 定义 `AgentType`（id, label, systemPrompt, tools, permission, maxIterations, timeout）
- 内置两种：`Explore`（只读, 10 iterations）和 `Worker`（全工具, 20 iterations）
- `spawn_subagent` 工具的 schema 增加 `agentType` 参数
- subagent 生命周期从 tool executor 超时中分离——用自己的 maxIterations 控制
- 插件可以贡献 agent 类型（已有：PluginAgent → CrewRoleConfig，扩展到 AgentType）

### Phase 2：结构化结果 + 改进的 trace 展示

- `SubagentResult` 从 `{ text, tokensUsed }` 扩展为 `{ summary, confidence, filesRead, ... }`
- UI trace 展示：在 subagent trace 卡片里显示 filesRead 列表 + confidence 指标
- 主 agent 的系统提示说明何时用 Agent（"用 Agent 做深入调查，用 read_file 做简单查询"）

### Phase 3：后台模式 + 取消

- `spawn_subagent` 增加 `background: boolean` 参数
- 后台 subagent：主 agent 继续处理后续消息，subagent 完成后注入一条通知
- 取消 UI：subagent 执行中，工具块显示"取消"按钮

### Phase 4（远期）：Crew 统一

- Crew 变成"主 agent spawn N 个 Worker Agent + 协调"的模式
- Plan Gate 变成主 agent 的一个 "plan then confirm" 流程（不是独立 UI）
- Agent/Crew toggle 真正消失——主 agent 自己决定

---

## 不做的事

1. **不做 worktree 隔离（v4 范围内）**——需要 git worktree 基建，复杂度高，单独做
2. **不做 inter-agent 通信**——Claude Code 的 SendMessage 是 Team 协作用的；v4 只做主 agent → subagent 的单向委派
3. **不做动态 agent 类型选择**——v4 靠 LLM 在 agentType 参数里选（给好 description 就行）；不做额外的分类器

---

## 与 Claude Code 的差异（有意的）

| Claude Code | kairo-code-desktop | 原因 |
|---|---|---|
| Agent 是 SDK 级的一等公民 | Agent 仍走 tool registry（但有特殊的超时/权限处理） | kairo-ts 的 AgentBuilder 已经是一等公民，不需要在 desktop 层再造一个 |
| Team/SendMessage 多 agent 协作 | Crew 独立机制 | Crew 的 plan gate + DAG + Change Lens 已经成熟，不值得重写 |
| 10+ agent 类型（Explore/Plan/code-reviewer/...） | 2 种（Explore + Worker） | 先证明架构对，再扩展类型 |
