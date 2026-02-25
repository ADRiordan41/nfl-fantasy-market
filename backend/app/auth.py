from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta


PASSWORD_HASH_ALGO = "pbkdf2_sha256"
PASSWORD_PBKDF2_ITERATIONS = int(os.environ.get("PASSWORD_PBKDF2_ITERATIONS", "390000"))
PASSWORD_SALT_BYTES = int(os.environ.get("PASSWORD_SALT_BYTES", "16"))

SESSION_TOKEN_BYTES = int(os.environ.get("SESSION_TOKEN_BYTES", "32"))
SESSION_TOKEN_PREFIX = os.environ.get("SESSION_TOKEN_PREFIX", "fsm")
SESSION_TTL_HOURS = max(1, int(os.environ.get("SESSION_TTL_HOURS", "168")))
SESSION_TOKEN_PEPPER = os.environ.get("SESSION_TOKEN_PEPPER", "").encode("utf-8")


def _b64_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def hash_password(password: str) -> str:
    salt = os.urandom(PASSWORD_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_PBKDF2_ITERATIONS,
    )
    return f"{PASSWORD_HASH_ALGO}${PASSWORD_PBKDF2_ITERATIONS}${_b64_encode(salt)}${_b64_encode(digest)}"


def verify_password(password: str, encoded_hash: str | None) -> bool:
    if not encoded_hash:
        return False
    parts = encoded_hash.split("$")
    if len(parts) != 4:
        return False

    algo, iterations_raw, salt_raw, digest_raw = parts
    if algo != PASSWORD_HASH_ALGO:
        return False

    try:
        iterations = int(iterations_raw)
        salt = _b64_decode(salt_raw)
        expected_digest = _b64_decode(digest_raw)
    except (ValueError, binascii.Error):
        return False

    candidate_digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(candidate_digest, expected_digest)


def generate_session_token() -> str:
    return f"{SESSION_TOKEN_PREFIX}_{secrets.token_urlsafe(SESSION_TOKEN_BYTES)}"


def hash_session_token(token: str) -> str:
    digest = hashlib.sha256()
    digest.update(SESSION_TOKEN_PEPPER)
    digest.update(token.encode("utf-8"))
    return digest.hexdigest()


def session_expiry_from_now(now: datetime | None = None) -> datetime:
    current = now or datetime.utcnow()
    return current + timedelta(hours=SESSION_TTL_HOURS)
