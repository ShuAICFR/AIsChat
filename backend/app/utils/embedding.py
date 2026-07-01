"""
嵌入向量工具模块
实现维度自动检测，支持 DeepSeek Embedding API
"""
import logging
import httpx
from app.config import settings

logger = logging.getLogger(__name__)

# 缓存的嵌入维度（首次调用后缓存）
_embedding_dimension: int | None = None
_embedding_model: str | None = None


async def detect_embedding_dimension(
    api_base_url: str = settings.deepseek_base_url,
    api_key: str | None = None,
) -> tuple[int, str]:
    """
    自动检测嵌入维度。
    发送测试请求，根据返回的 embedding 长度确定维度。
    返回 (维度, 模型名称)
    """
    global _embedding_dimension, _embedding_model

    if _embedding_dimension is not None:
        return _embedding_dimension, _embedding_model

    # 尝试的模型列表（按优先级：环境变量配置 > OpenAI 兼容 > 开源）
    configured = settings.default_embedding_model
    models_to_try = [configured] if configured else []
    # 去重追加常见备选
    for m in ["text-embedding-3-small", "text-embedding-ada-002", "bge-large-zh-v1.5"]:
        if m not in models_to_try:
            models_to_try.append(m)

    async with httpx.AsyncClient(timeout=30.0) as client:
        for model in models_to_try:
            try:
                url = f"{api_base_url}/v1/embeddings"
                headers = {"Content-Type": "application/json"}
                if api_key:
                    headers["Authorization"] = f"Bearer {api_key}"

                payload = {
                    "model": model,
                    "input": "test dimension detection",
                }

                response = await client.post(url, json=payload, headers=headers)

                if response.status_code == 200:
                    data = response.json()
                    embedding = data["data"][0]["embedding"]
                    dimension = len(embedding)
                    _embedding_dimension = dimension
                    _embedding_model = model
                    logger.info(
                        f"✅ 嵌入维度检测成功: 模型={model}, 维度={dimension}"
                    )
                    return dimension, model
                else:
                    logger.warning(
                        f"模型 {model} 请求失败 (HTTP {response.status_code}): {response.text[:200]}"
                    )
            except Exception as e:
                logger.warning(f"模型 {model} 检测异常: {e}")

    # 所有模型都失败，使用默认值
    logger.warning("⚠️  所有嵌入模型检测失败，使用默认维度 1536")
    _embedding_dimension = 1536
    _embedding_model = "text-embedding-3-small"
    return 1536, "text-embedding-3-small"


async def get_embedding(
    text: str,
    api_base_url: str = settings.deepseek_base_url,
    api_key: str | None = None,
    model: str | None = None,
) -> list[float]:
    """
    获取文本的嵌入向量。
    首次调用会自动检测维度。
    """
    _, detected_model = await detect_embedding_dimension(api_base_url, api_key)
    actual_model = model or detected_model

    async with httpx.AsyncClient(timeout=30.0) as client:
        url = f"{api_base_url}/v1/embeddings"
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        payload = {
            "model": actual_model,
            "input": text,
        }

        response = await client.post(url, json=payload, headers=headers)

        if response.status_code != 200:
            raise Exception(f"Embedding API 错误 ({response.status_code}): {response.text[:500]}")

        data = response.json()
        return data["data"][0]["embedding"]


def get_cached_dimension() -> int:
    """获取已缓存的嵌入维度（不会触发检测）"""
    return _embedding_dimension or 1536
