"""
联邦通信服务（v1.2.0 跨实例联邦通信）

提供实例身份管理、对等端 CRUD、群聊共享、HMAC 挑战-应答、
远程消息持久化等业务逻辑。不负责 WebSocket 连接管理（见 federation_manager.py）。
"""
import uuid
import hmac
import hashlib
import os
import time
import logging
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.utils.crypto import encrypt_api_key, decrypt_api_key
from app.config import settings
import httpx

logger = logging.getLogger(__name__)


# ── ULID 生成（纯 Python，零依赖） ──

# Crockford's Base32 编码表（排除 I L O U 避免混淆）
_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

def _encode_base32(value: int, length: int) -> str:
    """将整数编码为指定长度的 Base32 字符串"""
    chars = []
    for _ in range(length):
        chars.append(_BASE32[value & 0x1F])
        value >>= 5
    return ''.join(reversed(chars))

def generate_ulid() -> str:
    """
    生成 ULID（Universally Unique Lexicographically Sortable Identifier）。

    26 字符: 10 字符时间戳（48-bit ms）+ 16 字符随机数（80-bit）。
    UUIDv7 碰撞率约为 2.2e-16，ULID 理论上更低（80-bit 随机 vs 74-bit）。
    """
    # 48-bit 时间戳（毫秒级 Unix 时间）
    timestamp = int(time.time() * 1000)
    # 80-bit 加密级随机数
    random_bytes = os.urandom(10)
    random_int = int.from_bytes(random_bytes, 'big')

    ts_part = _encode_base32(timestamp, 10)
    rand_part = _encode_base32(random_int, 16)
    return ts_part + rand_part

def generate_public_id() -> str:
    """生成 AIsChat 公网 ID（AIsChat- + ULID）"""
    return f"AIsChat-{generate_ulid()}"

# ── 实例身份 ──

async def initialize_instance(db: AsyncSession) -> dict:
    """首次启动生成子网 UUID v4 + 公网 ULID，后续返回已有身份。"""
    from app.models.federation import InstanceConfig

    result = await db.execute(select(InstanceConfig).where(InstanceConfig.id == 1))
    config = result.scalar_one_or_none()

    if config is None:
        config = InstanceConfig(
            id=1,
            instance_id=str(uuid.uuid4()),
            public_id=generate_public_id(),
        )
        db.add(config)
        await db.commit()
        await db.refresh(config)
        logger.info(f"🌐 首次启动，实例子网 ID: {config.instance_id}, 公网 ID: {config.public_id}")
    elif not config.public_id:
        # 旧实例没有公网 ID，自动生成
        config.public_id = generate_public_id()
        config.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await db.commit()
        await db.refresh(config)
        logger.info(f"🌐 补生成公网 ID: {config.public_id}")
    else:
        logger.info(f"🌐 实例子网 ID: {config.instance_id}, 公网 ID: {config.public_id}")

    return _instance_config_to_dict(config)


async def get_instance_info(db: AsyncSession) -> dict:
    """获取本实例身份信息。若未初始化则自动初始化。"""
    from app.models.federation import InstanceConfig

    result = await db.execute(select(InstanceConfig).where(InstanceConfig.id == 1))
    config = result.scalar_one_or_none()
    if config is None:
        return await initialize_instance(db)
    return _instance_config_to_dict(config)


async def update_instance_info(
    db: AsyncSession,
    display_name: str | None = None,
    public_url: str | None = None,
    public_id: str | None = None,
) -> dict:
    """更新实例身份信息"""
    from app.models.federation import InstanceConfig

    result = await db.execute(select(InstanceConfig).where(InstanceConfig.id == 1))
    config = result.scalar_one_or_none()
    if config is None:
        # 尚未初始化，先初始化
        config = InstanceConfig(id=1, instance_id=str(uuid.uuid4()))
        db.add(config)
        await db.flush()

    if display_name is not None:
        config.display_name = display_name
    if public_url is not None:
        config.public_url = public_url
    if public_id is not None:
        config.public_id = public_id

    config.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    await db.refresh(config)
    logger.info(f"🌐 更新实例信息: display_name={config.display_name}, public_id={config.public_id}")
    return {"success": True, "instance": _instance_config_to_dict(config)}


async def regenerate_public_id(db: AsyncSession) -> dict:
    """重新生成公网 ID（用于冲突后的补救）"""
    from app.models.federation import InstanceConfig

    result = await db.execute(select(InstanceConfig).where(InstanceConfig.id == 1))
    config = result.scalar_one_or_none()
    if config is None:
        return {"error": True, "message": "实例尚未初始化"}

    old_id = config.public_id
    config.public_id = generate_public_id()
    config.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    await db.refresh(config)

    logger.info(f"🔄 更换公网 ID: {old_id} → {config.public_id}")
    return {"success": True, "old_public_id": old_id, "public_id": config.public_id}


# ── GitHub 注册表 ──

REGISTRY_URL = f"https://api.github.com/repos/{settings.registry_repo}/contents/{settings.registry_file}"


async def fetch_github_registry() -> dict:
    """
    从 GitHub Contents API 拉取注册表。
    返回 {"success": True, "registry": ...} 或 {"success": False, "message": ...}
    """
    import base64, json

    headers = {"Accept": "application/vnd.github.v3+json"}
    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(REGISTRY_URL, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                content = base64.b64decode(data["content"]).decode("utf-8")
                registry = json.loads(content)
                return {
                    "success": True,
                    "registry": registry,
                    "sha": data["sha"],
                    "updated_at": registry.get("updated_at", ""),
                }
            elif resp.status_code == 404:
                # 注册表文件还不存在，返回空注册表
                return {
                    "success": True,
                    "registry": {"version": 1, "updated_at": "", "instances": {}},
                    "sha": None,
                }
            elif resp.status_code == 403:
                return {"success": False, "message": "GitHub API 速率限制，请稍后重试或配置 GITHUB_TOKEN"}
            else:
                return {"success": False, "message": f"GitHub API 返回 {resp.status_code}: {resp.text[:200]}"}
    except httpx.HTTPError as e:
        logger.warning(f"拉取 GitHub 注册表失败: {e}")
        return {"success": False, "message": f"网络错误: {e}"}


async def register_public_id(db: AsyncSession) -> dict:
    """
    将当前实例的公网 ID 注册到 GitHub 注册表。

    流程：
    1. 获取当前实例的 public_id
    2. 拉取最新注册表 → 冲突检测
    3. 若 ID 已被占用 → 返回冲突信息
    4. 若 ID 未被占用 → 写入注册表 → PUT 回 GitHub
    """
    import base64, json

    # 1. 获取当前实例信息
    instance = await get_instance_info(db)
    public_id = instance.get("public_id")
    if not public_id:
        return {"success": False, "message": "实例尚未生成公网 ID，请先初始化"}

    if not settings.github_token:
        return {"success": False, "message": "未配置 GITHUB_TOKEN，无法写入注册表。请在 .env 中设置 GITHUB_TOKEN"}

    # 2. 拉取注册表 + 冲突检测
    registry_result = await fetch_github_registry()
    if not registry_result["success"]:
        return registry_result

    registry = registry_result["registry"]
    current_sha = registry_result["sha"]

    # 冲突检测
    existing = registry.get("instances", {}).get(public_id)
    if existing:
        return {
            "success": False,
            "conflict": True,
            "message": (
                f"公网 ID「{public_id}」已被占用。"
                f"占用实例: {existing.get('display_name', '未知')}，"
                f"注册时间: {existing.get('registered_at', '未知')}。"
                f"请点击「重新生成 ID」更换公网 ID。"
            ),
            "existing_entry": existing,
        }

    # 3. 写入注册表
    registry["instances"][public_id] = {
        "display_name": instance.get("display_name", ""),
        "public_url": instance.get("public_url", ""),
        "registered_at": datetime.now(timezone.utc).isoformat(),
    }
    registry["updated_at"] = datetime.now(timezone.utc).isoformat()

    headers = {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": f"Bearer {settings.github_token}",
    }
    body = {
        "message": f"Register {public_id}",
        "content": base64.b64encode(
            json.dumps(registry, indent=2, ensure_ascii=False).encode("utf-8")
        ).decode("ascii"),
    }
    if current_sha:
        body["sha"] = current_sha  # 乐观锁，防止并发覆盖

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.put(REGISTRY_URL, json=body, headers=headers)
            if resp.status_code in (200, 201):
                logger.info(f"✅ 公网 ID {public_id} 已注册到 GitHub 注册表")
                return {
                    "success": True,
                    "message": f"公网 ID「{public_id}」已成功注册到 GitHub 注册表",
                    "registry_url": f"https://github.com/{settings.registry_repo}/blob/main/{settings.registry_file}",
                }
            elif resp.status_code == 409:
                return {"success": False, "message": "注册表已被他人修改，请重试（SHA 冲突）"}
            elif resp.status_code == 422:
                return {"success": False, "message": "GitHub API 参数错误，请检查注册表文件路径"}
            else:
                return {"success": False, "message": f"GitHub API 返回 {resp.status_code}: {resp.text[:200]}"}
    except httpx.HTTPError as e:
        return {"success": False, "message": f"网络错误: {e}"}


# ── 对等端管理 ──

async def list_peers(db: AsyncSession) -> list[dict]:
    """列出所有对等端（含连接状态）"""
    from app.models.federation import FederationPeer

    result = await db.execute(select(FederationPeer).order_by(FederationPeer.created_at.asc()))
    peers = result.scalars().all()
    return [_peer_to_dict(p) for p in peers]


async def add_peer(
    db: AsyncSession,
    peer_public_id: str,
    remote_url: str,
    shared_secret: str,
    display_name: str = "",
) -> dict:
    """添加对等端（加密存储共享密钥）"""
    from app.models.federation import FederationPeer

    # 检查是否已存在同 public_id 的 peer
    existing = await db.execute(
        select(FederationPeer).where(FederationPeer.peer_public_id == peer_public_id)
    )
    if existing.scalar_one_or_none():
        return {"error": True, "message": f"对等端 {peer_public_id} 已存在"}

    encrypted_secret = encrypt_api_key(shared_secret)
    peer = FederationPeer(
        peer_public_id=peer_public_id,
        display_name=display_name,
        remote_url=remote_url,
        shared_secret_encrypted=encrypted_secret,
    )
    db.add(peer)
    await db.commit()
    await db.refresh(peer)

    logger.info(f"🌐 添加对等端: {peer_public_id} ({remote_url})")
    return {"success": True, "peer": _peer_to_dict(peer)}


async def update_peer(
    db: AsyncSession,
    peer_id: int,
    display_name: str | None = None,
    remote_url: str | None = None,
    shared_secret: str | None = None,
    is_enabled: bool | None = None,
) -> dict:
    """更新对等端配置"""
    from app.models.federation import FederationPeer

    result = await db.execute(select(FederationPeer).where(FederationPeer.id == peer_id))
    peer = result.scalar_one_or_none()
    if peer is None:
        return {"error": True, "message": "对等端不存在"}

    if display_name is not None:
        peer.display_name = display_name
    if remote_url is not None:
        peer.remote_url = remote_url
    if shared_secret is not None:
        peer.shared_secret_encrypted = encrypt_api_key(shared_secret)
    if is_enabled is not None:
        peer.is_enabled = is_enabled

    peer.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    await db.refresh(peer)

    logger.info(f"🌐 更新对等端 #{peer_id}: {peer.peer_public_id}")
    return {"success": True, "peer": _peer_to_dict(peer)}


async def remove_peer(db: AsyncSession, peer_id: int) -> dict:
    """移除对等端（级联删除群聊共享）"""
    from app.models.federation import FederationPeer

    result = await db.execute(select(FederationPeer).where(FederationPeer.id == peer_id))
    peer = result.scalar_one_or_none()
    if peer is None:
        return {"error": True, "message": "对等端不存在"}

    peer_name = peer.peer_public_id
    await db.delete(peer)
    await db.commit()

    logger.info(f"🌐 移除对等端 #{peer_id}: {peer_name}")
    return {"success": True, "message": f"对等端「{peer_name}」已移除"}


async def get_peer_by_public_id(db: AsyncSession, public_id: str):
    """根据公网 ID 查找对等端（返回 ORM 对象或 None）"""
    from app.models.federation import FederationPeer

    result = await db.execute(
        select(FederationPeer).where(FederationPeer.peer_public_id == public_id)
    )
    return result.scalar_one_or_none()


async def get_decrypted_secret(peer) -> str:
    """解密对等端的共享密钥"""
    return decrypt_api_key(peer.shared_secret_encrypted)


async def update_peer_connection_state(
    db: AsyncSession,
    peer_id: int,
    state: str,
) -> None:
    """更新对等端连接状态"""
    from app.models.federation import FederationPeer

    result = await db.execute(select(FederationPeer).where(FederationPeer.id == peer_id))
    peer = result.scalar_one_or_none()
    if peer is None:
        return

    peer.connection_state = state
    if state == "connected":
        peer.last_connected_at = datetime.now(timezone.utc).replace(tzinfo=None)
    peer.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()


# ── 群聊共享 ──

async def list_group_shares(db: AsyncSession, group_id: int) -> list[dict]:
    """查看某个群聊的联邦共享状态"""
    from app.models.federation import FederationGroupShare, FederationPeer

    result = await db.execute(
        select(FederationGroupShare, FederationPeer.peer_public_id, FederationPeer.display_name)
        .join(FederationPeer, FederationGroupShare.peer_id == FederationPeer.id)
        .where(FederationGroupShare.group_id == group_id)
        .order_by(FederationGroupShare.created_at.asc())
    )
    rows = result.all()
    shares = []
    for share, peer_public_id, peer_display_name in rows:
        d = _share_to_dict(share)
        d["peer_public_id"] = peer_public_id
        d["peer_display_name"] = peer_display_name
        shares.append(d)
    return shares


async def share_group(
    db: AsyncSession,
    group_id: int,
    peer_id: int,
    share_direction: str = "bidirectional",
) -> dict:
    """将群聊共享给对等端"""
    from app.models.federation import FederationGroupShare
    from app.models.group import Group

    # 检查是否已存在
    existing = await db.execute(
        select(FederationGroupShare).where(
            FederationGroupShare.group_id == group_id,
            FederationGroupShare.peer_id == peer_id,
        )
    )
    if existing.scalar_one_or_none():
        return {"error": True, "message": "该群已与此对等端共享"}

    share = FederationGroupShare(
        group_id=group_id,
        peer_id=peer_id,
        share_direction=share_direction,
    )
    db.add(share)

    # 设置 groups.is_federated 反范式化标记
    group_result = await db.execute(select(Group).where(Group.id == group_id))
    group = group_result.scalar_one_or_none()
    if group and not group.is_federated:
        group.is_federated = True

    await db.commit()
    await db.refresh(share)

    logger.info(f"🌐 群 {group_id} 已共享给 peer #{peer_id} (direction={share_direction})")
    return {"success": True, "share": _share_to_dict(share)}


async def unshare_group(
    db: AsyncSession,
    group_id: int,
    peer_id: int,
) -> dict:
    """取消群聊联邦共享"""
    from app.models.federation import FederationGroupShare
    from app.models.group import Group

    result = await db.execute(
        select(FederationGroupShare).where(
            FederationGroupShare.group_id == group_id,
            FederationGroupShare.peer_id == peer_id,
        )
    )
    share = result.scalar_one_or_none()
    if share is None:
        return {"error": True, "message": "共享记录不存在"}

    await db.delete(share)

    # 检查是否还有其他共享，若没有则取消 is_federated
    remaining = await db.execute(
        select(FederationGroupShare).where(FederationGroupShare.group_id == group_id)
    )
    if not remaining.scalars().all():
        group_result = await db.execute(select(Group).where(Group.id == group_id))
        group = group_result.scalar_one_or_none()
        if group:
            group.is_federated = False

    await db.commit()

    logger.info(f"🌐 群 {group_id} 取消共享 peer #{peer_id}")
    return {"success": True, "message": "已取消联邦共享"}


async def get_connected_peers_for_group(db: AsyncSession, group_id: int) -> list:
    """获取共享此群且已连接的对等端列表（返回 FederationPeer ORM 对象列表）"""
    from app.models.federation import FederationGroupShare, FederationPeer

    result = await db.execute(
        select(FederationPeer)
        .join(FederationGroupShare, FederationGroupShare.peer_id == FederationPeer.id)
        .where(
            FederationGroupShare.group_id == group_id,
            FederationGroupShare.is_enabled == True,
            FederationPeer.is_enabled == True,
            FederationPeer.connection_state == "connected",
        )
        .distinct()
    )
    return result.scalars().all()


# ── 远程消息处理 ──

async def handle_remote_message(
    db: AsyncSession,
    group_id: int,
    msg_dict: dict,
    source_public_id: str,
) -> "Message":
    """持久化来自远程实例的消息"""
    from app.models.message import Message

    message = Message(
        group_id=group_id,
        sender_type=msg_dict.get("sender_type", "human"),
        sender_id=0,  # 远程发送者，本地无对应 user_id，用 0 占位
        content=msg_dict.get("content", ""),
        reply_to=msg_dict.get("reply_to"),
        source_public_id=source_public_id,
    )
    # 保留远程时间戳
    remote_time = msg_dict.get("created_at")
    if remote_time:
        try:
            from datetime import datetime as dt
            message.created_at = dt.fromisoformat(remote_time.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            pass

    db.add(message)
    await db.flush()
    logger.info(f"🌐 持久化远程消息: group={group_id} from={source_public_id} id={message.id}")
    return message


# ── HMAC 挑战-应答 ──

def hmac_response(secret: str, challenge: str) -> str:
    """计算挑战的 HMAC-SHA256 应答"""
    return hmac.new(
        secret.encode("utf-8"),
        challenge.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def generate_challenge() -> str:
    """生成 256-bit 随机挑战字符串"""
    import secrets
    return secrets.token_hex(32)


# ── dict 转换 ──

def _instance_config_to_dict(config) -> dict:
    return {
        "instance_id": config.instance_id,
        "public_id": config.public_id,
        "display_name": config.display_name or "",
        "public_url": config.public_url or "",
        "created_at": str(config.created_at) if config.created_at else None,
        "updated_at": str(config.updated_at) if config.updated_at else None,
    }


def _peer_to_dict(peer) -> dict:
    return {
        "id": peer.id,
        "peer_public_id": peer.peer_public_id,
        "display_name": peer.display_name or "",
        "remote_url": peer.remote_url,
        "is_enabled": peer.is_enabled,
        "connection_state": peer.connection_state,
        "last_connected_at": str(peer.last_connected_at) if peer.last_connected_at else None,
        "created_at": str(peer.created_at) if peer.created_at else None,
        "updated_at": str(peer.updated_at) if peer.updated_at else None,
    }


def _share_to_dict(share) -> dict:
    return {
        "id": share.id,
        "group_id": share.group_id,
        "peer_id": share.peer_id,
        "is_enabled": share.is_enabled,
        "remote_group_id": share.remote_group_id,
        "share_direction": share.share_direction,
        "created_at": str(share.created_at) if share.created_at else None,
    }
