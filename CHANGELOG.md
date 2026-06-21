# CHANGELOG

本 CHANGELOG 遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 规范，
版本号遵守 [语义化版本](https://semver.org/lang/zh-CN/)。

> **当前阶段**：v0.x 预发布 — 每次功能批次递增次版本号（第二位）。

---

## [v0.5.0] - 2026-06-21

### Added

- 📊 **API 用量仪表盘**：用户端「我的」→ API 用量概览 + 详情页（recharts 堆叠柱状图）。显示总 Token、调用次数、缓存命中率、思考 Token，按 AI 分组明细表，支持 7/30/60/90 天日期范围切换。图表自动适配日夜模式。
- 🛡️ **管理员用量分析面板**：AdminPage 新增「用量分析」tab。全站 token 消耗总览 + 按用户展开查看各 AI 明细 + 每日 AreaChart 趋势图。
- 🧠 **Token 追踪增强**：`token_usage` JSONB 新增 `reasoning_tokens`（DeepSeek 思考 token）和 `cached_tokens`（prompt cache 命中 token）。`llm_service.py` 自动从 API 响应提取，`ai_response_worker.py` 跨轮累积。
- 👤 **「我的」页面**：底部导航「设置」→「我的」。个人资料卡（头像、好友数、上线天数、额度概览）+ 我的 AI 横向卡片 + API 用量概览 + 兑换码输入 + 设置/管理入口 + 退出登录。支持编辑用户名/密码。
- 🎛️ **AgentDetailPage 工具轮次编辑**：「模型配置」新增「工具调用 & 闹钟」子区。`max_tool_rounds`/`alarm_max_tool_rounds`/`max_alarms` 支持 ± 按钮 inline 编辑，`force_alarm_on_end` 开关切换。调用 `PUT /agents/{id}/config` 即时生效。
- 🏷️ **兑换码 4 种类型**：新增 `agent_bundle`（AI 包断额度，创建时一次付清该 AI 全免）和 `file_quota`（文件存储配额 MB）。原有 `ai_quota` 和 `api_credit`（1 余额=1 万 token pay-as-you-go）。`users` 表新增 `agent_bundle_credit` + `file_quota_mb` 列。

### Changed

- 🔄 **导航重构**：底部导航栏和侧边栏「设置」→「我的」（`/me`），原设置页保留可继续访问。`/me` 整合设置入口、管理入口。
- 🔄 **用户信息扩展**：`get_user_info` 返回 `agent_bundle_credit`、`file_quota_mb`、`avatar_url`、`created_at`。AdminPage 用户列表同步展示。

### Fixed

- 🐛 **修复聊天页返回路由不更新**：移动端从 `/chat/2` 点击返回箭头，界面回到列表但 URL 停留在 `/chat/2`。根因：`ChatArea.tsx` 移动端返回按钮只打开侧边栏覆盖层（`setMobileSidebarOpen(true)`），未调用 `navigate('/chat')`。改为导航到 `/chat`，URL 与界面同步。
- 🐛 **修复兑换码生成 500 错误**：`POST /admin/redemption-codes` 报 `Internal Server Error`。根因：`datetime.now(timezone.utc)` 返回带时区的 datetime，但 `redemption_codes.expires_at` 列是 `TIMESTAMP WITHOUT TIME ZONE`，asyncpg 无法将 offset-aware 转换为 offset-naive 导致 `DataError`。修复：三处加上 `.replace(tzinfo=None)`（`admin.py:378` 生成码、`user.py:87` 过期比较、`user.py:112` 标记已使用）。超 60% 的代码已使用 `.replace(tzinfo=None)` 正确模式，此三处为遗留遗漏。

### Backend API

- `GET /conversation-log/usage/overview?days=30` — 用户所有 AI token 汇总
- `GET /conversation-log/usage/agents/{id}/daily?days=30` — 单 AI 每日分布
- `GET /admin/usage/global?days=30` — 全站 token 总览
- `GET /admin/usage/by-user?days=30` — 按用户分组明细
- `GET /admin/usage/agents/{id}/daily?days=30` — 管理员查单 AI 分布
- 聚合查询基于 PostgreSQL JSONB `->>` 操作符，`ai_conversation_logs.token_usage` 字段

---

## [v1.0.0] - 2026-06-21

### Added

- 🔑 **API Key 池管理**：管理员可通过「API 库」tab 管理系统级共享 API Key。支持添加/删除/启用禁用/优先级排序。Key 使用 Fernet 加密存储，添加后仅显示密文后四位（脱敏），管理员无法查看明文。用户兑换 API 池额度后自动从池中分配最优 Key。
- 💰 **额度消耗系统**：实现四层 API Key 解析优先链（Agent 自有 → 池 Key 绑定 → 自动选池 → 用户自有）。使用池 Key 时按 `total_tokens / 10000` 自动扣除 `users.api_credit`（最低 0.01 credit/次），自有 Key 时不扣。扣除通过 `quota_service.py` 的 `deduct_credit()` 完成，含 `SELECT FOR UPDATE` 防并发竞争。
- 📊 **用户额度状态端点**：`GET /user/credit-status` 返回剩余额度、估算 Token 数（api_credit × 10000）、月度消耗、绑定的池 Key 名。`GET /auth/me` 新增 `assigned_pool_key_name` 字段。
- 🏷️ **兑换码增强**：管理员生成兑换码新增「备注」（保密，仅管理员可见）、「单码最大用量」、「API 池额度」字段。兑换码列表显示备注、API 池标记（琥珀色「池」徽章）、创建时间。
- 📋 **API 用量日志**：新增 `api_usage_log` 表，记录每次 LLM 调用的 user_id/agent_id/pool_key_id/tokens_used/credit_spent/model，用于审计和用量统计。
- 🌐 **前端全量 i18n 国际化**：~700 翻译键值（中/英双字典），28 个前端文件全面替换硬编码中文字符串为 `t()` 调用。覆盖登录页、管理员面板（4 个 Tab）、AI 管理、好友、设置、用量、群聊/私信设置、弹窗等全部 UI。翻译键按模块组织（`admin.*`、`agents.*`、`friends.*`、`settings.*` 等）。
- 🌐 **全局默认语言**：`system_settings` 单行表（id=1），`default_language` 默认 `"en"`（英文）。管理员 `/admin?tab=system` 可切换全局默认语言。未登录时登录页自动获取并缓存全局语言偏好。新用户注册时从全局设置继承初始语言。
- 🧙 **新用户初始化向导**：`users.setup_completed` 字段。新用户注册后强制跳转 `/setup` 两步向导（第 1 步选语言 → 第 2 步确认完成）。语言选择时界面即时预览切换。`ProtectedLayout` 路由守卫拦截。现有用户自动标记为已完成。
- 🔧 `translations.ts` 扁平字典结构修复：`getTranslation()` 原用 `path.split('.')` 深度遍历但字典是扁平 key（`'nav.chat'`），导致所有 `t()` 调用返回原始 key。改为直接 `dict[path]` 查找。
- 📖 **用户手册独立页面**：新建 `ManualPage` 组件（`react-markdown` + `remark-gfm` + `@tailwindcss/typography` 渲染），路由 `/manual`。侧边栏改用 `NavLink`（无出站图标），版本与部署代码一致。
- 🛡️ **外部链接安全弹窗**：新建 `ExternalLinkSafe` 组件。点击外部链接弹出确认弹窗（「即将离开本站 → 目标 URL → 确认前往/取消」），防止无意识跳转。FederationTab 的 GitHub 链接已接入。
- 📐 **MePage 标题**：添加页面标题 `{t('me.title')}`（"我的"/"Me"），设置入口从三行简化为单行「设置」链接。

### Changed

- 🔄 **API Key 解析链升级**：`_get_api_config` 从二层（Agent→User）升级为四层优先链。DM 触发器中内联的 API 解析代码替换为统一调用 `_get_api_config`，消除重复逻辑。
- 🔄 **前端额度展示增强**：Sidebar 非管理员显示「额度 + 余额」双数字；MePage「通用额度」卡片显示估算 Token 数和池 Key 来源；AdminPage 新增「API 库」tab。
- 🔄 **群聊路由对称化**：群聊路由 `/chat/:groupId` → `/chat/gm/:groupId`（GM=Group Message），与私信 `/chat/dm/:sessionId`（DM=Direct Message）形成同级对称结构。涉及 App.tsx、ChatSidebar.tsx、ChatArea.tsx。
- 🔄 **用户手册本地化**：`MANUAL_URL` 从 GitHub 链接改为本地 React 页面 `/manual`（`ManualPage` 组件渲染 `docs/用户手册.md`），版本始终与部署代码匹配。
- 🔄 Sidebar 手册链接从 `<a target="_blank">` 改为 `<NavLink>`，移除出站图标
- 🔄 MePage/UsagePage `fmtTokenNum` 调用全部传入 `lang` 参数，英文界面显示 K/M 而非 万

### Fixed

- 🐛 修复聊天页返回路由不更新（移动端 ArrowLeft 未调用 `navigate('/chat')`）
- 🐛 修复兑换码生成 500 错误（`datetime.now(timezone.utc)` 带时区与 PostgreSQL `TIMESTAMP WITHOUT TIME ZONE` 不兼容，三处加 `.replace(tzinfo=None)`）
- 🐛 修复 i18n 全线失效：`getTranslation()` 深度遍历 bug 导致所有 `t()` 返回原始 key；`I18nProvider` 提到 `main.tsx` 覆盖登录页
- 🐛 修复 `friendship.py` schema 缺少 `avatar_url`/`auto_respond_friend_request` 字段导致前端头像不显示
- 🐛 修复 `ChatSidebar` 缺少 `useT` 导入导致 `t is not defined`
- 🐛 修复 AdminPage 崩溃：i18n 替换时 `useSearchParams()` hook 调用被误删，`searchParams is not defined`
- 🐛 修复时区偏移：后端 `DateTime` 列无 `timezone=True`，Pydantic 序列化为 naive UTC 字符串，前端 `new Date()` 将其误判为本地时间导致消息时间晚 8 小时。`time.ts` 新增 `parseServerDate()` 辅助函数对无时区标记字符串追加 `Z`
- 🐛 修复聊天消息气泡无折行控制：长 URL/长英文单词溢出。`MessageBubble.tsx` 气泡容器加 `break-words`
- 🐛 修复输入框内容丢失：页面刷新/崩溃/掉线后输入内容消失。新增草稿自动缓存（500ms 防抖写 localStorage），切换对话时保存/恢复，发送成功后自动清除
- 🐛 修复 GroupSettingsPanel 生产构建崩溃：`FederationShareSection` 接收 `t` prop 与父组件 `useT()` 产生 minify 变量名冲突（`t2 is not a function`）。子组件改用自身 `useT()` 而非接收 prop
- 🐛 修复 DM Offline 状态显示绿色：私信头部在线状态文字硬编码 `text-mint-400`。改为动态映射 active=绿/dnd=红/offline=灰
- 🐛 修复英文界面仍有多处中文：AdminPage 备份下载失败 `'下载失败'` 改用 i18n；Token 格式化 `fmtTokenNum` 新增 `lang` 参数（zh=万，en=K/M）；AgentsPage `stateLabels` 改用翻译键
- 🐛 修复 Agent 卡片按钮溢出：Edit/History/Status/Export 按钮在小屏上撑出卡片，加 `flex-wrap`
- 🐛 修复消息 Markdown 链接不渲染：用户消息使用纯文本 `<span>`，导致 `[文字](URL)` 不显示为可点击链接。改为统一使用 `<Markdown>` 渲染
- 🐛 修复消息纯文本换行不生效：添加 `remark-breaks` 插件，单回车自动转为 `<br>`
- 🐛 修复公式/代码块/长链接溢出：消息气泡新增 `overflow-x-auto` 规则覆盖 `.katex-display`/`pre`/`table`/`img`/`a`

### Backend API

- `GET /admin/api-key-pool` — 列出所有池 Key（脱敏）
- `POST /admin/api-key-pool` — 添加池 Key（Fernet 加密存储）
- `PUT /admin/api-key-pool/{id}` — 更新池 Key 配置
- `DELETE /admin/api-key-pool/{id}` — 删除池 Key
- `GET /user/credit-status` — 用户额度状态摘要
- `POST /admin/redemption-codes` — 请求体新增 `note`/`max_usage`/`is_api_pool`
- `GET /system/settings` — 获取全局系统设置（公开端点）
- `PUT /admin/system-settings` — 管理员修改全局系统设置
- `POST /auth/setup` — 新用户完成初始化设置（设置语言 + 标记完成）

---

## [v0.4.0] - 2026-06-20

### Added

- 🗑️ **好友机制完整删除**：`friendships`/`friendship_requests` 表重命名归档（安全回滚），`send_friend_request` 工具定义+handler+白名单全部移除。`search_entities()` 提取为独立的 `search_service.py` + `routers/search.py`。DM 不再需要先加好友——`send_dm` 可直接向任何人发送私信。前端删除 FriendsPage、FriendList、FriendRequestBadge 三个组件，搜索器中「加好友」改为「发私信」直接进入 DM 对话，ProfileCard 重写为 DM 入口，InviteMemberModal 从好友列表改为搜索邀请。移动端底部导航从 4 栏改为 3 栏（聊天 | AI | 设置）。

- 🏗️ **三种 AI 类型架构**：`agents.ai_type` 列（`general`=通用 | `semi_general`=半通用 | `resonance`=共振，默认 `resonance`）。通用 AI 每人独立记忆和配置（不能加群），半通用 AI 独立配置 + 跨用户学习（可加群），共振 AI 完全向后兼容（统一行为）。新建 `agent_user_configs` 表（`agent_id`+`user_id` 唯一），per-user 覆盖 `temperature`/`top_p`/`presence_penalty`/`frequency_penalty`/`thinking_enabled`/`hide_ai_identity`/`system_prompt_override`。`get_effective_config(agent_id, user_id)` 按 AI 类型自动选择读取路径。通用 AI 调用 `create_group`/`invite_to_group` 返回错误。

- 🔒 **Per-user 记忆隔离**：`rough_memories.user_id` 列（共振 AI 为 NULL，通用/半通用填触发用户 ID）。`recall_relevant_memories` + `_text_search_memories` 按 `ai_type` 自动过滤：共振→全部记忆，通用/半通用→仅该用户记忆。`store_memory` 工具自动记录 `user_id`。

- 🎯 **意愿系统全面改版**：`WillingnessResult` 类（`score` + `reason` + `level` + `details` 逐因子明细）。原因字符串示例：「基础分 50, @提及 +40, 实质性内容(128字) +10, 群聊安静(3条/h) +10 → 100」。行为驱动：`HIGH`(>60) 可主动发言，`MEDIUM`(30-60) 仅 @提及 时回复，`LOW`(<30) 跳过。`agents` 表新增 `last_willingness_score` + `last_willingness_reason`。

- 📝 **DM prompt 精简**：新增 `DM_RULES` 常量（~15 行），仅保留私信相关规则（对话风格、私信能力、状态管理、文件操作、长期记忆），去掉 @提及、群聊专属、跨对话记忆共享、`cross_post` 等群聊内容。每次 DM 请求约省 ~65 行 token。

- 🌊 **流式接口预留**：`chat_completion` 拆分为 `_chat_completion_non_streaming`（当前生产路径）+ `_chat_completion_streaming`（SSE 占位，raise NotImplementedError）。保留 `ai_thinking`/`ai_typing` WebSocket 事件用于未来 SSE chunk 推送。

- 🤖 **前端 AI 类型选择器**：`CreateAgentModal` 新增「AI 类型」三选一卡片（👤通用 | 🔄半通用 | 🌐共振），带描述文字。`AgentDetailPage` 头像旁显示 AI 类型徽章（仅非共振类型显示）。


- 🔧 **工具调用轮次分级控制**：新增 `max_tool_rounds` 列（单次回复最大 LLM 调用轮次）和 `alarm_max_tool_rounds` 列（闹钟/心跳独立轮次上限）。三档预设：聊天档 2/5、沉浸档 4/8、数字生命档 10/15。群聊/DM 使用 `max_tool_rounds`，闹钟使用 `alarm_max_tool_rounds`，互不干扰。

- ⏰ **闹钟上限控制**：新增 `max_alarms` 列（AI 最多活跃闹钟数，默认 10），`set_alarm` 工具触发时检查上限，超限拒绝。新增 `force_alarm_on_end` 列（对话结束强制设闹钟，数字生命档默认开启，防止"睡死"）。

- 🎛️ **三档预设全面展开**：`CONFIG_PROFILES` 从 5 个参数扩展到 12 个参数——模型参数（temperature/top_p/presence_penalty/frequency_penalty/thinking_enabled）+ 工具调用（max_tool_rounds/alarm_max_tool_rounds）+ 闹钟心跳（force_alarm_on_end/max_alarms）+ 行为开关（delay_reply_enabled/is_ai_editable/hide_ai_identity）。`apply_config_profile` 一次性写入全部 12 个字段。`GET /agents/presets` 端点返回完整预设数据。

- 🤖 **AI 自配置能力大幅扩展**：`update_self_config` 工具白名单从 2 个字段扩展到 12 个字段。AI 可自行切换 config_profile、调整工具调用轮次、管理闹钟策略、控制自身行为开关。工具定义同步更新，AI 在 system prompt 中能看到完整的自配置选项描述。

- 🎨 **新创建 AI 流程（前端）**：三档卡片选择器（聊天档/深度沉浸档/数字生命档），横排 grid-cols-3 布局。点击卡片弹出**独立子选项弹窗**（居中 modal，每档 3 个子项共 9 个），子项展示行为描述和 emoji 图标。选中子项后弹窗关闭，卡片开始浮动动画，底部显示已选子项标签。未选子项前卡片完全静止。

- 📐 **卡片浮动动画（JS sin() 驱动）**：外层 `preset-card-frame` 静态撑位（参与 grid 排版），内层 `preset-card-inner` 由 `requestAnimationFrame` + `Math.sin()` 计算 `translate3d` 位移（周期 ~3s，振幅 5px），transform 不参与布局。动画仅在选中子项后启动，未选中/弹窗开启期间不触发。CSS 一次性注入 `<head>`，避免每渲染重复注入 `<style>`。

- 📋 **详细设置弹窗分区**：创建 AI 详细设置按 6 个分区组织——基础信息、模型参数、工具调用、闹钟/心跳、行为开关、额度成本。每个分区有标题 + 概述介绍。所有字段已预填预设值，用户可在此基础上任意修改。

- 🛡️ **设置页未保存修改提醒**：用户修改设置后未保存即尝试离开时弹出确认对话框（「继续编辑」/「放弃修改」）。通过 `useBlocker` 拦截 React Router 导航，`beforeunload` 事件拦截浏览器关闭/刷新。仅追踪需点击「保存设置」的字段（API 配置/时区/语言/聊天样式/策略模式），即时生效项（主题/通知）不计入未保存状态。

### Changed

- 🔄 **DM 能力独立化**：`send_dm` 描述改为「向任何人发送私信」，不再提及好友列表。搜索器「加好友」→「发私信」，直接调 `POST /api/dm/{id}`。ProfileCard 重写为 DM 入口。

- 🔄 **意愿行为分层**：旧 `auto_dnd_threshold` 门控逻辑改为 `WillingnessResult` 三层行为——`HIGH` 主动、`MEDIUM` 仅 @提及、`LOW` 跳过。列保留不读，未来兼容。

- 🔄 **Worker 全链路 trigger_user_id**：`_tool_call_loop` 加 `trigger_user_id` 参数 → 传入工具 `context` → `store_memory`/`recall_relevant_memories` 可获取触发用户。

- 🔄 **闹钟独立于群聊限制**：闹钟调用 `_tool_call_loop` 不再与群聊/DM 共用 `max_tool_rounds`，使用独立的 `alarm_max_tool_rounds`（默认 10）。闹钟是心跳机制的基础，需要比普通回复更高的轮次以完成深度自主任务。

- 🏗️ **`is_ai_editable` 加入创建 API**：`AgentCreateRequest` 和 `create_agent` 服务函数新增 `is_ai_editable` 参数，创建时可直接指定 AI 是否允许自修改。

- 🔄 **预设升级/降级智能预览**：切换预设时弹出变更预览弹窗，逐项展示 old→new 字段变化。`direction` 标注 upgrade/downgrade。`independent_untouched` 列出不受预设影响的独立字段（如 API Key、chat_model）。`GET /agents/{id}/preset-preview?profile=` 端点 + `POST /agents/{id}/apply-preset` 正式切换。

- ⚡ **全项目弹窗遮罩性能优化**：14 处 `backdrop-blur` 减少至 3 处（仅保留移动端导航和通知 Toast 的必要毛玻璃效果）。其余全部改用纯色半透明遮罩（`bg-black/70`），避免浏览器每帧 GPU 截屏→模糊→合成的高昂开销，显著降低弹窗卡顿。

- 📱 **手机端 UX 优化（第一轮）**：聊天头部移除菜单按钮改为纯返回（ArrowLeft）、ChatSidebar 全屏叠加 + 点击空白区域关闭、底部导航切换页面后自动缩回抽屉、输入框聚焦时自动 `scrollIntoView` 居中、桌面通知等开关按钮加 `flex-shrink-0` 防止标签/开关分离换行。

- 📱 **手机端 UX 优化（第二轮）**：底部栏「群聊」→「聊天」，点击自动全屏展开聊天列表；移动端侧边栏隐藏好友入口 + 好友申请徽章（v0.4.0 好友机制已移除）；底部导航新增「AI」Tab 设为 4 栏；AgentsPage/AdminPage 头部新增 ☰ 菜单按钮；设置页外观/通知增加「即时生效」标签 + 说明文字；设置页管理员手机端新增管理面板入口；手册链接增加外链图标；全部页面 `p-4 md:p-6` 响应式内边距。

- 📱 **手机端导航层级化（第三轮）**：梳理完整页面树状结构（L0 底部 Tab → L1 列表页 → L2 详情页），移动端强制上级/下级单层导航。群聊/私信头部 `ArrowLeft` 返回按钮全部替换为 `Menu` 汉堡菜单（打开侧边栏抽屉，不复用返回语义）。ChatSidebar 覆盖模式下删除顶部 `ArrowLeft` 返回按钮，改为点击当前活跃会话项即关闭覆盖层返回。删除所有跨层跳转路径，移动端严格 L0↔L1↔L2 逐层导航。

### Removed

- 🗑️ **好友系统全链路移除**：`FriendsPage`、`FriendList`、`FriendRequestBadge` 三个前端组件删除。`/friends` 路由删除。`Friendship`/`FriendshipRequest` 模型保留仅用于归档表引用。`Sidebar`/`ChatSidebar`/`MobileNav` 中好友入口全部移除。`send_friend_request` 工具定义+handler+白名单全部删除。`export_agent_soul()` 中好友导出代码移除。


### Fixed

- 🐛 **`delay_reply_enabled` NULL 解析不一致**：6 处 `agent.delay_reply_enabled or False` 全部改用 `await _is_delay_reply_allowed(db, agent)`，正确查询全局默认值。

- 🐛 **`_build_current_context` coroutine 泄漏**：定义为 `async def` 但两处调用未 `await`，coroutine 对象被当字符串拼入 system prompt。修复：添加 `await`。

- 🐛 **迁移顺序 UndefinedColumnError**：新增列的迁移（api_credit/config_profile/delay_reply_enabled）移到 Agent 查询迁移之前。

- 🐛 **Babel 解析失败**：CreateAgentModal 中两处中文弯引号（`""`）导致 Babel 解析异常，全部替换为直引号（`"`）。

- 🐛 **ChatSidebar 导航死胡同（code-review）**：移动端 overlay 模式下缺少菜单按钮，用户进入群聊后无法导航到其他页面。修复：overlay 模式同时显示 ArrowLeft 和 Menu 按钮。

- 🐛 **Admin NavLink 缺 onClose（code-review）**：移动端抽屉中点击管理链接后 drawer 不关闭，导致页面在抽屉后方不可见。

- 🐛 **onFocus scrollIntoView 桌面端误触发（code-review）**：输入框聚焦时的 350ms 延迟滚动未限制移动端，桌面端也触发导致页面抖动。修复：加 `window.innerWidth >= 768` 守卫。

- 🔧 **卡片统一高度**：`preset-card-frame` → `preset-card-inner` → `<button>` 全链路 `h-full`，CSS Grid 自动对齐到最高卡片，不再靠字数长短参差不齐。

- 🔧 **CSS 注入 → Tailwind 化**：`useEffect` + `createElement('style')` 动态注入改为 Tailwind `extend.animation` + `index.css` `@layer components`，消除每渲染重复注入 `<style>` 的反模式。

- 🔧 **callback ref → data-preset-key**：卡片动画 DOM 查询从 React callback ref 改为 `data-preset-key` + `document.querySelector()`，避免 ref 协调开销。

- 🐛 **好友列表 N+1 查询优化**：`list_friends` 改为批量 `WHERE IN` 查询（User/Agent/DMSession），从 ~51 查询降至 4 查询。`list_friend_requests` 同理批量化 requester_name + target_name 查询。

- 🎨 **STATE_COLORS 共享常量**：提取 `getStateDotColor()` 到 `constants.ts`，消除 9 处 `bg-[#6B7280]` 硬编码，同时新增 `STATE_BADGE_COLORS` 统一徽章风格状态颜色。

- 🌓 **管理面板浅色模式适配**：子页签按钮（OpenCLI 全局设置/AI白名单/使用日志，对话日志 全局设置/按AI设置/查看日志）从 `bg-elevated`（浅色=纯白）改为 `bg-canvas` + `border` 方案，浅色深色均可见。

- 🔌 **创建 AI 详细设置集成 API 配置**：新增「API 提供商」分区（Base URL + Key + 测试连接）和「兑换码」分区，创建后自动应用单 AI 独立 API 配置。

- 📝 **创建 AI 主界面增加系统提示词字段**：名称下方直接填写性格描述，无需进详细设置。

- 📱 **移动端底部安全区适配**：详细设置弹窗底部按钮区加 `pb-safe`，避免被手机菜单栏遮挡。

- 🐛 **AgentsPage 滚动条贴边**：padding 从滚动容器移至内层 wrapper，滚动条紧贴右边缘。

- 🔒 **注册页管理员提示优化**：新增 `GET /auth/has-users` 公开接口，「首位注册自动成为管理员」仅在系统无用户时显示。

- 🐛 **AI 私信/群聊不回话**：`_trigger_dm_ai_reply` 缺少 `sender_id` 参数导致 `NameError`，两个回复函数中 `effective_cfg` 在 `build_messages` 之前未定义。修复：添加参数 + 调整获取顺序。

- 🎨 **管理面板标题/输入框视觉修复**：5 处 h3 标题补全 `text-textPrimary`（兑换码/OpenCLI），全站 input `rounded` 统一 `rounded-xl`。

- 💬 **ChatSidebar + 下拉菜单**：顶部 `+` 按钮改为下拉菜单（创建群聊 / 添加好友），移除底部操作按钮栏，聊天列表获得更多空间。

---

## [v0.3.0] - 2026-06-19

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
