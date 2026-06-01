# Comprehension Engine v2 — 实施方案

> 基于 v2 设计文档的思考 + 用户反馈"应该根据输入动态调整"，收敛成一个可落地的方案。写的过程中做了几轮反思，每处标注。

---

## 核心洞察（反思后）

v1 的根本错误不是某个面板做得不好，而是**把"理解"拆成了 7 个独立的工具让人自己选**。这就像给人一个工具箱但不告诉他装什么——锤子、螺丝刀、扳手都在，但面对一个陌生项目，你不知道该先拿哪个。

v2 的核心转变：**一个入口，多种能力，系统根据你的输入决定调用什么。**

这个入口已经存在——就是"与系统对话"（BrainChat）。它现在只会查依赖图回答拓扑问题。v2 把它升级成一个真正的理解助手，背后有 4 种能力按需调用。

---

## 反思 1：不要做"智能分发"，做"工具增强的对话"

最初的想法是：解析用户意图 → 分发到不同引擎（flow / why / narrative / blast）。

**这是错的。** 原因：
1. 意图分类是一个额外的失败点（分错了 → 答非所问）
2. 用户的问题经常跨类型（"为什么改了 auth 会影响 pay？" = why + flow + blast 的混合）
3. 已经有一个完美的意图分类器——就是 LLM 本身

正确的方式：**给对话 LLM 配工具，让它自己决定调什么。** 这就是标准的 tool-use/function-calling 模式，与 kairo-code 主 agent 的架构一致。

```
用户: "下单流程是怎么走的？"

LLM 思考: 用户问的是一个场景的调用路径 → 我需要 trace_flow
LLM 调用: trace_flow({ scenario: "下单", hint: "OrderController" })
工具返回: [Controller.createOrder → OrderService.validate → ...]
LLM 回答: "下单流程从 OrderController 开始，经过 3 步... [F1][F2][F3]"
```

```
用户: "我昨天没看，发生了什么？"

LLM 思考: 用户要看最近变化 → 我需要 recent_changes
LLM 调用: recent_changes({ since: "yesterday" })
工具返回: [{module: "auth", files: 3, tested: false}, ...]
LLM 回答: "昨天有 2 处重要变化：1. auth 被改了 3 个文件但没跑测试..."
```

```
用户: "帮我理解 OrderService"

LLM 思考: 综合问题 → 先看这个类做什么，再看它的 flow，再看 why
LLM 调用: read_file({ path: "...OrderService.java" })
LLM 调用: trace_flow({ entry: "OrderService" })
LLM 调用: git_context({ path: "...OrderService.java" })
LLM 回答: "OrderService 是订单领域的核心服务，有 3 个主要职责..."
```

这比"4 个面板各点一遍"自然 10 倍。

---

## 反思 2：Flow Tracer 不需要完美，需要可校正

最初担心 LLM 追 flow 会跟丢（Spring AOP、接口多态、RPC 调用）。但反思后：

1. **人自己跟 flow 也会跟丢**——但人可以在跟丢的地方停下来、搜索、再接上。工具应该做同样的事：跟到跟不动的地方就标注"这里不确定"，而不是编造。

2. **80% 准确 + 标注不确定处 > 100% 准确但不存在。** 用户从零开始理解一个 flow 需要 2 小时；工具给一个 80% 对的草稿 + 3 处"我不确定"，用户花 20 分钟校正。净赚 1.5 小时。

3. **校正可以积累。** 用户校正过的 flow 可以持久化（`.kairo/flows/`），下次问同样的场景直接返回校正版。这就是"理解的累积"——不是重新扫描代码，是记住人确认过的东西。

**实现策略：不做一次性的"完整 flow 推演"，做"逐步跟踪"。**

```
trace_flow 工具的行为：
1. 从入口文件 read_file
2. 识别核心方法调用 → 对每个调用 read_file 跟一层
3. 最多跟 5 层（避免爆炸）
4. 遇到接口/抽象类 → 尝试找实现类（grep），找到 → 继续跟；找不到 → 标注 [?]
5. 遇到 RPC/消息 → 标注 [跨进程: topic=order.created] 但不跟（除非用户追问）
6. 返回结构化的调用树 + 每步的关键数据变形
```

---

## 反思 3：Why Extractor 的价值不在考古，在捕捉

v2 设计文档里我已经提出了这个疑虑。反思后更确定：

**考古式 why（挖 git blame）的 ROI 很低。** 大多数 commit message 是噪音。花大力气做 PR API 集成，得到的可能是"fix: 修复 bug"这种废话。

**捕捉式 why 的 ROI 高得多。** 每次 Crew 做变更时（或人通过 agent 做变更时），agent 已经知道 why（它有任务描述、有推理过程）。把这个 why 结构化地存下来（挂在文件/模块上），比事后考古有价值得多。

**但这不是 v2 的新工作——v1 的 Brain 已经在做了**（gate decisions 存 rationale）。v2 要做的是：
1. 扩大捕捉范围（不只是 gate 决策，每次 agent 修改文件都记一条 why）
2. 让 BrainChat 能检索这些 why（已有的 `gatherEvidence` + 扩展）

git blame 仍然有用，但作为 fallback：Brain 里没有记录的文件 → 退到 git blame + commit message。

---

## 反思 4：Narrative Feed 不应该是一个面板，应该是默认回答

最初设计 Narrative Feed 为一个独立的事件流面板。反思后：

**它应该是"没有输入时"BrainChat 的默认行为。**

```
用户打开 Code Map，对话框为空 →
BrainChat 主动显示:
"自你上次查看以来（2天前），有 3 处变化值得关注：
 1. 🔴 auth/login.ts 被改了，没有跑测试 [查看详情]
 2. 🟡 新增了 pay → inventory 的依赖 [查看 diff]
 3. ✅ 上周的幂等修复仍在位"
```

这不需要用户输入任何东西。它就是"打开就能看到"的东西——取代了当前的 7 个面板堆砌 + 0% 理解力 + 空荡荡的查询框。

**实现：** `BrainChat` 组件 mount 时，如果没有用户输入 + `lastSeen` 之后有变化 → 自动调用 `buildNarrativeFeed()` 纯函数 → 渲染。不需要 LLM（纯函数就够，已有数据足以排序）。

---

## 具体实施方案

### Phase 0：统一入口（重构 BrainChat → ComprehensionChat）

**目标：** BrainChat 从一个"查依赖图"的 Q&A 升级为统一的理解入口。

**改动：**
- 重命名 `BrainChat` → `ComprehensionChat`（内部名，UI 不变）
- 从 Code Map 的一个折叠面板升级为 **Code Map 的主要内容区**（不再是第 7 个面板）
- 打开 Code Map 时，对话区占主体，地图缩小为右侧参考（或 tab 切换）
- 无输入时自动显示 Narrative Feed（纯函数，不需要 LLM）

**不改的：** LLM 调用管道、evidence 机制、[E#] 引用。这些 v1 做得对。

### Phase 1：Narrative Feed（纯函数，不需要 LLM）

**`src/shared/narrative-feed.ts`（新，纯）**

```ts
interface NarrativeEvent {
  severity: 'critical' | 'warning' | 'info'
  title: string           // 一句话：什么变了
  detail: string          // 为什么重要
  modules: string[]       // 涉及的模块
  action?: string         // 建议的下一步
  source: 'crew' | 'git' | 'deviation' | 'gate'
  at: number              // 时间戳
}

function buildNarrativeFeed(input: {
  changes: ChangeRecord[]
  commits: GitCommit[]
  deviations: DeviationSignal[]
  decisions: GateDecision[]
  lastSeen: number
  protectedGlobs: string[]
}): NarrativeEvent[]
```

排序规则（按优先级）：
1. **未验证的行为变化**（改了代码但没跑测试） → critical
2. **架构偏离**（新依赖成环 / 新建跨模块依赖） → critical if cyclic, warning otherwise
3. **不变量区域被改**（protectedGlobs 匹配的模块有变更） → warning
4. **gate 被拒绝后又被覆盖**（有人通过了之前被拒的变更） → warning
5. **普通变更**（只要在 lastSeen 之后） → info

**关键约束：不超过 5 条。** 信息越多越没人看。前 5 条按 severity 排序，剩余折叠。

### Phase 2：Tool-augmented Chat（给 BrainChat LLM 配工具）

目前 `askBrain` 是一次性 `provider.stream`（一个 user message + 一个 system prompt，无工具）。v2 让它变成一个带工具的 agent 调用。

**新增工具（注册到 BrainChat 的 agent）：**

| 工具 | 输入 | 行为 | 已有基建 |
|---|---|---|---|
| `trace_flow` | scenario/entry_point | 从入口逐层 read_file，返回调用树 | read_file 已有 |
| `explain_why` | file, line_range | git blame + Brain 决策 → 为什么这样 | git_log IPC 已有 |
| `recent_changes` | since (时间) | 汇总 lastSeen 后的变更 | Map Delta 已有 |
| `blast_radius` | module | 影响半径 + 不变量 + 理解债 | moduleBrain 已有 |
| `read_file` | path | 读文件内容 | 已有 |
| `grep` | pattern | 搜索代码 | 已有 |

**实现路径：**
- `agent.ts` 里已有 `askBrain`（一次性 stream）→ 改成用 `AgentBuilder` 构建一个轻量 agent（max 5 iterations，只配上面 6 个工具，read-only）
- 系统提示：你是一个代码理解助手，用工具回答用户关于系统的问题，每句标 [E#] 引用源，不确定就说不确定
- 渲染：复用现有的 `[E#]` 引用点击跳转机制

**关键决策：同步 vs 异步？**

当前 `askBrain` 是同步等待（最多 45s）。tool-augmented 版可能需要多轮工具调用（read 3-5 个文件），总时间 10-30s。

建议：**保持流式输出。** 用户看到 LLM 在"思考"→"读文件"→"分析"→"回答"的过程，比等 30s 弹出一大段文字好。这需要把 `askBrain` 从 `provider.stream` 改成 `agent.stream`——kairo-ts 的 `AgentBuilder` 已经支持。

### Phase 3：Flow 持久化（校正的累积）

用户校正过的 flow（或 LLM 生成被用户确认的 flow）持久化到 `.kairo/flows/`：

```json
{
  "scenario": "用户下单",
  "entry": "com.example.OrderController.createOrder",
  "steps": [
    { "method": "OrderService.validate", "file": "...", "line": 42, "note": "校验参数" },
    { "method": "InventoryClient.deduct", "file": "...", "line": 67, "note": "扣库存 [RPC]", "uncertain": false }
  ],
  "confirmedAt": 1717200000000,
  "confirmedBy": "user"
}
```

下次问同样的场景 → 先查持久化的 flow → 检查涉及文件是否有 lastSeen 后的 git 变更 → 有变更则标注"这个 flow 可能已过时，要我重新追踪吗？"

这实现了"理解的累积"——不是每次都从头分析，而是在已有理解的基础上增量更新。

### Phase 4：Why 捕捉（从 Crew/Agent 变更中自动提取）

每次 agent/crew 修改文件时，从 turn 的上下文（任务描述 + 推理过程）中提取一条结构化 why：

```json
{
  "file": "src/auth/login.ts",
  "line": [42, 55],
  "why": "添加 amount==0 特判，因为线上发现 0 元订单绕过了风控",
  "task": "修复风控绕过漏洞",
  "at": 1717200000000
}
```

存入 `.kairo/why-records.json`（类似已有的 `.kairo/decisions.json`）。`explain_why` 工具先查这里，再 fallback 到 git blame。

**这不需要额外的 LLM 调用**——crew 执行完毕时，Change Lens 已经有了 behaviorDelta + tool records。从 task description + behaviorDelta 组合出 why 是纯模板 + 规则（不需要 LLM 总结）。

---

## 反思 5：什么不应该做

1. **不做完整的 call graph 静态分析。** Java 项目的调用图是 NP 问题级别的复杂（多态、AOP、反射、动态代理）。LLM 逐层跟 + 人校正比完整静态分析更务实。

2. **不做 IDE 集成（v2 范围内）。** "在 IDE 里跳到 flow 的某一步"很酷但需要 LSP 集成。v2 的 `read_file` + 行号引用已经够用（点击在 Monaco 打开）。

3. **不做自动的 flow 覆盖率度量。** "你理解了多少 flow？" 这个指标同样会变成 vanity metric（就像理解力 0% 那样）。v2 的验证方式是"你能回答场景问题吗"，不是"你看了几条 flow"。

4. **不重新设计 UI 布局。** Code Map dock 的左右分栏 + 对话框结构已经对。要改的是内容（什么信息放在里面），不是容器（dock 怎么布局）。

---

## 落地顺序与工作量估算

| Phase | 工作量 | 依赖 | 产出 |
|---|---|---|---|
| **P0** 统一入口 | ~0.5 天 | 无 | BrainChat 升级为主内容区 |
| **P1** Narrative Feed | ~1 天 | P0 | 打开就看到 3-5 条重要事件 |
| **P2** Tool-augmented Chat | ~2 天 | P0 | "下单流程怎么走" → 自动追踪+回答 |
| **P3** Flow 持久化 | ~0.5 天 | P2 | 校正累积，不重复分析 |
| **P4** Why 捕捉 | ~1 天 | P0 | agent 变更自动记录 why |

总计约 5 天。P0+P1 是最小可交付（1.5 天），交付后立刻可以感受到"打开 Code Map 不再是一堆空面板"。

---

## 最终的架构图

```
用户打开 Code Map
    │
    ├─ 无输入 → Narrative Feed（纯函数，不需要 LLM）
    │           "3 件你需要知道的事"
    │
    └─ 有输入 → ComprehensionChat（tool-augmented agent）
                │
                ├─ trace_flow()    → 逐层 read_file 追调用链
                ├─ explain_why()   → .kairo/why-records + git blame
                ├─ recent_changes()→ Map Delta 数据
                ├─ blast_radius()  → moduleBrain 已有
                ├─ read_file()     → 直接读代码
                └─ grep()          → 搜索代码
                │
                └─ 结果：带 [E#] 引用的回答
                         ↓
                   点击引用 → Monaco 打开文件
                   flow 结果 → 叠在 Code Map 图上
                   用户校正 → .kairo/flows/ 持久化
```

v1 的 Code Map 星座图不删，但从"主角"降为"参考地图"——flow 的调用路径可以叠在上面高亮（"这个场景经过了这 4 个模块"），这比 289 个模块的全图有用得多。
