FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/tmp/.hf_cache \
    TORCH_HOME=/tmp/.torch_cache \
    DEVICE=cpu \
    ENABLE_LCM=true \
    CPU_INFERENCE_SIZE=384

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libegl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p uploads outputs outputs/models3d sample_sketches app/database /tmp/.hf_cache /tmp/.torch_cache && \
    chmod -R 777 /app /tmp/.hf_cache /tmp/.torch_cache

EXPOSE 8005

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8005"]
