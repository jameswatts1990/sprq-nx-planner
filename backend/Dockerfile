FROM python:3.14-slim

WORKDIR /app

# libpq5: psycopg runtime. libatomic1: required by the Node 26 binary the
# devcontainer installs (this image is the devcontainer base); slim lacks it.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    libatomic1 \
    && rm -rf /var/lib/apt/lists/*

# Pinned, hash-verified runtime deps first - this layer caches unless requirements.txt changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir --require-hashes -r requirements.txt

# Then the app itself, without re-resolving (its deps are already pinned above).
COPY pyproject.toml ./
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./

RUN pip install --no-cache-dir --no-deps .

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
