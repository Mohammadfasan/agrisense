
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app


COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY config ./config
COPY scripts/fetch_model.py ./scripts/fetch_model.py

RUN useradd --create-home --uid 10001 mlservice \
 && mkdir -p /models \
 && chown mlservice /models
USER mlservice

ENV MODELS_DIR=/models
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=3s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=2)"


CMD ["sh", "-c", "python scripts/fetch_model.py --dest \"$MODELS_DIR\" && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]