"""Conservative trace redaction, independent of provider-bound projections."""

import re
from typing import Any

REDACTED = "[redacted]"
SENSITIVE_KEYS = frozenset(
    {
        "password",
        "passwd",
        "secret",
        "token",
        "apikey",
        "authorization",
        "cookie",
        "setcookie",
        "credentials",
        "privatekey",
        "email",
        "phone",
        "phonenumber",
        "ssn",
        "socialsecuritynumber",
        "fullname",
        "address",
    }
)
EMAIL = re.compile(
    r"\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}"
    r"@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,10}\b"
)
BEARER = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)
TOKEN = re.compile(r"\b(?:sk-(?:or-v1-)?|hf_|gh[pousr]_)[A-Za-z0-9_-]{16,}\b")
URL_PASSWORD = re.compile(
    r"\b([a-z][a-z0-9+.-]{0,31}://)[^\s/:@]{1,256}:[^\s/@]{1,4096}@", re.IGNORECASE
)
CREDENTIAL_ASSIGNMENT = re.compile(
    r"\b(api[_-]?key|password|passwd|client[_-]?secret|access[_-]?token)"
    r"\s*[:=]\s*(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)",
    re.IGNORECASE,
)


def redact_text(value: str, secrets: tuple[str, ...] = ()) -> str:
    for secret in secrets:
        value = value.replace(secret, REDACTED)
    value = BEARER.sub("Bearer " + REDACTED, value)
    value = TOKEN.sub(REDACTED, value)
    value = URL_PASSWORD.sub(r"\1[redacted]@", value)
    value = CREDENTIAL_ASSIGNMENT.sub(r"\1=[redacted]", value)
    return EMAIL.sub(REDACTED, value)


def redact_payload(value: Any, secrets: tuple[str, ...] = ()) -> Any:
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            normalized = re.sub(r"[^a-z0-9]", "", key.lower())
            sensitive = normalized in SENSITIVE_KEYS or normalized.endswith(
                ("password", "secret", "apikey", "accesstoken", "refreshtoken", "authtoken")
            )
            result[redact_text(key, secrets)] = (
                REDACTED if sensitive else redact_payload(item, secrets)
            )
        return result
    if isinstance(value, list):
        return [redact_payload(item, secrets) for item in value]
    if isinstance(value, str):
        return redact_text(value, secrets)
    return value
