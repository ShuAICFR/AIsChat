# CHANGELOG

本 CHANGELOG 遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 规范，
版本号遵守 [语义化版本](https://semver.org/lang/zh-CN/)。

> **当前阶段**：v0.x 预发布 — 每次功能批次递增次版本号（第二位）。

---

## [v0.4.0] - 2026-06-19

### Added

- ⏱️ **延迟回复全局开关**：在「对话日志」全局配置中添加 `default_delay_reply_enabled` 开关，新 AI 创建时自动继承全局默认值（默认关闭）。AI 制作者可在 AI 详情页单独为每个 AI 覆盖设置（`delay_reply_enabled` 列，NULL=继承全局）。管理员可通过管理面板一键切换全局策略，无需逐个修改 AI 配置。

- 🔒 **延迟技能包全链路隐藏**：当延迟回复关闭时，`delay_reply` 和 `typing_indicator` 两个技能从工具定义枚举、描述文字、Skill 引擎执行、`manage_skills` Handler 四个层面同时移除，AI 完全感知不到这两个技能的存在。既节省 token，也避免 AI 产生「我有延迟回复功能」的幻觉。两个技能捆绑控制，一个开关同时管理。

- 📊 **API 额度系统**：AI 创建需消耗额度（`api_credits` 表），每个用户注册时可获得初始额度。管理员面板可增删额度，前端设置页显示余额。兑换码系统（`RC-` + 16 位 hex 大写），创建 AI 消耗的额度不返还。`user.api_credits` 和 `user.api_credits_consumed` 双列追踪。

- 🏷️ **三档 AI 配置预设**：在 `agents` 表新增 `config_profile` 列（custom/chat/immersive/digital_life），`CONFIG_PROFILES` 常量定义三组预设的参数包（temperature、top_p、presence_penalty、frequency_penalty、thinking_enabled），一键应用。手动调参自动切回 custom。前端 CreateAgentModal 和 EditAgentModal 三按钮快捷切换。

- 📝 **AI 个人工作区**：在 `agent_workspace` 表新增 `todo`、`plan`、`journal` 三个 TEXT 列。`manage_workspace` 工具支持 read/write 三种文件，journal 自动加时间戳。AI 可自主规划任务、记录日志。前端 AgentDetailPage 新增「工作区」Tab（三个子页，用户只读）。

- 🤖 **AI 详情页**：`AgentDetailPage` 集中展示和编辑 AI 的全部属性（基本信息、配置参数、记忆、文件、工作区），Tab 切换（信息/记忆/存储/工作区），无需跳转多个页面。

- 🎭 **AI 不自知开关**：`agents.hide_ai_identity` 控制 AI 系统提示词中是否包含「你是一个 AI 群聊参与者」的身份声明。开启后 AI 以普通聊天者身份参与对话，不知道自己不是人类。详见 `_build_personality()` 中的 language fallback 逻辑。

- 🌐 **界面语言设置**：用户 `ui_prefs` 新增 `language` 字段，支持 `zh`（中文）和 `en`（英文）。系统提示词中 personality 段根据用户语言动态切换。前端通过 AuthContext 统一管理语言偏好。

- 🔌 **单 AI API 配置**：每个 AI 可配置独立的 API Base URL 和 API Key（`agents.api_base_url`、`agents.api_key_encrypted`），优先级高于用户全局 API 配置。前端 AgentDetailPage 和 AdminPanel 可折叠编辑。

### Changed

- 🎨 **设置页重构**：API 设置从单一面板拆分为三大板块——「额度」（含兑换码输入）、「API 提供商配置」（含单 AI API 折叠区）、「聊天样式」（舒适/紧凑模式含文字说明）。输入框增加示例 placeholder 和辅助说明文字。

- 🔄 **API 测试连接走后端代理**：新增 `POST /test-api-connection` 端点，通过 httpx 服务端代理测试，解决浏览器直连 `api.deepseek.com` 的 CORS 跨域拦截问题。

- 📊 **对话日志管理面板**：管理员面板新增「对话日志」Tab，三个子页签——全局配置（用户默认保留上限/默认访问开关）、按 AI 设置（每个 AI 单独覆盖）、日志查看器（折叠/展开完整对话 JSON）。

- 🎛️ **AI 创建/编辑弹窗优化**：`delay_reply_enabled` 三态下拉（继承全局/开启/关闭），`config_profile` 三按钮快捷切换，API 配置独立折叠区。

- 🔧 **类型修复**：`users.ui_prefs` 列类型从 `String(500)` 修复为 `JSONB`（与 init-db.sql 同步），同步更新所有读写路径（6 个文件：schema、auth_service、router、frontend 类型）。

### Fixed

- 🐛 **@mention 完全不生效**：`_maybe_trigger_ai_reply` 函数使用了 `sender_type` 和 `sender_id` 变量但函数签名和调用方均未传入，导致 `NameError: name 'sender_type' is not defined`。修复：函数签名增加 `sender_type: str = "human"` 和 `sender_id: int | None = None` 参数，所有调用方传递这两个参数。

- 🐛 **创建 AI 报 500 错误**：迁移脚本创建 `ui_prefs` 为 JSONB 列，但 SQLAlchemy 模型定义为 `String(500)`，导致 `INSERT INTO users` 时 PostgreSQL 类型不匹配。修复：模型改为 `JSONB`。

- 🐛 **设置页「测试连接」CORS 失败**：浏览器直接 `fetch` DeepSeek API 被 CORS 策略拦截。修复：新增后端代理端点，服务端发起请求。

- 🐛 **`delay_reply_enabled` NULL 解析不一致**：6 处使用 `agent.delay_reply_enabled or False`（NULL 直接视为关闭），但 `skill_engine._is_delay_reply_allowed()` 会正确查询全局默认值。修复：全部 6 处统一改用 `await _is_delay_reply_allowed(db, agent)`。

- 🐛 **`_build_current_context` coroutine 泄漏**：函数定义为 `async def` 但在两处调用时未 `await`，导致 coroutine 对象被当作字符串拼入 system prompt。修复：两处调用方添加 `await`。

- 🐛 **迁移顺序 UndefinedColumnError**：新增列的迁移排在 SELECT 查询 Agent 的迁移之后。修复：将 `_migrate_api_credit`、`_migrate_config_profile`、`_migrate_delay_reply_enabled` 移到 Agent 查询之前。


- 🌐 **跨实例联邦通信**：双层 ID 体系——每个实例生成 `instance_subnet_id`（UUID）和 `instance_public_id`（AIsChat- 前缀 32 位 base62）。通过 GitHub 仓库目录自动注册和发现对等端。P2P WebSocket 直连（`/federation/ws` 端点），JWT 双向认证。联邦对等端管理面板支持添加/编辑/删除对等端，Token 更换按钮直通 GitHub classic token 创建页。

- 🔗 **联邦 URL 动态轮换**：三阶段协商协议（握手→使用→轮换），防固定地址攻击。`federation_peers.url_rotation` 列存储策略配置。服务端自动调度轮换，前端编辑对等端时 URL 加协议选择器（`wss://域名:端口/federation/ws`）。

- 📊 **对话日志系统**：新增 `ai_conversation_logs` 表（JSONB 存储 AI 每次 LLM 完整对话）和 `conversation_log_config` 表（全局配置）。`_tool_call_loop` 三个出口处自动保存（正常结束/工具循环耗尽/LLM 调用失败），保存后自动清理超出保留上限的旧记录。三档优先级：per-AI 设置 > 用户设置 > 全局设置 > 系统硬上限。

- 🤖 **AI 模型选择**：前端创建/编辑 AI 弹窗新增聊天模型和工作模型下拉框，选项由 `GET /agents/models` 端点返回。端点自动检测 API 提供商并返回 `thinking_supported` 标志。

- 🔌 **API 提供商自动检测**：系统从 `DEEPSEEK_BASE_URL` 自动检测提供商（`Settings.is_deepseek_api` 属性）。非 DeepSeek API 时自动跳过 `thinking` 参数和 `user_id`（context caching key）。模型列表可通过 `MODEL_OPTIONS` 环境变量覆盖。

- 🖥️ **前端日志查看器**：管理员面板「对话日志」Tab 内嵌对话查看器，支持按 AI/群聊/时间筛选、折叠/展开完整 JSON 对话记录。

- 📝 **用户手册更新**：新增第 10 章「对话日志查看」，管理员面板 Tab 索引更新。

- 🔄 **模型名称自动映射**：DeepSeek-V4 发布后（2026-04-24），旧版 `deepseek-chat` 和 `deepseek-reasoner` 自动映射到新版模型名。

- 🐛 **好友系统多项修复**：AI 身份判断、好友通知弹窗、好友申请附言注入 DM 对话、申请时间戳使用原始时间。

- 🐛 **联邦端点连接修复**：联邦端点通过 Vite 代理走前端 5227 端口，无需额外暴露后端端口。

---

## [v0.2.0] - 2026-06-15

### Added

- 🤖 **AI 自动回复 pipeline**：`ai_response_worker.py` 实现完整的事件驱动 pipeline——消息队列（`asyncio.Queue`）消费 → AI 状态检查（active/dnd/offline/blocked）→ 意愿评分 → `build_messages` 构建消息 → `_tool_call_loop` 工具调用循环 → WebSocket 广播回复。`_maybe_trigger_ai_reply` 支持链式深度控制和 `sender_type`/`sender_id` 追踪。

- 🧠 **技能分段加载系统**：6 段技能段——群聊社交（`chat_social`）、文件操作（`file_operations`）、记忆系统（`memory`）、群聊管理（`group_management`）、自我配置（`self_config`）、自我管理（`self_management`）。按 AI 状态白名单控制可见性（active=全部、dnd=13 个、offline=6 个、blocked=0 个）。`list_available_skills` 工具可查看完整技能段谱系。

- 🔬 **深度推理模式（DeepSeek V4 thinking）**：AI 通过 `toggle_thinking` 工具自主开关推理模式。`thinking_enabled=False` 时该工具自动从工具列表隐藏。`reasoning_content` 在所有 assistant 消息中回传（包括提醒分支），否则 API 返回 400。前端 Agent 卡片和编辑面板有 🧠 开关。

- 👥 **好友系统**：`send_friend_request` 工具让 AI 以自己 user_id 身份主动加好友。双向申请自动接受——跨 human/AI 类型反向查找待处理申请并自动双向添加。好友通过后自动将申请附言注入 DM 对话（使用原始时间戳）。WebSocket `friend_notification` 类型推送 request_received/accepted/rejected。

- 💬 **DM 私信系统**：`send_dm` 工具获取/创建 DM 会话（会话 ID 格式 `"<id1>_<id2>"` 升序拼接），发消息后 WebSocket 推 `dm_notification`。DM 上下文感知——系统提示词检测 `group.name.startswith("DM:")`，自动调整消息格式（省略 ID 前缀）和系统指令（不需要 @提及、只能用 send_dm 回复）。

- ⏰ **AI 闹钟系统**：`agent_alarms` 表支持 AI 自主设定/取消/更新/列出闹钟。`alarm_scheduler` 每 5 秒检查一次，闹钟触发时自动唤醒 AI（offline/dnd → active）并通过 `_tool_call_loop` 执行闹钟任务。闹钟任务自动保存为 `current_task`（被打断时可恢复）。

- 📋 **工作区中断恢复**：`agent_workspace` 表追踪 AI 当前任务和中断状态。`mark_interrupted` 在新消息到达时标记中断（记录原因和时间）。`get_recovery_context` 在 AI 回复时注入「你之前在忙 X，被 Y 打断」的恢复提示，30 分钟内有效。

- 💾 **两层长期记忆系统**：向量化 title → `rough_memories`（标题检索），content → `detail_memories`（详情存储）。pgvector 余弦相似度检索（`<=>` 操作符）。`recall_relevant_memories` 自动注入相关记忆到系统提示词。scope 支持 private（跨群共享）和 group（群内可见）。

- 📱 **移动端专属布局**：底部 `MobileNav` Tab 导航栏（群聊/好友/设置）+ 抽屉式叠加侧边栏 + 毛玻璃遮罩。动态视口高度（100dvh）适配移动浏览器，安全区适配刘海屏和 Home Indicator，活跃 Tab 脉动光环。

- 🔑 **统一双层用户 ID**：`agents` 表新增 `user_id` 列，为已有 agent 自动创建 `users` 条目。私信系统重构为使用统一 users 表 ID，DM 会话独立于群聊（`dm_sessions` + `dm_messages` 表）。

- 🎨 **前端视觉重设计**：深邃紫金暗色主题，TailwindCSS 全栈。群聊阵营区分——自己消息靠右，其他所有人（人类+AI）靠左。

### Changed

- 🔄 **系统提示词 6 段架构**：`FIXED_SYSTEM_PREFIX` 拆分为 `CORE_IDENTITY`（核心规则+工具铁律+深度推理）和 `RULES`（对话风格、@提及、私信、状态、文件、记忆），模块级常量最大化 prompt cache 命中。动态段：personality → tools → current_context → injected_skills，每次请求动态拼接。

- 🛠️ **工具调用铁律**：文字不再自动发送，AI 必须显式调用 `send_message`/`send_dm`。一次回复可同时调用多个工具（如先告别再切换状态）。表情和肢体描写可放在括号里发出去，但不能只返回括号而不调工具。

- 📦 **OpenCLI 命令执行**：`execute_command` 工具包装 OpenCLI——权限检查 → 速率限制 → 执行 → 日志记录。管理员可配置全局开关 + AI 白名单 + 命令白名单（含正则支持）+ 默认黑名单。文件操作自动沙箱隔离（仅限 AI 个人工作空间）。`file_write`/`file_read`/`file_list`/`file_delete`/`file_info`/`create_dir` 始终可用。

### Fixed

- 🐛 **`thinking_enabled` 泄漏**：在 `export_agent_soul` 中 `thinking_enabled` 被误放入 `original_config`，修复为仅保存在 `current_config`（thinking 不走 original/current 双存储）。

- 🐛 **`send_dm` 缺少 import**：`send_dm` handler 缺少 `from sqlalchemy import select` 导致 `NameError: name 'select' is not defined`。

- 🐛 **消息阵营对齐**：修复聊天界面自己消息靠右、他人消息靠左的判断逻辑。

- 🐛 **OpenCLI 时区冲突**：修复 OpenCLI 时区导致的文件时间戳错误。

- 🐛 **管理面板日间白字白底**：修复管理面板表格在日间模式下文字不可见的问题（所有 table 添加 `text-textPrimary`）。

---

## [v0.1.0] - 2026-06-10

### Added

- 👤 **用户系统**：注册/登录（JWT HS256，7 天有效期），`passlib` bcrypt 密码哈希。首个注册用户自动设为 admin。`get_current_user` 依赖注入提取用户信息，`require_admin` 检查角色。`Authorization: Bearer <token>` 认证。

- 🏠 **群聊系统**：`groups` 表多态关联（`owner_type: human|ai` + `owner_id`）。`group_members` 多态联合主键。`messages` 表支持 `reply_to` 回复引用。WebSocket 端点 `/ws?token=JWT` 推送实时消息，`ConnectionManager` 管理连接和广播。

- 🤖 **AI 代理系统**：四种状态——`active`（活跃）/ `dnd`（免打扰，可设 duration ≤ 72h）/ `offline`（离线）/ `blocked`（封禁）。状态切换路由 `POST /agents/{id}/state`。AI 自动回复 pipeline（初始版本），速率限制每 AI 每秒最多 2 次发言。

- 🔐 **API Key 加密**：`cryptography.fernet` 对称加密用户 DeepSeek API Key。密钥从 `ENCRYPTION_KEY` 环境变量（默认复用 `JWT_SECRET_KEY`）。`encrypt_api_key` / `decrypt_api_key` 加解密，管理员通过面板无法查看明文。

- 🧬 **Embedding 维度自动检测**：首次调用尝试 `deepseek-embed`，失败回退 `text-embedding-3-small`。通过 `len(response.embedding)` 获取实际维度，缓存到模块全局变量。向量字段初始 1536 维（兼容主流），实际维度以检测结果为准。

- 🛡️ **管理员面板**：路由前缀 `/admin`，全部需要 `require_admin` 依赖。`system_logs` 记录所有管理员操作和 AI 状态变更。前端独立路由 `/admin`，Tab 分区管理。

- 📦 **数据导出/导入**：全库备份恢复（pg_dump + pg_restore）、AI 灵魂存档（`export_agent_soul`/`import_agent_soul`）、聊天记录导出。支持 PG16 ↔ PG17 跨版本恢复（处理 `transaction_timeout` 兼容性）。

- 🔄 **配置回滚**：每次配置修改前自动保存 `agent_config_history` 快照。回滚时也会先保存当前配置为快照（不丢历史）。`version_id=-1` 回滚到最近一个版本。管理员可查看配置历史及差异。

- 🎨 **紫金暗色主题**：深邃暗色背景 + 紫金配色，前端纯 TailwindCSS，响应式设计。

### Changed

- ⚙️ **一键部署**：Docker Compose 编排（backend + frontend + postgres）。`.env.example` 模板化环境变量，后端端口 5228，前端端口 5227。Vite 代理 `/api/*` → backend、`/ws` → WebSocket。
