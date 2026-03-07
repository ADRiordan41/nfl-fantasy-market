import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Iterable


@dataclass(frozen=True)
class SmtpSettings:
    host: str
    port: int
    username: str | None
    password: str | None
    from_email: str
    from_name: str
    use_starttls: bool
    use_ssl: bool

    @property
    def enabled(self) -> bool:
        return bool(self.host and self.port and self.from_email)


def format_from_header(from_name: str, from_email: str) -> str:
    return f"{from_name} <{from_email}>" if from_name else from_email


def build_password_reset_email(
    *,
    to_email: str,
    from_name: str,
    from_email: str,
    reset_url: str,
    expiry_minutes: int,
) -> EmailMessage:
    message = EmailMessage()
    message["To"] = to_email
    message["From"] = format_from_header(from_name, from_email)
    message["Subject"] = "MatchupMarket password reset"
    message.set_content(
        "\n".join(
            [
                "A password reset was requested for your MatchupMarket account.",
                "",
                f"Reset your password: {reset_url}",
                f"This link expires in {expiry_minutes} minutes.",
                "",
                "If you did not request this reset, you can ignore this email.",
            ]
        )
    )
    return message


def send_smtp_message(settings: SmtpSettings, message: EmailMessage, *, recipients: Iterable[str] | None = None) -> None:
    if not settings.enabled:
        raise RuntimeError("SMTP mail delivery is not configured.")

    targets = list(recipients) if recipients is not None else [value.strip() for value in message.get_all("To", [])]
    if not targets:
        raise RuntimeError("SMTP message is missing recipients.")

    if settings.use_ssl:
        with smtplib.SMTP_SSL(settings.host, settings.port, timeout=20, context=ssl.create_default_context()) as server:
            if settings.username:
                server.login(settings.username, settings.password or "")
            server.send_message(message, to_addrs=targets)
        return

    with smtplib.SMTP(settings.host, settings.port, timeout=20) as server:
        server.ehlo()
        if settings.use_starttls:
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
        if settings.username:
            server.login(settings.username, settings.password or "")
        server.send_message(message, to_addrs=targets)
