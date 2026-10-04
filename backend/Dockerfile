FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini pyproject.toml ./
COPY alembic ./alembic
COPY app ./app
COPY scripts ./scripts

RUN useradd --system --no-create-home caredose
USER caredose

EXPOSE 8000
# Apply migrations, then serve. One worker: the WebSocket hub and scheduler live in-process.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
