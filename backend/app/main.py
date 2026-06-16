"""
AI群聊社交网络 - FastAPI 主应用入口
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import check_db_connection

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("app.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    logger.info("🚀 AI群聊社交网络系统启动中...")
    logger.info(f"  默认聊天模型: {settings.default_chat_model}")
    logger.info(f"  默认工作模型: {settings.default_work_model}")

    # 检查数据库连接
    db_ok = await check_db_connection()
    if db_ok:
        logger.info("✅ 数据库连接正常")
    else:
        logger.warning("⚠️  数据库连接失败，请检查配置")

    # 执行数据库迁移（幂等）
    from app.migration import run_migrations
    await run_migrations()

    # 启动 AI 回复 Worker
    from app.services.ai_response_worker import ai_response_worker
    ai_worker_task = asyncio.create_task(ai_response_worker())

    # 启动向量化 Pipeline Worker
    from app.services.vector_pipeline import vector_pipeline_worker
    vector_worker_task = asyncio.create_task(vector_pipeline_worker())

    logger.info("✅ 后台 worker 已全部启动")

    yield

    logger.info("👋 系统关闭，正在停止后台 worker...")
    for task in [ai_worker_task, vector_worker_task]:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    logger.info("后台 worker 已停止")


app = FastAPI(
    title="AI群聊社交网络",
    description="让 AI 拥有完整社交行为的群聊平台",
    version="1.1.2",
    lifespan=lifespan,
)

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 开发环境允许所有来源
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 注册路由
from app.routers import auth, agents, groups, ws, user, memories, files, admin, friends, dm

app.include_router(auth.router)
app.include_router(agents.router)
app.include_router(groups.router)
app.include_router(ws.router)
app.include_router(user.router)
app.include_router(memories.router)
app.include_router(files.router)
app.include_router(admin.router)
app.include_router(friends.router)
app.include_router(dm.router)


@app.get("/")
async def root():
    """健康检查"""
    return {
        "service": "AI群聊社交网络",
        "version": "0.1.0",
        "status": "running",
    }


@app.get("/health")
async def health():
    """健康检查（详细）"""
    db_ok = await check_db_connection()
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "disconnected",
    }
