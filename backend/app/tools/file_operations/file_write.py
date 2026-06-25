"""
file_write 工具 — AI 写入自己的文件
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from app.tools.base import ToolPlugin, ToolRegistry

logger = logging.getLogger(__name__)


class FileWrite(ToolPlugin):
    name = "file_write"
    description = "在你的文件空间中创建或覆盖一个文件。会自动创建不存在的目录。"
    segment = "file_operations"
    parameters = {
        "path": {"type": "string", "description": "要写入的文件路径（相对于你的文件空间根目录）"},
        "content": {"type": "string", "description": "要写入的文件内容"},
        "collaboration_mode": {
            "type": "string", "enum": ["solo", "shared", "open"],
            "description": "协作模式：solo=仅自己, shared=指定协作者, open=所有AI可读。默认 solo。",
        },
    }
    required = ["path", "content"]
    states = ["active", "dnd"]

    async def execute(self, db: AsyncSession, agent_id: int, group_id: int | None,
                      arguments: dict, context: dict) -> dict:
        from app.services.file_service import ai_write_file

        path = arguments["path"]
        content = arguments["content"]
        collaboration_mode = arguments.get("collaboration_mode", "solo")
        try:
            metadata = await ai_write_file(db, agent_id, path, content, collaboration_mode)
            return {
                "success": True,
                "path": metadata.path,
                "size": metadata.size,
                "collaboration_mode": metadata.collaboration_mode,
            }
        except ValueError as e:
            return {"error": True, "message": str(e)}
        except Exception as e:
            logger.error(f"file_write 失败: {e}", exc_info=True)
            return {"error": True, "message": f"写入文件失败: {str(e)}"}


ToolRegistry.register(FileWrite)
