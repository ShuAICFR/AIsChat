"""
文件系统路由
"""
import os
import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.file import FileMetadata
from app.utils.auth import get_current_user
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fs", tags=["文件"])


def _check_path_safe(path: str) -> bool:
    """检查路径是否安全（防目录穿越）"""
    normalized = os.path.normpath(path)
    if normalized.startswith("..") or normalized.startswith("/"):
        return False
    return True


@router.get("/list")
async def list_files(
    path: str = Query("/", description="目录路径"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """列出目录内容"""
    if not _check_path_safe(path):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="路径不合法")

    # 查询文件元数据
    result = await db.execute(
        select(FileMetadata).where(FileMetadata.path.like(f"{path}%"))
    )
    files = result.scalars().all()

    return [
        {
            "id": f.id,
            "path": f.path,
            "owner_type": f.owner_type,
            "owner_id": f.owner_id,
            "size": f.size,
            "mime_type": f.mime_type,
            "created_at": str(f.created_at) if f.created_at else None,
        }
        for f in files
    ]


@router.post("/upload")
async def upload_file(
    path: str = Query("/"),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """上传文件"""
    if not _check_path_safe(path):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="路径不合法")

    # 构建物理存储路径
    relative_path = os.path.join(path, file.filename or f"unnamed_{uuid.uuid4().hex[:8]}")
    physical_path = os.path.join(settings.data_dir, relative_path)

    # 确保目录存在
    os.makedirs(os.path.dirname(physical_path), exist_ok=True)

    # 写入文件
    content = await file.read()
    with open(physical_path, "wb") as f:
        f.write(content)

    # 记录元数据
    metadata = FileMetadata(
        path=relative_path,
        owner_type="ai",  # 当前版本：个人文件
        owner_id=current_user["user_id"],
        size=len(content),
        mime_type=file.content_type,
        permissions={
            "owner": f"user:{current_user['user_id']}",
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

    return {
        "id": metadata.id,
        "path": relative_path,
        "size": metadata.size,
        "mime_type": metadata.mime_type,
    }


@router.get("/download/{file_id}")
async def download_file(
    file_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """下载文件"""
    result = await db.execute(select(FileMetadata).where(FileMetadata.id == file_id))
    metadata = result.scalar_one_or_none()

    if metadata is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")

    physical_path = os.path.join(settings.data_dir, metadata.path)
    if not os.path.exists(physical_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物理文件不存在")

    from fastapi.responses import FileResponse
    return FileResponse(
        physical_path,
        media_type=metadata.mime_type or "application/octet-stream",
        filename=os.path.basename(metadata.path),
    )


@router.delete("/delete")
async def delete_file(
    path: str = Query(...),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除文件"""
    if not _check_path_safe(path):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="路径不合法")

    result = await db.execute(
        select(FileMetadata).where(FileMetadata.path == path)
    )
    metadata = result.scalar_one_or_none()

    if metadata is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")

    # 检查权限
    if metadata.owner_id != current_user["user_id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权删除")

    # 删除物理文件
    physical_path = os.path.join(settings.data_dir, metadata.path)
    if os.path.exists(physical_path):
        os.remove(physical_path)

    # 删除元数据
    await db.delete(metadata)
    await db.flush()

    return {"message": "文件已删除", "path": path}


@router.post("/mkdir")
async def create_directory(
    path: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    """创建目录"""
    if not _check_path_safe(path):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="路径不合法")

    physical_path = os.path.join(settings.data_dir, path)
    os.makedirs(physical_path, exist_ok=True)

    return {"message": "目录已创建", "path": path}
