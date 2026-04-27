FROM pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Celery GPU worker: concurrency=1 (one GPU task at a time), solo pool
CMD ["celery", "-A", "tasks", "worker", \
     "--queues=gpu", \
     "--concurrency=1", \
     "--pool=solo", \
     "--loglevel=info", \
     "-n", "gpu-worker@%h"]
