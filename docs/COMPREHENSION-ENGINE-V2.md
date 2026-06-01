# Comprehension Engine v2 — 如何让人快速理解一个陌生项目

> 这不是一份 PRD，是一份思考文档。目标是想清楚"理解"到底是什么，现有工具（包括我们自己的 v1）哪里不对，以及 v2 应该做什么。

---

## 1. 高手是怎么理解一个陌生项目的

通过观察资深工程师接手新项目的行为，可以归纳出几层递进的理解：

### 第一层：地形感知（5 分钟）

"这个项目大概是什么东西？用什么语言/框架？大概有多大？"

高手的做法：看 README、看目录结构、看 build 文件（pom.xml / package.json）。不看代码。

**工具覆盖度：IDE 基本够用。**

### 第二层：流（Flow）理解（30 分钟 - 2 小时）

"一个请求进来，经过了什么？数据怎么变形的？什么状态被改了？"

高手的做法：
- 找 1-2 个核心用户场景（如"下单"、"登录"）
- 从入口（Controller / API endpoint）开始，沿调用链跟到数据库/消息队列
- 重点关注 **数据流转**（入参→校验→转换→持久化→出参）和 **副作用**（发消息、写日志、改缓存）
- 画一个心理模型："这个请求经过 A → B → C，在 B 处分叉，如果失败走 D"

**这是 v1 完全没有覆盖的。** 依赖图是静态的"谁依赖谁"，不是动态的"一个请求怎么走"。一个模块可以依赖另一个但从未在某个场景中调用它。

### 第三层：Why 理解（持续积累）

"为什么这里要用观察者模式？为什么这个字段不能为 null？为什么要特殊处理这个 case？"

高手的做法：
- 看 git blame + commit message（"为什么被改成这样"）
- 找 PR description 和 code review 讨论（"当时的决策上下文"）
- 找文档里的 ADR（Architecture Decision Record）
- 直接问人

**v1 的 Brain 只存了 gate 决策的 why，太窄了。** 真正的 why 分散在 git 历史、PR 讨论、Slack 对话、人的脑子里。

### 第四层：雷区感知（经验积累）

"哪里改了会出意外？哪些假设不能违反？"

高手的做法：
- 靠踩过坑（或看别人踩坑）
- 靠 code review 中的 "小心这里" 注释
- 靠系统性地理解 **不变量**（"金额操作必须幂等"、"这个表的 status 字段是状态机，只能按 A→B→C 走"）

**v1 有 protected globs 和 gate rules，但太粗粒度。** 真正的雷区是语义级的（"这个函数的返回值被 10 个地方缓存了，改返回类型会炸"），不是路径级的。

### 第五层：亲手验证（不可替代）

"我改一行看什么炸了，跑起来看实际数据长什么样。"

**任何工具、任何可视化都无法替代动手的理解。** 但工具可以缩短"从不知道改哪里到找到那一行"的路径。

---

## 2. 现有工具覆盖了什么，遗漏了什么

| 理解层次 | IDE | Code Review | 文档 | v1 理解力仪器 |
|---|---|---|---|---|
| 地形感知 | ✅ 文件树/搜索 | | ✅ README | ✅ Code Map |
| Flow 理解 | ⚠️ Find Usages（手动逐层跟） | ⚠️ PR diff（碎片化） | ⚠️ 通常缺 | ❌ 完全没有 |
| Why 理解 | ⚠️ git blame | ✅ PR 讨论 | ⚠️ ADR 通常不全 | ⚠️ Brain 只存 gate 决策 |
| 雷区感知 | ❌ | ⚠️ 依赖 reviewer 经验 | ❌ | ⚠️ protected globs 太粗 |
| 亲手验证 | ✅ 跑+调试 | | | ❌ |

**最大的空白是 Flow。** 没有任何现有工具能回答 "用户下单这个场景，代码是怎么走的？" 除非你自己跟一遍 Find Usages。

---

## 3. AI 时代特有的理解挑战

当代码是 AI 写的（crew/agent/Copilot），人面对一个额外的问题：**你没有经历写的过程。**

手写代码时，你理解每一行因为你写了它。AI 写的 40 个文件，你只看了 diff，审了 gate 的问题——你以为你理解了，但你没有。你理解的是 "AI 改了什么" ，不是 "系统现在是怎么工作的"。

这意味着：
- **理解力衰减比手写时代快得多**（AI 每天产出的变更量远超人手写）
- **表面审查不等于理解**（点 Approve ≠ 知道系统怎么工作）
- **需要一种工具帮人"补上"没有经历写的过程而缺失的理解**

---

## 4. v1 理解力仪器的自我批评

### 有效的
- **Comprehension Gate**：真正做到了"只在高杠杆决策点打断人"，比 200 行 PR review 有效
- **Verification Ledger**：反橡皮图章——把"跑了什么"变成"该验的没验"，直击 review theater
- **Architecture Deviation 检测**：新建依赖/成环 → 真实的异常信号，不是噪音
- **与系统对话（Grounded Q&A）**：每句标 [E#] 引用，永不退化成无引用 prose

### Vanity metric（看着好看但没用）
- **理解力 0%**：首次打开必定 0%，给人焦虑但不给出路（已在 A2 修复）
- **Track Record（auto/验证/采纳率）**：这些数字回答 "AI 表现如何"，不回答 "你理解了什么"
- **Drift Trend sparkline**：微小的折线图，没有任何人会因为看到它而采取行动

### 方向性错误
- **Code Map（星座图）**：289 个模块的依赖图 → 信息密度约等于零。没有人通过看一幅模块依赖图就理解了一个项目。**依赖 ≠ 理解。** 高手理解的是 flow / why / 雷区，不是"谁 import 了谁"。
- **7 个面板堆砌**：OnboardingTour / Drill / Preflight / Replay / ServiceMap / BrainChat / RankedDiff 放在同一个 dock 里 → 认知过载。用户不知道该从哪个开始。（已在 A3 部分缓解）

---

## 5. v2 核心原语设计

v2 的北极星：**不展示结构，讲述故事。** 帮人获得 Flow + Why + 雷区 三层理解。

### 原语 1：Flow Tracer（场景级调用路径）

用户输入一个场景（"用户下单"），系统从代码中**推演**出这个场景的调用路径：

```
Controller.createOrder()
  → OrderService.validate(request)
  → InventoryClient.deduct(sku, qty)    [RPC, 可能失败]
  → OrderDAO.insert(order)              [DB 写入]
  → MessageProducer.send("order.created") [副作用: 消息]
  → return OrderResponse(orderId)
```

不是 Find Usages 那种"这个函数被谁调用"（被动、要人自己跟），而是"这个场景从头到尾怎么走"（主动叙事）。

**实现路径**：LLM + 代码上下文（入口文件内容 + 沿调用链 read_file 跟几层）。不需要完美，80% 准确 + 人校正 > 不存在。结果可持久化，后续变更时标记"这个 flow 可能已经过时"。

### 原语 2：Why Extractor（决策考古）

对任何一段代码，回答"为什么是这样"：

```
Q: 为什么 OrderService.validate() 里要特判 amount == 0？

A: 这个特判在 2024-03-15 由 zhangle 加入（commit abc123），
   PR #456 的描述说："线上发现 0 元订单绕过了风控，加特判拦截"。
   这段代码最后一次被改是 2024-09-01（commit def789），改了错误消息但逻辑没变。
```

**实现路径**：git blame + commit message + LLM 总结。如果有 GitHub/GitLab PR API 接入，可以拉 PR 讨论。核心是把分散在多个系统里的 why 聚合到代码旁边。

### 原语 3：Narrative Feed（"你需要知道的 3 件事"）

取代当前的 7 个面板堆砌。打开 Code Map 时不是显示一个静态图 + 一堆折叠面板，而是一个**按重要性排序的事件流**：

```
1. 🔴 auth 模块昨天被 AI 改了 3 个文件，没有跑测试。你需要看一下。
2. 🟡 新的 pay→inventory 依赖被引入（之前没有这个调用路径）。是故意的吗？
3. 🟢 上周修的那个 bug（订单幂等问题）的修复仍然在位，没有被后续 commit 改掉。
```

这回答的是"我现在需要知道什么"——不是"系统长什么样"（那是给入门者的），而是"自从我上次看以来，发生了什么重要的事"（给持续跟进者的）。

**实现路径**：已有 Map Delta / git history / Change Lens 的数据，只需要一个**排序+叙事层**把它们变成人话，而不是一堆指标面板。

### 原语 4：Guided Exploration（引导式亲手试）

不能替代亲手试，但可以缩短路径：

```
"你说你想理解下单流程。我建议你：
1. 在 OrderController.java 第 42 行打个断点
2. 用这个 curl 命令触发一个下单请求：curl -X POST ...
3. 观察 InventoryClient.deduct() 的入参和返回值
4. 注意 MessageProducer.send() 的消息体结构"
```

这是 Flow Tracer 的"动手版"——不只告诉你 flow 是什么，引导你亲身验证它。

**实现路径**：LLM 根据 Flow Tracer 的结果生成调试步骤。v2 scope 是生成文本引导，不涉及 IDE 集成（那是 v3）。

---

## 6. 验证标准（怎么判断"理解了"）

不能用"看了多少"来衡量理解。两个更好的代理指标：

1. **能回答场景问题**："如果库存不足，下单会怎样？" → 能答出 InventoryClient 抛异常 → OrderService 捕获 → 返回 400 → 消息不发 = 理解了。不能答 = 没理解。

2. **能预测变更影响**："如果我改 OrderDAO.insert 的返回值类型，会影响什么？" → 能答出 OrderService 用了返回的 orderId → Controller 也用了 → 前端也解析了 → 需要同步改 = 理解了。

v2 的 Drill 系统应该生成这类**场景级问题**（"如果 X 发生会怎样？"），而不是当前的拓扑问题（"谁依赖 shared？"）。拓扑问题考的是记忆力，场景问题考的是理解力。

---

## 7. 落地优先级

| 优先级 | 原语 | 为什么 | 依赖 |
|---|---|---|---|
| **P0** | Narrative Feed | 最小改动最大收益：已有数据 → 排序+叙事 | Map Delta + git history 已有 |
| **P1** | Flow Tracer | 填补最大空白 | LLM + read_file 工具链 |
| **P2** | Why Extractor | 强化 Brain，从 gate-only 扩到全代码 | git blame + LLM |
| **P3** | Guided Exploration | Flow Tracer 的下游 | Flow Tracer |

不需要一次做完。P0 可以在当前架构上改造（把面板堆砌→事件 feed），不需要新的基建。P1 需要一个新的 LLM 工具调用流，但可以复用现有 BrainChat 的架构。

---

## 8. 与 v1 的关系

v1 不需要被"推翻"，而是被**重新排列**：

- **保留并强化**：Comprehension Gate、Verification Ledger、Architecture Deviation、Grounded Q&A
- **重新定位**：Code Map 从"主角"变成"背景地图"，Flow Tracer 的调用路径可以叠在上面
- **降级或移除**：Track Record / Drift sparkline / 理解力百分比 → 如果 Narrative Feed 能更好地回答"我现在需要知道什么"，这些数字就不再需要
- **改造**：7 个面板 → Narrative Feed 整合（已在 A3 部分开始）

核心转变：**从"展示指标让人自己判断"到"直接告诉人该关注什么"。**
