"""
文件服务层
文件 CRUD、权限检查、协作模式判定、O(n) 引用通知
"""
import os
import uuid
import logging
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sa_delete, and_
from app.models.file import FileMetadata, FileReference, FileCollaborator
from app.config import settings

logger = logging.getLogger(__name__)

# ============================================================
# 权限检查
# ============================================================

def _check_path_safe(path: str) -> bool:
    """检查路径是否安全（防目录穿越）"""
    normalized = os.path.normpath(path)
    if normalized.startswith("..") or normalized.startswith("/"):
        return False
    return True


def _get_physical_path(relative_path: str) -> str:
    """构建物理存储路径"""
    return os.path.join(settings.data_dir, relative_path)


def _check_permission(metadata: FileMetadata, requester_type: str, requester_id: int,
                      required_perm: str = "read") -> bool:
    """
    检查请求者对文件是否有指定权限。

    collaboration_mode 判定逻辑：
    - solo: 仅 owner 有全部权限
    - shared: owner + file_collaborators 中的协作者有权限
    - open: 所有同群/同 owner 的 AI 有 read 权限，write 需 owner 或 collaborator
    """
    # Owner 始终有全部权限
    if metadata.owner_type == requester_type and metadata.owner_id == requester_id:
        return True

    # 简单权限检查：根据 permissions JSONB 中的 rules
    if metadata.permissions and isinstance(metadata.permissions, dict):
        rules = metadata.permissions.get("rules", [])
        # 按角色匹配权限
        for rule in rules:
            role = rule.get("role", "")
            perm_str = rule.get("perm", "")
            if required_perm in perm_str:
                # 如果有更细粒度的检查逻辑，在此扩展
                pass

    return False


async def check_file_access(db: AsyncSession, file_id: int, requester_type: str,
                            requester_id: int, required_perm: str = "read") -> FileMetadata | None:
    """检查文件访问权限，返回 FileMetadata 或 None"""
    result = await db.execute(
        select(FileMetadata).where(FileMetadata.id == file_id)
    )
    metadata = result.scalar_one_or_none()
    if metadata is None:
        return None

    # Owner 始终有权限
    if metadata.owner_type == requester_type and metadata.owner_id == requester_id:
        return metadata

    # collaboration_mode 判定
    mode = metadata.collaboration_mode or "solo"

    if mode == "solo":
        # 仅 owner 有权限
        return None

    elif mode == "shared":
        # 检查是否为显式协作者
        collab_result = await db.execute(
            select(FileCollaborator).where(
                FileCollaborator.file_id == file_id,
                FileCollaborator.collaborator_type == requester_type,
                FileCollaborator.collaborator_id == requester_id,
            )
        )
        collab = collab_result.scalar_one_or_none()
        if collab is None:
            return None
        # viewer 角色只能读
        if collab.role == "viewer" and required_perm not in ("read",):
            return None
        return metadata

    elif mode == "open":
        # open 模式：read 权限对所有人开放，write 需 owner
        if required_perm == "read":
            return metadata
        # write 以上需 owner（已在上面返回）
        return None

    return None


# ============================================================
# 文件 CRUD
# ============================================================

async def upload_file(
    db: AsyncSession,
    path: str,
    filename: str,
    content: bytes,
    mime_type: str | None,
    owner_type: str,
    owner_id: int,
    collaboration_mode: str = "solo",
) -> FileMetadata:
    """上传文件到指定路径"""
    if not _check_path_safe(path):
        raise ValueError("路径不合法")

    relative_path = os.path.join(path, filename or f"unnamed_{uuid.uuid4().hex[:8]}")
    physical_path = _get_physical_path(relative_path)

    # 确保目录存在
    os.makedirs(os.path.dirname(physical_path), exist_ok=True)

    # 写入物理文件
    with open(physical_path, "wb") as f:
        f.write(content)

    # 记录元数据
    metadata = FileMetadata(
        path=relative_path,
        owner_type=owner_type,
        owner_id=owner_id,
        size=len(content),
        mime_type=mime_type,
        collaboration_mode=collaboration_mode,
        permissions={
            "owner": f"{owner_type}:{owner_id}",
            "rules": [
                {"role": "owner", "perm": "rwcdm"},
                {"role": "admin", "perm": "rwcd"},
                {"role": "collaborator", "perm": "rwc"},
                {"role": "viewer", "perm": "r"},
            ],
        },
    )
    db.add(metadata)
    await db.flush()
    await db.refresh(metadata)

    logger.info(f"文件上传完成: {relative_path} ({len(content)} bytes) by {owner_type}:{owner_id}")
    return metadata


async def list_files(
    db: AsyncSession,
    path: str,
    requester_type: str,
    requester_id: int,
) -> list[dict]:
    """列出目录内容（过滤无权条目）"""
    if not _check_path_safe(path):
        raise ValueError("路径不合法")

    result = await db.execute(
        select(FileMetadata).where(FileMetadata.path.like(f"{path}%"))
    )
    files = result.scalars().all()

    filtered = []
    for f in files:
        can_access = await check_file_access(db, f.id, requester_type, requester_id, "read")
        if can_access:
            filtered.append({
                "id": f.id,
                "path": f.path,
                "owner_type": f.owner_type,
                "owner_id": f.owner_id,
                "size": f.size,
                "mime_type": f.mime_type,
                "collaboration_mode": f.collaboration_mode,
                "created_at": str(f.created_at) if f.created_at else None,
                "updated_at": str(f.updated_at) if f.updated_at else None,
            })

    return filtered


async def get_file(db: AsyncSession, file_id: int) -> FileMetadata | None:
    """获取文件元数据"""
    result = await db.execute(
        select(FileMetadata).where(FileMetadata.id == file_id)
    )
    return result.scalar_one_or_none()


async def get_file_physical_path(db: AsyncSession, file_id: int,
                                 requester_type: str, requester_id: int) -> str | None:
    """获取文件的物理路径（含权限检查）"""
    metadata = await check_file_access(db, file_id, requester_type, requester_id, "read")
    if metadata is None:
        return None

    physical_path = _get_physical_path(metadata.path)
    if not os.path.exists(physical_path):
        return None

    return physical_path


async def delete_file(
    db: AsyncSession,
    file_id: int,
    requester_type: str,
    requester_id: int,
) -> bool:
    """删除文件（需 owner 或 delete 权限）"""
    metadata = await check_file_access(db, file_id, requester_type, requester_id, "delete")
    if metadata is None:
        # 再检查是否为 owner
        result = await db.execute(
            select(FileMetadata).where(FileMetadata.id == file_id)
        )
        metadata = result.scalar_one_or_none()
        if metadata is None:
            raise ValueError("文件不存在")
        if not (metadata.owner_type == requester_type and metadata.owner_id == requester_id):
            raise ValueError("无权删除此文件")

    # 删除物理文件
    physical_path = _get_physical_path(metadata.path)
    if os.path.exists(physical_path):
        os.remove(physical_path)

    # 删除元数据（级联删除 references 和 collaborators）
    await db.delete(metadata)
    await db.flush()

    logger.info(f"文件已删除: {metadata.path} by {requester_type}:{requester_id}")
    return True


# ============================================================
# 文件引用追踪（用于 O(n) 通知）
# ============================================================

async def track_file_reference(
    db: AsyncSession,
    file_id: int,
    referrer_type: str,
    referrer_id: int,
    ref_type: str = "read",
) -> FileReference:
    """记录文件引用（幂等：同一引用方对同一文件只保留一条记录）"""
    # 检查是否已存在
    result = await db.execute(
        select(FileReference).where(
            FileReference.file_id == file_id,
            FileReference.referrer_type == referrer_type,
            FileReference.referrer_id == referrer_id,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        # 更新引用类型（如从 read 升级到 write）
        if existing.ref_type != ref_type:
            existing.ref_type = ref_type
            await db.flush()
        return existing

    ref = FileReference(
        file_id=file_id,
        referrer_type=referrer_type,
        referrer_id=referrer_id,
        ref_type=ref_type,
    )
    db.add(ref)
    await db.flush()
    await db.refresh(ref)
    return ref


async def get_file_referrers(db: AsyncSession, file_id: int) -> list[dict]:
    """获取文件的所有引用方（用于 O(n) 通知）"""
    result = await db.execute(
        select(FileReference).where(FileReference.file_id == file_id)
    )
    refs = result.scalars().all()
    return [
        {
            "referrer_type": r.referrer_type,
            "referrer_id": r.referrer_id,
            "ref_type": r.ref_type,
        }
        for r in refs
    ]


async def get_ai_referenced_files(db: AsyncSession, ai_id: int) -> list[dict]:
    """获取 AI 引用的所有文件"""
    result = await db.execute(
        select(FileReference, FileMetadata).join(
            FileMetadata, FileReference.file_id == FileMetadata.id
        ).where(
            FileReference.referrer_type == "ai",
            FileReference.referrer_id == ai_id,
        )
    )
    rows = result.all()
    return [
        {
            "file_id": ref.file_id,
            "path": meta.path,
            "ref_type": ref.ref_type,
            "size": meta.size,
            "mime_type": meta.mime_type,
        }
        for ref, meta in rows
    ]


# ============================================================
# 协作模式管理
# ============================================================

async def set_collaboration_mode(
    db: AsyncSession,
    file_id: int,
    mode: str,
    requester_type: str,
    requester_id: int,
) -> FileMetadata:
    """修改文件的协作模式（仅 owner 可操作）"""
    result = await db.execute(
        select(FileMetadata).where(FileMetadata.id == file_id)
    )
    metadata = result.scalar_one_or_none()
    if metadata is None:
        raise ValueError("文件不存在")

    if not (metadata.owner_type == requester_type and metadata.owner_id == requester_id):
        raise ValueError("仅文件所有者可修改协作模式")

    if mode not in ("solo", "shared", "open"):
        raise ValueError("无效的协作模式，可选值: solo, shared, open")

    metadata.collaboration_mode = mode
    metadata.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.flush()

    logger.info(f"文件 {file_id} 协作模式已更改为 {mode}")
    return metadata


async def add_file_collaborator(
    db: AsyncSession,
    file_id: int,
    collaborator_type: str,
    collaborator_id: int,
    role: str = "collaborator",
    requester_type: str | None = None,
    requester_id: int | None = None,
) -> FileCollaborator:
    """添加文件协作者（仅 owner 可操作）"""
    # 权限检查
    result = await db.execute(
        select(FileMetadata).where(FileMetadata.id == file_id)
    )
    metadata = result.scalar_one_or_none()
    if metadata is None:
        raise ValueError("文件不存在")

    if requester_type and requester_id:
        if not (metadata.owner_type == requester_type and metadata.owner_id == requester_id):
            raise ValueError("仅文件所有者可管理协作者")

    # 检查是否已存在
    exist_result = await db.execute(
        select(FileCollaborator).where(
            FileCollaborator.file_id == file_id,
            FileCollaborator.collaborator_type == collaborator_type,
            FileCollaborator.collaborator_id == collaborator_id,
        )
    )
    if exist_result.scalar_one_or_none():
        raise ValueError("该协作者已存在")

    collab = FileCollaborator(
        file_id=file_id,
        collaborator_type=collaborator_type,
        collaborator_id=collaborator_id,
        role=role,
    )
    db.add(collab)
    await db.flush()
    await db.refresh(collab)

    # 自动将协作模式设为 shared
    if metadata.collaboration_mode == "solo":
        metadata.collaboration_mode = "shared"
        metadata.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await db.flush()

    logger.info(f"已添加协作者 {collaborator_type}:{collaborator_id} 到文件 {file_id}")
    return collab


async def remove_file_collaborator(
    db: AsyncSession,
    file_id: int,
    collaborator_type: str,
    collaborator_id: int,
) -> bool:
    """移除文件协作者"""
    result = await db.execute(
        select(FileCollaborator).where(
            FileCollaborator.file_id == file_id,
            FileCollaborator.collaborator_type == collaborator_type,
            FileCollaborator.collaborator_id == collaborator_id,
        )
    )
    collab = result.scalar_one_or_none()
    if collab is None:
        raise ValueError("协作者不存在")

    await db.delete(collab)
    await db.flush()
    logger.info(f"已移除协作者 {collaborator_type}:{collaborator_id} 从文件 {file_id}")
    return True


async def get_file_collaborators(db: AsyncSession, file_id: int) -> list[dict]:
    """获取文件的所有协作者"""
    result = await db.execute(
        select(FileCollaborator).where(FileCollaborator.file_id == file_id)
    )
    collabs = result.scalars().all()
    return [
        {
            "collaborator_type": c.collaborator_type,
            "collaborator_id": c.collaborator_id,
            "role": c.role,
        }
        for c in collabs
    ]


# ============================================================
# O(n) 通知：文件变更时通知所有引用方
# ============================================================

async def notify_file_changed(db: AsyncSession, file_id: int, change_type: str,
                              changed_by_type: str, changed_by_id: int):
    """
    文件变更时通知所有引用方（O(n) 遍历）。
    通过 WebSocket 推送 file_changed 事件到每个在线 AI。
    """
    from app.routers.ws import manager

    referrers = await get_file_referrers(db, file_id)
    metadata = await get_file(db, file_id)

    notified = set()
    for ref in referrers:
        if ref["referrer_type"] == "ai":
            ai_id = ref["referrer_id"]
            if ai_id in notified:
                continue
            notified.add(ai_id)

            # 通过 WebSocket 查找 AI 对应的 user_id 并推送
            from app.models.agent import Agent
            agent_result = await db.execute(
                select(Agent.user_id).where(Agent.id == ai_id)
            )
            agent_user_id = agent_result.scalar_one_or_none()
            if agent_user_id:
                try:
                    await manager.send_to_user(agent_user_id, {
                        "type": "file_changed",
                        "data": {
                            "file_id": file_id,
                            "path": metadata.path if metadata else None,
                            "change_type": change_type,
                            "changed_by_type": changed_by_type,
                            "changed_by_id": changed_by_id,
                        },
                    })
                except Exception as e:
                    logger.warning(f"文件变更通知AI {ai_id} 失败: {e}")

    logger.info(f"文件 {file_id} 变更通知已发送给 {len(notified)} 个引用方")


# ============================================================
# AI 文件操作工具辅助函数
# ============================================================

async def ai_read_file(db: AsyncSession, agent_id: int, file_path: str) -> str:
    """AI 读取文件（自动追踪引用）"""
    if not _check_path_safe(file_path):
        raise ValueError("路径不合法")

    physical_path = _get_physical_path(file_path)
    if not os.path.exists(physical_path):
        raise ValueError(f"文件不存在: {file_path}")

    # 检查权限
    result = await db.execute(
        select(FileMetadata).where(FileMetadata.path == file_path)
    )
    metadata = result.scalar_one_or_none()
    if metadata:
        can_access = await check_file_access(db, metadata.id, "ai", agent_id, "read")
        if not can_access:
            raise ValueError("无权读取此文件")
    # 无元数据的文件（旧数据）允许读取

    # 读取文件
    try:
        with open(physical_path, "r", encoding="utf-8") as f:
            content = f.read()
    except UnicodeDecodeError:
        # 二进制文件尝试用 latin-1
        with open(physical_path, "r", encoding="latin-1") as f:
            content = f.read()

    # 追踪引用
    if metadata:
        await track_file_reference(db, metadata.id, "ai", agent_id, "read")

    return content


async def ai_write_file(db: AsyncSession, agent_id: int, file_path: str,
                        content: str, collaboration_mode: str = "solo") -> FileMetadata:
    """AI 写入文件（创建或覆盖）"""
    if not _check_path_safe(file_path):
        raise ValueError("路径不合法")

    physical_path = _get_physical_path(file_path)
    os.makedirs(os.path.dirname(physical_path), exist_ok=True)

    content_bytes = content.encode("utf-8")
    with open(physical_path, "wb") as f:
        f.write(content_bytes)

    # 查找或创建元数据
    result = await db.execute(
        select(FileMetadata).where(FileMetadata.path == file_path)
    )
    metadata = result.scalar_one_or_none()

    if metadata:
        # 更新已有文件
        metadata.size = len(content_bytes)
        metadata.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await track_file_reference(db, metadata.id, "ai", agent_id, "write")
        await db.flush()
        # 通知引用方
        await notify_file_changed(db, metadata.id, "modified", "ai", agent_id)
    else:
        # 创建新文件
        metadata = FileMetadata(
            path=file_path,
            owner_type="ai",
            owner_id=agent_id,
            size=len(content_bytes),
            mime_type="text/plain",
            collaboration_mode=collaboration_mode,
            permissions={
                "owner": f"ai:{agent_id}",
                "rules": [
                    {"role": "owner", "perm": "rwcdm"},
                    {"role": "collaborator", "perm": "rwc"},
                    {"role": "viewer", "perm": "r"},
                ],
            },
        )
        db.add(metadata)
        await db.flush()
        await db.refresh(metadata)
        await track_file_reference(db, metadata.id, "ai", agent_id, "write")

    return metadata


async def ai_list_files(db: AsyncSession, agent_id: int, path: str = "/") -> list[dict]:
    """AI 列出目录"""
    return await list_files(db, path, "ai", agent_id)


async def ai_delete_file(db: AsyncSession, agent_id: int, file_path: str) -> bool:
    """AI 删除文件"""
    if not _check_path_safe(file_path):
        raise ValueError("路径不合法")

    result = await db.execute(
        select(FileMetadata).where(FileMetadata.path == file_path)
    )
    metadata = result.scalar_one_or_none()
    if metadata is None:
        raise ValueError("文件不存在")

    return await delete_file(db, metadata.id, "ai", agent_id)


async def ai_share_file(db: AsyncSession, agent_id: int, file_path: str,
                        target_type: str, target_id: int, role: str = "collaborator") -> dict:
    """AI 分享文件给其他 AI 或用户"""
    if not _check_path_safe(file_path):
        raise ValueError("路径不合法")

    result = await db.execute(
        select(FileMetadata).where(FileMetadata.path == file_path)
    )
    metadata = result.scalar_one_or_none()
    if metadata is None:
        raise ValueError("文件不存在")

    if not (metadata.owner_type == "ai" and metadata.owner_id == agent_id):
        raise ValueError("仅文件所有者可分享")

    # 添加协作者（自动切换协作模式为 shared）
    await add_file_collaborator(db, metadata.id, target_type, target_id, role)

    # 追踪分享引用
    await track_file_reference(db, metadata.id, target_type, target_id, "share")

    return {
        "file_id": metadata.id,
        "path": metadata.path,
        "shared_with": f"{target_type}:{target_id}",
        "role": role,
    }
