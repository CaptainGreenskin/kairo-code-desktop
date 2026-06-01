# Visual Redesign — 从"能用"到"想用"

> 参考 Cursor 3.0 / Claude.ai / Linear / opencode 的设计语言。

---

## 当前问题（审计结论）

| 问题 | 严重度 | 数据 |
|---|---|---|
| **字体乱飞** | 🔴 | 6 种像素大小（9/10/11/12/13/14px），390 处硬编码 |
| **按钮没有组件** | 🔴 | 30+ 组件各自画按钮，padding/size/radius 全不一致 |
| **没有阴影体系** | 🟡 | 仅 19 处使用默认 shadow，无层级感 |
| **颜色单调** | 🟡 | 只有蓝色 accent，缺少温暖/活力感 |
| **没有微交互** | 🟡 | hover 只有 color transition，无 scale/transform |
| **sidebar 像 90 年代** | 🟡 | 无头像、无分组视觉、session 卡片太素 |

---

## 设计原则

1. **克制** — 不追求花哨，追求清晰。每个像素都有理由。
2. **层级分明** — 用阴影+背景色区分层次，不用线条。
3. **一致** — 同类元素长得一样。按钮就是按钮，不管在哪个组件里。
4. **呼吸** — 给内容足够的空间。现在很多地方太紧凑。
5. **温暖** — 深色主题不等于冰冷。加一点微妙的暖色让它有生命感。

---

## 一、Typography Scale（4 级就够）

参考 opencode（13/14/16/20px）和 Linear，收敛为 4 个语义 token：

```css
--text-xs: 11px;    /* 标签、时间戳、辅助信息 */
--text-sm: 13px;    /* 次要文本、按钮、表单 */
--text-base: 14px;  /* 正文、消息、主要内容 */
--text-lg: 16px;    /* 标题、强调 */
--text-xl: 20px;    /* 页面标题（少用）*/
```

**行动**：全局替换 390 处 `text-[Npx]`：
- `text-[9px]` → `text-xs`（或直接删掉，9px 太小了）
- `text-[10px]` / `text-[11px]` → `text-xs`
- `text-[12px]` / `text-[13px]` → `text-sm`
- `text-[14px]` → `text-base`

---

## 二、Button Component（4 变体 × 2 尺寸）

```tsx
// src/renderer/components/ui/Button.tsx
interface ButtonProps {
  variant: 'primary' | 'secondary' | 'ghost' | 'danger'
  size: 'sm' | 'md'
  icon?: boolean  // icon-only (square)
  children: React.ReactNode
  // ...standard button props
}
```

| 变体 | 样式 |
|---|---|
| **primary** | `bg-accent text-white hover:bg-accent-hover shadow-xs` |
| **secondary** | `bg-surface-2 text-text-primary border border-border hover:bg-surface-3` |
| **ghost** | `text-text-secondary hover:text-text-primary hover:bg-surface-2` |
| **danger** | `bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20` |

| 尺寸 | 样式 |
|---|---|
| **sm** | `text-xs px-2 py-1 rounded-md` (11px) |
| **md** | `text-sm px-3 py-1.5 rounded-lg` (13px) |
| **icon sm** | `w-7 h-7 rounded-md` |
| **icon md** | `w-8 h-8 rounded-lg` |

所有按钮统一加 `transition-all duration-150`。

---

## 三、Shadow / Elevation System

参考 opencode 的 shadow 体系，定义 3 级：

```css
--shadow-xs: 0 1px 2px rgba(0,0,0,0.05);                    /* 卡片 */
--shadow-md: 0 4px 12px rgba(0,0,0,0.1);                     /* 浮层、下拉 */
--shadow-lg: 0 12px 40px rgba(0,0,0,0.15);                   /* 模态、对话框 */
/* Focus ring */
--shadow-focus: 0 0 0 2px var(--color-accent), 0 0 0 4px rgba(59,130,246,0.2);
```

**哪里加阴影**：
- 输入框 focus → `shadow-focus`
- 下拉菜单/命令面板 → `shadow-md`
- 模态对话框 → `shadow-lg`
- 卡片（session 项、plugin 行） → `shadow-xs` on hover

---

## 四、Color Refinement

当前的颜色没大问题但缺乏**温度**。调整：

```css
/* 暗色主题：从纯蓝灰 → 微暖灰 */
--color-surface-0: #09090b;   /* 纯黑底 → Zinc 900 */
--color-surface-1: #121215;   /* 微暖 */
--color-surface-2: #1c1c22;   /* 微暖 */
--color-surface-3: #27272e;   /* 微暖 */
--color-border: #2e2e38;      /* 微暖边框 */

/* Accent: 从纯蓝 → 带紫的蓝（更有品牌感） */
--color-accent: #6366f1;       /* Indigo 500 */
--color-accent-hover: #4f46e5; /* Indigo 600 */

/* 新增：柔和的品牌渐变（用于特殊场景） */
--color-gradient-start: #6366f1;
--color-gradient-end: #8b5cf6;
```

---

## 五、Input Redesign

当前输入框太素。参考 Claude.ai 的输入框：

```
┌─────────────────────────────────────────────────────────┐
│  Ask anything...                              ⚡  →    │
│                                                         │
│  ⌘K palette · / commands · @file                       │
└─────────────────────────────────────────────────────────┘
```

- 更大的 padding（`py-3 px-4`）
- 柔和的内阴影（`shadow-inner`）
- Focus 时有 accent 发光（`ring-2 ring-accent/30`）
- 工具提示在输入框内部底部（而不是框外面）
- 发送按钮更明显（filled accent，不是 ghost）

---

## 六、Sidebar Redesign

参考 Linear 的侧边栏：

- **Session 卡片**：不只是文字列表，每个 session 是一个微卡片（hover 有 subtle shadow）
- **分组**：Today / Yesterday / This Week / Older（而不是平铺）
- **图标**：session 旁边有一个小图标（根据内容类型——代码/对话/crew 分不同图标）
- **底部工具栏**：Settings / Open Folder 用图标按钮，不是全宽文字按钮

---

## 七、Message Bubble Redesign

参考 Claude.ai：

- **用户消息**：右对齐，accent 背景色淡化（`bg-accent/8`），圆角更大（`rounded-2xl`）
- **AI 消息**：左对齐，无背景色（内容就是内容），markdown 渲染更好
- **工具调用块**：折叠式，不是全展开——默认只显示"✓ read_file"一行，点击展开看 args/result
- **间距**：消息之间有更多呼吸空间（`gap-4` 而不是 `gap-1`）

---

## 八、Micro-interactions

- **按钮 hover**：不只变色，加 `scale(1.02)` 微缩放
- **面板展开**：用 framer-motion 的 spring（不是线性）
- **消息出现**：从下方 fadeIn + slideUp（不是瞬间出现）
- **工具调用完成**：✓ 打勾有一个小 pop 动画
- **输入框 focus**：border 颜色 + 发光 ring 同时变化

---

## 实施顺序

| Step | 改动 | 影响面 | 时间 |
|---|---|---|---|
| **S1** | Typography scale（收敛 6→4 级） | 全局 390 处 | ~1h |
| **S2** | Button 组件 + 全局替换 | 30+ 组件 | ~2h |
| **S3** | Color/shadow/input 升级 | index.css + InputBar | ~1h |
| **S4** | Sidebar 改造 | Sidebar.tsx | ~1h |
| **S5** | Message bubble 改造 | MessageBubble.tsx + ChatPanel | ~1h |
| **S6** | Micro-interactions | 全局 | ~30min |

总计约 6-7h。每步都可以 build + 截图验证。
