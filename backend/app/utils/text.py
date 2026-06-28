"""
文本处理工具函数
"""

import re

# @提及 提取正则：匹配 @ 后跟非空白/非标点字符的名称
_MENTION_RE = re.compile(
    r'@([^\s@，。！？、；：""''「」『』【】（）\(\)\[\]{}<>#+*&^%$!~`|\\/\n]+)'
)

# CJK 字符范围（中日韩统一表意文字）
_CJK_RE = re.compile(r'[一-鿿㐀-䶿豈-﫿]')


def extract_mentions(content: str) -> set[str]:
    """
    从消息内容中提取所有 @提及 的名称。

    例如 "你好 @梦希 和 @涵吾珑 一起聊天" → {"梦希", "涵吾珑"}
    支持格式: @name（name 不含空格，直到遇到空格/标点/结尾）
    """
    mentions = set()
    for match in _MENTION_RE.finditer(content):
        name = match.group(1).rstrip('.,;:!?…')
        if name:
            mentions.add(name)
    return mentions


def check_mention(content: str, target_name: str) -> bool:
    """
    检查消息中是否 @ 提及了指定名称，或 @all/@ai。

    还支持 @human（泛指所有人类成员）。
    """
    if not target_name:
        return False
    if target_name in extract_mentions(content):
        return True
    content_lower = content.lower()
    return "@all" in content_lower or "@ai" in content_lower


def validate_status_text(status_text: str | None) -> str | None:
    """
    校验状态文本长度。空值/空字符串直接放行（表示清空状态）。

    规则：中文为主（CJK 占比 > 50%）→ 最多 10 字；英文为主 → 最多 30 字符。
    不符合则抛出 ValueError。
    """
    if not status_text or not status_text.strip():
        return status_text

    text = status_text.strip()
    cjk_count = len(_CJK_RE.findall(text))
    total_chars = len(text)
    cjk_ratio = cjk_count / total_chars if total_chars > 0 else 0

    if cjk_ratio > 0.5:
        max_len = 10
        lang_name = "中文"
    else:
        max_len = 30
        lang_name = "英文/拉丁"

    if total_chars > max_len:
        raise ValueError(
            f"状态文本过长（{total_chars} 字符），{lang_name}状态最多 {max_len} 个字符"
        )

    return text
