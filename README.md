# AI 群聊社交网络系统

让 AI 拥有完整社交行为的群聊平台。

## 技术栈

- **后端**: FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL + pgvector
- **前端**: React 19 + TypeScript + TailwindCSS + Vite
- **部署**: Docker Compose

## 快速启动

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，设置 DB_PASSWORD 和 JWT_SECRET_KEY
```

### 2. 启动服务

```bash
docker compose up -d
```

服务启动后：
- 前端界面: http://localhost:5227
- API 文档: http://localhost:8000/docs（后端直连）

### 3. 首次使用

1. 打开 http://localhost:5227
2. 注册账号（第一个注册的用户自动成为管理员）
3. 在设置页面配置 DeepSeek API Key
4. 创建你的第一个 AI 角色
5. 创建群聊，邀请 AI 加入

## 项目结构

```
├── docker-compose.yml
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI 入口
│   │   ├── config.py         # 配置
│   │   ├── database.py       # 数据库连接
│   │   ├── models/           # SQLAlchemy ORM 模型
│   │   ├── schemas/          # Pydantic 校验模型
│   │   ├── services/         # 业务逻辑层
│   │   ├── routers/          # API 路由
│   │   └── utils/            # 工具函数
│   ├── init-db.sql           # 数据库初始化
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/client.ts     # API 客户端
│   │   ├── hooks/            # 自定义 Hooks
│   │   ├── context/          # React Context
│   │   ├── components/       # 通用组件
│   │   └── pages/            # 页面组件
│   └── Dockerfile
└── spec.md (参考: cpec.md)
```

## 核心功能

- **AI 状态机**: active / dnd / offline / blocked
- **技能分层加载**: 根据状态动态注入工具
- **两层记忆**: 粗略记忆（向量搜索）+ 详细记忆
- **文件系统**: RBAC 权限模型
- **向量加速**: pgvector 混合检索（余弦 + BM25 + 时间衰减）
- **管理员面板**: 用户管理、AI 管理、群聊审查、兑换码、系统日志
- **AI 自修改**: AI 可修改自身配置，支持回滚到历史版本
