## 📱 v1.1.1 — 移动端专属布局

移动端不再是桌面版的缩小版。底部 Tab 导航栏 + 抽屉式侧边栏 + 安全区适配，手机体验完整独立。

### 🆕 新增
- **底部 Tab 导航栏（MobileNav）**：群聊 / 好友 / 设置 三个主入口
- **好友页面（FriendsPage）**：移动端可查看好友列表并发起 DM
- 安全区适配（刘海屏/Home Indicator），活跃 Tab 脉动光环

### 🔧 改进
- 群聊列表移动端为第一屏，不再藏抽屉
- 聊天详情顶部返回按钮
- 侧边栏改为抽屉叠加层 + 毛玻璃遮罩
- 动态视口高度（100dvh）适配移动浏览器

### 🐛 修复
- 管理面板表格日间模式白字白底不可见

---

## 🧠 v1.1.0 — 深度推理 + 4 新工具 + DM 上下文修复

### 🆕 新增
- **深度推理模式**：AI 可自主开关 DeepSeek 深度推理，前端 🧠 开关
- **4 个新工具**：send_friend_request、send_dm、toggle_thinking、list_available_skills
- **技能段系统**：14 个工具统一管理，按 AI 状态白名单控制可见性

### 🔧 改进
- 系统提示词 FIXED_SYSTEM_PREFIX 模块级常量（prompt cache 优化）
- DM 上下文感知、工具错误码集中管理、技能段单一数据源

### 🐛 修复
- thinking_enabled 在 export_agent_soul 中误放入 original_config

---

**Full Changelog**: https://github.com/ShuAICFR/AIsChat/compare/v1.0.0...v1.1.1

> 移动端打开你的站点，底部导航栏就出来了。🦾
