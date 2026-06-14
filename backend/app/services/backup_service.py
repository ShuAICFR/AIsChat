"""
数据库备份/恢复服务
使用 pg_dump / psql 进行 PostgreSQL 数据库的导出和导入
"""
import asyncio
import os
import tempfile
import logging
from app.config import settings

logger = logging.getLogger(__name__)

BACKUP_TIMEOUT = 120  # 备份超时（秒）
RESTORE_TIMEOUT = 300  # 恢复超时（秒）


async def create_backup() -> bytes:
    """
    执行 pg_dump，导出整个数据库为 SQL 字节。
    使用 settings.database_url_sync 连接数据库。
    超时 120 秒。
    """
    db_url = settings.database_url_sync

    # 解析数据库连接信息：postgresql://user:pass@host:port/dbname
    # 示例：postgresql://ai_chat:password@postgres:5432/ai_group_chat
    url = db_url.replace("postgresql://", "")
    # 分离 user:pass@host:port/dbname
    auth_host, dbname = url.rsplit("/", 1)
    user_pass, host_port = auth_host.rsplit("@", 1)
    user, password = user_pass.split(":", 1)
    host, port = host_port.split(":", 1) if ":" in host_port else (host_port, "5432")

    cmd = [
        "pg_dump",
        "-h", host,
        "-p", port,
        "-U", user,
        "-d", dbname,
        "--no-owner",
        "--no-acl",
        "--encoding=UTF8",
    ]

    logger.info(f"开始备份数据库: {dbname}")

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "PGPASSWORD": password},
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=BACKUP_TIMEOUT
        )

        if proc.returncode != 0:
            err_msg = stderr.decode("utf-8", errors="replace")
            logger.error(f"pg_dump 失败 (code={proc.returncode}): {err_msg}")
            raise RuntimeError(f"数据库备份失败: {err_msg[:500]}")

        logger.info(f"数据库备份完成: {len(stdout)} bytes")
        return stdout

    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError("数据库备份超时（超过 120 秒）")
    except FileNotFoundError:
        raise RuntimeError("pg_dump 未安装，请检查 postgresql-client 是否已安装")


async def restore_backup(sql_content: bytes) -> dict:
    """
    执行 psql 恢复数据库。
    ⚠️ 此操作会覆盖当前数据库所有数据，需谨慎使用。
    超时 300 秒。
    """
    db_url = settings.database_url_sync

    url = db_url.replace("postgresql://", "")
    auth_host, dbname = url.rsplit("/", 1)
    user_pass, host_port = auth_host.rsplit("@", 1)
    user, password = user_pass.split(":", 1)
    host, port = host_port.split(":", 1) if ":" in host_port else (host_port, "5432")

    # 将 SQL 写入临时文件，psql 从文件读取更稳定
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", suffix=".sql", delete=False, prefix="aischat_restore_"
        ) as f:
            f.write(sql_content)
            tmp_path = f.name

        cmd = [
            "psql",
            "-h", host,
            "-p", port,
            "-U", user,
            "-d", dbname,
            "-f", tmp_path,
            "-v", "ON_ERROR_STOP=1",
        ]

        logger.info(f"开始恢复数据库: {dbname}")

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "PGPASSWORD": password},
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=RESTORE_TIMEOUT
        )

        if proc.returncode != 0:
            err_msg = stderr.decode("utf-8", errors="replace")
            logger.error(f"psql 恢复失败 (code={proc.returncode}): {err_msg}")
            raise RuntimeError(f"数据库恢复失败: {err_msg[:500]}")

        logger.info("数据库恢复完成")
        return {"success": True, "message": "数据库已恢复，请刷新页面"}

    except asyncio.TimeoutError:
        raise RuntimeError("数据库恢复超时（超过 300 秒）")
    except FileNotFoundError:
        raise RuntimeError("psql 未安装，请检查 postgresql-client 是否已安装")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
