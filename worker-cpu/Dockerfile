FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Celery CPU worker: concurrency=4 (parallel lightweight tasks)
CMD ["celery", "-A", "tasks", "worker", \
     "--queues=cpu", \
     "--concurrency=4", \
     "--pool=prefork", \
     "--loglevel=info", \
     "-n", "cpu-worker@%h"]
