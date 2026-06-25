"""
file_delete 工具 — AI 删除自己的文件
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from app.tools.base import ToolPlugin, ToolRegistry

logger = logging.getLogger(__name__)


class FileDelete(ToolPlugin):
    name = "file_delete"
    description = "删除你文件空间中的一个文件。"
    segment = "file_operations"
    parameters = {
        "path": {"type": "string", "description": "要删除的文件路径（相对于你的文件空间根目录）"},
    }
    required = ["path"]
    states = ["active", "dnd"]

    async def execute(self, db: AsyncSession, agent_id: int, group_id: int | None,
                      arguments: dict, context: dict) -> dict:
        from app.services.file_service import ai_delete_file

        path = arguments["path"]
        try:
            await ai_delete_file(db, agent_id, path)
            return {"success": True, "path": path, "message": "文件已删除"}
        except ValueError as e:
            return {"error": True, "message": str(e)}
        except Exception as e:
            logger.error(f"file_delete 失败: {e}", exc_info=True)
            return {"error": True, "message": f"删除文件失败: {str(e)}"}


ToolRegistry.register(FileDelete)
