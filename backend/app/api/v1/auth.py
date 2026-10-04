from datetime import UTC, datetime

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from sqlalchemy import select

from app.config import get_settings
from app.deps import DB, CurrentUser, auth_limit, refresh_limit
from app.models import User
from app.schemas import LoginIn, ProfileIn, RegisterIn, TokenOut, UserOut
from app.services.auth import authenticate, create_token, create_user, decode_token
from app.services.system import audit

router = APIRouter(prefix="/auth", tags=["auth"])
REFRESH_COOKIE = "ct_refresh"


def _issue(response: Response, user: User) -> TokenOut:
    s = get_settings()
    response.set_cookie(
        REFRESH_COOKIE,
        create_token(user, "refresh"),
        max_age=s.jwt_refresh_token_expire_days * 86400,
        httponly=True,
        secure=s.is_production,
        samesite="strict",
        path="/api/v1/auth",
    )
    return TokenOut(
        access_token=create_token(user, "access"),
        expires_in=s.jwt_access_token_expire_minutes * 60,
        user=UserOut.model_validate(user),
    )


@router.post("/register", response_model=TokenOut, status_code=201, dependencies=[Depends(auth_limit)])
def register(body: RegisterIn, request: Request, response: Response, db: DB) -> TokenOut:
    if db.scalar(select(User.id).where(User.email == body.email.lower())):
        raise HTTPException(409, "An account with this email already exists")
    user = create_user(
        db,
        email=body.email,
        password=body.password,
        full_name=body.full_name,
        role="caretaker",
        timezone=body.timezone,
    )
    user.last_login_at = datetime.now(UTC)
    audit(db, "user.register", "user", user.id, user=user, request=request)
    db.commit()
    return _issue(response, user)


@router.post("/login", response_model=TokenOut, dependencies=[Depends(auth_limit)])
def login(body: LoginIn, request: Request, response: Response, db: DB) -> TokenOut:
    user = authenticate(db, body.email, body.password)
    if user is None:
        audit(db, "auth.login_failed", "user", request=request)
        db.commit()
        raise HTTPException(401, "Incorrect email or password")
    user.last_login_at = datetime.now(UTC)
    audit(db, "auth.login", "user", user.id, user=user, request=request)
    db.commit()
    return _issue(response, user)


@router.post("/refresh", response_model=TokenOut, dependencies=[Depends(refresh_limit)])
def refresh(response: Response, db: DB, ct_refresh: str | None = Cookie(default=None)) -> TokenOut:
    user_id = decode_token(ct_refresh, "refresh") if ct_refresh else None
    user = db.get(User, user_id) if user_id else None
    if user is None or not user.is_active:
        response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth")
        raise HTTPException(401, "Session expired, please sign in again")
    return _issue(response, user)


@router.post("/logout", status_code=204)
def logout(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth")


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user


@router.put("/me", response_model=UserOut)
def update_me(body: ProfileIn, user: CurrentUser, db: DB) -> User:
    user.full_name, user.timezone = body.full_name, body.timezone
    db.commit()
    return user
