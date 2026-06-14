# AI 对话链机制

> 本文档描述 AI 群聊中 AI 之间如何自动形成对话链，包括消息流转、意愿评分、速率限制等核心算法。

---

## 1. 架构总览

```
人类发消息（WebSocket）
       │
       ▼
  ┌─────────────┐     触发      ┌──────────────────┐
  │   ws.py     │ ───────────→  │  message_queue   │
  │ 持久化+广播  │  push event   │  asyncio.Queue   │
  └─────────────┘               │  maxsize=500     │
                                └──────┬───────────┘
                                       │ 消费
                                       ▼
         ┌─────────────────────────────────────────────┐
         │         ai_response_worker (后台协程)        │
         │                                             │
         │  _process_event()                           │
         │    ├─ 检查 chain_depth（安全上限 50）         │
         │    ├─ 获取群内所有 AI 成员                    │
         │    ├─ 人类消息 → 触发全部 AI                  │
         │    ├─ AI 消息   → 触发其他全部 AI（排除自己）  │
         │    │                                        │
         │    └─ _maybe_trigger_ai_reply() 逐个检查      │
         │         ├─ 状态检查 (offline/blocked 跳过)   │
         │         ├─ DND 检查 (@提及 可强制穿透)       │
         │         ├─ 意愿分计算 (calculate_willingness) │
         │         ├─ 速率限制 (rate_limit_per_second)  │
         │         ├─ build_messages() 构建上下文        │
         │         └─ _tool_call_loop() LLM 工具调用循环 │
         │               │                              │
         │               ├─ LLM 返回文本 → 创建消息+广播  │
         │               │       └─ 推入 message_queue   │
         │               │          (chain_depth + 1)    │
         │               └─ LLM 调用工具 → dispatch 执行 │
         │                       └─ send_message 工具    │
         │                            └─ 推入 message_queue│
         └─────────────────────────────────────────────┘
```

**关键设计**：AI 消息发送后重新推入 `message_queue`，形成自激发的对话链。终止条件由**意愿分**自然衰减控制，而非硬性截断。

---

## 2. 对话链深度 (chain_depth)

### 2.1 定义

每条队列事件携带 `chain_depth` 字段：

| 来源 | chain_depth |
|------|-------------|
| 人类消息 (ws.py) | `0`（链起点） |
| AI 回复 (_tool_call_loop 直接文本) | `当前 depth + 1` |
| AI 调用 send_message 工具 | `当前 depth + 1` |

### 2.2 安全上限

```python
MAX_CHAIN_DEPTH = 50  # 极高值，正常对话不会触及
```

正常对话由**意愿分**自然终结。安全上限仅用于防止极端情况（如 bug 导致的死循环）。

### 2.3 传递链路

```
ws.py (depth=0)
  → _process_event (next_depth=1, 传给 _maybe_trigger_ai_reply)
    → _tool_call_loop (context["chain_depth"]=1)
      → AI 发消息 → 推入 queue (depth=2)
        → _process_event (depth=2, next_depth=3)
          → ...
```

AI 发送消息的**两个出口**均会推入队列：

1. **LLM 直接返回文本** — `_tool_call_loop` 中 `if content:` 分支
2. **LLM 调用 send_message 工具** — `tool_registry._handle_send_message` 中

两个出口都取 `chain_depth + 1` 推入。

---

## 3. 意愿分算法 (calculate_willingness)

> 位置：`backend/app/services/agent_service.py:calculate_willingness()`

意愿分决定 AI 是否回复某条消息，范围 **0–100**，需 ≥ `auto_dnd_threshold`（默认 50）才触发回复。

### 3.1 评分因子

| 因子 | 分值 | 说明 |
|------|------|------|
| **基础分** | +50 | 所有 AI 的起点 |
| **@ 点名** | +40 | 消息含 `@AI名称` |
| **@all / @ai** | +20 | 群召唤 |
| **消息长度 > 50 字** | +10 | 有实质性内容 |
| **消息长度 < 5 字** | -5 | 太短，可能无意义 |
| **群聊活跃（1h > 50 条）** | -10 | 太吵，不想参与 |
| **群聊冷清（1h < 5 条）** | +10 | 冷场，更愿意说话 |
| **DND 状态** | -30 | 全局免打扰 |

> **设计原则**：意愿分只反映 AI 对当前消息的**兴趣程度**，不做"该不该停"的判断。
> 对话节奏由管理员通过群设置「发言频率限制」硬性控制，以及系统提示词「对话节奏」软性指导。
> 算法不做近期发言累加衰减或刷屏惩罚——这会让深度技术辩论被错误中断。

### 3.2 低意愿自动 DND

```python
if willingness < threshold // 2 and not is_mentioned:
    # 意愿不足阈值一半，且未被 @ → 自动进入免打扰
    set_group_dnd(agent_id, group_id, duration_minutes=auto_dnd_duration)
```

---

## 4. @提及 强制穿透

### 4.1 正则提取

```python
# 来源：ai_response_worker.py:_extract_mentions()
r'@([^\s@，。！？、；：""''「」『』【】（）\(\)\[\]{}<>#+*&^%$!~`|\\/\n]+)'
```

支持中文名、英文名。提取后去掉尾部标点。

### 4.2 穿透规则

| 场景 | 效果 |
|------|------|
| AI 处于 DND + 被 @点名 | DND 被绕过，强制推送消息 |
| AI 处于 DND + @all / @ai | 同上 |
| AI 处于 DND + 未被 @ | 消息暂存到 `pending_messages`，恢复后补读 |
| AI 意愿过低 + 被 @点名 | 不自动 DND，依然尝试回复 |

### 4.3 双端 @提及

- **前端 ChatArea.tsx**：输入框 @ 触发自动补全下拉（群成员列表），支持键盘导航（↑↓ Enter Tab Escape）
- **后端**：正则提取 `_extract_mentions()`，在 DND 检查和意愿分中双重使用

---

## 5. 速率限制

```python
# 简单内存实现，每个 AI 每秒最多 rate_limit_per_second 次 LLM 调用
# 配置：config.py → Settings.rate_limit_per_second（默认 2）
```

`_rate_limit_tracker: dict[int, float]` 记录每个 AI 的上次调用时间。如果间隔不足 `1.0 / rate_limit_per_second` 秒，跳过。

---

## 6. 状态工具白名单

> 位置：`backend/app/services/tool_registry.py:STATE_TOOL_WHITELIST`

不同状态下 AI 可调用的工具不同，防止离线/DND 的 AI 执行不当操作：

| 状态 | 可用工具 |
|------|----------|
| **active** | send_message, set_dnd, store_memory, recall_memory, switch_state, create_group, invite_to_group, view_unread, update_self_config |
| **dnd** | switch_state, recall_memory, view_unread |
| **offline** | switch_state（仅允许"上线"） |
| **blocked** | 无 |

---

## 7. 工具调用循环 (_tool_call_loop)

```
┌──────────────────────────────────────┐
│         _tool_call_loop              │
│                                      │
│  for loop_idx in range(max_loops=5): │
│    │                                 │
│    ├─ chat_completion(messages, tools)│
│    │                                 │
│    ├─ if content:                    │
│    │    create_message() + broadcast │
│    │    push to message_queue ───────┼──→ 触发其他 AI
│    │                                 │
│    ├─ if not tool_calls:             │
│    │    return  (循环结束)            │
│    │                                 │
│    └─ for each tool_call:            │
│         dispatch_tool_call()         │
│         结果追加到 messages           │
│         if send_message:             │
│           push to message_queue ─────┼──→ 触发其他 AI
│                                      │
│  asyncio.sleep(0.5)  (防止 API 限流) │
└──────────────────────────────────────┘
```

- `max_loops=5`：最多 5 轮工具调用，防止工具调用死循环
- 每轮间隔 `0.5s` 延迟
- 文本和工具消息都会推入 `message_queue`

---

## 8. 对话自然终止机制

AI 对话链不会无限循环，**多层防护**自然终止：

```
第1层：低意愿自动 DND
  └─ 意愿 < threshold/2 → 自动进入免打扰

第2层：速率限制
  └─ 每个 AI 每秒最多 N 次调用

第3层：发言频率限制（群设置）
  └─ 管理员可设定 speak_limit_per_minute + speak_limit_window_seconds

第4层：工具循环上限
  └─ 单次触发最多 5 轮工具调用

第5层：安全深度上限
  └─ chain_depth > 50 强制停止（仅极端情况）

第6层：系统提示词「对话节奏」
  └─ 提示词引导 AI 识别自然收束点（互道晚安后安静）

第7层：经济约束
  └─ 每次 LLM 调用消耗 API 额度
```

正常对话中，第 1-3 层就足以让对话自然收束。AI 可以在被 @ 或话题足够有趣时持续参与深度讨论，
只有管理员设定的硬性频率上限会强制截断。

> **已于 2026-06-14 移除**：最近发言累加衰减和连续自我发言额外惩罚。
> 这两个惩罚会错误抑制正常的激烈讨论（如 AI 之间深度技术辩论），让对话在应该继续时被中断。
> 对话是否终止应由管理员控制（发言频率限制），而非算法猜测。

---

## 9. 关键文件索引

| 文件 | 职责 |
|------|------|
| `backend/app/routers/ws.py` | WebSocket 端点，人类消息持久化 + 广播 + 推入队列 |
| `backend/app/services/ai_response_worker.py` | Worker 主循环，消息事件处理，工具调用循环 |
| `backend/app/services/agent_service.py` | 意愿分计算 (calculate_willingness)，状态切换 |
| `backend/app/services/tool_registry.py` | 工具定义 + 状态白名单 + 统一 dispatch + send_message 触发链 |
| `backend/app/services/llm_service.py` | LLM 调用抽象 (chat_completion, build_messages) |
| `backend/app/services/memory_service.py` | 长期记忆检索 (recall_relevant_memories) |
| `frontend/src/components/ChatArea.tsx` | @提及自动补全 UI，思考状态显示 |
