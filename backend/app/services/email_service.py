"""
SMTP 邮件发送服务
使用 aiosmtplib 异步发送验证码邮件
v1.0.0: 多 SMTP 容灾 + 自定义邮件模板
"""
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.system_settings import SystemSettings
from app.services.system_settings_service import get_settings
from app.utils.crypto import decrypt_api_key, encrypt_api_key

logger = logging.getLogger(__name__)

# 默认邮件模板（DB 未配置时的 fallback）
EMAIL_TEMPLATES = {
    "zh": {
        "register": {
            "subject": "【{from_name}】邮箱验证码",
            "body_html": """<div style="max-width:480px;margin:0 auto;font-family:Arial,sans-serif">
<h2 style="color:#7C3AED">{from_name}</h2>
<p>你好，</p>
<p>你的邮箱验证码是：</p>
<div style="background:#F3F4F6;border-radius:8px;padding:20px;text-align:center;margin:16px 0">
  <span style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#1F2937">{code}</span>
</div>
<p>验证码 5 分钟内有效，请勿转发给他人。</p>
<p style="color:#9CA3AF;font-size:12px">如果这不是你的操作，请忽略此邮件。</p>
</div>""",
        },
        "login": {
            "subject": "【{from_name}】登录验证码",
            "body_html": """<div style="max-width:480px;margin:0 auto;font-family:Arial,sans-serif">
<h2 style="color:#7C3AED">{from_name}</h2>
<p>你好，</p>
<p>你的登录验证码是：</p>
<div style="background:#F3F4F6;border-radius:8px;padding:20px;text-align:center;margin:16px 0">
  <span style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#1F2937">{code}</span>
</div>
<p>验证码 5 分钟内有效，请勿转发给他人。</p>
<p style="color:#9CA3AF;font-size:12px">如果这不是你的操作，请忽略此邮件。</p>
</div>""",
        },
        "rebind": {
            "subject": "【{from_name}】换绑邮箱验证码",
            "body_html": """<div style="max-width:480px;margin:0 auto;font-family:Arial,sans-serif">
<h2 style="color:#7C3AED">{from_name}</h2>
<p>你好，</p>
<p>你正在更换绑定邮箱，验证码是：</p>
<div style="background:#F3F4F6;border-radius:8px;padding:20px;text-align:center;margin:16px 0">
  <span style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#1F2937">{code}</span>
</div>
<p>验证码 5 分钟内有效，请勿转发给他人。</p>
<p style="color:#9CA3AF;font-size:12px">如果这不是你的操作，你的账号可能已被盗用，请立即联系管理员。</p>
</div>""",
        },
    },
    "en": {
        "register": {
            "subject": "[{from_name}] Email Verification Code",
            "body_html": """<div style="max-width:480px;margin:0 auto;font-family:Arial,sans-serif">
<h2 style="color:#7C3AED">{from_name}</h2>
<p>Hello,</p>
<p>Your email verification code is:</p>
<div style="background:#F3F4F6;border-radius:8px;padding:20px;text-align:center;margin:16px 0">
  <span style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#1F2937">{code}</span>
</div>
<p>This code is valid for 5 minutes. Do not share it with anyone.</p>
<p style="color:#9CA3AF;font-size:12px">If this wasn't you, please ignore this email.</p>
</div>""",
        },
        "login": {
            "subject": "[{from_name}] Login Verification Code",
            "body_html": """<div style="max-width:480px;margin:0 auto;font-family:Arial,sans-serif">
<h2 style="color:#7C3AED">{from_name}</h2>
<p>Hello,</p>
<p>Your login verification code is:</p>
<div style="background:#F3F4F6;border-radius:8px;padding:20px;text-align:center;margin:16px 0">
  <span style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#1F2937">{code}</span>
</div>
<p>This code is valid for 5 minutes. Do not share it with anyone.</p>
<p style="color:#9CA3AF;font-size:12px">If this wasn't you, please ignore this email.</p>
</div>""",
        },
        "rebind": {
            "subject": "[{from_name}] Email Rebind Verification Code",
            "body_html": """<div style="max-width:480px;margin:0 auto;font-family:Arial,sans-serif">
<h2 style="color:#7C3AED">{from_name}</h2>
<p>Hello,</p>
<p>You are changing your bound email. The verification code is:</p>
<div style="background:#F3F4F6;border-radius:8px;padding:20px;text-align:center;margin:16px 0">
  <span style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#1F2937">{code}</span>
</div>
<p>This code is valid for 5 minutes. Do not share it with anyone.</p>
<p style="color:#9CA3AF;font-size:12px">If this wasn't you, your account may have been compromised. Contact the admin immediately.</p>
</div>""",
        },
    },
}


class SafeDict(dict):
    """安全字典：格式化时缺失的 key 保留原占位符，不抛 KeyError"""
    def __missing__(self, key):
        return '{' + key + '}'


async def _get_smtp_configs(db: AsyncSession) -> list[dict]:
    """读取全部 SMTP 配置列表（密码解密）。未配置返回空列表。

    兼容三种格式：
    1. 新格式 JSONB 数组: [{"host":..., "is_active":true, "priority":0}, ...]
    2. 旧格式 JSONB 单对象: {"host":..., ...} → 自动包装为数组
    3. JSON 字符串（历史遗留）
    """
    settings = await get_settings(db)
    smtp_raw = settings.get("smtp_config")

    if not smtp_raw:
        return []

    # 兼容 JSON 字符串
    if isinstance(smtp_raw, str):
        import json
        smtp_raw = json.loads(smtp_raw)

    # 兼容旧格式：单对象 → 包装为数组
    if isinstance(smtp_raw, dict):
        smtp_raw = [smtp_raw]

    if not isinstance(smtp_raw, list):
        return []

    result = []
    for cfg in smtp_raw:
        if not isinstance(cfg, dict):
            continue
        cfg = dict(cfg)  # 浅拷贝，避免修改 DB 中的原始值
        # 解密密码
        if cfg.get("password_encrypted"):
            try:
                cfg["password"] = decrypt_api_key(cfg.pop("password_encrypted"))
            except Exception:
                cfg["password"] = ""
        else:
            cfg["password"] = cfg.get("password", "")
        # 确保兼容字段存在
        cfg.setdefault("is_active", True)
        cfg.setdefault("priority", 0)
        result.append(cfg)

    return result


def _pick_smtp_config(configs: list[dict]) -> dict | None:
    """按 priority 升序，取第一个 is_active=true 的配置。无可用返回 None。"""
    active = [c for c in configs if c.get("is_active", True)]
    if not active:
        return None
    active.sort(key=lambda c: c.get("priority", 0))
    return active[0]


async def get_email_templates(db: AsyncSession) -> dict:
    """获取邮件模板（DB 优先，NULL/空则 fallback 到 EMAIL_TEMPLATES 默认值）"""
    settings = await get_settings(db)
    templates = settings.get("email_templates")
    if templates and isinstance(templates, dict):
        # 至少有一个语言键有内容才用 DB 的
        if templates.get("zh") or templates.get("en"):
            return templates
    return EMAIL_TEMPLATES


def format_email_template(tpl: dict, vars: dict) -> dict:
    """安全格式化单个模板，变量缺失时保留原占位符（不抛异常）"""
    sd = SafeDict(vars)
    return {
        "subject": tpl["subject"].format_map(sd),
        "body_html": tpl["body_html"].format_map(sd),
    }


def format_all_templates(templates: dict, vars: dict) -> dict:
    """安全格式化全部模板（zh + en 全部 purpose）"""
    sd = SafeDict(vars)
    result = {}
    for lang in templates:
        result[lang] = {}
        for purpose, tpl in templates[lang].items():
            result[lang][purpose] = {
                "subject": tpl["subject"].format_map(sd),
                "body_html": tpl["body_html"].format_map(sd),
            }
    return result


async def _send_with_config(cfg: dict, to_email: str, code: str, template: dict):
    """使用指定 SMTP 配置发送单封邮件。成功返回 True，失败抛异常。"""
    from_name = cfg.get("from_name", "AIsChat")
    sd = SafeDict(code=code, from_name=from_name)

    subject = template["subject"].format_map(sd)
    body_html = template["body_html"].format_map(sd)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{cfg['from_email']}>"
    msg["To"] = to_email
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    import aiosmtplib
    await aiosmtplib.send(
        msg,
        hostname=cfg["host"],
        port=cfg.get("port", 587),
        username=cfg["username"],
        password=cfg["password"],
        use_tls=cfg.get("use_tls", True),
    )


async def send_verification_code_email(
    db: AsyncSession,
    to_email: str,
    code: str,
    purpose: str,
    lang: str = "zh",
) -> bool:
    """发送验证码邮件（多 SMTP 容灾）。

    按优先级遍历全部 SMTP 配置，遇失败自动尝试下一个。
    成功返回 True，全部失败抛 ValueError（包含每个配置的错误信息）。
    """
    configs = await _get_smtp_configs(db)
    if not configs:
        raise ValueError("邮件服务未配置，请联系管理员")

    templates = await get_email_templates(db)
    lang = lang if lang in templates else "zh"
    template = templates[lang].get(purpose, templates[lang].get("register", templates[lang]["register"]))

    # 按优先级排序
    sorted_configs = sorted(configs, key=lambda c: c.get("priority", 0))

    errors = []
    tried = 0
    for i, cfg in enumerate(sorted_configs):
        if not cfg.get("is_active", True):
            continue
        tried += 1
        try:
            await _send_with_config(cfg, to_email, code, template)
            logger.info(f"验证码邮件已发送至 {to_email} (purpose={purpose}, smtp=#{i} {cfg.get('host')})")
            return True
        except Exception as e:
            err_msg = f"SMTP #{i} ({cfg.get('host')}): {e}"
            logger.warning(f"发送验证码邮件失败 ({err_msg})，尝试下一个配置...")
            errors.append(err_msg)

    if tried == 0:
        raise ValueError("没有可用的 SMTP 配置（全部已停用）")
    raise ValueError(f"所有 SMTP 配置均发送失败 ({tried} 个尝试): {'; '.join(errors)}")


async def test_smtp_connection(config: dict) -> tuple[bool, str]:
    """测试 SMTP 连接。返回 (ok, message)。"""
    try:
        import aiosmtplib
        from email.mime.text import MIMEText

        test_msg = MIMEText("AIsChat SMTP connection test", "plain", "utf-8")
        test_msg["Subject"] = "AIsChat SMTP Test"
        test_msg["From"] = f"{config.get('from_name', 'Test')} <{config['from_email']}>"
        test_msg["To"] = config["from_email"]  # 发给发件人自己

        await aiosmtplib.send(
            test_msg,
            hostname=config["host"],
            port=config.get("port", 587),
            username=config.get("username"),
            password=config.get("password", ""),
            use_tls=config.get("use_tls", True),
        )
        return True, "SMTP 连接成功，测试邮件已发送"
    except Exception as e:
        return False, f"SMTP 连接失败: {e}"
