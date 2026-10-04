from tests.conftest import register


def test_register_login_me(client):
    headers = register(client)
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == "care@example.com"
    assert me.json()["role"] == "caretaker"

    login = client.post("/api/v1/auth/login", json={"email": "CARE@example.com", "password": "correct-horse-1"})
    assert login.status_code == 200
    assert login.json()["token_type"] == "bearer"
    assert "ct_refresh" in login.cookies


def test_password_is_hashed(client, db):
    from app.models import User

    register(client)
    user = db.query(User).one()
    assert user.password_hash.startswith("$argon2")
    assert "correct-horse-1" not in user.password_hash


def test_bad_credentials_and_duplicate_email(client):
    register(client)
    bad = client.post("/api/v1/auth/login", json={"email": "care@example.com", "password": "wrong-password"})
    assert bad.status_code == 401
    dup = client.post(
        "/api/v1/auth/register",
        json={"email": "care@example.com", "password": "another-pass1", "full_name": "X"},
    )
    assert dup.status_code == 409


def test_validation(client):
    r = client.post("/api/v1/auth/register", json={"email": "nope", "password": "short", "full_name": ""})
    assert r.status_code == 422
    r = client.post(
        "/api/v1/auth/register",
        json={"email": "a@example.com", "password": "long-enough-1", "full_name": "A", "timezone": "Mars/Base"},
    )
    assert r.status_code == 422


def test_protected_routes_reject_anonymous_and_bad_tokens(client):
    assert client.get("/api/v1/patients").status_code == 401
    assert client.get("/api/v1/patients", headers={"Authorization": "Bearer garbage"}).status_code == 401
    assert client.get("/api/v1/dashboard").status_code == 401


def test_refresh_token_cookie(client):
    register(client)
    r = client.post("/api/v1/auth/refresh")
    assert r.status_code == 200
    assert r.json()["access_token"]
    client.post("/api/v1/auth/logout")
    client.cookies.clear()
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_refresh_token_cannot_be_used_as_access_token(client):
    register(client)
    refresh = client.cookies.get("ct_refresh")
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {refresh}"}).status_code == 401


def test_login_rate_limited(client):
    register(client)
    codes = [
        client.post("/api/v1/auth/login", json={"email": "care@example.com", "password": "bad-password"}).status_code
        for _ in range(12)
    ]
    assert 429 in codes


def test_deactivated_user_is_locked_out(client, admin_auth, db):
    headers = register(client, "other@example.com")
    users = client.get("/api/v1/admin/users", headers=admin_auth).json()
    uid = next(u["id"] for u in users if u["email"] == "other@example.com")
    client.put(f"/api/v1/admin/users/{uid}", headers=admin_auth, json={"is_active": False})
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
