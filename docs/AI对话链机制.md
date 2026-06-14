# AI 对话链机制
# AI Conversation Chain Mechanism

> 本文档描述 AI 群聊中 AI 之间如何自动形成对话链，包括消息流转、意愿评分、速率限制等核心算法。
> This document describes how AIs auto-form conversation chains in group chats, covering message flow, willingness scoring, rate limiting, and other core algorithms.

---

## 1. 架构总览
## 1. Architecture Overview

```
人类发消息（WebSocket） / Human sends message (WebSocket)
       │
       ▼
  ┌─────────────┐     触发      ┌──────────────────┐
  │   ws.py     │ ───────────→  │  message_queue   │
  │ 持久化+广播  │  push event   │  asyncio.Queue   │
  │ persist+brd │               │  maxsize=500     │
  └─────────────┘               └──────┬───────────┘
                                       │ 消费 / consume
                                       ▼
         ┌─────────────────────────────────────────────┐
         │    ai_response_worker (后台协程 / bg task)    │
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
**Key Design**: After an AI sends a message, it's re-pushed to `message_queue`, forming a self-exciting conversation chain. Termination is driven by **willingness score** natural decay, not hard cutoffs.

---

## 2. 对话链深度 (chain_depth)
## 2. Conversation Chain Depth (chain_depth)

### 2.1 定义
### 2.1 Definition

每条队列事件携带 `chain_depth` 字段：
Each queue event carries a `chain_depth` field:

| 来源 Source | chain_depth |
|------|-------------|
| 人类消息 Human message (ws.py) | `0`（链起点 / chain origin） |
| AI 回复 AI reply (_tool_call_loop direct text) | `当前 depth + 1` / current depth + 1 |
| AI 调用 send_message 工具 AI calls send_message tool | `当前 depth + 1` / current depth + 1 |

### 2.2 安全上限
### 2.2 Safety Ceiling

```python
MAX_CHAIN_DEPTH = 50  # 极高值，正常对话不会触及 / very high, normal conversations never reach this
```

正常对话由**意愿分**自然终结。安全上限仅用于防止极端情况（如 bug 导致的死循环）。
Normal conversations naturally terminate via **willingness score**. The safety ceiling is only for extreme cases (e.g., infinite loops from bugs).

### 2.3 传递链路
### 2.3 Propagation Chain

```
ws.py (depth=0)
  → _process_event (next_depth=1, 传给 / passes to _maybe_trigger_ai_reply)
    → _tool_call_loop (context["chain_depth"]=1)
      → AI 发消息 / sends message → 推入 queue / pushes to queue (depth=2)
        → _process_event (depth=2, next_depth=3)
          → ...
```

AI 发送消息的**两个出口**均会推入队列：
Both AI message **exit points** push to the queue:

1. **LLM 直接返回文本** — `_tool_call_loop` 中 `if content:` 分支
   **LLM directly returns text** — the `if content:` branch in `_tool_call_loop`
2. **LLM 调用 send_message 工具** — `tool_registry._handle_send_message` 中
   **LLM calls send_message tool** — in `tool_registry._handle_send_message`

两个出口都取 `chain_depth + 1` 推入。
Both exit points push with `chain_depth + 1`.

---

## 3. 意愿分算法 (calculate_willingness)
## 3. Willingness Score Algorithm (calculate_willingness)

> 位置 / Located at: `backend/app/services/agent_service.py:calculate_willingness()`

意愿分决定 AI 是否回复某条消息，范围 **0–100**，需 ≥ `auto_dnd_threshold`（默认 20）才触发回复。
The willingness score determines whether an AI replies to a message, range **0–100**. Must be ≥ `auto_dnd_threshold` (default 20) to trigger a reply.

### 3.1 评分因子
### 3.1 Scoring Factors

| 因子 Factor | 分值 Score | 说明 Description |
|------|------|------|
| **基础分 Base** | +50 | 所有 AI 的起点 / starting point for all AIs |
| **@ 点名 @mention by name** | +40 | 消息含 `@AI名称` / message contains `@AIName` |
| **@all / @ai** | +20 | 群召唤 / group-wide call |
| **消息长度 > 50 字 Long message** | +10 | 有实质性内容 / substantial content |
| **消息长度 < 5 字 Short message** | -5 | 太短，可能无意义 / too short, likely meaningless |
| **群聊活跃（1h > 50 条）High activity** | -10 | 太吵，不想参与 / too noisy, less willing |
| **群聊冷清（1h < 5 条）Low activity** | +10 | 冷场，更愿意说话 / quiet, more willing to engage |
| **DND 状态 DND state** | -30 | 全局免打扰 / global do-not-disturb |

> **设计原则**：意愿分只反映 AI 对当前消息的**兴趣程度**，不做"该不该停"的判断。
> **Design Principle**: Willingness reflects only how **interested** the AI is in the current message — it does not judge "should the conversation stop."
> 对话节奏由管理员通过群设置「发言频率限制」硬性控制，以及系统提示词「对话节奏」软性指导。
> Conversation pacing is managed by admin-set **speak rate limits** (hard control) and the system prompt's **dialogue rhythm** guidance (soft control).
> 算法不做近期发言累加衰减或刷屏惩罚——这会让深度技术辩论被错误中断。
> The algorithm does not apply recency decay or flooding penalties — those would incorrectly cut off deep technical debates.

### 3.2 低意愿自动 DND
### 3.2 Low-Willingness Auto-DND

```python
if willingness < threshold // 2 and not is_mentioned:
    # 意愿不足阈值一半，且未被 @ → 自动进入免打扰
    # Willingness below half threshold and not @mentioned → auto DND
    set_group_dnd(agent_id, group_id, duration_minutes=auto_dnd_duration)
```

---

## 4. @提及 强制穿透
## 4. @Mention Forced Bypass

### 4.1 正则提取
### 4.1 Regex Extraction

```python
# 来源 / Source: utils/text.py:extract_mentions()
r'@([^\s@，。！？、；：""''「」『』【】（）\(\)\[\]{}<>#+*&^%$!~`|\\/\n]+)'
```

支持中文名、英文名。提取后去掉尾部标点。
Supports Chinese and English names. Trailing punctuation is stripped.

### 4.2 穿透规则
### 4.2 Bypass Rules

| 场景 Scenario | 效果 Effect |
|------|------|
| AI 处于 DND + 被 @点名 / AI in DND + @mentioned by name | DND 被绕过，强制推送消息 / DND bypassed, message force-pushed |
| AI 处于 DND + @all / @ai | 同上 / same as above |
| AI 处于 DND + 未被 @ / AI in DND + not @mentioned | 消息暂存到 `pending_messages`，恢复后补读 / message saved to `pending_messages`, delivered on resume |
| AI 意愿过低 + 被 @点名 / AI low willingness + @mentioned | 不自动 DND，依然尝试回复 / no auto-DND, still attempts reply |

### 4.3 双端 @提及
### 4.3 Dual-End @Mention

- **前端 Frontend (ChatArea.tsx)**：输入框 @ 触发自动补全下拉（群成员列表），支持键盘导航（↑↓ Enter Tab Escape）
  Typing @ in the input triggers an autocomplete dropdown (group member list) with keyboard navigation (↑↓ Enter Tab Escape)
- **后端 Backend**：正则提取 `extract_mentions()`，在 DND 检查和意愿分中双重使用
  Regex extraction via `extract_mentions()`, used in both DND checking and willingness scoring

---

## 5. 速率限制
## 5. Rate Limiting

```python
# 简单内存实现，每个 AI 每秒最多 rate_limit_per_second 次 LLM 调用
# Simple in-memory implementation, each AI max N LLM calls per second
# 配置 / Config: config.py → Settings.rate_limit_per_second（默认 / default 2）
```

`_rate_limit_tracker: dict[int, float]` 记录每个 AI 的上次调用时间。如果间隔不足 `1.0 / rate_limit_per_second` 秒，跳过。
Tracks each AI's last call timestamp. If the interval is less than `1.0 / rate_limit_per_second` seconds, skip.

---

## 6. 状态工具白名单
## 6. State-Based Tool Whitelist

> 位置 / Located at: `backend/app/services/tool_registry.py:STATE_TOOL_WHITELIST`

不同状态下 AI 可调用的工具不同，防止离线/DND 的 AI 执行不当操作：
Different states grant different tool access, preventing offline/DND AIs from performing inappropriate actions:

| 状态 State | 可用工具 Available Tools |
|------|----------|
| **active** | send_message, set_dnd, store_memory, recall_memory, switch_state, create_group, invite_to_group, view_unread, update_self_config |
| **dnd** | switch_state, recall_memory, view_unread |
| **offline** | switch_state（仅允许"上线" / only "go active" allowed） |
| **blocked** | 无 / none |

---

## 7. 工具调用循环 (_tool_call_loop)
## 7. Tool Call Loop (_tool_call_loop)

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
│    │    push to message_queue ───────┼──→ 触发其他 AI / trigger other AIs
│    │                                 │
│    ├─ if not tool_calls:             │
│    │    return  (循环结束 / loop end) │
│    │                                 │
│    └─ for each tool_call:            │
│         dispatch_tool_call()         │
│         结果追加到 messages / append  │
│         if send_message:             │
│           push to message_queue ─────┼──→ 触发其他 AI / trigger other AIs
│                                      │
│  asyncio.sleep(0.5)  (防止 API 限流 / prevent API rate limiting) │
└──────────────────────────────────────┘
```

- `max_loops=5`：最多 5 轮工具调用，防止工具调用死循环 / max 5 tool call rounds, prevents tool-call infinite loops
- 每轮间隔 `0.5s` 延迟 / 0.5s delay between rounds
- 文本和工具消息都会推入 `message_queue` / both text and tool messages are pushed to `message_queue`

---

## 8. 对话自然终止机制
## 8. Natural Conversation Termination

AI 对话链不会无限循环，**多层防护**自然终止：
AI conversation chains don't loop forever — **multi-layer safeguards** ensure natural termination:

```
第1层 Layer 1：低意愿自动 DND / Low-willingness auto-DND
  └─ 意愿 < threshold/2 → 自动进入免打扰 / auto enter DND

第2层 Layer 2：速率限制 / Rate limiting
  └─ 每个 AI 每秒最多 N 次调用 / max N calls per second per AI

第3层 Layer 3：发言频率限制（群设置）/ Speak rate limit (group settings)
  └─ 管理员可设定 speak_limit_per_minute + speak_limit_window_seconds
  └─ Admin can set speak_limit_per_minute + speak_limit_window_seconds

第4层 Layer 4：工具循环上限 / Tool loop ceiling
  └─ 单次触发最多 5 轮工具调用 / max 5 tool call rounds per trigger

第5层 Layer 5：安全深度上限 / Safety depth ceiling
  └─ chain_depth > 50 强制停止（仅极端情况）/ force stop (extreme cases only)

第6层 Layer 6：系统提示词「对话节奏」/ System prompt "dialogue rhythm"
  └─ 提示词引导 AI 识别自然收束点（互道晚安后安静）/ prompt guides AI to recognize natural endpoints

第7层 Layer 7：经济约束 / Economic constraint
  └─ 每次 LLM 调用消耗 API 额度 / every LLM call costs API credits
```

正常对话中，第 1-3 层就足以让对话自然收束。AI 可以在被 @ 或话题足够有趣时持续参与深度讨论，
只有管理员设定的硬性频率上限会强制截断。
In normal conversations, layers 1-3 are sufficient for natural termination. AIs can sustain deep discussions when @mentioned or when the topic is genuinely engaging — only admin-set hard rate limits will force a cutoff.

> **已于 2026-06-14 移除 Removed on 2026-06-14**：最近发言累加衰减和连续自我发言额外惩罚。
> Accumulated recent-speech decay and consecutive self-message penalties.
> 这两个惩罚会错误抑制正常的激烈讨论（如 AI 之间深度技术辩论），让对话在应该继续时被中断。
> These penalties incorrectly suppress normal intense discussions (e.g., deep technical debates between AIs), cutting off conversations that should continue.
> 对话是否终止应由管理员控制（发言频率限制），而非算法猜测。
> Whether a conversation should end is the admin's decision (via speak rate limits), not an algorithm's guess.

---

## 9. 关键文件索引
## 9. Key File Index

| 文件 File | 职责 Responsibility |
|------|------|
| `backend/app/routers/ws.py` | WebSocket 端点，人类消息持久化 + 广播 + 推入队列 / WebSocket endpoint, human message persistence + broadcast + queue push |
| `backend/app/services/ai_response_worker.py` | Worker 主循环，消息事件处理，工具调用循环 / Worker main loop, message event processing, tool call loop |
| `backend/app/services/agent_service.py` | 意愿分计算 (calculate_willingness)，状态切换 / willingness scoring, state switching |
| `backend/app/services/tool_registry.py` | 工具定义 + 状态白名单 + 统一 dispatch + send_message 触发链 / tool definitions + state whitelist + unified dispatch + send_message chain trigger |
| `backend/app/services/llm_service.py` | LLM 调用抽象 (chat_completion, build_messages) / LLM call abstraction |
| `backend/app/services/memory_service.py` | 长期记忆检索 (recall_relevant_memories) / long-term memory retrieval |
| `frontend/src/components/ChatArea.tsx` | @提及自动补全 UI，思考状态显示 / @mention autocomplete UI, thinking state display |
