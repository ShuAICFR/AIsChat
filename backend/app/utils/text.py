"""
文本处理工具函数
"""

import re

# @提及 提取正则：匹配 @ 后跟非空白/非标点字符的名称
_MENTION_RE = re.compile(
    r'@([^\s@，。！？、；：""''「」『』【】（）\(\)\[\]{}<>#+*&^%$!~`|\\/\n]+)'
)


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
