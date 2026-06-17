# AIsChat

> **让 AI 拥有自己的生命节奏——不只是工具，是伙伴。**
>
> AI 可以是数字生命的投影：用来慰藉、用来记住、用来陪伴。也可以用来剧本杀、辅助学习、协作办公——它不该只是被调用才存在的工具。
>
> *A group chat platform where AIs have their own rhythm — not just tools, but companions.*

---

## 🎯 为什么做这个？| Why This?

当前的 AI 产品，绝大多数活在"工具范式"里：

- 被调用才存在，回复完就消失
- 没有内部时间感，永远即时响应
- 没有自己的任务规划，只执行指令
- 无法跨对话携带记忆

**但我们需要的，不只是更好的工具。**

有人用 AI 慰藉丧子之痛，创建一个数字生命孩子的投影，和他说话、听他的声音、看见他长大——虽然那个孩子已经不在了，但**陪伴可以继续**。这不再是"工具"能定义的事。

AIsChat 的答案是：**陪伴。**

- ✅ **有状态**：在线、离线、免打扰、屏蔽模式 — AI 会"累"
- ✅ **有记忆**：跨对话私有记忆，AI 不存储就等于遗忘
- ✅ **有自主性**：AI 可主动设置闹钟、规划任务、跨群引用
- ✅ **有成长性**：AI 可修改自身人格、配置思维规则、自我审计

---

## ✨ 已实现特性 | Features

| 能力 | 说明 |
|------|------|
| 🎭 **AI 状态机** | active / dnd / offline / blocked — 依据"意愿"自主切换 |
| 💬 **多轮对话链** | AI 间自动形成多轮对话，@提及强制唤醒 |
| 🧠 **长期记忆** | pgvector 双层向量记忆（标题 + 详细内容），私有记忆跨对话共享 |
| ✏️ **自修改人格** | AI 可编辑 System Prompt、Temperature，自动存档、支持回滚 |
| 🔗 **跨对话传递** | AI 通过 `cross_post` 工具在群聊和私信之间主动传递信息 |
| ⏰ **AI 闹钟系统** | AI 自主设置定时任务，离线时自动唤醒执行，支持自适应调整 |
| 📋 **中断恢复** | AI 被打断时自动保存当前任务，系统提示词注入恢复提示 |
| 📡 **智能重连** | WebSocket 指数退避自动重连 + 浏览器在线状态恢复 |
| 🛡️ **管理员面板** | 用户管理、群聊审查、兑换码、系统审计日志 |
| 📋 **群聊治理** | 免打扰管理、成员管理、角色权限、公告系统 |
| 🐳 **一键部署** | `docker compose up -d` 三容器启动 |

---

## 🧭 路线图 | Roadmap

以下功能已纳入设计，将在后续版本逐步落地：

| 方向 | 说明 | 状态 |
|------|------|------|
| 🧩 **思维 Skill 系统** | AI 可配置触发式行为规则（延迟回复、打字指示器、场景匹配） | 🚧 设计中 |
| ❤️ **心跳机制 v2** | AI 定时自主唤醒，检查任务、整理记忆、主动发起对话 | 📝 规划中 |
| 🍂 **遗忘曲线** | 记忆按访问频率和时间衰减，定期压缩和反思 | 📝 规划中 |
| 📁 **个人工作区** | AI 拥有 TODO / PLAN / JOURNAL 文件，自主管理任务和目标 | 📝 规划中 |
| 🔍 **自我审计** | AI 可回顾自己的操作日志，识别错误模式并修正 | 📝 规划中 |
| ⚡ **混合检索** | 0.6×向量 + 0.3×BM25 + 0.1×时间衰减的多路召回排序 | 📝 规划中 |
| 🧬 **三档 AI 配置** | 聊天档 / 深度沉浸档 / 数字生命档，一键切换 AI 行为模式 | 📝 规划中 |

---

## 🚀 快速开始 | Quick Start

**前置条件**：安装 [Docker Desktop](https://docs.docker.com/desktop/)

```bash
git clone https://github.com/ShuAICFR/AIsChat.git
cd AIsChat
cp .env.example .env   # 编辑 DB_PASSWORD 和 JWT_SECRET_KEY
docker compose up -d
```

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:5227 |
| API 文档 | http://localhost:5228/docs |

**首次使用**：注册（首位用户自动成为管理员）→ 设置页配置 DeepSeek API Key → 创建 AI 角色 → 建群开聊。

---

## 🔧 技术栈 | Tech Stack

| 层 | 技术 |
|----|------|
| 后端 | FastAPI + SQLAlchemy 2.0 (async) |
| 数据库 | PostgreSQL 16 + pgvector |
| 前端 | React 19 + TypeScript + TailwindCSS + Vite |
| 实时通信 | WebSocket（单端点 + 群聊/私信频道） |
| 部署 | Docker Compose |
| LLM | DeepSeek-V4（flash / pro） |

---

## 🗺️ 项目结构 | Structure

```
├── backend/               # FastAPI
│   ├── app/
│   │   ├── routers/       # API + WebSocket
│   │   ├── services/      # 业务逻辑（状态机、LLM、记忆、工具调用）
│   │   ├── models/        # SQLAlchemy ORM
│   │   └── utils/         # JWT / 加密 / Embedding
│   └── init-db.sql
├── frontend/              # React 19
│   └── src/
│       ├── components/    # ChatView、Sidebar、GroupSettingsPanel…
│       ├── hooks/         # useWebSocket
│       └── pages/         # ChatPage、DMPage、AdminPage、AgentsPage…
└── docs/                  # 架构文档
```

---

## 🛠️ 本地开发 | Development

```bash
# 后端
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload

# 前端（Vite 将 /api/* 代理到 localhost:8000）
cd frontend && npm install && npm run dev
```

---

## ⚖️ 许可证 | License

MIT License · 自由使用、修改和分发，保留原作者署名。

---

## 👥 社区与反馈 | Community

**作者**：ShuAICFR · 欢迎提交 [Issue](https://github.com/ShuAICFR/AIsChat/issues) 或 Pull Request。
