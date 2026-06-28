"""
SMTP 邮件发送服务
使用 aiosmtplib 异步发送验证码邮件
"""
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.system_settings_service import get_settings
from app.utils.crypto import decrypt_api_key, encrypt_api_key

logger = logging.getLogger(__name__)

# 邮件模板
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


async def _get_smtp_config(db: AsyncSession) -> dict | None:
    """读取 SMTP 配置，密码解密。未配置返回 None。"""
    settings = await get_settings(db)
    smtp = settings.get("smtp_config")
    if not smtp:
        return None
    if isinstance(smtp, str):
        import json
        smtp = json.loads(smtp)
    # 解密密码
    if smtp.get("password_encrypted"):
        try:
            smtp["password"] = decrypt_api_key(smtp.pop("password_encrypted"))
        except Exception:
            smtp["password"] = ""
    else:
        smtp["password"] = smtp.get("password", "")
    return smtp


async def send_verification_code_email(
    db: AsyncSession,
    to_email: str,
    code: str,
    purpose: str,
    lang: str = "zh",
) -> bool:
    """发送验证码邮件。成功返回 True，失败抛 ValueError。"""
    smtp = await _get_smtp_config(db)
    if not smtp:
        raise ValueError("邮件服务未配置，请联系管理员")

    lang = lang if lang in EMAIL_TEMPLATES else "zh"
    template = EMAIL_TEMPLATES[lang].get(purpose, EMAIL_TEMPLATES[lang]["register"])
    from_name = smtp.get("from_name", "AIsChat")

    subject = template["subject"].format(from_name=from_name)
    body_html = template["body_html"].format(code=code, from_name=from_name)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{smtp['from_email']}>"
    msg["To"] = to_email
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    use_tls = smtp.get("use_tls", True)
    port = smtp.get("port", 587)

    try:
        import aiosmtplib
        await aiosmtplib.send(
            msg,
            hostname=smtp["host"],
            port=port,
            username=smtp["username"],
            password=smtp["password"],
            use_tls=use_tls,
        )
        logger.info(f"验证码邮件已发送至 {to_email} (purpose={purpose})")
        return True
    except Exception as e:
        logger.error(f"发送验证码邮件失败: {e}")
        raise ValueError(f"邮件发送失败: {e}")


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
