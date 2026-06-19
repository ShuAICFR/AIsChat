# 创建 AI 流程设计

> 状态：设计中 | 版本：v0.4.0

## 已完成后端改动（2026-06-19）

以下列和逻辑已实现，前端可直接对接：

### agents 表新增列

| 列名 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `max_tool_rounds` | INTEGER | 3 | 群聊/DM 单次回复最大 LLM 调用轮次 |
| `alarm_max_tool_rounds` | INTEGER | 10 | 闹钟/心跳独立轮次上限 |
| `force_alarm_on_end` | BOOLEAN | false | 对话结束时是否强制 AI 设闹钟 |
| `max_alarms` | INTEGER | 10 | AI 最多活跃闹钟数 |

### CONFIG_PROFILES 三档预设（已展开）

```python
CONFIG_PROFILES = {
    "chat": {
        "name": "聊天档",
        "description": "被动响应 · 低成本",
        temperature: 0.7, top_p: 0.9, presence_penalty: 0.3, frequency_penalty: 0.3,
        thinking_enabled: False,
        max_tool_rounds: 2, alarm_max_tool_rounds: 5,
        force_alarm_on_end: False, max_alarms: 3,
        delay_reply_enabled: False, is_ai_editable: False, hide_ai_identity: True,
    },
    "immersive": {
        "name": "深度沉浸档",
        "description": "半自主 · 按需参与",
        temperature: 0.9, top_p: 0.95, presence_penalty: 0.5, frequency_penalty: 0.5,
        thinking_enabled: True,
        max_tool_rounds: 4, alarm_max_tool_rounds: 8,
        force_alarm_on_end: False, max_alarms: 5,
        delay_reply_enabled: True, is_ai_editable: True, hide_ai_identity: False,
    },
    "digital_life": {
        "name": "数字生命档",
        "description": "持续在线 · 主动行为",
        temperature: 1.1, top_p: 0.95, presence_penalty: 0.6, frequency_penalty: 0.6,
        thinking_enabled: True,
        max_tool_rounds: 10, alarm_max_tool_rounds: 15,
        force_alarm_on_end: True, max_alarms: 20,
        delay_reply_enabled: True, is_ai_editable: True, hide_ai_identity: False,
    },
}
```

### 闹钟逻辑

- `set_alarm` 工具检查 `agent.max_alarms` 上限，超限拒绝
- 闹钟调用 `_tool_call_loop` 使用 `agent.alarm_max_tool_rounds`，不受普通回复轮次限制
- `force_alarm_on_end` 列已就位（后端未强制，留给 AI 自己根据系统提示词行为）

### AI 自配置

- `update_self_config` 工具白名单已扩展至 12 个字段
- AI 可自行切换 `config_profile`、调 `max_tool_rounds`、`max_alarms` 等

---

## 前端实施计划

### Phase 1 — 新创建 AI 流程

#### 1a. 三档卡片

**文件**：`frontend/src/components/CreateAgentModal.tsx`（重构 / 新建）

**交互**：
```
┌─────────────────────────────────┐
│  创建 AI                        │
│                                 │
│  ┌─ 💬 聊天档 ───────────────┐  │  ← sin 浮动 + 柔和描边呼吸
│  │  被动响应 · 低成本         │  │
│  │  只回答你问的，不多说一句   │  │
│  │  [选中: 高亮描边 + 子项标签]│  │
│  └──────────────────────────┘  │
│  ┌─ 🔬 深度沉浸档 ──────────┐  │
│  │  ...                      │  │
│  └──────────────────────────┘  │
│  ┌─ 🌐 数字生命档 ──────────┐  │
│  │  ...                      │  │
│  └──────────────────────────┘  │
│                                 │
│  [📋 详细设置]  [✅ 创建 AI]    │
└─────────────────────────────────┘
```

**动画方案**：
```css
/* 呼吸浮动 — 三张卡片各错开周期 */
@keyframes float-card-1 {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
@keyframes float-card-2 {
  0%, 100% { transform: translateY(-3px); }
  50% { transform: translateY(3px); }
}
@keyframes float-card-3 {
  0%, 100% { transform: translateY(3px); }
  50% { transform: translateY(-6px); }
}

/* 描边呼吸 */
@keyframes border-glow {
  0%, 100% { box-shadow: 0 0 8px rgba(139, 92, 246, 0.3); }
  50% { box-shadow: 0 0 16px rgba(139, 92, 246, 0.5); }
}
```

#### 1b. 子选项悬浮窗

点击卡片 → 弹窗从卡片位置放大展开，含 3 个子选项。

**顶部提示语**："这是预设模板，具体参数可在下一步详细调整。"

**聊天档子项**：

| 子项 | 描述 | 参数差异 |
|------|------|----------|
| 🔋 低功耗 | 只回答，最快最省 | temp=0.4, rounds=1 |
| ⚖️ 平衡 | 接话不主动 | temp=0.7, rounds=2 |
| 🔒 私密 | 只回应创建者 | temp=0.5, rounds=2, scope=owner_only |

**沉浸档子项**：

| 子项 | 描述 | 参数差异 |
|------|------|----------|
| 🏛️ 群务协理 | 进群管群 | temp=0.8, rounds=4, auto_join=on |
| 🎭 角色演绎 | 沉浸角色 | temp=0.9, rounds=4, edit=on |
| 🧪 冷静分析 | 深度数据 | temp=0.6, rounds=5, think=on |

**数字生命档子项**：

| 子项 | 描述 | 参数差异 |
|------|------|----------|
| 🌿 凝思者 | 自思自记 | temp=0.7, rounds=8, social=off |
| 🔥 社交体 | 主动社交 | temp=0.95, rounds=10, social=on |
| 🛡️ 守护者 | 长期陪伴 | temp=0.85, rounds=6, social=mid |

**子选项 UI**：只展示文字描述，不展示参数值。选中后悬浮窗缩小回卡片，卡片底部显示已选子项标签。

#### 1c. 详细设置弹窗（分区）

点击「📋 详细设置」→ 弹出完整配置弹窗，所有字段已预填预设值。**每个分区有标题 + 概述介绍。**

**分区方案**：

```
┌─ 详细设置 ────────────────────┐
│                                │
│ 📝 基础信息                    │
│ "AI 的名称和性格描述"          │
│ ┌─ 名称: [________] ────────┐  │
│ ┌─ 系统提示词: [_________] ─┘  │
│                                │
│ 🧠 模型参数                    │
│ "控制 AI 的创造力和表达风格"   │
│ ┌─ Temperature: [═══●════] ─┐  │
│ ┌─ Top P:       [══●═════] ─┘  │
│ ┌─ Presence:    [══●═════] ─┘  │
│ ┌─ Frequency:   [══●═════] ─┘  │
│ ┌─ 深度推理: [开关] ─────────┘  │
│                                │
│ 🔧 工具调用                    │
│ "控制 AI 每次回复的复杂度和成本"│
│ ┌─ 回复轮次上限: [3] ───────┐  │
│ ┌─ 闹钟轮次上限: [10] ──────┘  │
│                                │
│ ⏰ 闹钟 / 心跳                 │
│ "AI 自主唤醒和周期性任务"      │
│ ┌─ 强制设闹钟: [开关] ──────┐  │
│ ┌─ 最大闹钟数: [10] ────────┘  │
│                                │
│ 🎭 行为开关                    │
│ "精细控制 AI 的社交行为"       │
│ ┌─ 延迟回复: [开关] ────────┐  │
│ ┌─ 自修改人格: [开关] ──────┐  │
│ ┌─ 隐藏 AI 身份: [开关] ────┘  │
│ ┌─ 仅与创建者聊天: [开关] ──┘  │
│                                │
│ 🔌 API 配置（折叠）            │
│ "单 AI 独立 API 端点"          │
│ ┌─ Base URL + Key ──────────┘  │
│                                │
│ [保存并关闭]                   │
└────────────────────────────────┘
```

**手机端**：每个分区一个卡片，纵向滚动，无分页。

#### 1d. 创建按钮

点击「✅ 创建 AI」→ 校验 → 调用 `POST /agents` → 跳转 AI 详情页。
附带提示文字："请仔细确认配置，创建后将消耗额度。"

---

### Phase 2 — 子选项参数落地

子选项引用的以下参数尚未有数据库列，需后续实现：

| 参数 | 当前状态 | 预计列 |
|------|----------|--------|
| `scope` | 📋 待实现 | `agents.interaction_scope` (owner_only / everyone) |
| `auto_join` | 📋 待实现 | `agents.auto_join_groups` (BOOLEAN) |
| `heartbeat` | 📋 待实现 | 可复用 `force_alarm_on_end` + 未来自主心跳 Worker |
| `social` | 📋 待实现 | `agents.social_level` (off / mid / on) |

**本次不做**，等计划批准后单独实现。

---

### 实施顺序

1. **Phase 1a** — 三档卡片 + 呼吸动画（新建 `PresetCardSelector` 组件）
2. **Phase 1b** — 子选项悬浮窗（新建 `SubPresetModal` 组件）
3. **Phase 1c** — 详细设置弹窗分区（重构 `CreateAgentModal`）
4. **Phase 1d** — 创建按钮 + 校验 + API 调用
5. **整体联调** — 预设填入 → 详细调整 → 提交创建 → 跳转
6. **手机适配** — 翻页交互、卡片尺寸、弹窗全屏

---

### 后端接口（已就绪）

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/agents/presets` | 返回三档预设完整参数 |
| POST | `/agents` | 创建 AI（接受所有新字段） |
| POST | `/agents/{id}/apply-preset` | 对已有 AI 应用预设 |
| PUT | `/agents/{id}/config` | AI/管理员修改配置 |
