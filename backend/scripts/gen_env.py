"""Create ../.env from ../.env.example with fresh random secrets and a VAPID key pair.

Usage: python backend/scripts/gen_env.py [--force]
"""

import base64
import re
import secrets
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

ROOT = Path(__file__).resolve().parents[2]


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def vapid_keys() -> tuple[str, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return b64url(public), b64url(private)


def main() -> None:
    target = ROOT / ".env"
    if target.exists() and "--force" not in sys.argv:
        sys.exit(".env already exists (use --force to overwrite)")
    text = (ROOT / ".env.example").read_text()
    db_password = secrets.token_urlsafe(18)
    public, private = vapid_keys()
    values = {
        "POSTGRES_PASSWORD": db_password,
        "JWT_SECRET": secrets.token_urlsafe(48),
        "DEVICE_API_SECRET": secrets.token_urlsafe(48),
        "VAPID_PUBLIC_KEY": public,
        "VAPID_PRIVATE_KEY": private,
    }
    for name, value in values.items():
        text = re.sub(rf"^{name}=.*$", f"{name}={value}", text, flags=re.M)
    text = text.replace("CHANGE_ME", db_password)
    target.write_text(text)
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
