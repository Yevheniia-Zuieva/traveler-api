# --- Етап 1: збірка залежностей ---
FROM python:3.12-slim AS builder

WORKDIR /build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /build/wheels -r requirements.txt

# --- Етап 2: runtime-образ ---
FROM python:3.12-slim AS runtime

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Встановлюємо runtime-бібліотеку PostgreSQL та curl для перевірки healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Створюємо непривілейованого користувача (UID/GID 1000)
RUN groupadd -g 1000 appgroup && \
    useradd -u 1000 -g appgroup -m -s /bin/bash appuser

COPY --from=builder /build/wheels /wheels
RUN pip install --no-cache /wheels/* && rm -rf /wheels

# Копіюємо код додатку та створюємо директорію для логів
COPY --chown=appuser:appgroup . .
RUN mkdir -p /app/logs && chown -R appuser:appgroup /app/logs

USER 1000:1000

EXPOSE 4567

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4567"]